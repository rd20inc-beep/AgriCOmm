/**
 * P3-09 / owner decision D-6 (a) — Milling WIP and truck rice bought at receipt.
 *
 *   - truck intake books the supplier payable + Dr 1210 / Cr 2010 at RECEIPT
 *     (same shape as New Purchase Lot) and moves straight on into 1260 WIP;
 *   - committing a lot moves its value from its own stock account to 1260;
 *   - yield relieves WIP into finished stock and books no second payable;
 *   - cancel returns WIP to stock (truck rice stays bought — booked now if it
 *     never was); delete voids the unpaid truck purchase by signed delta;
 *   - the per-account tie-out explains every move (P3-19).
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('Milling WIP + truck purchase at receipt (DB-gated)', () => {
  let db; let controller; let inventory; let wip; let sv;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  let seq = 0;

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const glNet = async (refNo, code, refTypes = null) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.status': 'Posted', 'c.code': code });
    if (refNo) q = q.whereIn('je.ref_no', [].concat(refNo));
    if (refTypes) q = q.whereIn('je.ref_type', refTypes);
    const r = await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };
  const tbBalanced = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted').select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.abs(r.n) < 0.01;
  };
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `MW${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product,
      raw_qty_kg: 0, status: 'Queued', created_by: ids.user, mill_id: ids.mill, ...over,
    }).returning('*');
    return b;
  };
  const makeLot = async (over) => {
    seq += 1;
    const [l] = await db('inventory_lots').insert({
      lot_no: `ZZMW-${run}-${seq}`, item_name: 'ZZ Rice', type: 'raw', entity: 'mill',
      warehouse_id: ids.whRaw, product_id: ids.product, qty: 10000, available_qty: 10000, unit: 'KG',
      supplier_id: ids.sup, landed_cost_per_kg: 100, rate_per_kg: 100, cost_per_unit: 100,
      purchase_amount: 1000000, landed_cost_total: 1000000, total_value: 1000000,
      net_weight_kg: 10000, status: 'Available', ...over,
    }).returning('*');
    return l;
  };
  const receive = (batchId, kg, perKg) => db.transaction((trx) => inventory.receiveRice(trx, {
    batchId, weightKg: kg, costPerKg: perKg, currency: 'PKR', supplierId: ids.sup, productId: ids.product, userId: ids.user,
  }));
  const truckLot = (batchId) => db('inventory_lots').where({ batch_ref: `batch-${batchId}`, type: 'raw' }).first();
  const lotPayable = (lotNo) => db('payables').where({ linked_ref: lotNo, category: 'Raw Material' }).first();
  const yieldOf = async (batchId, finished = 7000) => {
    const res = mockRes();
    await controller.recordYield({
      params: { id: String(batchId) },
      body: { actual_finished_kg: finished, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 },
      user: { id: ids.user },
    }, res);
    return res;
  };
  const unexplained = async () => {
    const t = await sv.inventoryTieOut(db);
    return Object.fromEntries(t.accounts.map((a) => [a.account, a.unexplained]));
  };

  let before;
  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/milling/milling.controller');
    inventory = require('../modules/inventory/inventory.service');
    wip = require('../modules/milling/millingWip');
    sv = require('../modules/inventory/stockValue');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-mw-${run}@test.local`, full_name: `ZZ MW ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ MW Supplier ${run}`, type: 'local' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ MW Rice ${run}` }).returning('*');
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ MW Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ MW Mill ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, sup: sup.id, product: p.id, whRaw: wh.id, mill: mill.id });
    before = await unexplained();
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('the chart has 1260 Milling WIP (a 12xx control account)', async () => {
    const acc = await db('chart_of_accounts').where({ code: '1260' }).first();
    expect(acc).toMatchObject({ name: 'Milling WIP', type: 'Asset' });
    expect(require('../modules/accounting/controlAccounts').isControlCode('1260')).toBe(true);
  });

  test('truck intake books AP at receipt and moves into WIP; a second truck adds the delta', async () => {
    const b = await makeBatch();
    await receive(b.id, 10000, 100);
    let lot = await truckLot(b.id);
    let pay = await lotPayable(lot.lot_no);
    expect(Number(pay.original_amount)).toBe(1000000);
    expect(pay).toMatchObject({ supplier_id: ids.sup, source_id: lot.id, status: 'Pending' });
    expect(await glNet(lot.lot_no, '2010', ['Purchase Lot'])).toBe(-1000000);
    expect(await glNet(lot.lot_no, '1210', ['Purchase Lot'])).toBe(1000000);
    expect(await wip.wipBalance(db, b.batch_no)).toBe(1000000);
    expect(await glNet([lot.lot_no, b.batch_no], '1210')).toBe(0);

    await receive(b.id, 5000, 100);
    lot = await truckLot(b.id);
    pay = await lotPayable(lot.lot_no);
    expect(Number(pay.original_amount)).toBe(1500000);
    expect(await glNet(lot.lot_no, '2010')).toBe(-1500000);
    expect(await wip.wipBalance(db, b.batch_no)).toBe(1500000);
    expect(await db('payables').where({ linked_ref: lot.lot_no }).count('id as c').first()).toMatchObject({ c: '1' });
    expect(await tbBalanced()).toBe(true);
  });

  test('yield relieves WIP into finished stock, books no second payable; a cost-sheet difference trues up the SAME payable', async () => {
    const b = await makeBatch();
    await receive(b.id, 10000, 100);
    await db('milling_batches').where({ id: b.id }).update({ raw_qty_kg: 10000, status: 'In Progress' });
    // The cost sheet says Rs 1,050,000 (e.g. a truck price corrected after receipt).
    await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: 1050000, currency: 'PKR' });
    const res = await yieldOf(b.id);
    expect(res.body && res.body.message).toBeUndefined();
    expect(res.statusCode).toBe(200);
    const lot = await truckLot(b.id);
    expect(await db('payables').where({ source_table: 'milling_raw_rice', source_id: b.id }).first()).toBeUndefined();
    const pays = await db('payables').where({ linked_ref: lot.lot_no });
    expect(pays).toHaveLength(1);
    expect(Number(pays[0].original_amount)).toBe(1050000);
    expect(await glNet(lot.lot_no, '2010')).toBe(-1050000);
    expect(await glNet(b.batch_no, '2010')).toBe(0);
    // WIP relieved; raw rice nets to zero; finished carries the batch.
    expect(await wip.wipBalance(db, b.batch_no)).toBe(0);
    expect(await glNet([lot.lot_no, b.batch_no], '1210')).toBe(0);
    expect(await glNet(b.batch_no, '1220')).toBeGreaterThan(0);
    expect(await tbBalanced()).toBe(true);
    // Money Out lists the truck lot's payable once — no derived MC- twin of the raw_rice.
    const mc = await db('milling_costs').where({ batch_id: b.id, category: 'raw_rice' }).first();
    const fin = require('../modules/finance/finance.controller');
    const r2 = mockRes();
    await fin.getPayables({ query: { limit: 5000 }, user: { id: ids.user, role: 'Super Admin' } }, r2);
    const feed = JSON.stringify(r2.body);
    expect(feed).not.toContain(`"MC-${mc.id}"`);
    expect(feed).toContain(lot.lot_no);
  });

  test('committing lots moves each from its own account into WIP; cancel moves it back', async () => {
    const raw = await makeLot({});
    const fin = await makeLot({ type: 'finished', landed_cost_per_kg: 200, qty: 4000, available_qty: 4000, net_weight_kg: 4000 });
    const b = await makeBatch({ processing_type: 'blended' });
    const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
    await db.transaction((trx) => commitLotToBatch(trx, { batchId: b.id, lotId: raw.id, qtyKg: 6000 }));
    await db.transaction((trx) => commitLotToBatch(trx, { batchId: b.id, lotId: fin.id, qtyKg: 4000 }));
    expect(await glNet(b.batch_no, '1260')).toBe(600000 + 800000);
    expect(await glNet(b.batch_no, '1210')).toBe(-600000);
    expect(await glNet(b.batch_no, '1220')).toBe(-800000);
    // Idempotent: a second sync posts nothing.
    expect((await db.transaction((trx) => wip.syncBatchWip(trx, b.id))).posted).toBe(false);

    const res = mockRes();
    await controller.cancelBatch({ params: { id: String(b.id) }, body: {}, user: { id: ids.user } }, res);
    expect(res.statusCode).toBe(200);
    expect(await glNet(b.batch_no, '1260')).toBe(0);
    expect(await glNet(b.batch_no, '1210')).toBe(0);
    expect(await glNet(b.batch_no, '1220')).toBe(0);
    // Nothing reversed or deleted — every journal stays Posted.
    const js = await db('journal_entries').where({ ref_no: b.batch_no }).select('status');
    expect(js.length).toBeGreaterThan(0);
    expect(js.every((j) => j.status === 'Posted')).toBe(true);
  });

  test('a lot re-priced while committed moves the re-price into WIP too', async () => {
    const raw = await makeLot({});
    const b = await makeBatch();
    const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
    await db.transaction((trx) => commitLotToBatch(trx, { batchId: b.id, lotId: raw.id, qtyKg: 5000 }));
    expect(await wip.wipBalance(db, b.batch_no)).toBe(500000);
    await db('inventory_lots').where({ id: raw.id }).update({ landed_cost_per_kg: 110 });
    await db.transaction((trx) => inventory.propagateLotCostToBatches(trx, raw.id, { userId: ids.user }));
    expect(await wip.wipBalance(db, b.batch_no)).toBe(550000);
  });

  test('cancelling a truck batch keeps the rice bought (booked now for a pre-D-6 receipt) and empties WIP', async () => {
    // A receipt from before purchases were booked at receipt: the lot exists, no payable, no GL.
    const b = await makeBatch();
    const legacy = await makeLot({ batch_ref: `batch-${b.id}`, qty: 8000, available_qty: 8000, net_weight_kg: 8000, landed_cost_per_kg: 90 });
    expect(await lotPayable(legacy.lot_no)).toBeUndefined();
    const res = mockRes();
    await controller.cancelBatch({ params: { id: String(b.id) }, body: {}, user: { id: ids.user } }, res);
    expect(res.statusCode).toBe(200);
    const pay = await lotPayable(legacy.lot_no);
    expect(Number(pay.original_amount)).toBe(720000);
    expect(await glNet(legacy.lot_no, '1210')).toBe(720000);
    expect(await glNet(legacy.lot_no, '2010')).toBe(-720000);
    expect(await wip.wipBalance(db, b.batch_no)).toBe(0);
  });

  test('deleting a truck batch voids the unpaid purchase by signed delta; a paid one is refused', async () => {
    const b = await makeBatch();
    await receive(b.id, 4000, 100);
    const lot = await truckLot(b.id);
    const res = mockRes();
    await controller.deleteBatch({ params: { id: String(b.id) }, user: { id: ids.user } }, res);
    expect(res.statusCode).toBe(200);
    expect((await lotPayable(lot.lot_no)).status).toBe('Reversed');
    expect(await glNet(lot.lot_no, '2010')).toBe(0);
    expect(await glNet([lot.lot_no, b.batch_no], '1210')).toBe(0);
    expect(await wip.wipBalance(db, b.batch_no)).toBe(0);

    const b2 = await makeBatch();
    await receive(b2.id, 4000, 100);
    const lot2 = await truckLot(b2.id);
    await db('payables').where({ linked_ref: lot2.lot_no }).update({ paid_amount: 1000, outstanding: 399000, status: 'Partial' });
    const res2 = mockRes();
    await controller.deleteBatch({ params: { id: String(b2.id) }, user: { id: ids.user } }, res2);
    expect(res2.statusCode).toBe(409);
    expect(await truckLot(b2.id)).toBeTruthy();
  });

  test('re-milling a cancelled batch\'s truck lot books no payable (P2-06 still holds)', async () => {
    const b = await makeBatch();
    await receive(b.id, 3000, 100);
    const res = mockRes();
    await controller.cancelBatch({ params: { id: String(b.id) }, body: {}, user: { id: ids.user } }, res);
    const lot = await truckLot(b.id);
    const b2 = await makeBatch({ status: 'In Progress', raw_qty_kg: 3000 });
    const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
    await db.transaction((trx) => commitLotToBatch(trx, { batchId: b2.id, lotId: lot.id, qtyKg: 3000 }));
    const toBook = await require('../modules/milling/rawPurchasePayable').rawPurchaseToBook(db, b2);
    expect(toBook.amount).toBe(0);
    expect(toBook.sources[0].booked).toBe('purchase_lot');
  });

  test('tie-out: 1260 WIP equals the rice committed to open batches, nothing unexplained', async () => {
    const t = await sv.inventoryTieOut(db);
    const w = t.accounts.find((a) => a.account === '1260');
    // Relative to the start: the tie-out is company-wide, and other suites on
    // the same DB leave fixtures (e.g. a source lot linked straight into
    // batch_source_lots) that this suite did not book.
    expect(Math.round((w.unexplained - (before['1260'] || 0)) * 100) / 100).toBe(0);
    // The truck scenarios were booked through the documents, so they add
    // nothing unexplained to raw rice (the directly-inserted test lots carry
    // no purchase journal and account for the whole 1210 change).
    const after = await unexplained();
    const direct = await db('inventory_lots').where('lot_no', 'like', `ZZMW-${run}-%`).whereNull('batch_ref')
      .where('type', 'raw').select(db.raw('COALESCE(SUM(net_weight_kg * landed_cost_per_kg), 0)::float AS v')).first();
    const legacyBooked = 720000; // the pre-D-6 truck lot, booked at cancel
    const legacyLot = await db('inventory_lots').where('lot_no', 'like', `ZZMW-${run}-%`).where('batch_ref', 'like', 'batch-%')
      .where('landed_cost_per_kg', 90).first();
    expect(Number(legacyLot.net_weight_kg) * 90).toBe(legacyBooked);
    expect(Math.round(((after['1210'] || 0) - (before['1210'] || 0)) * 100) / 100).toBe(Math.round(-direct.v * 100) / 100);
  });

  test('applyWipToCredits nets WIP against the input credits, totals unchanged', () => {
    const out = wip.applyWipToCredits([{ code: '1210', amount: 1000 }, { code: '2110', amount: 50 }], { 1210: 1200, 1220: 100 });
    expect(out).toEqual([{ code: '1260', amount: 1300 }, { code: '1210', amount: -200 }, { code: '2110', amount: 50 }, { code: '1220', amount: -100 }]);
    expect(out.reduce((s, c) => s + c.amount, 0)).toBe(1050);
  });
});
