/**
 * Money rules (package B), end to end over HTTP against a real, fully-migrated
 * Postgres:
 *
 *  B1  a cheque bounces: the payment is Bounced, the payable it was against is
 *      open again (payable for its full amount), the bank charge posts Dr 6200
 *      / Cr the account's own GL with a debit bank row; cleared / reversed /
 *      already-bounced cheques are refused (409).
 *  B5  bank reconciliation: start, tick, see the difference, refuse to
 *      complete while it is not 0, complete, and the reconciled rows are not
 *      offered again; one open reconciliation per account.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_B -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55465:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55465 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest --runInBand moneyRules.integration
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('money rules (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const acc = {};
  const glCode = {};
  const ids = {};
  const TODAY = new Date().toISOString().slice(0, 10);

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);
  const put = (who, url, body) => request(app).put(url).set(auth(who)).send(body);
  const get = (who, url) => request(app).get(url).set(auth(who));
  const bal = async (id) => Number((await db('bank_accounts').where({ id }).first()).current_balance);
  const glLines = async (refNo) => (await db('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
    .orderBy(['je.id', 'jl.id'])
    .select('coa.code', 'jl.debit', 'jl.credit', 'je.ref_type'))
    .map((l) => [l.ref_type, l.code, Number(l.debit), Number(l.credit)]);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['sa', 'Super Admin'], ['op', 'Mill Operator']]) {
      const [u] = await db('users').insert({
        email: `zz-b-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const mk = async (key, row) => {
      const [a] = await db('bank_accounts').insert({ name: `ZZ ${key} ${run}`, is_active: true, ...row }).returning('*');
      const gl = await require('../shared/accountGl').ensureAccountGl(db, a);
      acc[key] = { ...a, gl_account_id: gl.id };
      glCode[key] = gl.code;
    };
    await mk('bank', { type: 'bank', entity: 'general', currency: 'PKR', current_balance: 100000 });
    await mk('cash', { type: 'cash', entity: 'general', currency: 'PKR', current_balance: 50000 });
    // Opening balances as bank rows, so the account's rows foot to its balance.
    for (const [key, amt] of [['bank', 100000], ['cash', 50000]]) {
      await db('bank_transactions').insert({
        transaction_no: `ZZOB-${key}-${run}`, bank_account_id: acc[key].id, type: 'credit', amount: amt, currency: 'PKR',
        status: 'posted', transaction_date: '2026-01-01', source: 'opening_balance', notes: 'Opening',
      });
    }
    const [sup] = await db('suppliers').insert({ name: `ZZ Supplier ${run}`, type: 'local' }).returning('*');
    ids.sup = sup.id;
  });

  afterAll(async () => { if (db) await db.destroy(); });

  const newPayable = async (amount) => {
    const [pa] = await db('payables').insert({
      pay_no: `ZZPAY-${run}-${Math.random().toString(36).slice(2, 7)}`, entity: 'general', supplier_id: ids.sup,
      original_amount: amount, paid_amount: 0, outstanding: amount, status: 'Pending', currency: 'PKR', category: 'Other',
    }).returning('*');
    return pa;
  };
  const cheque = (pa, extra = {}) => post('sa', '/api/finance/payments', {
    type: 'payment', linked_payable_id: pa.id, amount: Number(pa.original_amount), currency: 'PKR',
    payment_method: 'cheque', bank_account_id: acc.bank.id, payment_date: TODAY, due_date: TODAY, bank_reference: `CHQ-${run}`, ...extra,
  });

  // ── B1 ──
  test('B1 bounce: Bounced, payable reopened, charge Dr 6200 / Cr the account\'s own GL + debit row', async () => {
    const pa = await newPayable(40000);
    const rec = await cheque(pa);
    expect(rec.status).toBe(201);
    const p = rec.body.data.payment;
    expect(p.cleared).toBe(false);
    // In the post: a second payment of the bill is refused.
    const dup = await post('sa', '/api/finance/payments', { type: 'payment', linked_payable_id: pa.id, amount: 40000, currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: acc.bank.id, payment_date: TODAY });
    expect(dup.status).toBe(400);
    const before = await bal(acc.bank.id);

    const noReason = await post('sa', `/api/finance/payments/${p.id}/bounce`, {});
    expect(noReason.status).toBe(400);
    const res = await post('sa', `/api/finance/payments/${p.id}/bounce`, { reason: 'Insufficient funds', bank_charge: 500, charge_date: TODAY });
    expect(res.status).toBe(200);
    const row = await db('payments').where({ id: p.id }).first();
    expect(row).toMatchObject({ status: 'Bounced', bounce_reason: 'Insufficient funds', bounced_by: ids.sa, cleared: false });
    expect(row.bounced_at).toBeTruthy();
    const payable = await db('payables').where({ id: pa.id }).first();
    expect([Number(payable.paid_amount), Number(payable.outstanding), payable.status]).toEqual([0, 40000, 'Pending']);
    expect(await bal(acc.bank.id)).toBe(before - 500);
    const bts = await db('bank_transactions').where({ linked_payment_id: p.id });
    expect(bts.map((b) => [b.type, Number(b.amount), b.source, b.category])).toEqual([['debit', 500, 'cheque_bounce', 'Bank Charges']]);
    expect(await glLines(p.payment_no)).toEqual([
      ['Cheque Bounce Charge', '6200', 500, 0],
      ['Cheque Bounce Charge', glCode.bank, 0, 500],
    ]);
    // The transaction drawer shows it bounced and offers neither clear, bounce nor reverse.
    const detail = await get('sa', `/api/finance/transactions/payment/${p.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ clearable: false, bounceable: false });
    expect(detail.body.data.payment).toMatchObject({ status: 'Bounced', bounce_reason: 'Insufficient funds' });
    expect(detail.body.data.reversal.allowed).toBe(false);
    // Reopened: the whole bill can be paid again.
    const again = await post('sa', '/api/finance/payments', { type: 'payment', linked_payable_id: pa.id, amount: 40000, currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: acc.bank.id, payment_date: TODAY });
    expect(again.status).toBe(201);
    // Twice, clear, reverse: all refused.
    expect((await post('sa', `/api/finance/payments/${p.id}/bounce`, { reason: 'again' })).status).toBe(409);
    expect((await post('sa', `/api/finance/payments/${p.id}/clear`, { bank_account_id: acc.bank.id })).status).toBe(409);
    expect((await post('sa', `/api/finance/payments/${p.id}/reverse`, { reason: 'x' })).status).toBe(409);
  });

  test('B1 refuses a cleared cheque and a reversed one (409); nothing moves', async () => {
    const pa1 = await newPayable(1000);
    const c1 = (await cheque(pa1)).body.data.payment;
    expect((await post('sa', `/api/finance/payments/${c1.id}/clear`, { bank_account_id: acc.bank.id })).status).toBe(200);
    const b1 = await bal(acc.bank.id);
    const r1 = await post('sa', `/api/finance/payments/${c1.id}/bounce`, { reason: 'late', bank_charge: 100 });
    expect(r1.status).toBe(409);
    expect(await bal(acc.bank.id)).toBe(b1);
    expect((await db('payments').where({ id: c1.id }).first()).status).toBe('Confirmed');

    const pa2 = await newPayable(1000);
    const c2 = (await cheque(pa2)).body.data.payment;
    expect((await post('sa', `/api/finance/payments/${c2.id}/reverse`, { reason: 'typo' })).status).toBe(200);
    const r2 = await post('sa', `/api/finance/payments/${c2.id}/bounce`, { reason: 'x' });
    expect(r2.status).toBe(409);
    expect((await db('payments').where({ id: c2.id }).first()).status).toBe('Reversed');
  });

  test('B1 bounce needs finance.confirm_payment', async () => {
    const pa = await newPayable(1000);
    const c = (await cheque(pa)).body.data.payment;
    const r = await post('op', `/api/finance/payments/${c.id}/bounce`, { reason: 'x' });
    expect(r.status).toBe(403);
  });

  // ── B5 ──
  test('B5 reconciliation: start, tick, difference, refuse, complete; reconciled rows are not offered again', async () => {
    // A fresh account: opening 20,000 + two receipts + one payment.
    const [a] = await db('bank_accounts').insert({ name: `ZZ Recon ${run}`, is_active: true, type: 'bank', entity: 'general', currency: 'PKR', current_balance: 0 }).returning('*');
    await require('../shared/accountGl').ensureAccountGl(db, a);
    const rows = [['credit', 20000, '2026-09-01'], ['credit', 5000, '2026-09-10'], ['debit', 3000, '2026-09-15'], ['credit', 700, '2026-10-05']];
    const txns = [];
    for (const [i, [type, amount, date]] of rows.entries()) {
      const [t] = await db('bank_transactions').insert({
        transaction_no: `ZZRC-${run}-${i}`, bank_account_id: a.id, type, amount, currency: 'PKR', status: 'posted', transaction_date: date, source: 'test',
      }).returning('*');
      txns.push(t);
      await db('bank_accounts').where({ id: a.id })[type === 'credit' ? 'increment' : 'decrement']('current_balance', amount);
    }

    expect((await post('op', '/api/accounting/reconciliations', { bank_account_id: a.id, statement_date: '2026-09-30', statement_balance: 22000 })).status).toBe(403);
    const created = await post('sa', '/api/accounting/reconciliations', { bank_account_id: a.id, statement_date: '2026-09-30', statement_balance: 22000 });
    expect(created.status).toBe(201);
    const id = created.body.data.reconciliation.id;
    // One open reconciliation per account.
    const second = await post('sa', '/api/accounting/reconciliations', { bank_account_id: a.id, statement_date: '2026-10-31', statement_balance: 1 });
    expect(second.status).toBe(409);
    expect(second.body.data.reconciliation.id).toBe(id);

    const ws = await get('sa', `/api/accounting/reconciliations/${id}`);
    expect(ws.status).toBe(200);
    // Rows after the statement date are not offered; nothing ticked yet.
    expect(ws.body.data.transactions.map((t) => t.transaction_no)).toEqual([0, 1, 2].map((i) => `ZZRC-${run}-${i}`));
    expect(ws.body.data).toMatchObject({ opening_balance: 0, cleared_balance: 0, difference: 22000 });

    // Tick the first two only: 25,000 cleared vs 22,000 on the statement.
    const s1 = await put('sa', `/api/accounting/reconciliations/${id}/ticks`, { bank_transaction_ids: [txns[0].id, txns[1].id] });
    expect(s1.status).toBe(200);
    expect(s1.body.data).toMatchObject({ cleared_balance: 25000, difference: -3000, ticked_count: 2 });
    expect(s1.body.data.reconciliation.status).toBe('In Progress');
    const refuse = await put('sa', `/api/accounting/reconciliations/${id}/complete`, {});
    expect(refuse.status).toBe(409);
    expect(refuse.body.message).toMatch(/difference must be 0/);
    // A row dated after the statement, or another account's, cannot be ticked.
    expect((await put('sa', `/api/accounting/reconciliations/${id}/ticks`, { bank_transaction_ids: [txns[3].id] })).status).toBe(400);

    // Statement lines (CSV import) suggest the missing tick by amount + date.
    const lines = await post('sa', `/api/accounting/reconciliations/${id}/items`, { items: [{ date: '2026-09-16', reference: 'CHQ 55', amount: -3000 }] });
    expect(lines.status).toBe(201);
    expect(lines.body.data.suggestions).toEqual([{ statement_item_id: lines.body.data.statement_lines[0].id, bank_transaction_id: txns[2].id }]);

    const s2 = await put('sa', `/api/accounting/reconciliations/${id}/ticks`, { bank_transaction_ids: [txns[0].id, txns[1].id, txns[2].id] });
    expect(s2.body.data).toMatchObject({ cleared_balance: 22000, difference: 0 });
    const done = await put('sa', `/api/accounting/reconciliations/${id}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.data.reconciliation).toMatchObject({ status: 'Completed', reconciled_by: ids.sa });
    expect(Number(done.body.data.reconciliation.difference)).toBe(0);
    // Completed is final.
    expect((await put('sa', `/api/accounting/reconciliations/${id}/ticks`, { bank_transaction_ids: [] })).status).toBe(409);
    expect((await put('sa', `/api/accounting/reconciliations/${id}/complete`, {})).status).toBe(409);

    // The next statement starts from the reconciled 22,000 and offers only the rest.
    expect((await post('sa', '/api/accounting/reconciliations', { bank_account_id: a.id, statement_date: '2026-09-01', statement_balance: 0 })).status).toBe(400);
    const next = await post('sa', '/api/accounting/reconciliations', { bank_account_id: a.id, statement_date: '2026-10-31', statement_balance: 22700 });
    expect(next.status).toBe(201);
    const ws2 = await get('sa', `/api/accounting/reconciliations/${next.body.data.reconciliation.id}`);
    expect(ws2.body.data.opening_balance).toBe(22000);
    expect(ws2.body.data.transactions.map((t) => t.id)).toEqual([txns[3].id]);
    const list = await get('sa', `/api/accounting/reconciliations?bank_account_id=${a.id}`);
    expect(list.body.data.reconciliations.map((r) => r.status)).toEqual(['Draft', 'Completed']);
  });
});
