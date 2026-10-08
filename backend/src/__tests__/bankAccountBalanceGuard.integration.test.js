/**
 * Bank-account master over HTTP against a real, fully-migrated Postgres:
 * create books an opening balance (BT row + Posted Dr 1000 / Cr 3000), and an
 * edit never moves the balance. The DB-less version is bankAccountBalanceGuard.test.js.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_fix -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55440:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55440 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest bankAccountBalanceGuard.integration
 */
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('bank-account balance guard (DB-gated)', () => {
  let db; let app; let request; let token;
  const run = `${Date.now()}`.slice(-7);
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-bank-${run}@test.local`, full_name: `ZZ Bank ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    token = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const glPosted = async (refNo) => db('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
    .select('c.code', 'jl.debit', 'jl.credit');

  test('create with an opening balance books BT + Posted Dr 1000 / Cr 3000; edits never move the balance', async () => {
    const created = await request(app).post('/api/admin/bank-accounts').set(auth()).send({
      name: `ZZ Meezan ${run}`, bank_name: 'Meezan', type: 'bank', currency: 'PKR', opening_balance: 250000,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.bank_account.id;
    expect(Number(created.body.data.bank_account.current_balance)).toBe(250000);

    const bt = await db('bank_transactions').where({ bank_account_id: id });
    expect(bt).toHaveLength(1);
    expect(bt[0]).toMatchObject({ type: 'credit', source: 'opening_balance', category: 'Opening Balance', status: 'posted' });
    expect(Number(bt[0].amount)).toBe(250000);

    const lines = await glPosted(`OPEN-BANK-${id}`);
    expect(lines.map((l) => [l.code, Number(l.debit), Number(l.credit)]).sort())
      .toEqual([['1000', 250000, 0], ['3000', 0, 250000]]);

    // A payment lands after the edit form loaded.
    await db('bank_accounts').where({ id }).update({ current_balance: 310000 });

    // Old client re-sending the stale balance → refused, nothing written.
    const stale = await request(app).put(`/api/admin/bank-accounts/${id}`).set(auth())
      .send({ name: `ZZ Meezan ${run}`, iban: 'PK-STALE', currency: 'PKR', current_balance: 250000 });
    expect(stale.status).toBe(400);
    expect(stale.body.message).toMatch(/Balances change only through payments, transfers or a Danger Zone adjustment/);
    let row = await db('bank_accounts').where({ id }).first();
    expect(Number(row.current_balance)).toBe(310000);
    expect(row.iban).toBeNull();

    // New client (no balance) → the edit lands, the balance stays.
    const ok = await request(app).put(`/api/admin/bank-accounts/${id}`).set(auth())
      .send({ name: `ZZ Meezan ${run}`, iban: 'PK36MEZN0001', currency: 'PKR', type: 'bank', is_export_default: false });
    expect(ok.status).toBe(200);
    row = await db('bank_accounts').where({ id }).first();
    expect(row.iban).toBe('PK36MEZN0001');
    expect(Number(row.current_balance)).toBe(310000);

    // Currency on an account with history → 409.
    const cur = await request(app).put(`/api/admin/bank-accounts/${id}`).set(auth()).send({ currency: 'USD' });
    expect(cur.status).toBe(409);
    expect((await db('bank_accounts').where({ id }).first()).currency).toBe('PKR');
  });
});
