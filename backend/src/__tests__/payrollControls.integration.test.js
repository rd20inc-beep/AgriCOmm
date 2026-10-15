/**
 * Payroll money controls (DB-gated, real routes + accounting engine):
 *   P2-09  advance payout: one locked transaction, pay drawer fields, booked to
 *          1330 Staff Advances on the payment date (D-11); recovery moves it to
 *          6135; concurrency + failure injection
 *   P2-10  no phantom cash: recovered advances / workers with history are not
 *          deleted; financial FKs RESTRICT
 *   P2-11  final settlement: atomic, exact advance recovery, one per worker
 *   P2-25  maker-checker, leave approval only via /approve, accrue = pay,
 *          no salary through mill expenses
 *   P2-27  recurring "Post now" guard, series end date, scheduler claim/retry
 *
 * Local run (throwaway DB, migrated):
 *   DB_HOST=… DB_NAME=… NODE_ENV=test npx jest --runInBand src/__tests__/payrollControls.integration.test.js
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('payroll controls (DB-gated)', () => {
  let db; let router; let accountingService; let advances; let settlement; let payroll; let automation;
  const tag = `${Date.now()}`.slice(-7);
  const ids = {};
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  // Run a route's FULL middleware chain (authorize, ownerApproval, audit, handler).
  const layerFor = (method, path) => router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  const call = async (method, path, { params = {}, body = {}, query = {}, user } = {}) => {
    const res = { statusCode: 200, body: null, headersSent: false, on: () => {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; res.headersSent = true; return res; };
    const req = { params, body, query, headers: {}, user: { ...(user || ids.admin) } };
    for (const h of layerFor(method, path).route.stack.map((s) => s.handle)) {
      let nexted = false;
      await h(req, res, () => { nexted = true; });
      if (!nexted || res.headersSent) break;
    }
    return res;
  };
  // A user of a non-bypass role holding exactly `perms` (module.action).
  const userWith = (id, roleId, perms) => ({ id, role_id: roleId, _permissionsLoaded: true, permissions: new Set(perms), moduleScopes: new Set() });

  const netByAccount = async (refs) => {
    const rows = await db('journal_lines as jl')
      .join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .whereIn('je.ref_no', refs).where('je.status', 'Posted')
      .groupBy('c.code').select('c.code', db.raw('SUM(jl.debit - jl.credit) as net'));
    const out = {};
    for (const r of rows) out[r.code] = Math.round(parseFloat(r.net) * 100) / 100;
    return out;
  };
  const balance = async () => parseFloat((await db('bank_accounts').where('id', ids.bank).first()).current_balance);
  const makeWorker = async (over = {}) => (await db('mill_workers').insert({
    name: `ZZ ${over.name || 'Worker'} ${tag}`, entity: 'mill', pay_type: 'monthly', monthly_salary: 30000, daily_wage: 1000,
    is_active: true, joined_date: '2020-01-01', ...over, ...(over.name ? { name: `ZZ ${over.name} ${tag}` } : {}),
  }).returning('*'))[0];
  const approvedAdvance = async (workerId, amount, over = {}) => (await db('mill_worker_advances').insert({
    worker_id: workerId, amount, advance_date: '2026-08-01', recovered_amount: 0, status: 'pending', approval_status: 'approved',
    recovery_method: 'full_next_salary', auto_deduct: true, ...over,
  }).returning('*'))[0];
  const pay = (id, over = {}) => advances.payAdvance(id, { payDate: '2026-08-05', method: 'cash', bankAccountId: ids.bank, ...over }, ids.admin.id);

  beforeAll(async () => {
    db = require('../config/database');
    router = require('../modules/milling/milling.routes');
    accountingService = require('../modules/accounting/accounting.service');
    advances = require('../modules/milling/payrollAdvances');
    settlement = require('../modules/milling/finalSettlement');
    payroll = require('../modules/milling/payroll.service');
    automation = require('../modules/admin/automation.service');
    const roles = Object.fromEntries((await db('roles').select('id', 'name')).map((r) => [r.name, r.id]));
    const mkUser = async (name, roleId) => (await db('users').insert({
      email: `zz-${name}-${tag}@test.local`, full_name: `ZZ ${name} ${tag}`, password_hash: 'x', role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0];
    const admin = await mkUser('admin', roles['Super Admin']);
    const owner = await mkUser('owner', roles.Owner);
    const maker = await mkUser('maker', roles['QC Analyst']);
    const checker = await mkUser('checker', roles['QC Analyst']);
    const [b] = await db('bank_accounts').insert({
      name: `ZZ Mill Cash ${tag}`, type: 'cash', currency: 'PKR', entity: 'mill', current_balance: 1000000, is_active: true,
    }).returning('*');
    const all = ['payroll.view', 'payroll.create', 'payroll.approve', 'payroll.pay', 'payroll.delete', 'payroll.edit'];
    Object.assign(ids, {
      bank: b.id,
      admin: { id: admin.id, role_id: roles['Super Admin'] },
      owner: { id: owner.id, role_id: roles.Owner },
      maker: userWith(maker.id, roles['QC Analyst'], all),
      checker: userWith(checker.id, roles['QC Analyst'], all),
      approverOnly: userWith(checker.id, roles['QC Analyst'], ['payroll.view', 'payroll.approve']),
      qcRole: roles['QC Analyst'],
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (db) await db.destroy();
  });

  // ── P2-09 ──────────────────────────────────────────────────────────────────
  describe('P2-09 advance payout', () => {
    test('booked Dr 1330 / Cr cash on the PAYMENT date, with method, account and date on the advance', async () => {
      const w = await makeWorker({ name: 'Adv A' });
      ids.workerA = w.id;
      const a = await approvedAdvance(w.id, 6000);
      const before = await balance();
      const res = await call('post', '/advances/:id/pay', { params: { id: String(a.id) }, body: { pay_date: '2026-08-05', payment_method: 'cash', bank_account_id: ids.bank } });
      expect(res.statusCode).toBe(200);
      const adv = await db('mill_worker_advances').where('id', a.id).first();
      expect(adv).toMatchObject({ approval_status: 'paid', status: 'outstanding', payout_gl: 'asset', pay_method: 'cash', bank_account_id: ids.bank, paid_by: ids.admin.id });
      expect(adv.paid_at.toISOString ? adv.paid_at.toISOString().slice(0, 10) : String(adv.paid_at)).toMatch(/2026-08-0[45]/);
      const exp = await db('business_expenses').where('id', adv.expense_id).first();
      expect(exp).toMatchObject({ category: 'staff_advance', payment_status: 'Paid', employee_id: w.id });
      const payment = await db('payments').where({ source_table: 'business_expenses', source_id: exp.id }).first();
      const net = await netByAccount([exp.expense_no, payment.payment_no]);
      expect(net['1330']).toBe(6000);
      expect(net['2040'] || 0).toBe(0);
      expect(net['6135']).toBeUndefined();
      // Every journal of the payout is dated on the payment date.
      const dates = await db('journal_entries').whereIn('ref_no', [exp.expense_no, payment.payment_no]).pluck('date');
      expect(dates.map((x) => new Date(x).toISOString().slice(0, 10)).every((x) => x >= '2026-08-04' && x <= '2026-08-05')).toBe(true);
      expect(await balance()).toBe(before - 6000);
      ids.advA = a.id;
    });

    test('two concurrent pays → one payout, the other 409', async () => {
      const w = await makeWorker({ name: 'Adv B' });
      const a = await approvedAdvance(w.id, 3000);
      const before = await balance();
      const results = await Promise.allSettled([pay(a.id), pay(a.id)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rej = results.find((r) => r.status === 'rejected');
      expect(rej.reason.statusCode).toBe(409);
      const n = await db('business_expenses').where({ category: 'staff_advance', employee_id: w.id }).count('id as c').first();
      expect(parseInt(n.c, 10)).toBe(1);
      expect(await balance()).toBe(before - 3000);
    });

    test('a ledger failure mid-payout leaves no partial state', async () => {
      const w = await makeWorker({ name: 'Adv C' });
      const a = await approvedAdvance(w.id, 2500);
      const before = await balance();
      const paymentsBefore = parseInt((await db('payments').count('id as c').first()).c, 10);
      const real = accountingService.createJournal.bind(accountingService);
      const spy = jest.spyOn(accountingService, 'createJournal').mockImplementation(async (trx, args) => {
        if (args.refType === 'Business Expense') throw new Error('injected: closed period');
        return real(trx, args);
      });
      await expect(pay(a.id)).rejects.toMatchObject({ statusCode: 400 });
      spy.mockRestore();
      expect(await db('mill_worker_advances').where('id', a.id).first()).toMatchObject({ approval_status: 'approved', expense_id: null });
      expect(await db('business_expenses').where({ category: 'staff_advance', employee_id: w.id }).first()).toBeUndefined();
      expect(parseInt((await db('payments').count('id as c').first()).c, 10)).toBe(paymentsBefore);
      expect(await balance()).toBe(before);
      // …and it pays cleanly afterwards.
      await expect(pay(a.id)).resolves.toMatchObject({ approval_status: 'paid' });
    });

    test('the drawer fields are validated', async () => {
      const w = await makeWorker({ name: 'Adv D' });
      const a = await approvedAdvance(w.id, 1000);
      await expect(pay(a.id, { payDate: '2999-01-01' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(pay(a.id, { method: 'cheque' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(pay(a.id, { method: 'bank_transfer', bankAccountId: null })).rejects.toMatchObject({ statusCode: 400 });
      await expect(pay(a.id, { payDate: '2026-07-01' })).rejects.toMatchObject({ statusCode: 400 }); // before the request
      const pending = await approvedAdvance(w.id, 1000, { approval_status: 'pending' });
      await expect(pay(pending.id)).rejects.toMatchObject({ statusCode: 409 });
    });

    test('payroll recovery moves the asset to cost (Dr 6135 / Cr 1330); undoing the run nets it', async () => {
      const run = await payroll.preparePayrollRun({ month: '2026-08', lines: [{ worker_id: ids.workerA }] }, ids.maker.id);
      const line = await db('mill_payroll_lines').where('run_id', run.id).first();
      expect(parseFloat(line.advance_deducted)).toBe(6000);
      expect(parseFloat(line.net_pay)).toBe(24000);
      expect((await call('post', '/payroll/runs/:id/approve', { params: { id: String(run.id) }, user: ids.checker })).statusCode).toBe(200);
      expect((await call('post', '/payroll/runs/:id/pay', { params: { id: String(run.id) } })).statusCode).toBe(200);
      const rec = await netByAccount([`ADVREC-RUN-${run.id}`]);
      expect(rec).toEqual({ 1330: -6000, 6135: 6000 });
      const adv = await db('mill_worker_advances').where('id', ids.advA).first();
      expect(adv).toMatchObject({ status: 'recovered' });
      // Salary cost for the month = 24,000 net paid + 6,000 recovered = gross.
      const runRow = await db('mill_payroll_runs').where('id', run.id).first();
      const exp = await db('business_expenses').where('id', runRow.expense_id).first();
      const salary = await netByAccount([exp.expense_no]);
      expect(salary['6135'] + rec['6135']).toBe(30000);

      // P2-10: a recovered advance cannot be deleted or voided.
      expect((await call('delete', '/advances/:id', { params: { id: String(ids.advA) } })).statusCode).toBe(409);
      expect((await call('post', '/advances/:id/void', { params: { id: String(ids.advA) }, body: { reason: 'x' }, user: ids.owner })).statusCode).toBe(409);

      const undo = await call('delete', '/payroll/runs/:id', { params: { id: String(run.id) }, body: { reason: 'test' } });
      expect(undo.statusCode).toBe(200);
      const after = await netByAccount([`ADVREC-RUN-${run.id}`]);
      expect(after['1330']).toBe(0);
      expect(after['6135']).toBe(0);
      expect(await db('mill_worker_advances').where('id', ids.advA).first()).toMatchObject({ status: 'outstanding' });
      expect((await db('mill_payroll_lines').where('run_id', run.id)).every((l) => l.active === false)).toBe(true);
    });
  });

  // ── P2-10 ──────────────────────────────────────────────────────────────────
  describe('P2-10 deletion keeps money and history', () => {
    test('a worker with payroll history can only be deactivated; the tax statement keeps them', async () => {
      const res = await call('delete', '/workers/:id', { params: { id: String(ids.workerA) } });
      expect(res.statusCode).toBe(409);
      expect(res.body.message).toMatch(/Deactivate/);
      // The database refuses too (financial FKs are RESTRICT).
      await expect(db('mill_workers').where('id', ids.workerA).del()).rejects.toMatchObject({ code: '23503' });
      await db('mill_workers').where('id', ids.workerA).update({ is_active: false });
      const lines = await db('mill_payroll_lines').where('worker_id', ids.workerA);
      expect(lines.length).toBeGreaterThan(0);
    });

    test('a worker with no money history (only an unpaid request) can be deleted', async () => {
      const w = await makeWorker({ name: 'Fresh' });
      await approvedAdvance(w.id, 500, { approval_status: 'pending' });
      const res = await call('delete', '/workers/:id', { params: { id: String(w.id) } });
      expect(res.statusCode).toBe(200);
      expect(await db('mill_worker_advances').where('worker_id', w.id).first()).toBeUndefined();
    });

    test('an unpaid advance request is deleted; a paid one must be voided with a reason', async () => {
      const w = await makeWorker({ name: 'Void' });
      const req1 = await approvedAdvance(w.id, 700, { approval_status: 'pending' });
      expect((await call('delete', '/advances/:id', { params: { id: String(req1.id) } })).statusCode).toBe(200);
      const a = await approvedAdvance(w.id, 900);
      await pay(a.id);
      const before = await balance();
      expect((await call('delete', '/advances/:id', { params: { id: String(a.id) } })).statusCode).toBe(409);
      // Voiding is a payment reversal: the Owner must authorize it (D-3)…
      expect((await call('post', '/advances/:id/void', { params: { id: String(a.id) }, body: { reason: 'x' } })).statusCode).toBe(403);
      // …and give a reason.
      expect((await call('post', '/advances/:id/void', { params: { id: String(a.id) }, body: {}, user: ids.owner })).statusCode).toBe(400);
      expect((await call('post', '/advances/:id/void', { params: { id: String(a.id) }, body: { reason: 'wrong worker' }, user: ids.owner })).statusCode).toBe(200);
      expect(await balance()).toBe(before + 900);
      const v = await db('mill_worker_advances').where('id', a.id).first();
      expect(v).toMatchObject({ approval_status: 'voided', void_reason: 'wrong worker' });
      const exp = await db('business_expenses').where('id', v.expense_id).first();
      const payment = await db('payments').where({ source_table: 'business_expenses', source_id: exp.id }).first();
      const net = await netByAccount([exp.expense_no, payment.payment_no]);
      for (const val of Object.values(net)) expect(val).toBe(0);
    });
  });

  // ── P2-11 ──────────────────────────────────────────────────────────────────
  describe('P2-11 final settlement', () => {
    test('recovers exactly the entered advance; the rest stays outstanding; one settlement per worker', async () => {
      const w = await makeWorker({ name: 'Leaver', joined_date: '2024-01-01' });
      const a = await approvedAdvance(w.id, 8000);
      await pay(a.id);
      const calc = await settlement.computeFinalSettlement(w.id, { leftDate: '2026-08-10' });
      expect(calc.finalSalary).toBe(10000); // 10 days × 30,000 ÷ 30
      const s = await settlement.settleWorker(w.id, {
        left_date: '2026-08-10', settlement_date: '2026-08-12', advances_deducted: 5000, gratuity: 0, pay_method: 'cash',
      }, ids.admin.id);
      expect(s).toMatchObject({ status: 'active' });
      expect(parseFloat(s.final_salary)).toBe(10000);
      const adv = await db('mill_worker_advances').where('id', a.id).first();
      expect(parseFloat(adv.recovered_amount)).toBe(5000);
      expect(adv.status).toBe('outstanding');
      expect(await netByAccount([`ADVREC-FS-${s.id}`])).toEqual({ 1330: -5000, 6135: 5000 });
      expect((await db('mill_workers').where('id', w.id).first()).is_active).toBe(false);

      await expect(settlement.settleWorker(w.id, { left_date: '2026-08-10' }, ids.admin.id)).rejects.toMatchObject({ statusCode: 409 });

      // Reversal needs a reason; restores the advance, nets the GL, keeps the row.
      expect((await call('post', '/payroll/final-settlements/:id/reverse', { params: { id: String(s.id) }, body: {}, user: ids.owner })).statusCode).toBe(400);
      const rev = await call('post', '/payroll/final-settlements/:id/reverse', { params: { id: String(s.id) }, body: { reason: 'stayed on' }, user: ids.owner });
      expect(rev.statusCode).toBe(200);
      expect(await db('mill_final_settlements').where('id', s.id).first()).toMatchObject({ status: 'reversed', reversal_reason: 'stayed on' });
      expect(parseFloat((await db('mill_worker_advances').where('id', a.id).first()).recovered_amount)).toBe(0);
      expect(await netByAccount([`ADVREC-FS-${s.id}`])).toEqual({ 1330: 0, 6135: 0 });
      expect((await db('mill_workers').where('id', w.id).first()).is_active).toBe(true);
      expect((await call('delete', '/payroll/final-settlements/:id', { params: { id: String(s.id) } })).statusCode).toBe(405);
    });

    test('components: never above the server figure; lower needs a reason; advance capped at outstanding', async () => {
      const w = await makeWorker({ name: 'Leaver2' });
      const base = { left_date: '2026-08-10', settlement_date: '2026-08-12', gratuity: 0 };
      await expect(settlement.settleWorker(w.id, { ...base, final_salary: 99999 }, ids.admin.id)).rejects.toMatchObject({ statusCode: 400 });
      await expect(settlement.settleWorker(w.id, { ...base, final_salary: 5000 }, ids.admin.id)).rejects.toMatchObject({ statusCode: 400 });
      await expect(settlement.settleWorker(w.id, { ...base, advances_deducted: 100 }, ids.admin.id)).rejects.toMatchObject({ statusCode: 400 });
      const ok = await settlement.settleWorker(w.id, { ...base, final_salary: 5000, adjustment_reason: 'half month unpaid leave' }, ids.admin.id);
      expect(parseFloat(ok.final_salary)).toBe(5000);
    });

    test('concurrent settlements → exactly one', async () => {
      const w = await makeWorker({ name: 'Leaver3' });
      const body = { left_date: '2026-08-10', settlement_date: '2026-08-12', gratuity: 0 };
      const r = await Promise.allSettled([settlement.settleWorker(w.id, body, ids.admin.id), settlement.settleWorker(w.id, body, ids.admin.id)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(r.find((x) => x.status === 'rejected').reason.statusCode).toBe(409);
      expect((await db('mill_final_settlements').where('worker_id', w.id)).length).toBe(1);
    });

    test('a failure after the payout rolls the whole settlement back', async () => {
      const w = await makeWorker({ name: 'Leaver4' });
      const a = await approvedAdvance(w.id, 1000);
      await pay(a.id);
      const before = await balance();
      const real = accountingService.createJournal.bind(accountingService);
      const spy = jest.spyOn(accountingService, 'createJournal').mockImplementation(async (trx, args) => {
        if (args.refType === 'Staff Advance Recovery') throw new Error('injected');
        return real(trx, args);
      });
      await expect(settlement.settleWorker(w.id, { left_date: '2026-08-10', settlement_date: '2026-08-12', gratuity: 0 }, ids.admin.id)).rejects.toBeDefined();
      spy.mockRestore();
      expect(await db('mill_final_settlements').where('worker_id', w.id).first()).toBeUndefined();
      expect((await db('mill_workers').where('id', w.id).first()).is_active).toBe(true);
      expect(parseFloat((await db('mill_worker_advances').where('id', a.id).first()).recovered_amount)).toBe(0);
      expect(await db('business_expenses').where({ category: 'salaries', employee_id: w.id }).first()).toBeUndefined();
      expect(await balance()).toBe(before);
    });

    test('the schema holds one live line per employee-month', async () => {
      const w = await makeWorker({ name: 'Dup' });
      const [r1] = await db('mill_payroll_runs').insert({ period: '2026-05', pay_date: '2026-05-31', entity: 'mill', status: 'prepared', pay_method: 'cash', gross_total: 0, net_total: 0, advance_total: 0, employee_count: 1 }).returning('*');
      const [r2] = await db('mill_payroll_runs').insert({ period: '2026-05', pay_date: '2026-05-31', entity: 'mill', status: 'prepared', pay_method: 'cash', gross_total: 0, net_total: 0, advance_total: 0, employee_count: 1 }).returning('*');
      const line = (runId) => ({ run_id: runId, worker_id: w.id, worker_name: 'x', gross_pay: 1, net_pay: 1 });
      await db('mill_payroll_lines').insert(line(r1.id));
      expect((await db('mill_payroll_lines').where('run_id', r1.id).first()).period).toBe('2026-05'); // trigger
      await expect(db('mill_payroll_lines').insert(line(r2.id))).rejects.toMatchObject({ code: '23505' });
    });
  });

  // ── P2-25 ──────────────────────────────────────────────────────────────────
  describe('P2-25 maker-checker and bypass paths', () => {
    test('the preparer cannot approve; another approver can; an Owner who prepared may, and it is recorded', async () => {
      const w1 = await makeWorker({ name: 'SoD1' });
      const run = await payroll.preparePayrollRun({ month: '2026-06', lines: [{ worker_id: w1.id }] }, ids.maker.id);
      const self = await call('post', '/payroll/runs/:id/approve', { params: { id: String(run.id) }, user: ids.maker });
      expect(self.statusCode).toBe(403);
      const ok = await call('post', '/payroll/runs/:id/approve', { params: { id: String(run.id) }, user: ids.checker });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.data.run.self_approved).toBe(false);

      const w2 = await makeWorker({ name: 'SoD2' });
      const run2 = await payroll.preparePayrollRun({ month: '2026-06', lines: [{ worker_id: w2.id }] }, ids.owner.id);
      const own = await call('post', '/payroll/runs/:id/approve', { params: { id: String(run2.id) }, user: ids.owner });
      expect(own.statusCode).toBe(200);
      expect(own.body.data.run.self_approved).toBe(true);
    });

    test('Accrue needs payroll.pay, not payroll.approve', async () => {
      const res = await call('post', '/payroll/runs/:id/accrue', { params: { id: '999999' }, user: ids.approverOnly });
      expect(res.statusCode).toBe(403);
      const res2 = await call('post', '/payroll/runs/:id/accrue', { params: { id: '999999' }, user: ids.checker });
      expect(res2.statusCode).toBe(404); // past the permission gate
    });

    test('a salary cannot be paid as a mill expense', async () => {
      const res = await call('post', '/expenses', { body: { category: 'salaries', amount: 1000, expense_date: today, employee_id: ids.workerA } });
      expect(res.statusCode).toBe(400);
      const res2 = await call('post', '/expenses', { body: { category: 'Staff_Advance', amount: 1000, expense_date: today } });
      expect(res2.statusCode).toBe(400);
      const heads = await call('get', '/expenses/heads');
      expect(heads.body.data.heads).not.toContain('salaries');
    });

    test('leave: create is always pending; approve checks overlap, quota and worked days', async () => {
      const w = await makeWorker({ name: 'Leave' });
      const created = await call('post', '/payroll/leave-requests', { body: { worker_id: w.id, from_date: '2026-08-03', to_date: '2026-08-04', status: 'approved' } });
      expect(created.statusCode).toBe(201);
      expect(created.body.data.status).toBe('pending');
      expect(created.body.data.approved_by).toBeNull();
      const overlap = await call('post', '/payroll/leave-requests', { body: { worker_id: w.id, from_date: '2026-08-04', to_date: '2026-08-06' } });
      expect(overlap.statusCode).toBe(409);
      const ok = await call('post', '/payroll/leave-requests/:id/approve', { params: { id: String(created.body.data.id) } });
      expect(ok.statusCode).toBe(200);
      expect((await call('post', '/payroll/leave-requests/:id/approve', { params: { id: String(created.body.data.id) } })).statusCode).toBe(409);

      // A day marked present is never overwritten by leave.
      await db('mill_attendance').insert({ worker_id: w.id, date: '2026-08-20', status: 'present', hours_worked: 8, overtime_hours: 0 });
      const lr = await call('post', '/payroll/leave-requests', { body: { worker_id: w.id, from_date: '2026-08-19', to_date: '2026-08-21' } });
      const blocked = await call('post', '/payroll/leave-requests/:id/approve', { params: { id: String(lr.body.data.id) } });
      expect(blocked.statusCode).toBe(409);
      expect((await db('mill_attendance').where({ worker_id: w.id }).whereRaw("date = '2026-08-20'").first()).status).toBe('present');

      // Quota.
      const [t] = await db('mill_leave_types').insert({ name: `ZZ Short ${tag}`, code: `ZZS${tag}`, paid: true, annual_quota: 2, accrues: false, is_active: true }).returning('*');
      const over = await call('post', '/payroll/leave-requests', { body: { worker_id: w.id, leave_type_id: t.id, from_date: '2026-09-01', to_date: '2026-09-03' } });
      expect(over.statusCode).toBe(409);
      expect(over.body.message).toMatch(/only 2 remain/);
      await db('mill_leave_types').where('id', t.id).update({ is_active: false });
    });
  });

  // ── data-correction scripts ────────────────────────────────────────────────
  describe('detection / correction scripts', () => {
    test('an orphan (duplicate) advance payout is detected and only it passes the correction check', async () => {
      const { detect } = require('../../scripts/detectPayrollDuplicates');
      const { orphanCheck } = require('../../scripts/reversePayrollDuplicatePayouts');
      const dup = await db.transaction((trx) => require('../modules/expenses/expenses.service').create({
        expense_type: 'mill', category: 'salaries', amount: 1500, currency: 'PKR', expense_date: '2026-08-05',
        description: `Salary advance — ZZ Dup ${tag}`, pay_now: true, bank_account_id: ids.bank, payment_method: 'cash',
      }, ids.admin.id, trx));
      const r = await detect(db);
      expect(r.A_orphanAdvancePayouts).toContain(dup.id);
      expect(r.B_duplicateSettlements).toEqual([]);
      expect(r.C_duplicateLines).toEqual([]);
      expect(await orphanCheck(db, dup.id)).toBeNull();
      const linked = await db('mill_worker_advances as a').join('business_expenses as e', 'e.id', 'a.expense_id')
        .where('e.category', 'staff_advance').first('a.expense_id');
      expect(await orphanCheck(db, linked.expense_id)).toMatch(/linked to advance/);
    });
  });

  // ── P2-27 ──────────────────────────────────────────────────────────────────
  describe('P2-27 recurring expenses + scheduler', () => {
    const expensesService = () => require('../modules/expenses/expenses.service');
    const series = async (vendor, date) => expensesService().create({
      expense_type: 'mill', category: 'utilities', amount: 1200, currency: 'PKR', expense_date: date,
      vendor_name: `ZZ ${vendor} ${tag}`, is_recurring: true, recurrence: 'monthly',
    }, ids.admin.id);

    test('double "Post now" → one occurrence; then not due → 409', async () => {
      const t = await series('Power', daysAgo(40));
      const r = await Promise.allSettled([
        automation.materializeRecurringExpense(t.id, { userId: ids.admin.id }),
        automation.materializeRecurringExpense(t.id, { userId: ids.admin.id }),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(r.find((x) => x.status === 'rejected').reason.statusCode).toBe(409);
      const rows = await db('business_expenses').where({ vendor_name: `ZZ Power ${tag}` });
      expect(rows).toHaveLength(2);
      const res = await call('post', '/expenses/recurring/:id/materialize', { params: { id: String(t.id) } });
      expect(res.statusCode).toBe(409);
    });

    test('a stopped series posts nothing past its end date', async () => {
      const t = await series('Rent', daysAgo(100));
      const stop = await call('post', '/expenses/recurring/:id/stop', { params: { id: String(t.id) }, body: { end_date: daysAgo(50) } });
      expect(stop.statusCode).toBe(200);
      await automation.materializeDueRecurringExpenses({ userId: ids.admin.id });
      const rows = await db('business_expenses').where({ vendor_name: `ZZ Rent ${tag}` }).orderBy('expense_date');
      expect(rows.length).toBe(2); // the template + the one occurrence before the end date
      expect(new Date(rows[1].expense_date).toISOString().slice(0, 10) <= daysAgo(50)).toBe(true);
      // Re-running posts nothing more.
      await automation.materializeDueRecurringExpenses({ userId: ids.admin.id });
      expect((await db('business_expenses').where({ vendor_name: `ZZ Rent ${tag}` })).length).toBe(2);
    });

    test('scheduler: one runner claims a due task; a placeholder is Skipped, not Success', async () => {
      await db('scheduled_tasks').update({ is_active: false });
      const [task] = await db('scheduled_tasks').insert({ name: `ZZ report ${tag}`, task_type: 'report_generation', cron_expression: '0 9 * * *', is_active: true, next_run: daysAgo(1) }).returning('*');
      const claims = await Promise.all([automation.claimTask(task), automation.claimTask(task)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await db('scheduled_tasks').where('id', task.id).update({ last_status: null });
      const now = new Date();
      await automation.runDueScheduledTasks(now);
      const after = await db('scheduled_tasks').where('id', task.id).first();
      expect(after.last_status).toBe('Skipped');
      expect(new Date(after.next_run).getTime()).toBeGreaterThan(now.getTime());
      expect(new Date(after.next_run).getUTCHours()).toBe(9);
      await db('scheduled_tasks').where('id', task.id).update({ is_active: false });
    });

    test('scheduler: a failing task is retried, then reported and moved to its next slot', async () => {
      const [task] = await db('scheduled_tasks').insert({ name: `ZZ receivables ${tag}`, task_type: 'email_reminder', cron_expression: '0 9 * * *', is_active: true, next_run: daysAgo(1) }).returning('*');
      const spy = jest.spyOn(automation, 'scanOverdueReceivables').mockRejectedValue(new Error('smtp down'));
      let now = new Date();
      for (let i = 1; i <= 3; i += 1) {
        await automation.runDueScheduledTasks(now);
        const t = await db('scheduled_tasks').where('id', task.id).first();
        expect(t.last_status).toBe('Failed');
        expect(t.last_error).toBe('smtp down');
        if (i < 3) {
          expect(t.failure_count).toBe(i);
          expect(new Date(t.next_run).getTime() - now.getTime()).toBeLessThan(5 * 60 * 1000); // next tick
        } else {
          expect(t.failure_count).toBe(0);
          expect(new Date(t.next_run).getUTCHours()).toBe(9);
        }
        now = new Date(now.getTime() + 2 * 60 * 1000);
      }
      spy.mockRestore();
      const note = await db('notifications').where('linked_ref', `TASK-${task.id}`).first();
      expect(note).toBeDefined();
      await db('scheduled_tasks').where('id', task.id).update({ is_active: false });
    });
  });
});
