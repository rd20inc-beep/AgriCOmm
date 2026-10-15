/**
 * P3-03 / P3-04 / P3-07 — yield, re-yield, reversal and costing integrity.
 *
 *   MIL-06  re-yield with a grade zeroed → no orphan qty; Σ ledger = qty for
 *           every output; nothing deleted from the ledger
 *   MIL-16  partial milling: cap + yield % on milled_qty_kg; the unmilled raw
 *           remainder stays raw stock (not Consumed); milled qty locked
 *   MIL-20  controlled un-yield (Owner-approved): outputs → 0, raw back, GL
 *           back to before the yield; refused once an output has moved
 *   MIL-08  service: yield → dispatch → re-yield refused, dispatchable qty unchanged
 *   MIL-34  service reconciliation: Produced = output lots only, from the ledger
 *   MIL-04  first yield and re-price produce the same cost/kg
 *   MIL-11  canonical cost categories; unknown keys refused
 *   MIL-35  bulk cost save in one transaction (all or nothing)
 *   MIL-13  consumption after completion re-runs the allocation
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(180000);

d('milling yield integrity (DB-gated)', () => {
  let db; let millCtl; let inventory; let reporting; let consumption; let app; let request;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  let seq = 0;

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const call = async (fn, req) => { const res = mockRes(); await fn(req, res); return res; };
  const asAdmin = (extra) => ({ user: { id: ids.user, role_id: ids.adminRole }, ...extra });
  const num = (v) => parseFloat(v) || 0;

  // Net Posted GL movement on an account for the batch's journals of the given ref types.
  const net = async (refNo, code, refTypes = null) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code });
    if (refTypes) q = q.whereIn('je.ref_type', refTypes);
    return Math.round((await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n * 100) / 100;
  };
  const outputs = (batchId) => db('inventory_lots')
    .where({ batch_ref: `batch-${batchId}` }).whereIn('type', ['finished', 'byproduct']).orderBy('id');
  const ledgerKg = async (lotId) => num((await db('lot_transactions').where({ lot_id: lotId }).sum('quantity_kg as s').first()).s);
  const expectLedgerMatchesQty = async (batchId) => {
    for (const l of await outputs(batchId)) {
      expect(Math.round(await ledgerKg(l.id) * 1000) / 1000).toBeCloseTo(num(l.qty), 3);
    }
  };

  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `Y${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product, mill_id: ids.mill,
      raw_qty_kg: 10000, status: 'In Progress', created_by: ids.user, ...over,
    }).returning('*');
    return b;
  };
  // Truck-intake batch: a raw lot under batch_ref, raw cost Rs 100/kg.
  const truckBatch = async ({ kg = 10000, over = {} } = {}) => {
    const b = await makeBatch({ raw_qty_kg: 0, ...over });
    await db.transaction((trx) => inventory.receiveRice(trx, {
      batchId: b.id, weightKg: kg, costPerKg: over.is_service_milling ? 0 : 100, currency: 'PKR',
      supplierId: ids.sup, productId: ids.product, userId: ids.user,
    }));
    await db('milling_batches').where({ id: b.id }).update({ raw_qty_kg: kg });
    if (!over.is_service_milling) {
      await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: kg * 100, currency: 'PKR' });
      await db('milling_quality_samples').insert({ batch_id: b.id, analysis_type: 'arrival', price_per_kg: 100 });
    }
    return db('milling_batches').where({ id: b.id }).first();
  };
  const yieldOf = (batchId, body) => call(millCtl.recordYield, asAdmin({ params: { id: String(batchId) }, body }));
  const reverse = (batchId, reason = 'wrong scale ticket') => call(millCtl.reverseYield, asAdmin({
    params: { id: String(batchId) }, body: { reason }, ownerAuth: { ownerId: ids.owner },
  }));

  beforeAll(async () => {
    db = require('../config/database');
    millCtl = require('../modules/milling/milling.controller');
    inventory = require('../modules/inventory/inventory.service');
    reporting = require('../modules/analytics/reporting.service');
    consumption = require('../modules/millStore/consumption.service');
    request = require('supertest');
    const express = require('express');
    const role = async (name) => (await db('roles').where({ name }).first()).id;
    ids.adminRole = await role('Super Admin');
    ids.ownerRole = await role('Owner');
    ids.mmRole = await role('Mill Manager');
    const user = async (tag, roleId) => (await db('users').insert({
      email: `zz-yi-${tag}-${run}@test.local`, full_name: `ZZ YI ${tag} ${run}`, password_hash: 'x', role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.user = await user('admin', ids.adminRole);
    ids.owner = await user('owner', ids.ownerRole);
    ids.mm = await user('mm', ids.mmRole);
    ids.sup = (await db('suppliers').insert({ name: `ZZ YI Supplier ${run}`, type: 'local' }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ YI Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ YI Mill ${run}` }).returning('*'))[0].id;
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ YI Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    ids.wh = wh.id;
    ids.client = (await db('customers').insert({ name: `ZZ YI Client ${run}`, customer_type: 'local' }).returning('*'))[0].id;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      req.user = { id, role_id: { [ids.user]: ids.adminRole, [ids.owner]: ids.ownerRole, [ids.mm]: ids.mmRole }[id] };
      next();
    });
    app.use('/milling', require('../modules/milling/milling.routes'));
  });
  afterAll(async () => { if (db) await db.destroy(); });

  describe('P3-03 re-yield and partial milling', () => {
    test('MIL-06: a grade zeroed on re-yield leaves no orphan qty; ledger = qty; nothing deleted', async () => {
      const b = await truckBatch();
      const r1 = await yieldOf(b.id, { actual_finished_kg: 6000, b1_kg: 800, b2_kg: 400, bran_kg: 1000, husk_kg: 1500, wastage_kg: 300 });
      expect(r1.statusCode).toBe(200);
      const before = await outputs(b.id);
      const b2 = before.find((l) => l.grade === 'B2');
      expect(num(b2.qty)).toBe(400);
      const rowsBefore = parseInt((await db('lot_transactions').whereIn('lot_id', before.map((l) => l.id)).count('id as c').first()).c, 10);

      // Re-yield: B2 zeroed, finished up, bran down.
      const r2 = await yieldOf(b.id, { actual_finished_kg: 6300, b1_kg: 900, b2_kg: 0, bran_kg: 900, husk_kg: 1500, wastage_kg: 400 });
      expect(r2.statusCode).toBe(200);
      const after = await outputs(b.id);
      const b2After = after.find((l) => l.id === b2.id);
      expect(b2After).toBeTruthy(); // kept (history), not deleted
      expect(num(b2After.qty)).toBe(0);
      expect(b2After.status).toBe('Closed');
      expect(num(after.find((l) => l.type === 'finished').qty)).toBe(6300);
      await expectLedgerMatchesQty(b.id);
      const rowsAfter = parseInt((await db('lot_transactions').whereIn('lot_id', before.map((l) => l.id)).count('id as c').first()).c, 10);
      expect(rowsAfter).toBeGreaterThan(rowsBefore); // deltas appended, nothing removed
      // GL by-product split follows the live lots.
      const { batchOutputValues } = require('../modules/milling/batchOutputValues');
      const v = (await batchOutputValues(db, [b.id])).get(b.id);
      expect(await net(b.batch_no, '1240', ['Milling Output Split'])).toBeCloseTo(v ? v.byproductValue : 0, 2);
    });

    test('MIL-16: partial milling — cap and yield % on the milled qty; the remainder stays raw stock', async () => {
      const b = await truckBatch();
      await db('milling_batches').where({ id: b.id }).update({ milled_qty_kg: 5000 });
      // 6,000 kg out of 5,000 milled (received 10,000) is refused now.
      const over = await yieldOf(b.id, { actual_finished_kg: 4000, bran_kg: 1000, husk_kg: 1000 });
      expect(over.statusCode).toBe(400);
      expect(over.body.message).toMatch(/milled quantity/);
      const ok = await yieldOf(b.id, { actual_finished_kg: 3500, bran_kg: 600, husk_kg: 800, wastage_kg: 100 });
      expect(ok.statusCode).toBe(200);
      const row = await db('milling_batches').where({ id: b.id }).first();
      expect(num(row.yield_pct)).toBe(70); // 3,500 / 5,000
      const raw = await db('inventory_lots').where({ batch_ref: `batch-${b.id}`, type: 'raw' }).first();
      expect(num(raw.qty)).toBe(5000);
      expect(raw.milling_status).toBeNull(); // not Consumed — 5,000 kg still to mill
      // The milled qty it consumed is now fixed.
      const lock = await call(millCtl.setMilledQty, asAdmin({ params: { id: String(b.id) }, body: { milled_qty_kg: 6000 } }));
      expect(lock.statusCode).toBe(409);
    });

    test('MIL-20: reverse yield — outputs to 0, raw back, GL back to before the yield, then re-yield', async () => {
      const b = await truckBatch();
      await db('milling_costs').insert({ batch_id: b.id, category: 'labor', amount: 20000, currency: 'PKR' });
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, b1_kg: 500, bran_kg: 1000, husk_kg: 1200, wastage_kg: 300 })).statusCode).toBe(200);
      const fin1220 = await net(b.batch_no, '1220');
      expect(fin1220).toBeGreaterThan(0);
      const ap = await net(b.batch_no, '2010', ['Rice Purchase']);
      expect(ap).toBe(-1000000);

      const r = await reverse(b.id);
      expect(r.statusCode).toBe(200);
      expect(r.body.data.journalsReversed).toBeGreaterThan(0);
      const row = await db('milling_batches').where({ id: b.id }).first();
      expect(row.status).toBe('In Progress');
      expect(num(row.actual_finished_kg)).toBe(0);
      expect(row.yield_reversal_reason).toBe('wrong scale ticket');
      expect(row.yield_reversal_authorized_by).toBe(ids.owner);
      for (const l of await outputs(b.id)) {
        expect(num(l.qty)).toBe(0);
        expect(l.status).toBe('Closed');
      }
      await expectLedgerMatchesQty(b.id);
      const raw = await db('inventory_lots').where({ batch_ref: `batch-${b.id}`, type: 'raw' }).first();
      expect(num(raw.qty)).toBe(10000);
      expect(num(raw.received_net_weight_kg)).toBe(10000); // an issue reversal is not intake
      expect(num(raw.available_qty)).toBe(10000);
      expect(Math.round(await ledgerKg(raw.id))).toBe(10000);
      // Milling journals net to nothing; the rice purchase stands (rice is back in 1210).
      for (const code of ['1220', '1240', '1210', '2110']) {
        expect(await net(b.batch_no, code, ['Milling Batch', 'Milling Output Split'])).toBe(0);
      }
      expect(await net(b.batch_no, '2010', ['Rice Purchase'])).toBe(-1000000);
      // Nothing was deleted or status-flipped: every original is still Posted.
      expect(parseInt((await db('journal_entries').where({ ref_no: b.batch_no, status: 'Reversed' }).count('id as c').first()).c, 10)).toBe(0);
      // Raw cost / supplier stay locked to the booked purchase.
      const edit = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'raw_rice', amount: 1100000 } }));
      expect(edit.statusCode).toBe(409);

      // A second reversal has nothing to reverse.
      expect((await reverse(b.id)).statusCode).toBe(409);

      // Re-recording the yield takes the first-yield path again — capitalised once.
      expect((await yieldOf(b.id, { actual_finished_kg: 7100, b1_kg: 500, bran_kg: 1000, husk_kg: 1200, wastage_kg: 200 })).statusCode).toBe(200);
      expect(await net(b.batch_no, '1220', ['Milling Batch', 'Milling Output Split'])).toBeCloseTo(fin1220, 2);
      expect(await net(b.batch_no, '2010', ['Rice Purchase'])).toBe(-1000000); // not booked twice
      const raw2 = await db('inventory_lots').where({ id: raw.id }).first();
      expect(num(raw2.qty)).toBe(0);
      await expectLedgerMatchesQty(b.id);
      expect(num((await outputs(b.id)).find((l) => l.type === 'finished').qty)).toBe(7100);
    });

    test('MIL-20: a blend source lot goes back under the batch hold', async () => {
      const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
      const [lot] = await db('inventory_lots').insert({
        lot_no: `ZZYI-${run}-SRC`, item_name: 'ZZ Rice', type: 'raw', entity: 'mill', product_id: ids.product, warehouse_id: ids.wh,
        qty: 8000, available_qty: 8000, unit: 'KG', supplier_id: ids.sup, landed_cost_per_kg: 100, rate_per_kg: 100,
        cost_per_unit: 100, net_weight_kg: 8000, received_net_weight_kg: 8000, status: 'Available', created_by: ids.user,
      }).returning('*');
      const b = await makeBatch({ raw_qty_kg: 5000 });
      await db.transaction((trx) => commitLotToBatch(trx, { batchId: b.id, lotId: lot.id, qtyKg: 5000 }));
      expect((await yieldOf(b.id, { actual_finished_kg: 3500, bran_kg: 600, husk_kg: 800, wastage_kg: 100 })).statusCode).toBe(200);
      expect(num((await db('inventory_lots').where({ id: lot.id }).first()).qty)).toBe(3000);
      expect((await reverse(b.id)).statusCode).toBe(200);
      const back = await db('inventory_lots').where({ id: lot.id }).first();
      expect(num(back.qty)).toBe(8000);
      expect(num(back.milling_reserved_qty)).toBe(5000);
      expect(num(back.available_qty)).toBe(3000);
      expect(back.milling_status).toBe('In Milling');
      expect(num(back.received_net_weight_kg)).toBe(8000);
      // And it can be milled again.
      expect((await yieldOf(b.id, { actual_finished_kg: 3400, bran_kg: 600, husk_kg: 800, wastage_kg: 200 })).statusCode).toBe(200);
      expect(num((await db('inventory_lots').where({ id: lot.id }).first()).qty)).toBe(3000);
    });

    test('MIL-20: katta freed / packed at yield go back to the store', async () => {
      const b = await truckBatch();
      await db('milling_vehicle_arrivals').insert({ batch_id: b.id, vehicle_no: `ZZ-${run}`, weight_kg: 10000, total_bags: 200, bag_size_kg: 50 });
      const kattaStock = async () => num((await db('mill_stock as s').join('mill_items as i', 'i.id', 's.item_id')
        .where('i.pack_type', 'katta').where('i.capacity_kg', 50).sum('s.quantity_available as q').first()).q);
      const start = await kattaStock();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const afterYield = await kattaStock();
      expect(afterYield).not.toBe(start); // 200 freed, the outputs packed back into some
      expect((await reverse(b.id)).statusCode).toBe(200);
      expect(await kattaStock()).toBe(start);
      const movements = await db('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: b.id }).sum('quantity as q').first();
      expect(num(movements.q)).toBe(0); // compensating rows, not deletions
    });

    test('MIL-20: refused once an output has moved; nothing changes', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const fin = (await outputs(b.id)).find((l) => l.type === 'finished');
      await db.transaction((trx) => inventory.postMovement(trx, {
        movementType: 'adjustment_minus', lotId: fin.id, qty: 10, notes: 'ZZ test write-off', userId: ids.user,
      }));
      const r = await reverse(b.id);
      expect(r.statusCode).toBe(409);
      expect(r.body.message).toMatch(/already been reserved, sold, moved or re-milled/);
      expect((await db('milling_batches').where({ id: b.id }).first()).status).toBe('Completed');
      // Re-yield refused the same way (the old guard missed adjustments / transfers).
      expect((await yieldOf(b.id, { actual_finished_kg: 6000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(409);
    });

    test('MIL-20 route: Owner approval + a reason are required', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const noOwner = await request(app).post(`/milling/batches/${b.id}/reverse-yield`)
        .set('x-test-user', String(ids.user)).send({ reason: 'scale error' });
      expect(noOwner.status).toBe(403);
      expect(noOwner.body.code).toBe('OWNER_AUTH_REQUIRED');
      const noReason = await request(app).post(`/milling/batches/${b.id}/reverse-yield`)
        .set('x-test-user', String(ids.owner)).send({});
      expect(noReason.status).toBe(400);
      const ok = await request(app).post(`/milling/batches/${b.id}/reverse-yield`)
        .set('x-test-user', String(ids.owner)).send({ reason: 'scale error' });
      expect(ok.status).toBe(200);
      const logged = await db('approval_authorizations').where({ kind: 'milling_yield_reversal', ref: String(b.id) }).first();
      // logged on response finish — give the event loop a tick
      await new Promise((r) => setTimeout(r, 200));
      expect(logged || await db('approval_authorizations').where({ kind: 'milling_yield_reversal', ref: String(b.id) }).first()).toBeTruthy();
    });

    test('delete after a reversed yield is refused (history stays); cancel is the way out', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      expect((await reverse(b.id)).statusCode).toBe(200);
      const del = await call(millCtl.deleteBatch, asAdmin({ params: { id: String(b.id) } }));
      expect(del.statusCode).toBe(409);
      expect(del.body.message).toMatch(/Cancel it instead/);
      expect(await db('milling_batches').where({ id: b.id }).first()).toBeTruthy();
      const cancel = await call(millCtl.cancelBatch, asAdmin({ params: { id: String(b.id) }, body: {} }));
      expect(cancel.statusCode).toBe(200);
      expect((await db('milling_batches').where({ id: b.id }).first()).status).toBe('Cancelled');
    });
  });

  describe('P3-04 service milling', () => {
    const svcBatch = async () => truckBatch({ over: { is_service_milling: true, client_customer_id: ids.client, supplier_id: null } });

    test('MIL-08: yield → dispatch → re-yield refused; dispatchable qty unchanged', async () => {
      const b = await svcBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const svc = require('../modules/serviceMilling/serviceMilling.controller');
      const fin = (await outputs(b.id)).find((l) => l.type === 'finished');
      const disp = await call(svc.createDispatch, asAdmin({ params: { id: String(b.id) }, body: { lot_id: fin.id, qty_kg: 3000 } }));
      expect(disp.statusCode).toBe(201);
      const before = num((await db('inventory_lots').where({ id: fin.id }).first()).available_qty);
      expect(before).toBe(4000);

      const re = await yieldOf(b.id, { actual_finished_kg: 7200, bran_kg: 1000, husk_kg: 1500, wastage_kg: 300 });
      expect(re.statusCode).toBe(409);
      expect(re.body.message).toMatch(/dispatch/);
      const after = await db('inventory_lots').where({ id: fin.id }).first();
      expect(num(after.available_qty)).toBe(4000);
      expect(Math.round(await ledgerKg(fin.id))).toBe(4000);
      // Un-yield refused the same way.
      expect((await reverse(b.id)).statusCode).toBe(409);
    });

    test('MIL-34: Produced = output lots only, from the ledger; a reversed dispatch does not inflate it', async () => {
      const b = await svcBatch();
      await db('milling_batches').where({ id: b.id }).update({ milled_qty_kg: 8000 });
      expect((await yieldOf(b.id, { actual_finished_kg: 5600, bran_kg: 800, husk_kg: 1200, wastage_kg: 400 })).statusCode).toBe(200);
      // Re-yield before any dispatch (allowed) — Produced must follow the new figures.
      expect((await yieldOf(b.id, { actual_finished_kg: 5500, bran_kg: 800, husk_kg: 1200, wastage_kg: 500 })).statusCode).toBe(200);
      const svc = require('../modules/serviceMilling/serviceMilling.controller');
      const fin = (await outputs(b.id)).find((l) => l.type === 'finished');
      const d1 = await call(svc.createDispatch, asAdmin({ params: { id: String(b.id) }, body: { lot_id: fin.id, qty_kg: 1000 } }));
      expect(d1.statusCode).toBe(201);
      expect((await call(svc.deleteDispatch, asAdmin({ params: { id: String(d1.body.data.id) } }))).statusCode).toBe(200);
      const d2 = await call(svc.createDispatch, asAdmin({ params: { id: String(b.id) }, body: { lot_id: fin.id, qty_kg: 2000 } }));
      expect(d2.statusCode).toBe(201);

      const rec = await reporting.getServiceMillingReconciliation();
      const row = rec.rows.find((r) => r.batchId === b.id);
      expect(row.producedKg).toBe(7500); // 5,500 + 800 + 1,200 — the client's raw lot is not "produced"
      expect(row.dispatchedKg).toBe(2000);
      expect(row.onHandKg).toBe(5500);
      expect(row.rawOnHandKg).toBe(2000); // unmilled client raw (10,000 − 8,000)
      expect(row.balanceKg).toBe(0);
      expect(row.reconciled).toBe(true);
      expect(row.milledKg).toBe(8000);

      const finAfter = await db('inventory_lots').where({ id: fin.id }).first();
      expect(num(finAfter.received_net_weight_kg)).toBe(5500); // the reversed dispatch is not intake

      const summary = await call(svc.getDispatchSummary, asAdmin({ params: { id: String(b.id) } }));
      expect(summary.body.data.summary.producedKg).toBe(7500);
    });
  });

  describe('data-correction scripts', () => {
    test('detect finds a pre-P3 phantom output; correct reverses it through the ledger', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 6000, b1_kg: 800, b2_kg: 400, bran_kg: 1000, husk_kg: 1500, wastage_kg: 300 })).statusCode).toBe(200);
      const b2 = (await outputs(b.id)).find((l) => l.grade === 'B2');
      // Re-create the old damage: the resync deleted the receipt rows and the
      // batch now says B2 = 0, but the lot kept its 400 kg.
      await db('lot_transactions').where({ lot_id: b2.id }).del();
      await db('milling_batches').where({ id: b.id }).update({ b2_kg: 0 });
      await db('milling_costs').insert({ batch_id: b.id, category: 'rawRice', amount: 1, currency: 'PKR' });

      const { detect } = require('../../scripts/detectMillingYieldIntegrity');
      const f = await detect(db);
      expect(f.phantom_output).toContain(b2.id);
      expect(f.phantom_output_correctable).toContain(b2.id);
      expect(f.noncanonical_category).toContain(`${b.id}:rawRice`);

      const { main, correctPhantomLot } = require('../../scripts/correctMillingYieldIntegrity');
      expect(typeof main).toBe('function');
      // (main() destroys the shared pool, so the per-lot step is exercised directly.)
      const r = await db.transaction((trx) => correctPhantomLot(trx, b2.id, { userId: ids.user }));
      expect(r.corrected).toBe(true);
      const fixed = await db('inventory_lots').where({ id: b2.id }).first();
      expect(num(fixed.qty)).toBe(0);
      expect(fixed.status).toBe('Closed');
      expect(Math.round(await ledgerKg(b2.id))).toBe(0);
      expect(parseInt((await db('lot_transactions').where({ lot_id: b2.id }).count('id as c').first()).c, 10)).toBe(2);
      expect((await detect(db, { sections: ['phantom'] })).phantom_output).not.toContain(b2.id);
      // Idempotent: a second run skips it.
      expect((await db.transaction((trx) => correctPhantomLot(trx, b2.id))).skipped).toBe('no_longer_phantom');
      await db('milling_costs').where({ batch_id: b.id, category: 'rawRice' }).del();
    });
  });

  describe('P3-07 residual costing', () => {
    test('MIL-04: first yield and re-price give the same cost/kg (milling category netted on both)', async () => {
      const b = await truckBatch();
      await db('milling_costs').insert([
        { batch_id: b.id, category: 'processing', amount: 30000, currency: 'PKR' },
        { batch_id: b.id, category: 'labor', amount: 10000, currency: 'PKR' },
      ]);
      // Legacy manual Milling Cost (still on old rows): overrides the processing category.
      await db('milling_batches').where({ id: b.id }).update({ manual_milling_cost_pkr: 30000, bran_price_per_kg: 20 });
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const first = num((await db('milling_batches').where({ id: b.id }).first()).total_cost_per_kg_finished);
      // Net purchase = 1,000,000 + 30,000 (once) + 10,000 = 1,040,000; bran credit 20,000.
      expect(first).toBeCloseTo((1040000 - 20000) / 7000, 4);
      await db.transaction((trx) => inventory.recomputeBatchOutputsAfterPriceChange(trx, b.id, { userId: ids.user }));
      const again = num((await db('milling_batches').where({ id: b.id }).first()).total_cost_per_kg_finished);
      expect(again).toBeCloseTo(first, 6);
      const fin = (await outputs(b.id)).find((l) => l.type === 'finished');
      expect(num(fin.cost_per_unit)).toBeCloseTo(first, 4);
    });

    test('MIL-11: categories are canonical — rawRice stored as raw_rice, unknown keys refused', async () => {
      const b = await makeBatch({ raw_qty_kg: 1000 });
      const r1 = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'rawRice', amount: 100000 } }));
      expect(r1.statusCode).toBe(200);
      expect(r1.body.data.cost.category).toBe('raw_rice');
      const r2 = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'Labour', amount: 500 } }));
      expect(r2.body.data.cost.category).toBe('labor');
      const bad = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'coffee', amount: 5 } }));
      expect(bad.statusCode).toBe(400);
      expect(bad.body.message).toMatch(/Unknown cost category/);
      const cats = (await db('milling_costs').where({ batch_id: b.id }).pluck('category')).sort();
      expect(cats).toEqual(['labor', 'raw_rice']);
    });

    test('MIL-35: bulk cost save is one transaction — all lines or none', async () => {
      const b = await makeBatch({ raw_qty_kg: 1000 });
      const bad = await request(app).post(`/milling/batches/${b.id}/costs/bulk`).set('x-test-user', String(ids.user))
        .send({ costs: [{ category: 'labor', amount: 1000 }, { category: 'nonsense', amount: 5 }] });
      expect(bad.status).toBe(400);
      expect(await db('milling_costs').where({ batch_id: b.id }).count('id as c').first()).toMatchObject({ c: '0' });

      // A line refused mid-way (raw cost locked) rolls back the lines before it.
      const y = await truckBatch();
      expect((await yieldOf(y.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const locked = await request(app).post(`/milling/batches/${y.id}/costs/bulk`).set('x-test-user', String(ids.user))
        .send({ costs: [{ category: 'labor', amount: 5000 }, { category: 'raw_rice', amount: 1 }] });
      expect(locked.status).toBe(409);
      expect(await db('milling_costs').where({ batch_id: y.id, category: 'labor' }).first()).toBeUndefined();

      const ok = await request(app).post(`/milling/batches/${b.id}/costs/bulk`).set('x-test-user', String(ids.user))
        .send({ costs: [{ category: 'raw_rice', amount: 100000 }, { category: 'packing', amount: 2000 }, { category: 'labor', amount: 1500 }] });
      expect(ok.status).toBe(200);
      expect(ok.body.data.total).toBe(103500);
      const cats = (await db('milling_costs').where({ batch_id: b.id }).pluck('category')).sort();
      expect(cats).toEqual(['labor', 'packaging', 'raw_rice']);
    });

    test('MIL-13: consumption after completion re-runs the allocation; refused on a cancelled batch', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id, { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 })).statusCode).toBe(200);
      const before = num((await db('milling_batches').where({ id: b.id }).first()).total_cost_per_kg_finished);
      const [item] = await db('mill_items').insert({ code: `ZZYI-DSL-${run}`, name: `ZZ Diesel ${run}`, category: 'fuel', unit: 'ltr', avg_cost_per_unit: 300 }).returning('*');
      await db('mill_stock').insert({ item_id: item.id, warehouse_id: null, quantity_available: 100, quantity_reserved: 0 });
      await consumption.confirm(b.id, [{ item_id: item.id, quantity: 70 }], ids.user);
      const after = await db('milling_batches').where({ id: b.id }).first();
      const { a } = await inventory.loadBatchAllocation(db, b.id);
      expect(num(after.total_cost_per_kg_finished)).toBeCloseTo(a.finishedCostPerKg, 4); // residual, not Σcost ÷ finished
      expect(num(after.total_cost_per_kg_finished)).toBeCloseTo(before + 21000 / 7000, 4);
      const fin = (await outputs(b.id)).find((l) => l.type === 'finished');
      expect(num(fin.cost_per_unit)).toBeCloseTo(a.finishedCostPerKg, 4);

      const c = await makeBatch({ status: 'Cancelled' });
      await expect(consumption.confirm(c.id, [{ item_id: item.id, quantity: 1 }], ids.user)).rejects.toThrow(/Cancelled/);
    });
  });
});
