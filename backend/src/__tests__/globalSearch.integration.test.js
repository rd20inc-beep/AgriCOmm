/**
 * P5-03 global search (GET /api/search, also behind GET /api/reporting/search)
 * over HTTP against a real, migrated Postgres:
 *   - every record type is found by its number / name / reference and links to
 *     a real route (the record page, the Finance drawer deep link, or the party
 *     statement for customers / suppliers — W11 / W12);
 *   - an exact number match ranks first;
 *   - each type is filtered by the caller's permission: the QC Analyst gets
 *     lots and batches but no orders, finance records, parties or amounts; the
 *     Documentation Officer gets orders and documents but no parties; a
 *     module-scoped user only gets types in its allow-list; a warehouse-scoped
 *     user only gets lots in its warehouses;
 *   - money appears only for finance.view.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('global search (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tag = `ZQ${run}`; // in every searchable reference
  const tok = {};
  const ids = {};

  const search = (who, q, url = '/api/search') => request(app).get(url).query({ q, limit: 20 })
    .set({ Authorization: `Bearer ${tok[who]}` });
  const group = (body, key) => (body.groups || []).find((g) => g.key === key);
  const keys = (body) => (body.groups || []).map((g) => g.key).sort();

  async function makeUser(key, roleName) {
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: roleName }).first();
    const [u] = await db('users').insert({
      email: `zz-p503-${key}-${run}@test.local`, full_name: `ZZ ${key} ${run}`,
      password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids[`user_${key}`] = u.id;
    tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    return u;
  }

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();

    const admin = await makeUser('admin', 'Super Admin');
    await makeUser('qc', 'QC Analyst');
    await makeUser('docs', 'Documentation Officer');
    await makeUser('finance', 'Finance Manager');
    await makeUser('operator', 'Mill Operator');
    const scopedMod = await makeUser('scopedMod', 'Read-Only Auditor');
    await db('user_scopes').insert({ user_id: scopedMod.id, scope_type: 'module', scope_value: 'inventory' });
    const scopedWh = await makeUser('scopedWh', 'Inventory Officer');

    const [cust] = await db('customers').insert({ name: `${tag} Buyer Co`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [lcust] = await db('customers').insert({ name: `${tag} Local Buyer`, customer_type: 'local', currency: 'PKR' }).returning('*');
    const [supp] = await db('suppliers').insert({ name: `${tag} Paddy Supplier`, supplier_code: `${tag}-S` }).returning('*');
    const [haul] = await db('haulers').insert({ name: `${tag} Haulage` }).returning('*');
    const [prod] = await db('products').insert({ name: `${tag} Rice`, code: `${tag}-P` }).returning('*');
    const [wh1] = await db('warehouses').insert({ name: `${tag} WH1`, entity: 'mill', type: 'finished' }).returning('*');
    const [wh2] = await db('warehouses').insert({ name: `${tag} WH2`, entity: 'mill', type: 'finished' }).returning('*');
    await db('user_scopes').insert({ user_id: scopedWh.id, scope_type: 'warehouse', scope_value: String(wh1.id) });
    const mill = (await db('mills').first()) || (await db('mills').insert({ name: `${tag} Mill` }).returning('*'))[0];
    let bank = await db('bank_accounts').first();
    if (!bank) [bank] = await db('bank_accounts').insert({ name: `${tag} Bank` }).returning('*');
    Object.assign(ids, { cust: cust.id, lcust: lcust.id, supp: supp.id, haul: haul.id });

    const [order] = await db('export_orders').insert({
      order_no: `${tag}-EX`, customer_id: cust.id, product_id: prod.id, product_name: `${tag} Rice`, created_by: admin.id,
    }).returning('*');
    // A second order whose number merely CONTAINS the first — ranks after it.
    const [order2] = await db('export_orders').insert({
      order_no: `X${tag}-EX-2`, customer_id: cust.id, product_id: prod.id, created_by: admin.id,
    }).returning('*');
    const [cont] = await db('shipment_containers').insert({ order_id: order.id, container_no: `${tag}CONT` }).returning('*');
    const [batch] = await db('milling_batches').insert({
      batch_no: `${tag}-MB`, batch_name: 'Search Blend', custom_tags: JSON.stringify([`tag-${tag}`]), mill_id: mill.id, created_by: admin.id,
    }).returning('*');
    const [svc] = await db('milling_batches').insert({
      batch_no: `${tag}-SV`, is_service_milling: true, mill_id: mill.id, created_by: admin.id,
    }).returning('*');
    const lot = { product_id: prod.id, item_name: `${tag} Super Basmati`, entity: 'mill', type: 'finished', status: 'Available', supplier_id: supp.id };
    const [lot1] = await db('inventory_lots').insert({ ...lot, lot_no: `${tag}-L1`, warehouse_id: wh1.id }).returning('*');
    const [lot2] = await db('inventory_lots').insert({ ...lot, lot_no: `${tag}-L2`, warehouse_id: wh2.id }).returning('*');
    const [sale] = await db('local_sales').insert({
      sale_no: `${tag}-LS`, item_name: 'Broken', buyer_name: `${tag} Walk-in`, customer_id: lcust.id,
      quantity_input: 10, quantity_kg: 10, rate_input: 100, rate_per_kg: 100, total_amount: 1000, due_amount: 400, status: 'Completed',
    }).returning('*');
    const [recv] = await db('receivables').insert({
      recv_no: `${tag}-RCV`, customer_id: cust.id, order_id: order.id, type: 'Advance', currency: 'USD',
      expected_amount: 500, received_amount: 0, outstanding: 500, status: 'Pending',
    }).returning('*');
    const [pay] = await db('payables').insert({
      pay_no: `${tag}-PAY`, supplier_id: supp.id, currency: 'PKR', original_amount: 900, paid_amount: 0, outstanding: 900, status: 'Pending',
    }).returning('*');
    const [pmt] = await db('payments').insert({
      payment_no: `${tag}-PMT`, type: 'payment', amount: 300, currency: 'PKR', status: 'Confirmed', bank_reference: `${tag}-CHQ77`,
    }).returning('*');
    const [rcpt] = await db('payments').insert({
      payment_no: `${tag}-RCP`, type: 'receipt', amount: 200, currency: 'USD', status: 'Confirmed',
    }).returning('*');
    const [btx] = await db('bank_transactions').insert({
      transaction_no: `${tag}-BT`, amount: 50, type: 'credit', currency: 'PKR', bank_account_id: bank.id, status: 'posted',
    }).returning('*');
    const [exp] = await db('business_expenses').insert({
      expense_no: `${tag}-EXP`, amount: 70, amount_pkr: 70, paid_amount: 20, category: 'Misc', expense_date: '2026-10-01',
    }).returning('*');
    const [doc] = await db('document_store').insert({
      doc_uid: `${tag}-DOC`, title: 'Phyto certificate', doc_type: 'phyto', linked_type: 'export_order', linked_id: order.id, is_latest: true, status: 'Draft',
    }).returning('*');
    Object.assign(ids, {
      order: order.id, order2: order2.id, cont: cont.id, batch: batch.id, svc: svc.id, lot1: lot1.id, lot2: lot2.id,
      sale: sale.id, recv: recv.id, pay: pay.id, pmt: pmt.id, rcpt: rcpt.id, btx: btx.id, exp: exp.id, doc: doc.id,
    });
  });

  afterAll(async () => { if (db) await db.destroy(); });

  it('rejects an unauthenticated call', async () => {
    const res = await request(app).get('/api/search').query({ q: tag });
    expect(res.status).toBe(401);
  });

  it('returns nothing for a term shorter than 2 characters', async () => {
    const res = await search('admin', 'Z');
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });

  it('finds every record type and links each to a real route', async () => {
    const res = await search('admin', tag);
    expect(res.status).toBe(200);
    const href = (key, id) => group(res.body, key)?.items.find((i) => i.id === id)?.href;
    expect(href('orders', ids.order)).toBe(`/export/${ids.order}`);
    expect(href('containers', ids.cont)).toBe(`/export/${ids.order}`);
    expect(href('batches', ids.batch)).toBe(`/milling/${ids.batch}`);
    expect(href('batches', ids.svc)).toBe(`/service-milling/${ids.svc}`);
    expect(href('lots', ids.lot1)).toBe(`/lot-inventory/${ids.lot1}`);
    expect(href('sales', ids.sale)).toBe(`/local-sales/${ids.sale}`);
    expect(href('customers', ids.cust)).toBe(`/finance/accounting/statements?type=customer&id=${ids.cust}`);
    expect(href('customers', ids.lcust)).toBe(`/finance/accounting/statements?type=customer&id=${ids.lcust}&scope=local`);
    expect(href('suppliers', ids.supp)).toBe(`/finance/accounting/statements?type=supplier&id=${ids.supp}`);
    expect(href('transporters', ids.haul)).toBe(`/admin?tab=haulers&hauler=${ids.haul}`);
    expect(href('receivables', ids.recv)).toBe(`/finance/money-in?open=receivable:${ids.recv}`);
    expect(href('payables', ids.pay)).toBe(`/finance/money-out?open=payable:${ids.pay}`);
    expect(href('payments', ids.pmt)).toBe(`/finance/money-out?open=payment:${ids.pmt}`);
    expect(href('payments', ids.rcpt)).toBe(`/finance/money-in?open=payment:${ids.rcpt}`);
    expect(href('bank', ids.btx)).toBe(`/finance/accounts?open=bank:${ids.btx}`);
    expect(href('expenses', ids.exp)).toBe(`/finance/money-out/expenses?open=expense:${ids.exp}`);
    expect(href('documents', ids.doc)).toBe(`/export/${ids.order}`);
  });

  it('finds a batch by its name and by a custom tag, a payment by its bank reference', async () => {
    const byTag = await search('admin', `tag-${tag}`);
    expect(group(byTag.body, 'batches').items.map((i) => i.id)).toEqual([ids.batch]);
    expect(group(byTag.body, 'batches').items[0].customTags).toEqual([`tag-${tag}`]);
    const byChq = await search('admin', `${tag}-CHQ77`);
    expect(group(byChq.body, 'payments').items.map((i) => i.id)).toEqual([ids.pmt]);
  });

  it('ranks an exact number match first, in its group and across groups', async () => {
    const res = await search('admin', `${tag}-EX`);
    expect(res.body.groups[0].key).toBe('orders');
    const items = group(res.body, 'orders').items;
    expect(items[0].id).toBe(ids.order);
    expect(items[0].rank).toBe(0);
    expect(items.find((i) => i.id === ids.order2).rank).toBe(2);
  });

  it('escapes LIKE wildcards', async () => {
    const res = await search('admin', '%_%');
    expect(res.status).toBe(200);
    expect(res.body.groups.flatMap((g) => g.items).some((i) => String(i.title).startsWith(tag))).toBe(false);
  });

  it('carries money for finance.view only', async () => {
    const fin = await search('finance', tag);
    expect(group(fin.body, 'payables').items[0]).toMatchObject({ outstanding: 900, currency: 'PKR' });
    expect(group(fin.body, 'sales').items[0]).toMatchObject({ amount: 1000, outstanding: 400 });
    const op = await search('operator', tag);
    const sale = group(op.body, 'sales').items[0];
    expect(sale).toBeDefined();
    expect(sale.amount).toBeUndefined();
    expect(sale.outstanding).toBeUndefined();
  });

  it('QC Analyst: lots and batches, no orders / finance records / parties / amounts', async () => {
    const res = await search('qc', tag);
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(['batches', 'lots', 'sales']);
    // no service batch without service_milling.view
    expect(group(res.body, 'batches').items.map((i) => i.id)).toEqual([ids.batch]);
    // party-masked: no supplier / buyer name on a lot or sale, and no match BY a buyer name
    expect(group(res.body, 'lots').items[0].subtitle).not.toContain('Paddy Supplier');
    expect(group(res.body, 'sales').items[0].subtitle).not.toContain('Walk-in');
    const byBuyer = await search('qc', `${tag} Walk-in`);
    expect(group(byBuyer.body, 'sales')).toBeUndefined();
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/"amount"|"outstanding"/);
  });

  it('Mill Operator: suppliers open the supplier ledger (no finance.view); no export orders', async () => {
    const res = await search('operator', tag);
    expect(group(res.body, 'suppliers').items[0].href).toBe(`/reports/supplier-ledger/${ids.supp}`);
    expect(group(res.body, 'orders')).toBeUndefined();
    expect(group(res.body, 'customers')).toBeUndefined();
    expect(group(res.body, 'receivables')).toBeUndefined();
  });

  it('Documentation Officer: orders and documents, no parties, no finance records, no lots', async () => {
    const res = await search('docs', tag);
    expect(keys(res.body)).toEqual(['containers', 'documents', 'orders']);
    expect(group(res.body, 'orders').items[0].subtitle).not.toContain('Buyer Co');
    const byBuyer = await search('docs', `${tag} Buyer Co`);
    expect(group(byBuyer.body, 'orders')).toBeUndefined();
  });

  it('a module-scoped user gets only the types in its allow-list', async () => {
    const res = await search('scopedMod', tag);
    expect(keys(res.body)).toEqual(['lots', 'sales']);
  });

  it('a warehouse-scoped user gets only lots in its warehouses', async () => {
    const res = await search('scopedWh', `${tag}-L`);
    expect(group(res.body, 'lots').items.map((i) => i.id)).toEqual([ids.lot1]);
  });

  it('the Reports hero route serves the same results behind reports.view', async () => {
    const res = await search('admin', `${tag}-EX`, '/api/reporting/search');
    expect(res.status).toBe(200);
    expect(group(res.body, 'orders').items[0].id).toBe(ids.order);
    const qc = await search('qc', tag, '/api/reporting/search');
    expect(qc.status).toBe(403); // QC Analyst has no reports.view
  });
});
