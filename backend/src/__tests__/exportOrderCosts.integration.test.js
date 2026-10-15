/**
 * P2-05 — export order costs on a real, fully migrated Postgres:
 *   - a second freight bill is a second row, journal and payable (it used to
 *     overwrite the first);
 *   - rice / raw_rice / milling are refused (they double count shipment COGS);
 *   - Closed / Cancelled orders refuse costs;
 *   - a foreign bill with no rate is refused, a rated one is stored in PKR;
 *   - a journal that cannot post saves nothing (no row, no payable);
 *   - milling on the order is derived from the batch's own costs, live.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('export order costs (DB-gated)', () => {
  let db; let costs; let accounting;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  beforeAll(async () => {
    db = require('../config/database');
    costs = require('../modules/exportOrders/exportCosts');
    accounting = require('../modules/accounting/accounting.service');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-eoc-${run}@test.local`, full_name: `ZZ EOC ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ EOC Buyer ${run}` }).returning('*');
    const [s] = await db('suppliers').insert({ name: `ZZ EOC Shipping Line ${run}` }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ EOC Kernel ${run}` }).returning('*');
    const mk = async (suffix, extra = {}) => (await db('export_orders').insert({
      order_no: `ZZ-EOC-${suffix}-${run}`, customer_id: c.id, product_id: p.id, created_by: u.id,
      status: 'In Milling', qty_mt: 10, contract_value: 6000, currency: 'USD', booked_fx_rate: 280, ...extra,
    }).returning('*'))[0];
    const open = await mk('A');
    const closed = await mk('B', { status: 'Closed' });
    const norate = await mk('C', { booked_fx_rate: null });
    Object.assign(ids, { user: u.id, supplier: s.id, open: open.id, closed: closed.id, norate: norate.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const order = (id) => db('export_orders').where({ id }).first();
  const add = (orderId, body) => db.transaction(async (trx) => costs.recordOrderCost(trx, {
    order: await trx('export_orders').where({ id: orderId }).first(), userId: ids.user, ...body,
  }));
  const fail = (p) => p.then(() => null, (e) => e);
  const journalsFor = async (orderNo, cat) => db('journal_entries').where({ ref_type: 'Export Order Cost', ref_no: `${orderNo} ${cat}`, status: 'Posted' });

  test('two freight bills → two rows, two journals, two payables, each with its vendor', async () => {
    const o = await order(ids.open);
    const a = await add(ids.open, { category: 'freight', amount: 100000, supplierId: ids.supplier, billRef: 'MSK-1' });
    const b = await add(ids.open, { category: 'freight', amount: 40000, vendorName: 'Clearing Co', billRef: 'CC-9' });
    expect(a.id).not.toBe(b.id);

    const rows = await db('export_order_costs').where({ order_id: ids.open, category: 'freight' }).orderBy('id');
    expect(rows.map((r) => [Number(r.amount), r.currency, r.supplier_id, r.vendor_name, r.bill_ref])).toEqual([
      [100000, 'PKR', ids.supplier, `ZZ EOC Shipping Line ${run}`, 'MSK-1'],
      [40000, 'PKR', null, 'Clearing Co', 'CC-9'],
    ]);
    const js = await journalsFor(o.order_no, 'freight');
    expect(js).toHaveLength(2);
    const pays = await db('payables').where({ source_table: 'export_order_costs' }).whereIn('source_id', [a.id, b.id]).orderBy('source_id');
    expect(pays.map((p) => [Number(p.original_amount), p.status, p.supplier_id])).toEqual([
      [100000, 'Pending', ids.supplier], [40000, 'Pending', null],
    ]);
    // Dr 6010 Freight / Cr 2010 for each bill
    const lines = await db('journal_lines as jl').join('chart_of_accounts as a', 'a.id', 'jl.account_id')
      .whereIn('jl.journal_id', js.map((j) => j.id)).select('a.code', 'jl.debit', 'jl.credit');
    expect(lines.filter((l) => l.code === '2010').reduce((s, l) => s + Number(l.credit), 0)).toBe(140000);
  });

  test.each(['rice', 'raw_rice', 'milling'])('%s cannot be added as an order cost (shipment COGS already costs it)', async (category) => {
    const before = await db('export_order_costs').where({ order_id: ids.open }).count('id as n').first();
    const err = await fail(add(ids.open, { category, amount: 5000, vendorName: 'x' }));
    expect(err && err.statusCode).toBe(400);
    expect(err.message).toMatch(/costed from stock at shipment/);
    const after = await db('export_order_costs').where({ order_id: ids.open }).count('id as n').first();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  test('a Closed order refuses new costs', async () => {
    const err = await fail(add(ids.closed, { category: 'freight', amount: 10, vendorName: 'x' }));
    expect(err && err.statusCode).toBe(400);
    expect(err.message).toMatch(/'Closed' status/);
  });

  test('a foreign bill: refused without any rate, stored in PKR at the booked rate otherwise', async () => {
    const err = await fail(add(ids.norate, { category: 'freight', amount: 100, currency: 'USD', vendorName: 'x' }));
    expect(err && err.statusCode).toBe(400);
    expect(err.message).toMatch(/FX rate is required/);

    const row = await add(ids.open, { category: 'insurance', amount: 100, currency: 'USD', vendorName: 'Insurer' });
    expect(row.currency).toBe('PKR');
    expect(Number(row.amount)).toBe(28000);
    expect(Number(row.base_amount_pkr)).toBe(28000);
  });

  test('a journal that cannot post aborts the whole bill (no row, no payable)', async () => {
    const spy = jest.spyOn(accounting, 'createJournal').mockRejectedValueOnce(new Error('Accounting period is closed'));
    try {
      const before = await db('export_order_costs').where({ order_id: ids.open }).count('id as n').first();
      const err = await fail(add(ids.open, { category: 'loading', amount: 999, vendorName: 'Loader' }));
      expect(err && err.statusCode).toBe(400);
      expect(err.message).toMatch(/The cost was not saved.*Accounting period is closed/);
      const after = await db('export_order_costs').where({ order_id: ids.open }).count('id as n').first();
      expect(Number(after.n)).toBe(Number(before.n));
      expect(await db('payables').where({ source_table: 'export_order_costs', original_amount: 999 })).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });

  test('milling is derived from the linked batch on read and follows later cost edits', async () => {
    let mill = await db('mills').first('id');
    if (!mill) [mill] = await db('mills').insert({ name: `ZZ Mill ${run}` }).returning('id');
    const [b] = await db('milling_batches').insert({
      batch_no: `ZZ-MB-${run}`, linked_export_order_id: ids.open, status: 'Completed',
      mill_id: mill.id, created_by: ids.user,
    }).returning('*');
    await db('milling_costs').insert([
      { batch_id: b.id, category: 'raw_rice', amount: 900000, currency: 'PKR' },
      { batch_id: b.id, category: 'processing', amount: 50000, currency: 'PKR' },
    ]);
    let derived = await costs.derivedMillingCosts(db, ids.open);
    expect(derived).toEqual([expect.objectContaining({ category: 'milling', amount: 950000, currency: 'PKR', derived: true, batch_no: `ZZ-MB-${run}` })]);

    await db('milling_costs').insert({ batch_id: b.id, category: 'electricity', amount: 10000, currency: 'PKR' });
    derived = await costs.derivedMillingCosts(db, ids.open);
    expect(derived[0].amount).toBe(960000);
    // Nothing was stored on the order for it.
    expect(await db('export_order_costs').where({ order_id: ids.open, category: 'milling' })).toHaveLength(0);
  });
});
