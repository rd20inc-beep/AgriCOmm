/**
 * P3-01 / P3-02 — the lot quantity invariant, end to end against Postgres.
 *
 *   available_qty = qty − reserved_qty − milling_reserved_qty
 *
 * - the DB CHECK (migration 371) refuses a write that breaks it;
 * - postMovement: inbound cost is the weighted average, outbound never touches
 *   the lot's cost (INV-22), status follows the quantity (INV-32);
 * - reservations and their release go through the engine with ledger rows,
 *   under the lot lock (INV-23);
 * - parallel sales / reservations / transfers on one lot never oversell;
 * - Edit Received writes a correction row so the ledger still reconciles (INV-20);
 * - Use in Batch commits through commitLotToBatch, which refuses client /
 *   export / non-millable lots (INV-05, MIL-19), trucks are refused on a
 *   source-lot batch (MIL-15) and Start Milling keeps the committed raw qty
 *   (MIL-42).
 * After every test, every lot this suite touched satisfies the invariant and
 * its ledger sums to its net weight.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('lot quantity invariant (DB-gated)', () => {
  let db; let inventory; let lotController; let millingController; let lifecycle;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const touched = new Set();
  let seq = 0;

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const n = (v) => parseFloat(v) || 0;
  const lotRow = (id) => db('inventory_lots').where({ id }).first();
  const ledger = (id) => db('lot_transactions').where({ lot_id: id }).orderBy('id');

  // An empty lot filled by a real purchase receipt (so its ledger reconciles).
  const makeLot = async (over = {}, { kg = 1000, cost = 100 } = {}) => {
    seq += 1;
    const [l] = await db('inventory_lots').insert({
      lot_no: `ZZQ-${run}-${seq}`, item_name: 'ZZ Q Rice', type: 'raw', entity: 'mill',
      warehouse_id: ids.wh, product_id: ids.product, qty: 0, available_qty: 0, unit: 'KG',
      supplier_id: ids.sup, status: 'Available', created_by: ids.user, ...over,
    }).returning('*');
    touched.add(l.id);
    if (kg > 0) {
      await db.transaction((trx) => inventory.postMovement(trx, {
        movementType: 'purchase_receipt', lotId: l.id, qty: kg, costPerUnit: cost, userId: ids.user,
      }));
    }
    await db('inventory_lots').where({ id: l.id }).update({ landed_cost_per_kg: cost, rate_per_kg: cost });
    return lotRow(l.id);
  };
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `MQ${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product,
      raw_qty_kg: 0, status: 'Queued', created_by: ids.user, mill_id: ids.mill, ...over,
    }).returning('*');
    return b;
  };
  const move = (lotId, movementType, qty, extra = {}) => db.transaction((trx) => inventory.postMovement(trx, {
    movementType, lotId, qty, userId: ids.user, ...extra,
  }));

  beforeAll(async () => {
    db = require('../config/database');
    inventory = require('../modules/inventory/inventory.service');
    lotController = require('../modules/inventory/lotInventory.controller');
    millingController = require('../modules/milling/milling.controller');
    lifecycle = require('../modules/milling/batchLifecycle');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-q-${run}@test.local`, full_name: `ZZ Q ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ Q Supplier ${run}`, type: 'local' }).returning('*');
    const [cust] = await db('customers').insert({ name: `ZZ Q Client ${run}` }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ Q Rice ${run}` }).returning('*');
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ Q Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ Q Mill ${run}`, status: 'Active' }).returning('*');
    Object.assign(ids, { user: u.id, sup: sup.id, cust: cust.id, product: p.id, wh: wh.id, mill: mill.id });
  });

  afterEach(async () => {
    // The invariant + ledger reconciliation hold for every lot touched so far.
    const rows = await db('inventory_lots').whereIn('id', [...touched]);
    for (const l of rows) {
      expect({ lot: l.lot_no, drift: Math.abs(n(l.available_qty) - (n(l.qty) - n(l.reserved_qty) - n(l.milling_reserved_qty))) <= 0.01 })
        .toEqual({ lot: l.lot_no, drift: true });
      const sum = await db('lot_transactions').where({ lot_id: l.id }).sum('quantity_kg as s').first();
      expect({ lot: l.lot_no, ledger: Math.round(n(sum.s) * 100) / 100 }).toEqual({ lot: l.lot_no, ledger: Math.round(n(l.net_weight_kg) * 100) / 100 });
      expect(Math.round(n(l.qty) * 100) / 100).toBe(Math.round(n(l.net_weight_kg) * 100) / 100);
    }
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('the DB CHECK refuses an available_qty that disagrees with the holds', async () => {
    const lot = await makeLot();
    await expect(db('inventory_lots').where({ id: lot.id }).update({ available_qty: 400 }))
      .rejects.toThrow(/inventory_lots_available_derived_chk/);
    await expect(db('inventory_lots').where({ id: lot.id }).update({ milling_reserved_qty: -1, available_qty: 1001 }))
      .rejects.toThrow(/check constraint/);
  });

  test('inbound cost is the weighted average; outbound leaves the lot cost alone (INV-22)', async () => {
    const lot = await makeLot({}, { kg: 1000, cost: 100 });
    await move(lot.id, 'purchase_receipt', 1000, { costPerUnit: 200 });
    let l = await lotRow(lot.id);
    expect(n(l.cost_per_unit)).toBeCloseTo(150, 4);
    expect(n(l.total_value)).toBeCloseTo(300000, 2);
    // A manual transaction carrying a SALE rate must not re-cost the stock left.
    await move(lot.id, 'local_sale', 500, { costPerUnit: 999 });
    l = await lotRow(lot.id);
    expect(n(l.cost_per_unit)).toBeCloseTo(150, 4);
    expect(n(l.total_value)).toBeCloseTo(150 * 1500, 2);
    const last = (await ledger(lot.id)).pop();
    expect(n(last.cost_impact)).toBeCloseTo(999 * 500, 2); // the movement keeps its own rate
  });

  test('status follows the quantity: emptied → Depleted, restocked → Available (INV-32)', async () => {
    const lot = await makeLot({}, { kg: 300 });
    await move(lot.id, 'local_sale', 300, { costPerUnit: 100 });
    expect((await lotRow(lot.id)).status).toBe('Depleted');
    await move(lot.id, 'return', 100, { costPerUnit: 100 });
    expect((await lotRow(lot.id)).status).toBe('Available');
    // A manual status is not overridden.
    await db('inventory_lots').where({ id: lot.id }).update({ status: 'Damaged' });
    await move(lot.id, 'local_sale', 100, { costPerUnit: 100 });
    expect((await lotRow(lot.id)).status).toBe('Damaged');
  });

  test('reserve + release go through the engine and both leave a ledger row (INV-23)', async () => {
    const lot = await makeLot({ type: 'finished' }, { kg: 1000 });
    const [o] = await db('export_orders').insert({
      order_no: `ZZQ-EX-${run}`, customer_id: ids.cust, product_id: ids.product, status: 'Draft', created_by: ids.user,
    }).returning('*');
    const r = await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 600, userId: ids.user }));
    let l = await lotRow(lot.id);
    expect([n(l.reserved_qty), n(l.available_qty)]).toEqual([600, 400]);
    // More than is free is refused, and nothing is held.
    await expect(db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 500, userId: ids.user })))
      .rejects.toThrow(/Insufficient available stock/);
    await db.transaction((trx) => inventory.releaseReservation(trx, { reservationId: r.id, userId: ids.user }));
    l = await lotRow(lot.id);
    expect([n(l.reserved_qty), n(l.available_qty)]).toEqual([0, 1000]);
    const rows = (await ledger(lot.id)).filter((t) => ['export_allocation', 'export_release'].includes(t.transaction_type));
    expect(rows.map((t) => [t.transaction_type, n(t.quantity_kg), n(t.reservation_effect)]))
      .toEqual([['export_allocation', 0, 600], ['export_release', 0, -600]]);
    // A second release of the same reservation is refused.
    await expect(db.transaction((trx) => inventory.releaseReservation(trx, { reservationId: r.id, userId: ids.user })))
      .rejects.toThrow(/already Released/);
  });

  test('parallel sales on one lot never oversell (row lock)', async () => {
    const lot = await makeLot({ type: 'finished' }, { kg: 1000 });
    const results = await Promise.allSettled([1, 2, 3].map(() => move(lot.id, 'local_sale', 400, { costPerUnit: 100 })));
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
    const l = await lotRow(lot.id);
    expect([n(l.qty), n(l.available_qty)]).toEqual([200, 200]);
  });

  test('parallel reserve / sell / transfer on one lot share the same stock', async () => {
    const lot = await makeLot({ type: 'finished' }, { kg: 1000 });
    const [o] = await db('export_orders').insert({
      order_no: `ZZQ-EX2-${run}`, customer_id: ids.cust, product_id: ids.product, status: 'Draft', created_by: ids.user,
    }).returning('*');
    const results = await Promise.allSettled([
      db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 500, userId: ids.user })),
      move(lot.id, 'local_sale', 500, { costPerUnit: 100 }),
      db.transaction(async (trx) => {
        const r = await inventory.transferToExport(trx, { lotId: lot.id, qtyKg: 500, transferPricePerMT: 100000, userId: ids.user });
        touched.add(r.exportLot.id);
        return r;
      }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
    const l = await lotRow(lot.id);
    expect(n(l.available_qty)).toBeCloseTo(0, 4);
  });

  test('Edit Received writes a correction row and the ledger still reconciles (INV-20)', async () => {
    // Opening-stock lot: no payable, restated against equity.
    const lot = await makeLot({}, { kg: 1000, cost: 100 });
    await db('inventory_lots').where({ id: lot.id }).update({ purchase_amount: 100000, landed_cost_total: 100000, received_net_weight_kg: 1000 });
    await db('lot_transactions').where({ lot_id: lot.id }).update({ transaction_type: 'opening_balance', reference_module: 'opening_balance' });
    const res = mockRes();
    await lotController.setLotReceivedQty({ params: { id: String(lot.id) }, body: { received_net_weight_kg: 900 }, user: { id: ids.user } }, res);
    expect(res.body && res.body.message).toBeUndefined();
    expect(res.statusCode).toBe(200);
    const l = await lotRow(lot.id);
    expect([n(l.qty), n(l.net_weight_kg), n(l.available_qty), n(l.received_net_weight_kg)]).toEqual([900, 900, 900, 900]);
    const last = (await ledger(lot.id)).pop();
    expect([last.transaction_type, n(last.quantity_kg)]).toEqual(['purchase_correction_out', -100]);
  });

  test('Edit Received cannot cut below rice committed to milling', async () => {
    const lot = await makeLot({}, { kg: 1000, cost: 100 });
    await db('inventory_lots').where({ id: lot.id }).update({ purchase_amount: 100000, landed_cost_total: 100000, received_net_weight_kg: 1000 });
    await db('lot_transactions').where({ lot_id: lot.id }).update({ transaction_type: 'opening_balance', reference_module: 'opening_balance' });
    const b = await makeBatch();
    await db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: b.id, lotId: lot.id, qtyKg: 800, userId: ids.user }));
    const res = mockRes();
    await lotController.setLotReceivedQty({ params: { id: String(lot.id) }, body: { received_net_weight_kg: 700 }, user: { id: ids.user } }, res);
    expect(res.statusCode).toBe(409);
    expect(n((await lotRow(lot.id)).qty)).toBe(1000);
  });

  describe('lot → batch commitment (P3-02)', () => {
    test('commit holds the qty with a ledger row; release gives it back with one', async () => {
      const lot = await makeLot();
      const b = await makeBatch();
      await db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: b.id, lotId: lot.id, qtyKg: 700, userId: ids.user }));
      let l = await lotRow(lot.id);
      expect([n(l.milling_reserved_qty), n(l.available_qty), l.milling_status]).toEqual([700, 300, 'In Milling']);
      await db.transaction((trx) => lifecycle.releaseBatchSources(trx, b.id, { userId: ids.user }));
      l = await lotRow(lot.id);
      expect([n(l.milling_reserved_qty), n(l.available_qty), l.milling_status]).toEqual([0, 1000, null]);
      const holds = (await ledger(lot.id)).filter((t) => t.transaction_type.startsWith('milling_'));
      expect(holds.map((t) => [t.transaction_type, n(t.reservation_effect)])).toEqual([['milling_hold', 700], ['milling_release', -700]]);
    });

    test('client-owned, export and non-millable lots are refused (MIL-19)', async () => {
      const b = await makeBatch();
      const client = await makeLot({ ownership: 'client', owner_customer_id: ids.cust });
      const exp = await makeLot({ entity: 'export', type: 'finished' });
      const bran = await makeLot({ type: 'byproduct', item_name: 'Rice Bran' });
      for (const [lot, why] of [[client, /service-milling client/], [exp, /only mill lots/], [bran, /not rice/]]) {
        await expect(db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: b.id, lotId: lot.id, qtyKg: 100, userId: ids.user })))
          .rejects.toThrow(why);
      }
      // A service batch mills only its own client's rice.
      const svc = await makeBatch({ is_service_milling: true, client_customer_id: ids.cust });
      const own = await makeLot();
      await expect(db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: svc.id, lotId: own.id, qtyKg: 100, userId: ids.user })))
        .rejects.toThrow(/service-milling batch/);
      await db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: svc.id, lotId: client.id, qtyKg: 100, userId: ids.user }));
      expect(n((await lotRow(client.id)).milling_reserved_qty)).toBe(100);
      await db.transaction((trx) => lifecycle.releaseBatchSources(trx, svc.id, { userId: ids.user }));
    });

    test('Use in Batch commits through commitLotToBatch — no fake truck, rice is held (INV-05)', async () => {
      const first = await makeLot();
      const lot = await makeLot();
      const b = await makeBatch({ raw_qty_kg: 500 });
      await db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: b.id, lotId: first.id, qtyKg: 500, userId: ids.user }));
      await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: 50000, currency: 'PKR' });
      const res = mockRes();
      await lotController.allocateLotToBatch({ params: { id: String(lot.id) }, body: { batch_id: b.id, weight_kg: 600 }, user: { id: ids.user } }, res);
      expect(res.body && res.body.message).toBeUndefined();
      expect(res.statusCode).toBe(200);
      const l = await lotRow(lot.id);
      expect([n(l.qty), n(l.milling_reserved_qty), n(l.available_qty)]).toEqual([1000, 600, 400]);
      expect(await db('milling_vehicle_arrivals').where({ batch_id: b.id })).toHaveLength(0);
      const src = await db('batch_source_lots').where({ batch_id: b.id, lot_id: lot.id }).first();
      expect(n(src.qty_kg)).toBe(600);
      expect(n((await db('milling_batches').where({ id: b.id }).first()).raw_qty_kg)).toBe(1100);
      const pool = await db('milling_costs').where({ batch_id: b.id, category: 'raw_rice' }).sum('amount as s').first();
      expect(n(pool.s)).toBe(50000 + 60000);
      // More than is free is refused.
      const res2 = mockRes();
      await lotController.allocateLotToBatch({ params: { id: String(lot.id) }, body: { batch_id: b.id, weight_kg: 500 }, user: { id: ids.user } }, res2);
      expect(res2.statusCode).toBe(400);
      await db.transaction((trx) => lifecycle.releaseBatchSources(trx, b.id, { userId: ids.user }));
    });

    test('Use in Batch refuses a truck-fed batch and a client lot', async () => {
      const lot = await makeLot();
      const b = await makeBatch();
      await db('milling_vehicle_arrivals').insert({ batch_id: b.id, vehicle_no: 'ZZ-1', weight_kg: 1000 });
      const res = mockRes();
      await lotController.allocateLotToBatch({ params: { id: String(lot.id) }, body: { batch_id: b.id, weight_kg: 100 }, user: { id: ids.user } }, res);
      expect(res.statusCode).toBe(409);
      const client = await makeLot({ ownership: 'client', owner_customer_id: ids.cust });
      const b2 = await makeBatch();
      const res2 = mockRes();
      await lotController.allocateLotToBatch({ params: { id: String(client.id) }, body: { batch_id: b2.id, weight_kg: 100 }, user: { id: ids.user } }, res2);
      expect(res2.statusCode).toBe(400);
      expect(n((await lotRow(client.id)).milling_reserved_qty)).toBe(0);
    });

    test('a truck is refused on a source-lot batch (MIL-15)', async () => {
      const lot = await makeLot();
      const b = await makeBatch();
      await db.transaction((trx) => lifecycle.commitLotToBatch(trx, { batchId: b.id, lotId: lot.id, qtyKg: 500, userId: ids.user }));
      const res = mockRes();
      await millingController.addVehicle({ params: { id: String(b.id) }, body: { vehicle_no: 'ZZ-T', weight_kg: 2000 }, user: { id: ids.user } }, res);
      expect(res.statusCode).toBe(409);
      expect(await db('inventory_lots').where({ batch_ref: `batch-${b.id}`, type: 'raw' })).toHaveLength(0);
      await db.transaction((trx) => lifecycle.releaseBatchSources(trx, b.id, { userId: ids.user }));
    });

    test('Start Milling without a qty keeps raw_qty_kg = the committed qty (MIL-42)', async () => {
      const lot = await makeLot();
      // A truck already recorded on the lot (inherited by the batch) weighs more.
      await db('milling_vehicle_arrivals').insert({ lot_id: lot.id, vehicle_no: 'ZZ-L', weight_kg: 1200 });
      const res = mockRes();
      await lotController.startMillingForLot({ params: { id: String(lot.id) }, body: {}, user: { id: ids.user } }, res);
      expect(res.statusCode).toBe(201);
      const b = await db('milling_batches').where({ id: res.body.data.batch.id }).first();
      expect(n(b.raw_qty_kg)).toBe(1000);
      const src = await db('batch_source_lots').where({ batch_id: b.id }).first();
      expect(n(src.qty_kg)).toBe(1000);
      await db.transaction((trx) => lifecycle.releaseBatchSources(trx, b.id, { userId: ids.user }));
    });

    test('Start Milling refuses a client-owned lot', async () => {
      const lot = await makeLot({ ownership: 'client', owner_customer_id: ids.cust });
      const res = mockRes();
      await lotController.startMillingForLot({ params: { id: String(lot.id) }, body: {}, user: { id: ids.user } }, res);
      expect(res.statusCode).toBe(400);
      expect(n((await lotRow(lot.id)).milling_reserved_qty)).toBe(0);
    });

    test('batch-create mill fallback picks an Active mill (MIL-43)', async () => {
      const fallback = await db('mills').where({ status: 'Active' }).orderBy('id').first('id');
      expect(fallback).toBeTruthy();
    });
  });
});
