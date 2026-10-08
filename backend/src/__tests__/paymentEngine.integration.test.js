/**
 * Phase 1 payment-engine convergence, end to end over HTTP against a real,
 * fully-migrated Postgres: each writer posts its journal INSIDE the same
 * transaction as the payment (a ledger failure rolls the bank, the documents
 * and the payment row back), writes its bank_transactions row, stamps its
 * source and settles the document.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_p1 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55441:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55441 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest paymentEngine.integration
 *
 * Every row it creates carries a per-run suffix; assertions are on deltas.
 */
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('payment engine convergence (DB-gated)', () => {
  let db; let app; let request; let accounting;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const acc = {};
  const ids = {};
  const TODAY = new Date().toISOString().slice(0, 10);

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);
  const get = (who, url) => request(app).get(url).set(auth(who));
  const bal = async (id) => Number((await db('bank_accounts').where({ id }).first()).current_balance);
  // The posted journal lines of every journal with this ref, as [code, debit, credit].
  const glLines = async (refNo, refType) => {
    const q = db('journal_entries as je')
      .join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
      .orderBy(['je.id', 'jl.id'])
      .select('coa.code', 'jl.debit', 'jl.credit', 'je.entity', 'je.party_type', 'je.party_id');
    if (refType) q.where('je.ref_type', refType);
    return (await q).map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }));
  };
  const btFor = (paymentId) => db('bank_transactions').where({ linked_payment_id: paymentId }).orderBy('id');
  const failLedgerOnce = () => jest.spyOn(accounting, 'postJournal').mockRejectedValueOnce(new Error('Period is closed.'));

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');

    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['sa', 'Super Admin'], ['fm', 'Finance Manager']]) {
      const [u] = await db('users').insert({
        email: `zz-p1-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const mk = async (key, row) => {
      const [a] = await db('bank_accounts').insert({ name: `ZZ ${key} ${run}`, is_active: true, ...row }).returning('*');
      acc[key] = a;
    };
    await mk('pkr', { type: 'bank', entity: 'general', currency: 'PKR', current_balance: 5000000 });
    await mk('usd', { type: 'bank', entity: 'export', currency: 'USD', current_balance: 0 });
    await mk('millCash', { type: 'cash', entity: 'mill', currency: 'PKR', current_balance: 1000000 });

    const [cust] = await db('customers').insert({ name: `ZZ Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [client] = await db('customers').insert({ name: `ZZ Client ${run}`, customer_type: 'service_milling', currency: 'PKR' }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ Supplier ${run}`, type: 'local' }).returning('*');
    const [wh] = await db('warehouses').insert({ name: `ZZ WH ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const product = await db('products').first('id');
    Object.assign(ids, { cust: cust.id, client: client.id, sup: sup.id, wh: wh.id, product: product.id });
  });

  afterAll(async () => { if (db) await db.destroy(); });

  // ── R8 + R5: Money In on an export advance → pending → Finance confirms ──
  test('export advance via Money In: pending, then confirm posts Dr 1000 / Cr 1310 with its BT row, in one trx', async () => {
    const orderNo = `ZZEX-${run}`;
    const [order] = await db('export_orders').insert({
      order_no: orderNo, customer_id: ids.cust, product_id: ids.product, qty_mt: 10, price_per_mt: 500,
      contract_value: 5000, currency: 'USD', advance_pct: 20, advance_expected: 1000, balance_expected: 4000,
      status: 'Awaiting Advance', booked_fx_rate: 280, bank_account_id: acc.usd.id, created_by: ids.sa,
    }).returning('*');
    const [adv] = await db('receivables').insert({
      recv_no: `ZZRCV-ADV-${run}`, type: 'Advance', entity: 'export', order_id: order.id, customer_id: ids.cust,
      currency: 'USD', expected_amount: 1000, received_amount: 0, outstanding: 1000, base_amount_pkr: 280000, status: 'Pending',
    }).returning('*');

    const rec = await post('sa', '/api/finance/payments', {
      type: 'receipt', linked_receivable_id: adv.id, amount: 1000, currency: 'USD',
      payment_method: 'bank_transfer', bank_account_id: acc.usd.id, payment_date: TODAY, bank_reference: `SW-${run}`,
    });
    expect(rec.status).toBe(201);
    expect(rec.body.data.pending_confirmation).toBe(true);
    const pending = rec.body.data.payment;
    expect(pending.status).toBe('Pending Finance Confirmation');
    expect(await bal(acc.usd.id)).toBe(0);
    expect(Number((await db('receivables').where({ id: adv.id }).first()).received_amount)).toBe(0);

    // A ledger failure at confirm rolls everything back: order, receivable,
    // bank, BT, posted row — and the pending receipt is still there.
    failLedgerOnce();
    const bad = await post('fm', `/api/export-orders/receipts/${pending.id}/confirm`, { fx_rate: 281 });
    expect(bad.status).toBe(400);
    expect(await bal(acc.usd.id)).toBe(0);
    const o1 = await db('export_orders').where({ id: order.id }).first();
    expect(Number(o1.advance_received)).toBe(0);
    expect((await db('payments').where({ id: pending.id }).first()).status).toBe('Pending Finance Confirmation');
    expect(await db('payments').where({ linked_receivable_id: adv.id }).whereNot({ id: pending.id })).toHaveLength(0);
    expect(await glLines(orderNo)).toHaveLength(0);

    const ok = await post('fm', `/api/export-orders/receipts/${pending.id}/confirm`, { fx_rate: 281 });
    expect(ok.status).toBe(200);
    const o2 = await db('export_orders').where({ id: order.id }).first();
    expect(Number(o2.advance_received)).toBe(1000);
    expect(Number(o2.advance_received_pkr)).toBe(281000);
    expect(o2.financial_status).toBe('Confirmed');
    expect(o2.status).toBe('Advance Received');
    const r2 = await db('receivables').where({ id: adv.id }).first();
    expect(r2.status).toBe('Paid');
    expect(await bal(acc.usd.id)).toBe(1000);
    const posted = await db('payments').where({ linked_receivable_id: adv.id }).first();
    expect(posted).toMatchObject({ status: 'Confirmed', created_by: ids.sa, confirmed_by: ids.fm, source_table: 'export_orders', bank_reference: `SW-${run}` });
    const bts = await btFor(posted.id);
    expect(bts.map((b) => [b.type, Number(b.amount), b.currency, b.source])).toEqual([['credit', 1000, 'USD', 'export_receipt']]);
    expect((await glLines(orderNo, 'Export Order')).map((l) => [l.code, l.debit, l.credit, l.entity]))
      .toEqual([['1000', 281000, 0, 'export'], ['1310', 0, 281000, 'export']]);
  });

  // ── R7 ──
  test('a salaries expense paid on Money Out debits 2040 and clears the accrual', async () => {
    const created = await post('sa', '/api/expenses', {
      expense_type: 'mill', category: 'salaries', amount: 12000, currency: 'PKR', expense_date: TODAY,
      vendor_name: `ZZ Staff ${run}`, description: 'October wages',
    });
    expect(created.status).toBe(201);
    const exp = created.body.data.expense || created.body.data;
    const payable = await db('payables').where({ source_table: 'business_expenses', source_id: exp.id }).first();
    const before = await bal(acc.millCash.id);
    const res = await post('sa', '/api/finance/payments', {
      type: 'payment', linked_payable_id: payable.id, amount: 12000, currency: 'PKR',
      payment_method: 'cash', bank_account_id: acc.millCash.id, payment_date: TODAY,
    });
    expect(res.status).toBe(201);
    const p = res.body.data.payment;
    expect(p).toMatchObject({ source_table: 'business_expenses', source_id: exp.id });
    expect(await bal(acc.millCash.id)).toBe(before - 12000);
    expect(await btFor(p.id)).toHaveLength(1);
    expect((await glLines(p.payment_no)).map((l) => [l.code, l.debit, l.credit, l.entity]))
      .toEqual([['2040', 12000, 0, 'mill'], ['1000', 0, 12000, 'mill']]);
    expect((await db('business_expenses').where({ id: exp.id }).first()).payment_status).toBe('Paid');
  });

  // ── R6 ──
  test('paying a raw-rice lot from Purchases settles its payable, writes a PAY row + BT, and is reversible', async () => {
    const lotNo = `ZZLOT-${run}`;
    const [lot] = await db('inventory_lots').insert({
      lot_no: lotNo, item_name: 'ZZ Paddy', type: 'raw', entity: 'mill', product_id: ids.product, warehouse_id: ids.wh,
      supplier_id: ids.sup, qty: 1000, available_qty: 1000, unit: 'kg', landed_cost_total: 100000, purchase_amount: 100000,
      due_amount: 100000, paid_amount: 0, payment_status: 'Pending', status: 'Available',
    }).returning('*');
    const [rice] = await db('payables').insert({
      pay_no: `ZZPAY-${run}`, entity: 'mill', payable_type: 'vendor', category: 'Raw Material', supplier_id: ids.sup,
      linked_ref: lotNo, source_table: null, source_id: lot.id, original_amount: 100000, paid_amount: 0,
      outstanding: 100000, status: 'Pending', currency: 'PKR',
    }).returning('*');
    const before = await bal(acc.pkr.id);

    const res = await post('sa', '/api/finance/purchases/pay', {
      source: 'lot', source_id: lot.id, amount: 60000, payment_method: 'bank_transfer', bank_account_id: acc.pkr.id, payment_date: TODAY,
    });
    expect(res.status).toBe(200);
    const [pr] = res.body.data.payments;
    expect(pr.payable_id).toBe(rice.id);
    const p = await db('payments').where({ id: pr.id }).first();
    expect(p).toMatchObject({ linked_payable_id: rice.id, source_table: 'inventory_lots', source_id: lot.id });
    expect(Number((await db('payables').where({ id: rice.id }).first()).paid_amount)).toBe(60000);
    expect(Number((await db('inventory_lots').where({ id: lot.id }).first()).paid_amount)).toBe(60000);
    expect(await bal(acc.pkr.id)).toBe(before - 60000);
    expect(await btFor(p.id)).toHaveLength(1);
    const gl = await glLines(p.payment_no, 'Payment');
    expect(gl.map((l) => [l.code, l.debit, l.credit])).toEqual([['2010', 60000, 0], ['1000', 0, 60000]]);
    expect(gl[0]).toMatchObject({ party_type: 'supplier', party_id: ids.sup });

    const rev = await post('sa', `/api/finance/payments/${p.id}/reverse`, { reason: 'test' });
    expect(rev.status).toBe(200);
    expect(Number((await db('payables').where({ id: rice.id }).first()).paid_amount)).toBe(0);
    expect(Number((await db('inventory_lots').where({ id: lot.id }).first()).paid_amount)).toBe(0);
    expect(await bal(acc.pkr.id)).toBe(before);
    const net = (await glLines(p.payment_no)).reduce((m, l) => ({ ...m, [l.code]: (m[l.code] || 0) + l.debit - l.credit }), {});
    expect(net).toEqual({ 2010: 0, 1000: 0 });
  });

  // ── A4 ──
  test('a service-milling receipt posts Dr 1000 / Cr 1120 into the picked account; a ledger failure rolls it back', async () => {
    const [inv] = await db('service_milling_invoices').insert({
      invoice_no: `ZZSMI-${run}`, client_customer_id: ids.client, invoice_date: TODAY, total_amount: 20000,
      received_amount: 0, balance_amount: 20000, payment_status: 'Unpaid',
    }).returning('*');
    const [rcv] = await db('receivables').insert({
      recv_no: `ZZRCV-SMI-${run}`, entity: 'mill', customer_id: ids.client, service_invoice_id: inv.id, type: 'Service Milling',
      currency: 'PKR', expected_amount: 20000, received_amount: 0, outstanding: 20000, base_amount_pkr: 20000, status: 'Pending',
    }).returning('*');
    const before = await bal(acc.pkr.id);

    failLedgerOnce();
    const bad = await post('sa', `/api/service-milling/invoices/${inv.id}/payments`, { amount: 5000, payment_method: 'bank_transfer', bank_account_id: acc.pkr.id });
    expect(bad.status).toBe(400);
    expect(await bal(acc.pkr.id)).toBe(before);
    expect(Number((await db('service_milling_invoices').where({ id: inv.id }).first()).received_amount)).toBe(0);
    expect(await db('payments').where({ service_invoice_id: inv.id })).toHaveLength(0);

    const res = await post('sa', `/api/service-milling/invoices/${inv.id}/payments`, { amount: 5000, payment_method: 'bank_transfer', bank_account_id: acc.pkr.id, reference: 'TT-1' });
    expect(res.status).toBe(201);
    const p = res.body.data.payment;
    expect(p).toMatchObject({ linked_receivable_id: rcv.id, service_invoice_id: inv.id });
    expect(await bal(acc.pkr.id)).toBe(before + 5000);
    expect(await btFor(p.id)).toHaveLength(1);
    expect((await glLines(p.payment_no)).map((l) => [l.code, l.debit, l.credit, l.entity]))
      .toEqual([['1000', 5000, 0, 'mill'], ['1120', 0, 5000, 'mill']]);
    expect((await db('service_milling_invoices').where({ id: inv.id }).first()).payment_status).toBe('Partial');
    expect((await db('receivables').where({ id: rcv.id }).first()).status).toBe('Partial');
  });

  // ── Money In / Money Out / Cash / Printable cashflow ──
  test('cashflow totals count an engine payment once; a contra transfer adds nothing', async () => {
    const cf = async () => (await get('sa', `/api/reporting/printable/cashflow?from=${TODAY}&to=${TODAY}`)).body.data.summary;
    const created = await post('sa', '/api/expenses', {
      expense_type: 'general', category: 'rent', amount: 777, currency: 'PKR', expense_date: TODAY, vendor_name: `ZZ Landlord ${run}`,
    });
    const exp = created.body.data.expense || created.body.data;
    const before = await cf();
    const paid = await request(app).put(`/api/expenses/${exp.id}/pay`).set(auth('sa'))
      .send({ amount: 777, payment_method: 'bank_transfer', bank_account_id: acc.pkr.id, paid_date: TODAY });
    expect(paid.status).toBe(200);
    const mid = await cf();
    expect(mid.outPkr - before.outPkr).toBe(777);
    expect(mid.outCount - before.outCount).toBe(1);
    const pay = await db('payments').where({ source_table: 'business_expenses', source_id: exp.id }).first();
    expect(pay.payment_no).toMatch(/^PAY-\d+$/);
    expect(await btFor(pay.id)).toHaveLength(1);

    const contra = await post('sa', '/api/finance/contra-transfers', {
      from_account_id: acc.pkr.id, to_account_id: acc.millCash.id, amount: 1000, currency: 'PKR',
      transfer_date: TODAY, reference: `ZZ-REF-${run}`, client_ref: require('crypto').randomUUID(),
    });
    expect(contra.status).toBe(200);
    expect(await cf()).toEqual(mid);
  });

  test('statutory remittance moves its account through the engine: bank must name one, only PKR, BT row', async () => {
    // A 2050 liability to remit (Dr 6135 / Cr 2050), as payroll would post it.
    const [l2050, e6135] = await Promise.all([
      db('chart_of_accounts').where({ code: '2050' }).first(),
      db('chart_of_accounts').where({ code: '6135' }).first(),
    ]);
    await db.transaction(async (trx) => {
      const j = await accounting.createJournal(trx, {
        date: TODAY, entity: 'mill', refType: 'ZZ Test', refNo: `ZZ-STAT-${run}`, description: 'test liability',
        currency: 'PKR', fxRate: 1, isAuto: true, userId: ids.sa,
        lines: [
          { account_id: e6135.id, account: e6135.name, debit: 900, credit: 0 },
          { account_id: l2050.id, account: l2050.name, debit: 0, credit: 900 },
        ],
      });
      await accounting.postJournal(trx, j.id);
    });
    const noAcct = await post('sa', '/api/milling/payroll/statutory-remittances', { entity: 'mill', liability_account_code: '2050', amount: 300, pay_method: 'bank' });
    expect(noAcct.status).toBe(400);
    expect(noAcct.body.message).toMatch(/Choose the account/);
    const usd = await post('sa', '/api/milling/payroll/statutory-remittances', { entity: 'mill', liability_account_code: '2050', amount: 300, pay_method: 'bank', bank_account_id: acc.usd.id });
    expect(usd.status).toBe(400);
    const before = await bal(acc.pkr.id);
    const ok = await post('sa', '/api/milling/payroll/statutory-remittances', { entity: 'mill', liability_account_code: '2050', amount: 300, pay_method: 'bank', bank_account_id: acc.pkr.id });
    expect(ok.status).toBe(201);
    expect(await bal(acc.pkr.id)).toBe(before - 300);
    const bt = await db('bank_transactions').where({ reference: ok.body.data.remittance_no, source: 'statutory_remittance' });
    expect(bt.map((b) => [b.bank_account_id, b.type, Number(b.amount)])).toEqual([[acc.pkr.id, 'debit', 300]]);
    expect((await glLines(ok.body.data.remittance_no)).map((l) => [l.code, l.debit, l.credit])).toEqual([['2050', 300, 0], ['1000', 0, 300]]);
  });
});
