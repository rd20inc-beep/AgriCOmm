/**
 * P2-31 over HTTP against a real, migrated Postgres:
 *   - POST /finance/settle records every allocation in ONE transaction: a
 *     failure on the last invoice leaves nothing posted (no payment, no bank
 *     row, no journal, no settled payable);
 *   - a good settlement settles each invoice, carries WHT / discount, returns
 *     the overdraft warning, and the account still ties out (P2-17);
 *   - invoices of two parties or two currencies are refused;
 *   - the legacy POST /finance/fund-transfers answers 410.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('settle across invoices (DB-gated)', () => {
  let db; let app; let request; let bankTieOut;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  let acct;
  const TODAY = new Date().toISOString().slice(0, 10);

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    ({ bankTieOut } = require('../modules/finance/bankTieOut'));
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Finance Manager' }).first();
    const [u] = await db('users').insert({
      email: `zz-p231-fm-${run}@test.local`, full_name: `ZZ FM ${run}`,
      password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids.fm = u.id;
    tok.fm = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    const { createBankAccount } = require('../modules/admin/bankAccounts.service');
    acct = (await db.transaction((trx) => createBankAccount(trx, {
      name: `ZZ Settle ${run}`, type: 'bank', entity: 'general', currency: 'PKR', is_active: true, opening_balance: 1000,
    }, ids.fm))).bank_account;
    for (const k of ['sup', 'sup2']) {
      const [s] = await db('suppliers').insert({ name: `ZZ ${k} ${run}`, type: 'local' }).returning('*');
      ids[k] = s.id;
    }
  });

  afterAll(async () => { if (db) await db.destroy(); });

  const newPayable = async (amount, { supplier = ids.sup, currency = 'PKR' } = {}) => (await db('payables').insert({
    pay_no: `ZZP231-${run}-${Math.random().toString(36).slice(2, 7)}`, entity: 'general', supplier_id: supplier,
    original_amount: amount, paid_amount: 0, outstanding: amount, status: 'Pending', currency, category: 'Other',
  }).returning('*'))[0];
  const settle = (allocations, extra = {}) => post('fm', '/api/finance/settle', {
    type: 'payment', currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: acct.id,
    payment_date: TODAY, allocations, ...extra,
  });
  const paymentsFor = (payableIds) => db('payments').whereIn('linked_payable_id', payableIds);

  test('a failure on the last invoice posts nothing at all', async () => {
    const a = await newPayable(300);
    const b = await newPayable(200);
    const before = (await db('bank_accounts').where({ id: acct.id }).first()).current_balance;
    const btBefore = await db('bank_transactions').where({ bank_account_id: acct.id }).count('id as n').first();
    // b is asked for more than it owes → the engine refuses it after a is done.
    const r = await settle([{ payable_id: a.id, amount: 300 }, { payable_id: b.id, amount: 250 }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/exceeds the outstanding/);
    expect(await paymentsFor([a.id, b.id])).toHaveLength(0);
    expect(Number((await db('payables').where({ id: a.id }).first()).paid_amount)).toBe(0);
    expect((await db('bank_accounts').where({ id: acct.id }).first()).current_balance).toBe(before);
    const btAfter = await db('bank_transactions').where({ bank_account_id: acct.id }).count('id as n').first();
    expect(Number(btAfter.n)).toBe(Number(btBefore.n));
  });

  test('settles every invoice in one go, with WHT / discount, and returns the overdraft warning', async () => {
    const a = await newPayable(800);
    const b = await newPayable(600);
    const r = await settle([
      { payable_id: a.id, amount: 800, wht_amount: 40 },
      { payable_id: b.id, amount: 600, discount_amount: 10 },
    ]);
    expect(r.status).toBe(201);
    expect(r.body.data.payments).toHaveLength(2);
    expect(r.body.data.total).toBe(1400);
    for (const p of [a, b]) {
      const row = await db('payables').where({ id: p.id }).first();
      expect(row.status).toBe('Paid');
    }
    const pays = await paymentsFor([a.id, b.id]);
    expect(pays.map((p) => [Number(p.wht_amount), Number(p.discount_amount)]).sort()).toEqual([[0, 10], [40, 0]]);
    // 1000 opening − (760 + 590) net = −350: allowed, with the warning.
    expect(r.body.data.warning).toMatchObject({ account_id: acct.id, overdrawn_by: 350 });
    const t = (await bankTieOut(db)).accounts.find((x) => x.account_id === acct.id);
    expect(t).toMatchObject({ balance: -350, sub_ledger: -350, gl_balance_pkr: -350, ok: true });
  });

  test('two parties, two currencies, or a duplicate invoice are refused', async () => {
    const a = await newPayable(10);
    const other = await newPayable(10, { supplier: ids.sup2 });
    const usd = await newPayable(10, { currency: 'USD' });
    expect((await settle([{ payable_id: a.id, amount: 10 }, { payable_id: other.id, amount: 10 }])).body.message).toMatch(/same party/);
    expect((await settle([{ payable_id: a.id, amount: 10 }, { payable_id: usd.id, amount: 10 }])).body.message).toMatch(/must be in PKR/);
    expect((await settle([{ payable_id: a.id, amount: 5 }, { payable_id: a.id, amount: 5 }])).status).toBe(400);
    expect(await paymentsFor([a.id, other.id, usd.id])).toHaveLength(0);
  });

  test('the legacy POST /fund-transfers is retired (410)', async () => {
    const r = await post('fm', '/api/finance/fund-transfers', { direction: 'ho_to_mill', from_account_id: acct.id, to_account_id: acct.id, amount: 1 });
    expect(r.status).toBe(410);
    expect(r.body.retired).toBe(true);
  });
});
