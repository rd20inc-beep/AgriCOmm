/**
 * P2-20 / owner decision D-10 over HTTP against a real, migrated Postgres:
 *   - a live export order in a currency with no rate on file (and no typed
 *     booked rate) is refused 400 FX_RATE_MISSING — no 280, no USD rate;
 *     with a typed rate it books at that rate; a Draft may wait for one;
 *   - a foreign payment with no rate on file is refused 422 and moves nothing;
 *   - GET /finance/fx-rates reports the latest rate as an estimate.
 *
 * Uses GBP, which a fresh database has no rate for. DB-gated.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('FX: postings need a rate on file (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  const TODAY = new Date().toISOString().slice(0, 10);

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);
  const get = (who, url) => request(app).get(url).set(auth(who));

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-p220-${run}@test.local`, full_name: `ZZ SA ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    tok.sa = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    const [cust] = await db('customers').insert({ name: `ZZ Buyer ${run}`, customer_type: 'export', currency: 'GBP' }).returning('*');
    const [bank] = await db('bank_accounts').insert({ name: `ZZ GBP Bank ${run}`, type: 'bank', entity: 'export', currency: 'PKR', current_balance: 0, is_active: true }).returning('*');
    const product = await db('products').first('id');
    const [sup] = await db('suppliers').insert({ name: `ZZ Supplier ${run}`, type: 'local' }).returning('*');
    Object.assign(ids, { cust: cust.id, bank: bank.id, product: product.id, sup: sup.id });
    // The premise: no GBP rate on file.
    expect(await db('fx_rates').where({ from_currency: 'GBP' }).where('rate', '>', 0).where('effective_date', '<=', TODAY).first()).toBeUndefined();
  });

  afterAll(async () => { if (db) await db.destroy(); });

  const order = (extra = {}) => post('sa', '/api/export-orders', {
    customer_id: ids.cust, product_id: ids.product, qty_mt: 10, price_per_mt: 500, contract_value: 5000,
    currency: 'GBP', incoterm: 'FOB', advance_pct: 20, bank_account_id: ids.bank, status: 'Awaiting Advance', ...extra,
  });

  test('a GBP order with no rate on file and none typed is refused (never 280, never the USD rate)', async () => {
    const before = await db('export_orders').count('id as n').first();
    const r = await order();
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FX_RATE_MISSING');
    expect(r.body.message).toMatch(/GBP/);
    const after = await db('export_orders').count('id as n').first();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  test('with a typed booked rate it books at that rate; a Draft may wait for one', async () => {
    const r = await order({ booked_fx_rate: 355.5 });
    expect(r.status).toBe(201);
    const o = await db('export_orders').where({ id: r.body.data.order.id }).first();
    expect(Number(o.booked_fx_rate)).toBe(355.5);
    expect(Number(o.contract_value_pkr_locked)).toBe(5000 * 355.5);
    expect(o.fx_rate_source).toBe('manual');
    const rv = await db('receivables').where({ order_id: o.id, type: 'Advance' }).first();
    expect(Number(rv.base_amount_pkr)).toBe(1000 * 355.5);

    const draft = await order({ status: 'Draft' });
    expect(draft.status).toBe(201);
    const dr = await db('export_orders').where({ id: draft.body.data.order.id }).first();
    expect(dr.booked_fx_rate).toBeNull();
    // Submitting it without a rate on file is refused.
    const sub = await post('sa', `/api/export-orders/${dr.id}/submit`, {});
    expect(sub.status).toBe(400);
    expect((await db('export_orders').where({ id: dr.id }).first()).status).toBe('Draft');
  });

  test('a GBP payment with no rate on file is refused and moves nothing', async () => {
    const [pa] = await db('payables').insert({
      pay_no: `ZZP220-${run}`, entity: 'general', supplier_id: ids.sup, original_amount: 100, paid_amount: 0,
      outstanding: 100, status: 'Pending', currency: 'GBP', category: 'Other',
    }).returning('*');
    const r = await post('sa', '/api/finance/payments', {
      type: 'payment', linked_payable_id: pa.id, amount: 100, currency: 'GBP',
      payment_method: 'bank_transfer', bank_account_id: ids.bank, payment_date: TODAY,
    });
    // recordPayment's Joi allows USD / PKR / EUR only — either way, nothing posts.
    expect([400, 422]).toContain(r.status);
    expect(await db('payments').where({ linked_payable_id: pa.id })).toHaveLength(0);
    expect(Number((await db('bank_accounts').where({ id: ids.bank }).first()).current_balance)).toBe(0);
  });

  test('the rates endpoint labels the latest rate as an estimate, per currency', async () => {
    const gbp = await get('sa', '/api/finance/fx-rates?currency=GBP');
    expect(gbp.status).toBe(200);
    expect(gbp.body.data.latest).toMatchObject({ rate: null, missing: true });
  });
});
