/**
 * P3-05 / P3-06 — the mill store's quantity and value move together, and 1250
 * Bags & Packaging moves with them.
 *
 *   MIL-22 / INV-41  the katta reconcile nets against current stock: freed
 *                    katta sold, then a re-yield → succeeds, shortfall ledgered
 *   MIL-23           packaging cost is one line per writer (packing run, store
 *                    issue, katta reconcile, cost sheet) — totals equal across paths
 *   INV-38 / MIL-24  a packing run credits 1250 only for what it drew; a katta
 *                    run is costed when the reconcile draws it
 *   INV-39           batch delete reverses the consumption journal
 *   INV-50           a packaging local sale posts Dr 5000 / Cr 1250
 *   INV-46           an average-cost change with stock is an Owner revaluation
 *   INV-44           real status guard; the override issues only what is there
 *   INV-42 / INV-45  set stock per bucket; no retiring an item with stock
 *   INV-47           concurrent issues of the last units: one wins, never negative
 *   EXP-35           received printed bags land in the store
 * Every test ends with the store tie-out: Δ(Σ on-hand × average) = Δ GL 1250.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('mill store valuation (DB-gated)', () => {
  let db; let repo; let svc; let consumption; let packing; let inventory; let storeStock;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  let seq = 0;
  // A katta size no other suite uses, so the reconcile finds OUR katta item —
  // a fresh size (and item) per test, so tests do not share katta stock.
  let SIZE = 100 + (Number(run) % 700);

  const gl1250 = async () => (await db('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.status': 'Posted', 'c.code': '1250' })
    .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n;
  const net = async (refNo, code, refType) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code });
    if (refType) q = q.where('je.ref_type', refType);
    return (await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n;
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  let before;
  const snapshot = async () => ({ store: await storeStock.storeValue(db), gl: await gl1250() });
  const expectTieOut = async () => {
    const now = await snapshot();
    expect(r2(now.store - before.store)).toBeCloseTo(r2(now.gl - before.gl), 1);
  };
  const stockOf = async (itemId, warehouseId = null) => Number((await db('mill_stock')
    .where({ item_id: itemId, warehouse_id: warehouseId }).first())?.quantity_available || 0);
  const ledgerOf = async (itemId) => Number((await db('mill_stock_movements')
    .where({ item_id: itemId }).sum({ q: 'quantity' }).first()).q || 0);
  const onHandOf = async (itemId) => Number((await db('mill_stock')
    .where({ item_id: itemId }).sum({ q: 'quantity_available' }).first()).q || 0);
  const avgOf = async (itemId) => Number((await db('mill_items').where({ id: itemId }).first()).avg_cost_per_unit);

  const makeItem = async (over = {}) => {
    seq += 1;
    const [it] = await db('mill_items').insert({
      code: `ZZSV${run}-${seq}`, name: `ZZ SV item ${run}-${seq}`, category: 'packaging', unit: 'pcs',
      avg_cost_per_unit: 0, ...over,
    }).returning('*');
    return it;
  };
  const buy = (itemId, quantity, cost, warehouseId = null) => db.transaction(async (trx) => {
    const header = { purchase_no: `ZZMP-${run}-${(seq += 1)}`, purchase_date: '2026-10-15', created_by: ids.user };
    return repo.createPurchase(trx, header, [{ item_id: itemId, quantity, cost_per_unit: cost, warehouse_id: warehouseId }]);
  });
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `ZZSV${run}-${seq}`, mill_id: ids.mill, product_id: ids.product, raw_qty_kg: 10000,
      status: 'In Progress', created_by: ids.user, ...over,
    }).returning('*');
    return b;
  };
  // A milled batch: N sacks of SIZE kg arrived; outputs recorded.
  const yieldBatch = async ({ sacks = 100, finishedKg = SIZE * 50, byKg = SIZE * 10 } = {}) => {
    const b = await makeBatch({ status: 'Completed', actual_finished_kg: finishedKg });
    await db('milling_vehicle_arrivals').insert({ batch_id: b.id, vehicle_no: `ZZV${run}${seq}`, total_bags: sacks, bag_size_kg: SIZE, weight_kg: sacks * SIZE });
    await db('inventory_lots').insert([
      { lot_no: `ZZSVF-${run}-${seq}`, item_name: 'ZZ Rice', type: 'finished', entity: 'mill', product_id: ids.product, warehouse_id: ids.wh, qty: finishedKg, available_qty: finishedKg, net_weight_kg: finishedKg, batch_ref: `batch-${b.id}`, status: 'Available' },
      ...(byKg ? [{ lot_no: `ZZSVB-${run}-${seq}`, item_name: 'ZZ Bran', type: 'byproduct', entity: 'mill', product_id: ids.product, warehouse_id: ids.wh, qty: byKg, available_qty: byKg, net_weight_kg: byKg, batch_ref: `batch-${b.id}`, status: 'Available' }] : []),
    ]);
    return b;
  };

  beforeAll(async () => {
    db = require('../config/database');
    repo = require('../modules/millStore/millStore.repository');
    svc = require('../modules/millStore/millStore.service');
    consumption = require('../modules/millStore/consumption.service');
    packing = require('../modules/millStore/packing.service');
    inventory = require('../modules/inventory/inventory.service');
    storeStock = require('../modules/millStore/storeStock');
    const role = async (name) => (await db('roles').where({ name }).first()).id;
    ids.adminRole = await role('Super Admin');
    ids.user = (await db('users').insert({
      email: `zz-sv-${run}@test.local`, full_name: `ZZ SV ${run}`, password_hash: 'x', role_id: ids.adminRole, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ SV Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ SV Mill ${run}` }).returning('*'))[0].id;
    const [wh] = await db('warehouses').insert({ name: `ZZ SV WH ${run}`, entity: 'mill', type: 'finished' }).returning('*');
    ids.wh = wh.id;
    const [wh2] = await db('warehouses').insert({ name: `ZZ SV Store2 ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    ids.wh2 = wh2.id;
  });
  beforeEach(async () => {
    // Our katta: the only active katta of SIZE kg.
    SIZE += 1;
    await db('mill_items').where({ pack_type: 'katta', capacity_kg: SIZE }).update({ is_active: false });
    ids.katta = (await makeItem({ name: `ZZ Katta ${SIZE}kg ${run}`, pack_type: 'katta', capacity_kg: SIZE })).id;
    before = await snapshot();
  });
  afterAll(async () => { if (db) await db.destroy(); });

  // ── P3-05 ────────────────────────────────────────────────────────────────
  describe('katta reconcile (MIL-22 / INV-41)', () => {
    test('freed katta sold, then a re-yield frees fewer → succeeds; the shortfall is ledgered, stock never negative', async () => {
      await buy(ids.katta, 20, 40); // purchased sacks at Rs 40
      const b = await yieldBatch({ sacks: 100, byKg: SIZE * 10 });
      await db.transaction((trx) => inventory.reconcileBatchKatta(trx, b.id, ids.user));
      // +100 freed, −60 by weight (50 finished + 10 by-product sacks, no
      // packing run) → 20 + 40 = 60 on hand.
      expect(await stockOf(ids.katta)).toBe(60);
      // Freed sacks carry no value: the item's value (20 × 40) is spread over 60.
      expect(r2((await onHandOf(ids.katta)) * (await avgOf(ids.katta)))).toBeCloseTo(800, 0);

      // Sell 55 of them (the store draws them at average cost, with its COGS).
      await db.transaction(async (trx) => {
        const sold = await storeStock.moveStock(trx, {
          itemId: ids.katta, qty: -55, valuation: 'avg',
          movement: { movement_type: 'consumption', reference_type: 'zz_test_sale', reference_id: b.id },
        });
        await storeStock.postStoreJournal(trx, { amount: -sold.value, counterCode: '5000', refType: 'ZZ Test Sale', refNo: `ZZS-${run}`, description: 'test sale' });
      });
      expect(await stockOf(ids.katta)).toBe(5);

      // Re-yield: only 60 sacks really arrived. The reconcile wants 40 back but
      // only 5 are left — it used to hit the non-negative CHECK and abort.
      await db('milling_vehicle_arrivals').where({ batch_id: b.id }).update({ total_bags: 60, weight_kg: 60 * SIZE });
      const res = await db.transaction((trx) => inventory.reconcileBatchKatta(trx, b.id, ids.user));
      expect(await stockOf(ids.katta)).toBe(0);
      expect(res.ledgered).toEqual([expect.objectContaining({ itemId: ids.katta, short: 35 })]);
      // The 5 sacks it took back held the item's last value: written off, not
      // left stranded in 1250.
      expect(await net(`batch_katta-${b.id}`, '1250', 'Mill Store Adjustment')).toBeLessThan(0);
      // The batch's own rows reached the new target (+60 − 60 = 0) and the
      // stock ledger still adds up to on-hand.
      const batchNet = Number((await db('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: b.id }).sum({ q: 'quantity' }).first()).q);
      expect(batchNet).toBe(0);
      expect(await ledgerOf(ids.katta)).toBe(await onHandOf(ids.katta));
      // Nothing deleted: the first reconcile's rows are still there.
      expect(await db('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: b.id, quantity: 100 }).first()).toBeTruthy();

      // Re-running moves nothing more.
      const rows = (await db('mill_stock_movements').where({ item_id: ids.katta })).length;
      await db.transaction((trx) => inventory.reconcileBatchKatta(trx, b.id, ids.user));
      expect((await db('mill_stock_movements').where({ item_id: ids.katta })).length).toBe(rows);
      await expectTieOut();
    });

    test('a yield-mode katta run is drawn AND costed at the reconcile — only what is drawn', async () => {
      await buy(ids.katta, 30, 50);
      const avg = await avgOf(ids.katta);
      const b = await yieldBatch({ sacks: 0, byKg: 0 }); // no freed sacks
      await db('milling_vehicle_arrivals').where({ batch_id: b.id }).del();
      const run1 = await packing.pack(b.id, { bag_item_id: ids.katta, bags_count: 40 }, ids.user, { allowOverPack: true });
      // The run books nothing for katta; the reconcile (pack triggers it) draws
      // the 30 there are and books them.
      expect(Number(run1.total_cost)).toBe(0);
      expect(await stockOf(ids.katta)).toBe(0);
      expect(run1.shortages).toEqual([expect.objectContaining({ short: 10 })]);
      const drawnValue = r2(30 * avg);
      expect(await net(b.batch_no, '1250', 'Mill Packing')).toBeCloseTo(-drawnValue, 1);
      const row = await db('milling_costs').where({ batch_id: b.id, source: 'katta_reconcile' }).first();
      expect(Number(row.amount)).toBeCloseTo(drawnValue, 1);
      await expectTieOut();
    });

    test('a pack-mode (pre-P3-05) katta run is not booked again at the reconcile, but its value leaves the store', async () => {
      await buy(ids.katta, 10, 60);
      const b = await yieldBatch({ sacks: 0, byKg: 0 });
      await db('milling_vehicle_arrivals').where({ batch_id: b.id }).del();
      // As recorded before P3-05: the run booked its katta (Dr 6000 / Cr 1250).
      const avg = await avgOf(ids.katta);
      const [log] = await db('mill_packing_logs').insert({
        batch_id: b.id, bag_item_id: ids.katta, bags_count: 10, capacity_kg_per_bag: SIZE, tare_kg_per_bag: 0,
        packed_weight_kg: 10 * SIZE, tare_weight_kg: 0, gross_weight_kg: 10 * SIZE, cost_per_bag: avg,
        total_cost: r2(10 * avg), katta_cost_mode: 'pack', packed_by: ids.user,
      }).returning('*');
      await db.transaction((trx) => storeStock.postStoreJournal(trx, { amount: r2(10 * avg), refType: 'Mill Packing', refNo: b.batch_no, description: 'legacy run' }));
      await db.transaction((trx) => inventory.reconcileBatchKatta(trx, b.id, ids.user));
      expect(await stockOf(ids.katta)).toBe(0);
      const moves = await db('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: b.id });
      expect(moves.map((m) => m.valuation)).toEqual(['prepaid']);
      // Only the legacy run's own journal — the reconcile booked nothing more.
      expect(await net(b.batch_no, '1250', 'Mill Packing')).toBeCloseTo(-r2(10 * avg), 1);
      expect(await db('milling_costs').where({ batch_id: b.id, source: 'katta_reconcile' }).first()).toBeUndefined();
      expect(log.id).toBeTruthy();
      await expectTieOut();
    });
  });

  describe('packaging cost: one writer per line, only what is drawn (MIL-23 / INV-38 / MIL-24)', () => {
    test('packing and store consumption of the same bags cost the same, each on its own line; the cost sheet never touches them', async () => {
      const bag = await makeItem({ capacity_kg: 25, pack_type: 'pp_bag' });
      await buy(bag.id, 100, 12);
      const b1 = await makeBatch();
      const b2 = await makeBatch();
      await packing.pack(b1.id, { bag_item_id: bag.id, bags_count: 20 }, ids.user);
      await consumption.confirm(b2.id, [{ item_id: bag.id, quantity: 20 }], ids.user);
      const line1 = await db('milling_costs').where({ batch_id: b1.id, category: 'packaging' });
      const line2 = await db('milling_costs').where({ batch_id: b2.id, category: 'packaging' });
      expect(line1.map((l) => [Number(l.amount), l.source])).toEqual([[240, 'packing_run']]);
      expect(line2.map((l) => [Number(l.amount), l.source])).toEqual([[240, 'store_consumption']]);
      expect(await net(b1.batch_no, '6000')).toBe(240);
      expect(await net(b2.batch_no, '6000')).toBe(240);

      // The cost drawer writes its own packaging line; the run's stays.
      const millCtl = require('../modules/milling/milling.controller');
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await millCtl.addCost({ params: { id: String(b1.id) }, body: { category: 'packing', amount: 50 }, user: { id: ids.user } }, res);
      expect(res.statusCode).toBeLessThan(300);
      const after = await db('milling_costs').where({ batch_id: b1.id, category: 'packaging' }).orderBy('id');
      expect(after.map((l) => [Number(l.amount), l.source])).toEqual([[240, 'packing_run'], [50, null]]);
      await expectTieOut();
    });

    test('a run short of bags credits 1250 only for what it drew, and an edit moves exactly the value drawn', async () => {
      const bag = await makeItem({ capacity_kg: 25, pack_type: 'pp_bag' });
      await buy(bag.id, 30, 10);
      const b = await makeBatch();
      const log = await packing.pack(b.id, { bag_item_id: bag.id, bags_count: 50 }, ids.user);
      expect(log.shortages).toEqual([expect.objectContaining({ short: 20 })]);
      expect(Number(log.total_cost)).toBe(300);
      expect(await net(b.batch_no, '1250', 'Mill Packing')).toBe(-300);

      // Buy more and correct the run up by 5: 5 more drawn at the new average.
      await buy(bag.id, 10, 16);
      const avg = await avgOf(bag.id);
      const owner = { id: ids.user, role_id: ids.adminRole };
      const upd = await packing.updateRun(b.id, log.id, { bags_count: 55 }, owner);
      expect(upd.costDelta).toBeCloseTo(r2(5 * avg), 1);
      expect(await net(b.batch_no, '1250', 'Mill Packing')).toBeCloseTo(-(300 + r2(5 * avg)), 1);
      // Deleting the run takes back everything it booked and returns the bags.
      await packing.deleteRun(b.id, log.id, owner);
      expect(await net(b.batch_no, '1250', 'Mill Packing')).toBeCloseTo(0, 1);
      expect(await stockOf(bag.id)).toBe(40);
      expect(await db('milling_costs').where({ batch_id: b.id, source: 'packing_run' })).toHaveLength(0);
      await expectTieOut();
    });
  });

  // ── P3-06 ────────────────────────────────────────────────────────────────
  describe('store GL, locks and guards (P3-06)', () => {
    test('batch delete returns the issued stock at its cost AND reverses the consumption journal (INV-39)', async () => {
      const it = await makeItem({ category: 'fuel', unit: 'liter' });
      await buy(it.id, 50, 300);
      const b = await makeBatch();
      await consumption.confirm(b.id, [{ item_id: it.id, quantity: 10 }], ids.user);
      expect(await net(b.batch_no, '1250', 'Mill Store Consumption')).toBe(-3000);
      const { deleteBatchTx } = require('../modules/milling/milling.controller');
      await db.transaction((trx) => deleteBatchTx(trx, b.id, ids.user));
      expect(await net(b.batch_no, '1250', 'Mill Store Consumption')).toBe(0);
      expect(await stockOf(it.id)).toBe(50);
      // The issue stays in the ledger; the return is a new row.
      const moves = await db('mill_stock_movements').where({ item_id: it.id, reference_type: 'batch', reference_id: b.id }).orderBy('id');
      expect(moves.map((m) => [m.movement_type, Number(m.quantity)])).toEqual([['consumption', -10], ['return', 10]]);
      await expectTieOut();
    });

    test('consumption: a cancelled batch is refused; the override issues only what is there (INV-44)', async () => {
      const it = await makeItem({ category: 'operational', unit: 'kg' });
      await buy(it.id, 5, 100);
      const cancelled = await makeBatch({ status: 'Cancelled' });
      await expect(consumption.confirm(cancelled.id, [{ item_id: it.id, quantity: 1 }], ids.user))
        .rejects.toThrow(/cancelled batch/);
      const b = await makeBatch();
      await expect(consumption.confirm(b.id, [{ item_id: it.id, quantity: 8 }], ids.user)).rejects.toThrow(/Insufficient stock/);
      const res = await consumption.confirm(b.id, [{ item_id: it.id, quantity: 8 }], ids.user, true);
      expect(res.shortages).toEqual([expect.objectContaining({ short: 3 })]);
      expect(res.total_cost).toBe(500);
      expect(await stockOf(it.id)).toBe(0);
      expect(Number((await db('mill_consumption_logs').where({ batch_id: b.id }).first()).quantity_used)).toBe(5);
      expect(await net(b.batch_no, '1250')).toBe(-500);
      await expectTieOut();
    });

    test('a packaging local sale posts Dr 5000 / Cr 1250 at average cost and carries that cost (INV-50)', async () => {
      const it = await makeItem({ pack_type: 'pp_bag', capacity_kg: 25 });
      await buy(it.id, 40, 20);
      const jwt = require('jsonwebtoken');
      const config = require('../config');
      const request = require('supertest');
      const app = require('../app')();
      const mm = (await db('users').insert({
        email: `zz-sv-mm-${run}@test.local`, full_name: `ZZ SV MM ${run}`, password_hash: 'x',
        role_id: (await db('roles').where({ name: 'Mill Manager' }).first()).id, is_active: true, status: 'active',
      }).returning('*'))[0];
      const tok = jwt.sign({ id: mm.id, role_id: mm.role_id, email: mm.email }, config.jwt.secret);
      const [cust] = await db('customers').insert({ name: `ZZ SV Local ${run}`, customer_type: 'local', currency: 'PKR', phone: `0301${run}` }).returning('*');
      const r = await request(app).post('/api/local-sales').set('Authorization', `Bearer ${tok}`)
        .set('Idempotency-Key', `sv-${run}-${Math.random()}`)
        .send({
          customer_id: cust.id, payment_mode: 'credit',
          items: [{ mill_item_id: it.id, item_name: it.name, quantity_input: 15, rate_input: 30 }],
        });
      expect([r.status, r.body.message]).toEqual([201, undefined]);
      const sale = r.body.data.sale;
      expect(await net(sale.sale_no, '5000', 'Local Sale COGS')).toBe(300);
      expect(await net(sale.sale_no, '1250', 'Local Sale COGS')).toBe(-300);
      const row = await db('local_sales').where({ id: sale.id }).first();
      expect(Number(row.landed_cost_total)).toBe(300);
      expect(Number(row.gross_profit)).toBe(150);
      expect(await stockOf(it.id)).toBe(25);
      await expectTieOut();
    });

    test('an average-cost change with stock is refused as an edit; the Owner revaluation posts the delta (INV-46)', async () => {
      const it = await makeItem();
      await buy(it.id, 10, 50);
      await expect(svc.updateItem(it.id, { avg_cost_per_unit: 70 })).rejects.toThrow(/Use Revalue/);
      const res = await svc.revalueItem(it.id, { avg_cost_per_unit: 70, reason: 'supplier credit note corrected' }, ids.user);
      expect(res.value_change).toBe(200);
      const mv = await db('mill_stock_movements').where({ id: res.movement_id }).first();
      expect(mv).toMatchObject({ reference_type: 'revaluation', movement_type: 'adjustment' });
      expect(await net(`MSR-${mv.id}`, '1250')).toBe(200);
      expect(await avgOf(it.id)).toBe(70);
      // With nothing on hand the cost is just a price.
      const empty = await makeItem();
      await expect(svc.updateItem(empty.id, { avg_cost_per_unit: 9 })).resolves.toBeTruthy();
      await expectTieOut();
    });

    test('set stock is per bucket; an item with stock cannot be retired (INV-42 / INV-45)', async () => {
      const it = await makeItem();
      await buy(it.id, 10, 5);
      await buy(it.id, 4, 5, ids.wh2);
      await expect(repo.setStock(it.id, { quantity_available: 12 }, ids.user)).rejects.toThrow(/more than one location/);
      await repo.setStock(it.id, { quantity_available: 6, warehouse_id: ids.wh2 }, ids.user);
      expect(await stockOf(it.id, ids.wh2)).toBe(6);
      expect(await stockOf(it.id)).toBe(10);
      await expect(svc.deleteItem(it.id)).rejects.toThrow(/still has 16/);
      await expect(svc.updateItem(it.id, { is_active: false })).rejects.toThrow(/still has 16/);
      await expectTieOut();
    });

    test('two issues racing for the last units: one wins, stock never negative, ledger = on hand (INV-47)', async () => {
      const it = await makeItem({ category: 'maintenance', unit: 'piece' });
      await buy(it.id, 10, 7);
      const b = await makeBatch();
      const results = await Promise.allSettled([
        consumption.confirm(b.id, [{ item_id: it.id, quantity: 7 }], ids.user),
        consumption.confirm(b.id, [{ item_id: it.id, quantity: 7 }], ids.user),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((x) => x.status === 'rejected').reason.message).toMatch(/Insufficient stock/);
      expect(await stockOf(it.id)).toBe(3);
      expect(await ledgerOf(it.id)).toBe(3);
      await expectTieOut();
    });

    test('received printed bags land in the store at zero value; a correction moves the difference (EXP-35)', async () => {
      const printed = require('../modules/exportOrders/printedBags.service');
      const cust = (await db('customers').insert({ name: `ZZ SV Buyer ${run}`, customer_type: 'export' }).returning('*'))[0];
      const [order] = await db('export_orders').insert({
        order_no: `ZZSV-${run}`, customer_id: cust.id, product_id: ids.product, created_by: ids.user, status: 'Draft',
      }).returning('*');
      const pbo = await printed.create(order.id, { quantity: 200, unit_cost: 15, bag_size_kg: 5, bag_type_name: 'BOPP' }, ids.user);
      const got = await printed.receive(pbo.id, { received_qty: 180 }, ids.user);
      expect(got.mill_item_id).toBeTruthy();
      expect(await stockOf(got.mill_item_id)).toBe(180);
      expect(await avgOf(got.mill_item_id)).toBe(0);
      await printed.receive(pbo.id, { received_qty: 190 }, ids.user);
      expect(await stockOf(got.mill_item_id)).toBe(190);
      // Bags used → the order cannot be deleted out from under them.
      await db.transaction((trx) => storeStock.moveStock(trx, {
        itemId: got.mill_item_id, qty: -50, valuation: 'avg',
        movement: { movement_type: 'consumption', reference_type: 'zz_test_use', reference_id: pbo.id },
      }));
      await expect(printed.remove(pbo.id)).rejects.toMatchObject({ statusCode: 409 });
      await expectTieOut();
    });
  });

  test('scripts: detect reports the tie-out; the true-up needs an Owner and the approved figure, then ties out', async () => {
    const { detect } = require('../../scripts/detectStoreValuation');
    const { plan, apply } = require('../../scripts/correctStoreValuation');
    const out = await detect(db);
    expect(out).toEqual(expect.objectContaining({ storeValue: expect.any(Number), gl1250: expect.any(Number), difference: expect.any(Number) }));
    expect(out.storeValue).toBe(await storeStock.storeValue(db));
    // Legacy drift on purpose: stock typed in with no journal.
    const it = await makeItem({ avg_cost_per_unit: 11 });
    await db('mill_stock').insert({ item_id: it.id, warehouse_id: null, quantity_available: 10, quantity_reserved: 0 });
    const p = await plan(db);
    const owner = (await db('users').insert({
      email: `zz-sv-owner-${run}@test.local`, full_name: `ZZ SV Owner ${run}`, password_hash: 'x',
      role_id: (await db('roles').where({ name: 'Owner' }).first()).id, is_active: true, status: 'active',
    }).returning('*'))[0];
    // Rolled back at the end: the shared test DB keeps its books.
    const ROLLBACK = new Error('rollback');
    await db.transaction(async (t) => {
      await expect(apply(t, { ownerId: ids.user, reason: 'test true-up', expected: p.difference })).rejects.toThrow(/not an active Owner/);
      await expect(apply(t, { ownerId: owner.id, reason: 'test true-up', expected: p.difference + 5 })).rejects.toThrow(/re-run the dry run/);
      const done = await apply(t, { ownerId: owner.id, reason: 'test true-up', expected: p.difference });
      expect(done.posted).toBe(true);
      const after = await detect(t);
      expect(Math.abs(after.difference)).toBeLessThan(0.01);
      throw ROLLBACK;
    }).catch((e) => { if (e !== ROLLBACK) throw e; });
    await db('mill_stock').where({ item_id: it.id }).del();
  });
});
