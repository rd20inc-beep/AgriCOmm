/**
 * P4-08 — payroll reports and the employee ledger (PAY-19, PAY-20, PAY-21).
 * Golden numbers on a seeded payroll year (2091) with a run in every status:
 *
 *   R1 2091-01 paid       gross 30,000 + bonus 2,000 − statutory 1,500 − deductions 500
 *                         − advance 400 = 29,600 computed; 29,000 paid, 600 short
 *   R2 2091-02 accrued    30,000 (earned, not paid)
 *   R3 2091-03 approved   30,000 (nothing booked)
 *   R4 2091-04 voided     30,000 (nothing)
 *   R5 2091-05 partially  W paid 20,000; W2 unpaid 10,000
 *   R6 2091-01 general    G paid 5,000 (another entity)
 *   advances (W): paid 1,000 (400 recovered), pending 5,000, rejected 2,000
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('payroll reports (DB-gated)', () => {
  let db; let router; let svc; const ids = {};
  const tag = `ZZPR${`${Date.now()}`.slice(-7)}`;

  const layerFor = (method, path) => router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  const call = async (method, path, { params = {}, query = {} } = {}) => {
    const res = { statusCode: 200, body: null, headersSent: false, on: () => {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; res.headersSent = true; return res; };
    const req = { params, body: {}, query, headers: {}, user: { ...ids.admin } };
    for (const h of layerFor(method, path).route.stack.map((s) => s.handle)) {
      let nexted = false;
      await h(req, res, () => { nexted = true; });
      if (!nexted || res.headersSent) break;
    }
    return res;
  };

  beforeAll(async () => {
    db = require('../config/database');
    router = require('../modules/milling/milling.routes');
    svc = require('../modules/analytics/reporting.service');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `${tag.toLowerCase()}@test.local`, full_name: tag, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids.admin = { id: u.id, role_id: role.id, role: 'Super Admin' };
    const worker = async (name, entity) => (await db('mill_workers').insert({
      name: `${tag} ${name}`, entity, pay_type: 'monthly', monthly_salary: 30000, daily_wage: 1000, is_active: true, joined_date: '2090-01-01',
    }).returning('*'))[0];
    const W = await worker('W', 'mill'); const W2 = await worker('W2', 'mill'); const G = await worker('G', 'general');
    Object.assign(ids, { W: W.id, W2: W2.id, G: G.id });

    const runOf = async (period, status, entity, lines) => {
      const [r] = await db('mill_payroll_runs').insert({
        period, pay_date: `${period}-28`, status, entity, pay_method: 'cash', employee_count: lines.length,
        gross_total: lines.reduce((s, l) => s + l.gross_pay, 0), net_total: lines.reduce((s, l) => s + l.net_pay, 0),
        advance_total: lines.reduce((s, l) => s + (l.advance_deducted || 0), 0),
        paid_at: status === 'paid' ? new Date(`${period}-28T10:00:00Z`) : null,
      }).returning('*');
      await db('mill_payroll_lines').insert(lines.map((l) => ({
        run_id: r.id, period, worker_name: `${tag} line`, active: status !== 'voided', bonus_total: 0, statutory_total: 0,
        deduction_total: 0, advance_deducted: 0, short_pay_amount: 0, basic_pay: l.gross_pay, ...l,
      })));
      return r;
    };
    const paidAt = (p) => new Date(`${p}-28T10:00:00Z`);
    await runOf('2091-01', 'paid', 'mill', [{
      worker_id: W.id, gross_pay: 30000, bonus_total: 2000, statutory_total: 1500, deduction_total: 500,
      advance_deducted: 400, net_pay: 29000, short_pay_amount: 600, paid_at: paidAt('2091-01'),
    }]);
    await runOf('2091-02', 'accrued', 'mill', [{ worker_id: W.id, gross_pay: 30000, net_pay: 30000 }]);
    await runOf('2091-03', 'approved', 'mill', [{ worker_id: W.id, gross_pay: 30000, net_pay: 30000 }]);
    await runOf('2091-04', 'voided', 'mill', [{ worker_id: W.id, gross_pay: 30000, net_pay: 30000 }]);
    await runOf('2091-05', 'partially_paid', 'mill', [
      { worker_id: W.id, gross_pay: 20000, net_pay: 20000, paid_at: paidAt('2091-05') },
      { worker_id: W2.id, gross_pay: 10000, net_pay: 10000 },
    ]);
    await runOf('2091-01', 'paid', 'general', [{ worker_id: G.id, gross_pay: 5000, net_pay: 5000, paid_at: paidAt('2091-01') }]);

    const adv = (amount, approval_status, status, recovered = 0) => ({
      worker_id: W.id, amount, advance_date: '2091-01-05', approval_status, status, recovered_amount: recovered,
      recovery_method: 'full_next_salary', auto_deduct: true,
    });
    await db('mill_worker_advances').insert([
      adv(1000, 'paid', 'outstanding', 400), adv(5000, 'pending', 'pending'), adv(2000, 'rejected', 'pending'),
    ]);
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('employee ledger: only earned lines credit, only paid lines debit; bonus/statutory/deductions modelled', async () => {
    const res = await call('get', '/workers/:id/ledger', { params: { id: String(ids.W) } });
    expect(res.statusCode).toBe(200);
    const { summary, entries } = res.body.data;
    expect(summary).toMatchObject({
      salaryEarned: 80000, bonus: 2000, statutoryWithheld: 1500, deductions: 500,
      salaryPaid: 49000, accruedUnpaid: 30000, advancesTaken: 1000, advanceDeducted: 400,
      advanceOutstanding: 600, pendingLines: 1, pendingNet: 30000,
    });
    // owed = accrued Feb salary + Jan short pay − advance still outstanding
    expect(summary.currentBalance).toBe(30000 + 600 - 600);
    expect(entries.filter((e) => e.type === 'salary_paid')).toHaveLength(2);
    expect(entries.some((e) => /2091-03|2091-04/.test(e.reference || ''))).toBe(false);
  });

  test('/payroll/report: totals are paid lines only; every status listed and broken out', async () => {
    const res = await call('get', '/payroll/report', { query: { from: '2091-01', to: '2091-12', entity: 'mill' } });
    const { runs, totals } = res.body.data;
    expect(runs).toHaveLength(5);
    expect(totals).toMatchObject({
      runs: 5, paidRuns: 2, employees: 2, grossTotal: 50000, bonusTotal: 2000, statutoryTotal: 1500,
      deductionTotal: 500, advanceTotal: 400, netTotal: 49000, basis: 'paid lines',
    });
    expect(totals.byStatus.voided).toMatchObject({ runs: 1, netTotal: 30000 });
    const onlyPaid = await call('get', '/payroll/report', { query: { from: '2091-01', to: '2091-12', entity: 'mill', status: 'paid' } });
    expect(onlyPaid.body.data.runs).toHaveLength(1);
  });

  test('payroll ledger: status filter applied, entity filter, columns modelled, no invented "Mill Cash"', async () => {
    const paid = await svc.getPayrollLedger({ from: '2091-01', to: '2091-12' });
    expect(paid.rows).toHaveLength(3);
    expect(paid.totals.net).toBe(54000);
    const mill = await svc.getPayrollLedger({ from: '2091-01', to: '2091-12', entity: 'mill' });
    expect(mill.totals).toMatchObject({ count: 2, net: 49000, gross: 50000, bonus: 2000, statutory: 1500, deductions: 500, shortPay: 600 });
    const jan = mill.rows.find((r) => r.period === '2091-01');
    expect(jan.gross + jan.bonus - jan.statutory - jan.deductions - jan.advanceDeducted - jan.shortPay).toBe(jan.net);
    expect(jan.account).toBe('Cash (no account recorded)');
    const unpaid = await svc.getPayrollLedger({ from: '2091-01', to: '2091-12', entity: 'mill', status: 'unpaid' });
    expect(unpaid.rows.map((r) => r.status).sort()).toEqual(['Accrued', 'Pending', 'Pending']);
    const all = await svc.getPayrollLedger({ from: '2091-01', to: '2091-12', entity: 'mill', status: 'all' });
    expect(all.rows).toHaveLength(6);
  });

  test('analytics: advances given = paid advances only', async () => {
    const a = await svc.getPayrollAnalytics({ from: '2091-01', to: '2091-12', entity: 'mill' });
    expect(a.summary.advancesGiven).toBe(1000);
    expect(a.summary.totalNet).toBe(49000);
    expect(a.summary.advanceRecoveryRate).toBe(40);
  });
});
