/**
 * GET /api/finance/transactions/:kind/:id and GET /api/finance/search against a
 * real, fully-migrated Postgres: both sides of a payment (its bank row and its
 * journal), the export-receipt journal found by its narrated payment number,
 * the reversal hint, party masking for restricted roles, and the finance.view
 * guard.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_p3 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55451:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55451 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest financeTransactionDetail.integration
 */
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('finance transaction detail + search (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  const acc = {};
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
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['sa', 'Super Admin'], ['fm', 'Finance Manager'], ['em', 'Export Manager'], ['qc', 'QC Analyst']]) {
      const [u] = await db('users').insert({
        email: `zz-p3-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const [pkr] = await db('bank_accounts').insert({ name: `ZZ P3 PKR ${run}`, type: 'bank', entity: 'general', currency: 'PKR', current_balance: 1000000, is_active: true }).returning('*');
    const [usd] = await db('bank_accounts').insert({ name: `ZZ P3 USD ${run}`, type: 'bank', entity: 'export', currency: 'USD', current_balance: 0, is_active: true }).returning('*');
    Object.assign(acc, { pkr, usd });
    const [sup] = await db('suppliers').insert({ name: `ZZ P3 Supplier ${run}`, type: 'local' }).returning('*');
    const [cust] = await db('customers').insert({ name: `ZZ P3 Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const product = await db('products').first('id');
    Object.assign(ids, { sup: sup.id, cust: cust.id, product: product.id });
  });

  afterAll(async () => { if (db) await db.destroy(); });

  test('a payment shows its bank row, its journal, who made it, and that it can be reversed', async () => {
    const [pa] = await db('payables').insert({
      pay_no: `ZZP3PAY-${run}`, entity: 'mill', payable_type: 'vendor', category: 'Other', supplier_id: ids.sup,
      original_amount: 5000, paid_amount: 0, outstanding: 5000, status: 'Pending', currency: 'PKR',
    }).returning('*');
    const rec = await post('fm', '/api/finance/payments', {
      type: 'payment', linked_payable_id: pa.id, amount: 5000, currency: 'PKR',
      payment_method: 'bank_transfer', bank_account_id: acc.pkr.id, payment_date: TODAY,
    });
    expect(rec.status).toBe(201);
    const pay = rec.body.data.payment;
    ids.pay = pay;

    const res = await get('fm', `/api/finance/transactions/payment/${pay.id}`);
    expect(res.status).toBe(200);
    const dt = res.body.data;
    expect(dt.kind).toBe('payment');
    expect(dt.payment).toMatchObject({ id: pay.id, payment_no: pay.payment_no, amount: 5000, currency: 'PKR', created_by_name: `ZZ Finance Manager ${run}` });
    expect(dt.payment.account).toMatchObject({ id: acc.pkr.id, currency: 'PKR' });
    expect(dt.document).toMatchObject({ kind: 'payable', id: pa.id, ref: pa.pay_no });
    expect(dt.party).toEqual({ type: 'supplier', id: ids.sup, name: `ZZ P3 Supplier ${run}` });
    expect(dt.bank_transactions.map((b) => [b.type, b.amount, b.currency])).toEqual([['debit', 5000, 'PKR']]);
    expect(dt.journals).toHaveLength(1);
    expect(dt.journals[0].lines.map((l) => [l.account_code, l.debit, l.credit])).toEqual([['2010', 5000, 0], ['1000', 0, 5000]]);
    expect(dt.reversal).toEqual({ allowed: true, reason: null });
    expect(dt.clearable).toBe(false);

    // The bank row opens the same detail, focused on itself.
    const bt = await db('bank_transactions').where({ linked_payment_id: pay.id }).first();
    const viaBank = await get('fm', `/api/finance/transactions/bank/${bt.id}`);
    expect(viaBank.body.data).toMatchObject({ kind: 'payment', focus_bank_transaction_id: bt.id, payment: { id: pay.id } });
  });

  test('a document can be attached to a payment once; Finance only', async () => {
    const up = await request(app).post('/api/finance/payments/attachment').set(auth('fm'))
      .attach('file', Buffer.from('%PDF-1.4 test'), 'wht-cert.pdf');
    expect(up.status).toBe(200);
    const body = { attachment_url: up.body.data.url, attachment_name: 'wht-cert.pdf' };
    expect((await request(app).put(`/api/finance/payments/${ids.pay.id}/attachment`).set(auth('qc')).send(body)).status).toBe(403);
    const ok = await request(app).put(`/api/finance/payments/${ids.pay.id}/attachment`).set(auth('fm')).send(body);
    expect(ok.status).toBe(200);
    const dt = (await get('fm', `/api/finance/transactions/payment/${ids.pay.id}`)).body.data;
    expect(dt.payment).toMatchObject({ attachment_url: up.body.data.url, attachment_name: 'wht-cert.pdf' });
    // It fills an empty slot; it never replaces a document.
    expect((await request(app).put(`/api/finance/payments/${ids.pay.id}/attachment`).set(auth('fm')).send(body)).status).toBe(409);
    // A file that was never uploaded is refused.
    const [pa] = await db('payables').insert({
      pay_no: `ZZP3PAY2-${run}`, entity: 'mill', payable_type: 'vendor', category: 'Other', supplier_id: ids.sup,
      original_amount: 100, paid_amount: 0, outstanding: 100, status: 'Pending', currency: 'PKR',
    }).returning('*');
    const p2 = (await post('fm', '/api/finance/payments', { type: 'payment', linked_payable_id: pa.id, amount: 100, currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: acc.pkr.id, payment_date: TODAY })).body.data.payment;
    expect((await request(app).put(`/api/finance/payments/${p2.id}/attachment`).set(auth('fm')).send({ attachment_url: 'nope.pdf' })).status).toBe(400);
  });

  test('a restricted role sees the reference but not the party', async () => {
    const res = await get('em', `/api/finance/transactions/payment/${ids.pay.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.party).toEqual({ type: 'supplier', id: null, name: 'Supplier' });
    expect(res.body.data.payment.payment_no).toBe(ids.pay.payment_no);
  });

  test('without finance.view both routes are refused', async () => {
    expect((await get('qc', `/api/finance/transactions/payment/${ids.pay.id}`)).status).toBe(403);
    expect((await get('qc', `/api/finance/search?q=ZZ`)).status).toBe(403);
  });

  test('an export receipt journals under the order but is found by its narrated payment number; it is reversed from the order', async () => {
    const orderNo = `ZZP3EX-${run}`;
    const [order] = await db('export_orders').insert({
      order_no: orderNo, customer_id: ids.cust, product_id: ids.product, qty_mt: 10, price_per_mt: 500,
      contract_value: 5000, currency: 'USD', advance_pct: 20, advance_expected: 1000, balance_expected: 4000,
      status: 'Awaiting Advance', booked_fx_rate: 280, bank_account_id: acc.usd.id, created_by: ids.sa,
    }).returning('*');
    await db('receivables').insert({
      recv_no: `ZZP3RCV-${run}`, type: 'Advance', entity: 'export', order_id: order.id, customer_id: ids.cust,
      currency: 'USD', expected_amount: 1000, received_amount: 0, outstanding: 1000, base_amount_pkr: 280000, status: 'Pending',
    });
    const rec = await post('sa', `/api/export-orders/${order.id}/record-receipt`, { kind: 'advance', amount: 1000, payment_method: 'bank_transfer', bank_account_id: acc.usd.id, payment_date: TODAY });
    expect(rec.status).toBeLessThan(300);
    const pending = await db('payments').where({ status: 'Pending Finance Confirmation', source_table: 'export_orders', source_id: order.id }).first()
      || await db('payments').where({ status: 'Pending Finance Confirmation' }).orderBy('id', 'desc').first();
    const ok = await post('fm', `/api/export-orders/receipts/${pending.id}/confirm`, { fx_rate: 281 });
    expect(ok.status).toBe(200);
    const posted = await db('payments').where({ source_table: 'export_orders', source_id: order.id, status: 'Confirmed' }).first();

    const res = await get('fm', `/api/finance/transactions/payment/${posted.id}`);
    const dt = res.body.data;
    expect(dt.payment).toMatchObject({ created_by_name: `ZZ Super Admin ${run}`, confirmed_by_name: `ZZ Finance Manager ${run}` });
    expect(dt.journals.map((j) => [j.ref_type, j.ref_no])).toEqual([['Export Order', orderNo]]);
    expect(dt.journals[0].lines.map((l) => [l.account_code, l.debit, l.credit])).toEqual([['1000', 281000, 0], ['1310', 0, 281000]]);
    expect(dt.reversal.allowed).toBe(false);
    expect(dt.reversal.reason).toMatch(/export order/);
    expect(dt.bank_transactions.map((b) => [b.type, b.amount, b.currency])).toEqual([['credit', 1000, 'USD']]);
  });

  test('search finds parties, documents and transactions; a restricted role gets no party names', async () => {
    const fm = await get('fm', `/api/finance/search?q=${encodeURIComponent(`P3 Supplier ${run}`)}`);
    expect(fm.status).toBe(200);
    expect(fm.body.data.parties).toEqual([{ type: 'supplier', id: ids.sup, name: `ZZ P3 Supplier ${run}` }]);
    const em = await get('em', `/api/finance/search?q=${encodeURIComponent(`P3 Supplier ${run}`)}`);
    expect(em.body.data.parties).toEqual([]);

    const doc = await get('fm', `/api/finance/search?q=ZZP3PAY-${run}`);
    expect(doc.body.data.documents.map((x) => [x.kind, x.ref])).toEqual([['payable', `ZZP3PAY-${run}`]]);
    const tx = await get('fm', `/api/finance/search?q=${ids.pay.payment_no}`);
    expect(tx.body.data.transactions.some((x) => x.kind === 'payment' && x.id === ids.pay.id)).toBe(true);
    expect((await get('fm', '/api/finance/search?q=Z')).body.data).toEqual({ parties: [], documents: [], transactions: [] });
  });
});
