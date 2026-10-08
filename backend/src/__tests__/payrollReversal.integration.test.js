/**
 * Payroll undo is audit-safe (DB-gated, real routes + accounting engine).
 *
 * DELETE /milling/payroll/runs/:id used to hard-delete the run's salaries
 * expense, payable, payment, bank_transactions row and journals. Now:
 *   - every journal stays and is netted by a signed-delta journal
 *     (TB moves by exactly −1× the original, never −2×);
 *   - the bank is restored with a reversing bank_transactions row (both kept);
 *   - expense / payable / payment are kept as 'Reversed';
 *   - the run is kept as 'reversed', its lines no longer count as paid;
 *   - an undo is refused (409) once a statutory liability it withheld has been
 *     remitted, and nothing moves.
 *
 * Local run: see exportShipmentCogs.integration.test.js header (migrate first).
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('payroll run undo (DB-gated)', () => {
  let db; let router;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  const handler = (method, path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const hs = layer.route.stack.map((s) => s.handle);
    return hs[hs.length - 1];
  };
  const call = async (method, path, { params = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await handler(method, path)({ params, body, query: {}, user: { id: ids.user } }, res);
    return res;
  };

  // Net Dr−Cr per account over every Posted journal whose ref is in refs.
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

  const makeRun = async (statutory) => {
    const [r] = await db('mill_payroll_runs').insert({
      period: '2026-09', pay_date: '2026-09-30', entity: 'mill', status: 'approved',
      pay_method: 'cash', bank_account_id: ids.bank, gross_total: 30000, net_total: 29500,
      advance_total: 0, employee_count: 1, created_by: ids.user,
    }).returning('*');
    await db('mill_payroll_lines').insert({
      run_id: r.id, worker_id: ids.worker, worker_name: `ZZ Worker ${run}`,
      basic_pay: 30000, gross_pay: 30000, net_pay: 29500, advance_deducted: 0,
      bonus_total: 0, deduction_total: 0, effective_days: 30, ot_hours: 0, ot_pay: 0,
      statutory_total: statutory ? 500 : 0,
      statutory_json: JSON.stringify(statutory ? [{ name: 'EOBI', account: '2050', amount: 500 }] : []),
    });
    return r;
  };

  beforeAll(async () => {
    db = require('../config/database');
    router = require('../modules/milling/milling.routes');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-payroll-${run}@test.local`, full_name: `ZZ Payroll ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [b] = await db('bank_accounts').insert({
      name: `ZZ Mill Cash ${run}`, type: 'cash', currency: 'PKR', entity: 'mill', current_balance: 100000, is_active: true,
    }).returning('*');
    const [w] = await db('mill_workers').insert({
      name: `ZZ Worker ${run}`, entity: 'mill', pay_type: 'salaried', daily_wage: 1000, is_active: true,
    }).returning('*');
    Object.assign(ids, { user: u.id, bank: b.id, worker: w.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('undoing a paid run nets its GL, restores the bank and keeps every record', async () => {
    const r = await makeRun(true);
    const paid = await call('post', '/payroll/runs/:id/pay', { params: { id: String(r.id) } });
    expect(paid.statusCode).toBe(200);

    const runRow = await db('mill_payroll_runs').where('id', r.id).first();
    const exp = await db('business_expenses').where('id', runRow.expense_id).first();
    const pay = await db('payments as p').join('payables as pa', 'pa.id', 'p.linked_payable_id')
      .where({ 'pa.source_table': 'business_expenses', 'pa.source_id': exp.id }).first('p.*');
    const refs = [exp.expense_no, pay.payment_no, `STAT-EXP-${exp.id}`];
    const before = await netByAccount(refs);
    expect(before['6135']).toBe(30000);          // 29,500 net + 500 statutory
    expect((await db('bank_accounts').where('id', ids.bank).first()).current_balance).toBe('70500.00');
    const journalCount = async () => parseInt((await db('journal_entries').whereIn('ref_no', refs).count('id as c').first()).c, 10);
    const postedBefore = await journalCount();

    const undo = await call('delete', '/payroll/runs/:id', { params: { id: String(r.id) }, body: { reason: 'test undo' } });
    expect(undo.statusCode).toBe(200);

    // Run kept as reversed, lines no longer paid.
    const after = await db('mill_payroll_runs').where('id', r.id).first();
    expect(after.status).toBe('reversed');
    expect(after.reversal_reason).toBe('test undo');
    expect(after.reversed_by).toBe(ids.user);
    const lines = await db('mill_payroll_lines').where('run_id', r.id);
    expect(lines.every((l) => l.paid_at === null)).toBe(true);

    // Every record kept, marked Reversed.
    expect((await db('business_expenses').where('id', exp.id).first()).payment_status).toBe('Reversed');
    expect((await db('payments').where('id', pay.id).first()).status).toBe('Reversed');
    const payable = await db('payables').where({ source_table: 'business_expenses', source_id: exp.id }).first();
    expect(payable.status).toBe('Reversed');
    expect(parseFloat(payable.outstanding)).toBe(0);

    // Nothing posted was deleted; the signed deltas net every account to zero.
    expect(await journalCount()).toBe(postedBefore * 2);
    const net = await netByAccount(refs);
    for (const code of Object.keys(before)) expect(net[code] || 0).toBe(0);

    // Bank restored by a reversing row; the original debit row is kept.
    expect((await db('bank_accounts').where('id', ids.bank).first()).current_balance).toBe('100000.00');
    const bts = await db('bank_transactions').where('reference', pay.payment_no).orderBy('id');
    expect(bts.map((t) => [t.type, parseFloat(t.amount)])).toEqual([['debit', 29500], ['credit', 29500]]);

    // A second undo is refused, nothing doubles.
    const again = await call('delete', '/payroll/runs/:id', { params: { id: String(r.id) } });
    expect(again.statusCode).toBe(409);
    expect(await journalCount()).toBe(postedBefore * 2);
  });

  test('the reversed run frees its workers for a new run of the same month', async () => {
    const { committedWorkerStatus } = require('../modules/milling/payroll.service');
    const map = await committedWorkerStatus('2026-09', 'mill');
    expect(map.has(ids.worker)).toBe(false);
  });

  test('undo is refused once the withheld statutory liability has been remitted', async () => {
    const r = await makeRun(true);
    expect((await call('post', '/payroll/runs/:id/pay', { params: { id: String(r.id) } })).statusCode).toBe(200);
    const remit = await call('post', '/payroll/statutory-remittances', {
      body: { entity: 'mill', liability_account_code: '2050', amount: 500, pay_method: 'cash', authority: 'EOBI' },
    });
    expect(remit.statusCode).toBe(201);

    const balBefore = (await db('bank_accounts').where('id', ids.bank).first()).current_balance;
    const jeBefore = (await db('journal_entries').count('id as c').first()).c;
    const undo = await call('delete', '/payroll/runs/:id', { params: { id: String(r.id) } });
    expect(undo.statusCode).toBe(409);
    expect(undo.body.message).toMatch(remit.body.data.remittance_no);
    expect((await db('mill_payroll_runs').where('id', r.id).first()).status).toBe('paid');
    expect((await db('bank_accounts').where('id', ids.bank).first()).current_balance).toBe(balBefore);
    expect((await db('journal_entries').count('id as c').first()).c).toBe(jeBefore);

    // Reversing the remittance (signed delta, kept) un-blocks the undo.
    const delRemit = await call('delete', '/payroll/statutory-remittances/:id', { params: { id: String(remit.body.data.id) } });
    expect(delRemit.statusCode).toBe(200);
    const remitNet = await netByAccount([remit.body.data.remittance_no]);
    expect(remitNet['2050'] || 0).toBe(0);
    expect(remitNet['1000'] || 0).toBe(0);
    expect((await call('delete', '/payroll/runs/:id', { params: { id: String(r.id) } })).statusCode).toBe(200);
  });

  test('deleting a salary advance reverses its cash-out instead of deleting it', async () => {
    const expensesService = require('../modules/expenses/expenses.service');
    const exp = await db.transaction((trx) => expensesService.create({
      expense_type: 'mill', category: 'salaries', amount: 5000, currency: 'PKR', expense_date: '2026-09-15',
      description: `Advance ZZ ${run}`, pay_now: true, bank_account_id: ids.bank, payment_method: 'cash',
    }, ids.user, trx));
    const [adv] = await db('mill_worker_advances').insert({
      worker_id: ids.worker, amount: 5000, advance_date: '2026-09-15', expense_id: exp.id,
      status: 'outstanding', approval_status: 'paid', recovered_amount: 0, recovery_method: 'manual', auto_deduct: false,
    }).returning('*');
    const balBefore = parseFloat((await db('bank_accounts').where('id', ids.bank).first()).current_balance);

    const res = await call('delete', '/advances/:id', { params: { id: String(adv.id) } });
    expect(res.statusCode).toBe(200);
    expect(await db('mill_worker_advances').where('id', adv.id).first()).toBeUndefined();
    const kept = await db('business_expenses').where('id', exp.id).first();
    expect(kept.payment_status).toBe('Reversed');
    const pay = await db('payments as p').join('payables as pa', 'pa.id', 'p.linked_payable_id')
      .where({ 'pa.source_table': 'business_expenses', 'pa.source_id': exp.id }).first('p.payment_no', 'p.status');
    expect(pay.status).toBe('Reversed');
    const net = await netByAccount([exp.expense_no, pay.payment_no]);
    for (const v of Object.values(net)) expect(v).toBe(0);
    expect(parseFloat((await db('bank_accounts').where('id', ids.bank).first()).current_balance)).toBe(balBefore + 5000);
  });
});
