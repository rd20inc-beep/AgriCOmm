/**
 * P2-08 — post-purchase / post-milling price, cost and batch edits.
 * Register choice (conservative): once rice has been milled (yield recorded) or
 * sold, its price / cost edits are REFUSED with a business message instead of
 * re-posting downstream; while still allowed, an edit posts a signed delta in
 * the same transaction and moves payables in place.
 *
 *   INV-08  lot Edit Price / Received after milling or sale → 409
 *   MIL-07  arrival price / raw_rice cost line after yield → 409
 *   MIL-03  manual Milling / Other totals → refused (one cost source); legacy clearable
 *   INV-13  Edit Costs updates payables in place (ids stable), GL = AP delta
 *   MIL-38  PUT /batches/:id locks raw qty / supplier / fee after yield; Joi; permission
 *   INV-12  deduct-from-supplier freight larger than the rice bill → refused
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('post-milling price / cost / batch edits (DB-gated)', () => {
  let db; let millCtl; let lotCtl; let inventory; let app; let request;
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
  const net = async (refNo, code, refType) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code });
    if (refType) q = q.where('je.ref_type', refType);
    return (await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n;
  };
  const makeLot = async (over = {}) => {
    seq += 1;
    const [l] = await db('inventory_lots').insert({
      lot_no: `ZZPM-${run}-${seq}`, item_name: 'ZZ Rice', type: 'raw', entity: 'mill',
      warehouse_id: ids.wh, product_id: ids.product, qty: 10000, available_qty: 10000, unit: 'KG',
      supplier_id: ids.sup, landed_cost_per_kg: 100, rate_per_kg: 100, cost_per_unit: 100,
      purchase_amount: 1000000, landed_cost_total: 1000000, total_value: 1000000,
      net_weight_kg: 10000, received_net_weight_kg: 10000, status: 'Available', created_by: ids.user,
      ...over,
    }).returning('*');
    return l;
  };
  const ricePayable = async (lot, over = {}) => (await db('payables').insert({
    pay_no: `ZP${run}-${(seq += 1)}`, payable_type: 'vendor', entity: 'mill', category: 'Raw Material',
    supplier_id: ids.sup, linked_ref: lot.lot_no, source_id: lot.id,
    original_amount: 1000000, paid_amount: 0, outstanding: 1000000, currency: 'PKR', status: 'Pending', ...over,
  }).returning('*'))[0];
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `P${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product, mill_id: ids.mill,
      raw_qty_kg: 10000, status: 'In Progress', created_by: ids.user, ...over,
    }).returning('*');
    return b;
  };
  const commit = async (batchId, lotId, qty = 10000) => {
    const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
    await db.transaction((trx) => commitLotToBatch(trx, { batchId, lotId, qtyKg: qty }));
  };
  const yieldOf = (batchId) => call(millCtl.recordYield, asAdmin({
    params: { id: String(batchId) },
    body: { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 },
  }));
  const truckBatch = async () => {
    const b = await makeBatch({ raw_qty_kg: 0 });
    await db.transaction((trx) => inventory.receiveRice(trx, {
      batchId: b.id, weightKg: 10000, costPerKg: 100, currency: 'PKR', supplierId: ids.sup, productId: ids.product, userId: ids.user,
    }));
    await db('milling_batches').where({ id: b.id }).update({ raw_qty_kg: 10000 });
    await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: 1000000, currency: 'PKR' });
    await db('milling_quality_samples').insert({ batch_id: b.id, analysis_type: 'arrival', price_per_kg: 100 });
    return b;
  };

  beforeAll(async () => {
    db = require('../config/database');
    millCtl = require('../modules/milling/milling.controller');
    lotCtl = require('../modules/inventory/lotInventory.controller');
    inventory = require('../modules/inventory/inventory.service');
    request = require('supertest');
    const express = require('express');
    const role = async (name) => (await db('roles').where({ name }).first()).id;
    ids.adminRole = await role('Super Admin');
    ids.operatorRole = await role('Mill Operator');
    ids.qcRole = await role('QC Analyst');
    const user = async (tag, roleId) => (await db('users').insert({
      email: `zz-pm-${tag}-${run}@test.local`, full_name: `ZZ PM ${tag} ${run}`, password_hash: 'x', role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.user = await user('admin', ids.adminRole);
    ids.operator = await user('op', ids.operatorRole);
    ids.qc = await user('qc', ids.qcRole);
    ids.sup = (await db('suppliers').insert({ name: `ZZ PM Supplier ${run}`, type: 'local' }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ PM Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ PM Mill ${run}` }).returning('*'))[0].id;
    ids.hauler = (await db('haulers').insert({ name: `ZZ PM Hauler ${run}` }).returning('*'))[0].id;
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ PM Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    ids.wh = wh.id;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      const roleId = { [ids.user]: ids.adminRole, [ids.operator]: ids.operatorRole, [ids.qc]: ids.qcRole }[id];
      req.user = { id, role_id: roleId };
      next();
    });
    app.use('/milling', require('../modules/milling/milling.routes'));
  });
  afterAll(async () => { if (db) await db.destroy(); });

  describe('INV-08: lot price / received edits', () => {
    test('allowed before yield (signed delta, payable in place, batch picks up the cost); refused after yield', async () => {
      const lot = await makeLot();
      const pay = await ricePayable(lot);
      const b = await makeBatch();
      await commit(b.id, lot.id);

      const r1 = await call(lotCtl.setLotPurchaseRate, asAdmin({ params: { id: String(lot.id) }, body: { rate_per_kg: 110 } }));
      expect(r1.statusCode).toBe(200);
      const p1 = await db('payables').where({ id: pay.id }).first();
      expect(Number(p1.original_amount)).toBe(1100000);
      expect(await net(lot.lot_no, '2010', 'Purchase Lot')).toBe(-100000);
      expect(await net(lot.lot_no, '1210', 'Purchase Lot')).toBe(100000);
      expect(Number((await db('batch_source_lots').where({ batch_id: b.id }).first()).cost_total_pkr)).toBe(1100000);

      expect((await yieldOf(b.id)).statusCode).toBe(200);
      const r2 = await call(lotCtl.setLotPurchaseRate, asAdmin({ params: { id: String(lot.id) }, body: { rate_per_kg: 120 } }));
      expect(r2.statusCode).toBe(409);
      expect(r2.body.message).toMatch(/already been milled in batch/);
      expect(Number((await db('payables').where({ id: pay.id }).first()).original_amount)).toBe(1100000);
      expect(await net(lot.lot_no, '2010', 'Purchase Lot')).toBe(-100000);

      const r3 = await call(lotCtl.setLotReceivedQty, asAdmin({ params: { id: String(lot.id) }, body: { received_net_weight_kg: 9000 } }));
      expect(r3.statusCode).toBe(409);
      const r4 = await call(lotCtl.updateLotCosts, asAdmin({ params: { id: String(lot.id) }, body: { labor_cost: 5000 } }));
      expect(r4.statusCode).toBe(409);
    });

    test('refused once rice from the lot was sold', async () => {
      const lot = await makeLot();
      await ricePayable(lot);
      await db('lot_transactions').insert({
        transaction_no: `ZZPM-T-${run}`, lot_id: lot.id, transaction_type: 'local_sale_out',
        quantity_kg: 100, created_by: ids.user, performed_by: ids.user,
      });
      const r = await call(lotCtl.setLotPurchaseRate, asAdmin({ params: { id: String(lot.id) }, body: { rate_per_kg: 90 } }));
      expect(r.statusCode).toBe(409);
      expect(r.body.message).toMatch(/already been sold/);
    });
  });

  describe('INV-13: Edit Costs moves payables in place', () => {
    test('ids stay, a new component gets a row, cleared → Reversed, GL = AP change; never below paid', async () => {
      const lot = await makeLot();
      const rice = await ricePayable(lot);
      const [labor] = await db('payables').insert({
        pay_no: `ZL${run}-${(seq += 1)}`, payable_type: 'vendor', entity: 'mill', category: 'Labor', supplier_id: ids.sup,
        linked_ref: lot.lot_no, source_table: 'lot_labor', source_id: lot.id,
        original_amount: 5000, paid_amount: 0, outstanding: 5000, currency: 'PKR', status: 'Pending',
      }).returning('*');
      await db('inventory_lots').where({ id: lot.id }).update({ labor_cost: 5000, landed_cost_total: 1005000 });

      const r1 = await call(lotCtl.updateLotCosts, asAdmin({ params: { id: String(lot.id) }, body: { labor_cost: 7000, other_cost: 1000 } }));
      expect(r1.statusCode).toBe(200);
      const rows = await db('payables').where({ linked_ref: lot.lot_no }).orderBy('id');
      expect(rows.find((r) => r.id === rice.id)).toMatchObject({ pay_no: rice.pay_no });
      expect(Number(rows.find((r) => r.id === rice.id).original_amount)).toBe(1000000);
      expect(rows.find((r) => r.id === labor.id)).toMatchObject({ pay_no: labor.pay_no, status: 'Pending' });
      expect(Number(rows.find((r) => r.id === labor.id).original_amount)).toBe(7000);
      expect(rows.filter((r) => r.source_table === 'lot_other')).toHaveLength(1);
      expect(await net(lot.lot_no, '2010', 'Purchase Lot')).toBe(-3000);

      const r2 = await call(lotCtl.updateLotCosts, asAdmin({ params: { id: String(lot.id) }, body: { labor_cost: 0 } }));
      expect(r2.statusCode).toBe(200);
      const l2 = await db('payables').where({ id: labor.id }).first();
      expect(l2.status).toBe('Reversed');
      expect(Number(l2.outstanding)).toBe(0);
      expect(await net(lot.lot_no, '2010', 'Purchase Lot')).toBe(4000);
      // AP subledger for the lot (live rows) = minus the GL movement + the untouched opening rice bill.
      const live = await db('payables').where({ linked_ref: lot.lot_no }).whereNot('status', 'Reversed').sum('original_amount as s').first();
      expect(Number(live.s)).toBe(1001000);

      const otherRow = await db('payables').where({ linked_ref: lot.lot_no, source_table: 'lot_other' }).first();
      await db('payables').where({ id: otherRow.id }).update({ paid_amount: 800, outstanding: 200, status: 'Partial' });
      const r3 = await call(lotCtl.updateLotCosts, asAdmin({ params: { id: String(lot.id) }, body: { other_cost: 500 } }));
      expect(r3.statusCode).toBe(409);
      expect(Number((await db('payables').where({ id: otherRow.id }).first()).original_amount)).toBe(1000);
    });
  });

  describe('MIL-07 / MIL-03: batch cost edits after yield', () => {
    test('arrival price and raw cost line locked after yield; processing cost allowed until an output is sold', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id)).statusCode).toBe(200);

      const q1 = await call(millCtl.saveQuality, asAdmin({ params: { id: String(b.id) }, body: { analysis_type: 'arrival', price_per_kg: 120 } }));
      expect(q1.statusCode).toBe(409);
      const q2 = await call(millCtl.saveQuality, asAdmin({ params: { id: String(b.id) }, body: { analysis_type: 'arrival', price_per_kg: 100, moisture: 12 } }));
      expect(q2.statusCode).toBe(200);
      expect(Number((await db('milling_costs').where({ batch_id: b.id, category: 'raw_rice' }).first()).amount)).toBe(1000000);

      const c1 = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'raw_rice', amount: 1200000 } }));
      expect(c1.statusCode).toBe(409);
      const before = await net(b.batch_no, '1220', 'Milling Batch');
      const c2 = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'labor', amount: 15000 } }));
      expect(c2.statusCode).toBe(200);
      expect(await net(b.batch_no, '1220', 'Milling Batch')).toBe(before + 15000);

      const fin = await db('inventory_lots').where({ batch_ref: `batch-${b.id}`, type: 'finished' }).first();
      await db('inventory_lots').where({ id: fin.id }).update({ sold_weight_kg: 100 });
      const c3 = await call(millCtl.addCost, asAdmin({ params: { id: String(b.id) }, body: { category: 'labor', amount: 20000 } }));
      expect(c3.statusCode).toBe(409);
      expect(c3.body.message).toMatch(/already been sold or used/);
    });

    test('PUT /prices refuses a new manual total; a legacy one can only be cleared', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id)).statusCode).toBe(200);
      const put = (body) => request(app).put(`/milling/batches/${b.id}/prices`).set('x-test-user', String(ids.user)).send(body);
      const r1 = await put({ bran_price_per_kg: 30, manual_milling_cost_pkr: 50000 });
      expect(r1.status).toBe(400);
      expect(r1.body.message).toMatch(/itemised lines on the Costs tab/);

      await db('milling_batches').where({ id: b.id }).update({ manual_other_expenses_pkr: 99999 });
      const same = await put({ bran_price_per_kg: 30, manual_other_expenses_pkr: 99999 });
      expect(same.status).toBe(200);
      const cleared = await put({ bran_price_per_kg: 30, manual_milling_cost_pkr: null, manual_other_expenses_pkr: null });
      expect(cleared.status).toBe(200);
      expect((await db('milling_batches').where({ id: b.id }).first()).manual_other_expenses_pkr).toBeNull();
      // Omitting the manual fields leaves them alone (it used to clear them).
      await db('milling_batches').where({ id: b.id }).update({ manual_other_expenses_pkr: 1234 });
      expect((await put({ bran_price_per_kg: 30 })).status).toBe(200);
      expect(Number((await db('milling_batches').where({ id: b.id }).first()).manual_other_expenses_pkr)).toBe(1234);
    });
  });

  describe('MIL-38: PUT /batches/:id', () => {
    test('completed batch: raw qty / supplier / fee locked, other fields editable; Joi; permission', async () => {
      const b = await truckBatch();
      expect((await yieldOf(b.id)).statusCode).toBe(200);
      const put = (who, body) => request(app).put(`/milling/batches/${b.id}`).set('x-test-user', String(who)).send(body);

      const locked = await put(ids.operator, { raw_qty_kg: 12000 });
      expect(locked.status).toBe(409);
      expect(locked.body.message).toMatch(/raw quantity/);
      expect((await put(ids.operator, { supplier_id: ids.sup + 100000 })).status).toBe(409);
      expect((await put(ids.operator, { milling_fee_per_kg: 9 })).status).toBe(409);
      expect((await put(ids.operator, { raw_qty_kg: -5 })).status).toBe(400);
      expect((await put(ids.qc, { batch_name: 'nope' })).status).toBe(403);

      const ok = await put(ids.operator, { batch_name: 'ZZ renamed', raw_qty_kg: 10000 });
      expect(ok.status).toBe(200);
      const after = await db('milling_batches').where({ id: b.id }).first();
      expect(after.batch_name).toBe('ZZ renamed');
      expect(Number(after.raw_qty_kg)).toBe(10000);

      // Before yield the same edit is allowed.
      const open = await makeBatch();
      const pre = await request(app).put(`/milling/batches/${open.id}`).set('x-test-user', String(ids.operator)).send({ raw_qty_kg: 12000 });
      expect(pre.status).toBe(200);
    });
  });

  describe('INV-12: freight deducted from the supplier', () => {
    const body = (transport) => ({
      item_name: 'ZZ Rice', warehouse_id: ids.wh, product_id: ids.product, supplier_id: ids.sup,
      hauler_id: ids.hauler, transport_paid_by: 'deduct_from_supplier',
      quantity_input: 1000, quantity_unit: 'kg', rate_input: 10, rate_unit: 'kg', transport_cost: transport,
    });
    test('more freight than the rice bill is refused; within it, payable and GL move together', async () => {
      const big = await call(lotCtl.createPurchaseLot, asAdmin({ body: body(50000) }));
      expect(big.statusCode).toBe(400);
      expect(big.body.message).toMatch(/more than the supplier's unpaid rice bill/);

      const ok = await call(lotCtl.createPurchaseLot, asAdmin({ body: body(2000) }));
      expect(ok.statusCode).toBe(201);
      const lotNo = ok.body.data.lot.lot_no || ok.body.data.lot.lotNo;
      const rice = await db('payables').where({ linked_ref: lotNo, category: 'Raw Material' }).first();
      expect(Number(rice.original_amount)).toBe(8000);
      // Supplier AP (rice bill 10,000 − deducted 2,000) = what the GL holds for the supplier.
      const supGl = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
        .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
        .where({ 'je.ref_no': lotNo, 'je.status': 'Posted', 'c.code': '2010', 'je.party_type': 'supplier', 'je.party_id': ids.sup })
        .select(db.raw('COALESCE(SUM(jl.credit - jl.debit), 0)::float AS n')).first();
      expect(supGl.n).toBe(8000);
    });
  });
});
