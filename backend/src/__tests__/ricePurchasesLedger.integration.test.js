/**
 * P3-14 (INV-01 / MIL-26): Mill ▸ Rice Purchases ledger is KG × Rs/kg.
 *
 *   - value = weight_kg × price_per_kg (it was kg × the per-MT price, 1000×);
 *   - weight comes back as weight_kg and the summary as totalWeightKg;
 *   - a lot-first truck (lot_id, no batch) gets its supplier / variety from
 *     its lot and is found by the supplier filter;
 *   - the HTTP route returns the same figures.
 *
 * Pure price resolution is tested without a DB; the rest is DB-gated.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const { vehiclePricePerKg, shapePurchaseRow, summarise } = require('../modules/milling/ricePurchasesLedger');

describe('vehiclePricePerKg', () => {
  test('the truck per-MT price is converted to per KG', () => {
    expect(vehiclePricePerKg({ price_per_mt: 85500 })).toBe(85.5);
  });
  test('falls back to truck per-kg, then arrival analysis, then the lot rate', () => {
    expect(vehiclePricePerKg({ price_per_kg: 80 })).toBe(80);
    expect(vehiclePricePerKg({}, { price_per_kg: 81 })).toBe(81);
    expect(vehiclePricePerKg({}, { price_per_mt: 82000 })).toBe(82);
    expect(vehiclePricePerKg({}, {}, '83.25')).toBe(83.25);
    expect(vehiclePricePerKg(null, null, null)).toBeNull();
  });
  test('value is kg × Rs/kg, never kg × Rs/MT', () => {
    const r = shapePurchaseRow({ weight_kg: '10000', quality_json: { price_per_mt: 85500 } });
    expect(r.weight_kg).toBe(10000);
    expect(r.price_per_kg).toBe(85.5);
    expect(r.value_pkr).toBe(855000);
    expect(summarise([r, shapePurchaseRow({ weight_kg: 500, quality_json: {} })]))
      .toEqual({ count: 2, totalWeightKg: 10500, totalValuePKR: 855000, unpricedCount: 1 });
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('rice purchases ledger (DB-gated)', () => {
  let db; let listRicePurchases; let app; let request; let token;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  beforeAll(async () => {
    db = require('../config/database');
    ({ listRicePurchases } = require('../modules/milling/ricePurchasesLedger'));
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-rp-${run}@test.local`, full_name: `ZZ RP ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    token = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    const [supA] = await db('suppliers').insert({ name: `ZZ RP Batch Supplier ${run}`, type: 'local' }).returning('*');
    const [supB] = await db('suppliers').insert({ name: `ZZ RP Lot Supplier ${run}`, type: 'local' }).returning('*');
    const [pA] = await db('products').insert({ name: `ZZ RP Basmati ${run}` }).returning('*');
    const [pB] = await db('products').insert({ name: `ZZ RP Sella ${run}` }).returning('*');
    const [wh] = await db('warehouses').insert({ name: `ZZ RP Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ RP Mill ${run}` }).returning('*');
    const [batch] = await db('milling_batches').insert({
      batch_no: `MRP${run}`, supplier_id: supA.id, product_id: pA.id, raw_qty_kg: 10000,
      status: 'Queued', created_by: u.id, mill_id: mill.id,
    }).returning('*');
    const lotRow = (over) => ({
      item_name: 'ZZ Rice', type: 'raw', entity: 'mill', warehouse_id: wh.id, qty: 10000, available_qty: 10000,
      net_weight_kg: 10000, unit: 'KG', status: 'Available', ...over,
    });
    await db('inventory_lots').insert(lotRow({
      lot_no: `ZZRP-B-${run}`, product_id: pA.id, supplier_id: supA.id, batch_ref: `batch-${batch.id}`, rate_per_kg: 85.5,
    }));
    const [lotFirst] = await db('inventory_lots').insert(lotRow({
      lot_no: `ZZRP-L-${run}`, product_id: pB.id, supplier_id: supB.id, variety: '1121 Sella', rate_per_kg: 90,
    })).returning('*');
    // Batch truck: priced on the truck, per MT (the document figure).
    await db('milling_vehicle_arrivals').insert({
      batch_id: batch.id, vehicle_no: `ZZB-${run}`, weight_kg: 10000, arrival_date: '2026-10-10',
      quality_json: { price_per_mt: 85500, price_per_kg: 85.5 },
    });
    // Lot-first truck: no batch, no truck price — the lot is the price.
    await db('milling_vehicle_arrivals').insert({
      lot_id: lotFirst.id, vehicle_no: `ZZL-${run}`, weight_kg: 4000, weighbridge_kg: 4050, accepted_kg: 3990,
      arrival_date: '2026-10-11',
    });
    Object.assign(ids, { supA: supA.id, supB: supB.id, pB: pB.id, lotFirst: lotFirst.id, batch: batch.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const mine = (rows) => rows.filter((r) => String(r.vehicle_no).endsWith(run));

  test('value = weight_kg × price_per_kg; summary in KG', async () => {
    const { purchases } = await listRicePurchases(db, { from_date: '2026-10-10', to_date: '2026-10-11' });
    const rows = mine(purchases);
    expect(rows).toHaveLength(2);
    const truck = rows.find((r) => r.vehicle_no === `ZZB-${run}`);
    expect(truck).toMatchObject({ weight_kg: 10000, price_per_kg: 85.5, value_pkr: 855000, batch_id: ids.batch });
    // 855,000 — not 855,000,000 (kg × Rs/MT).
    const lot = rows.find((r) => r.vehicle_no === `ZZL-${run}`);
    expect(lot).toMatchObject({
      weight_kg: 4000, weighbridge_kg: 4050, accepted_kg: 3990, price_per_kg: 90, value_pkr: 360000,
      lot_id: ids.lotFirst, supplier_id: ids.supB, variety: '1121 Sella', product_id: ids.pB,
    });
  });

  test('the supplier and variety filters find a lot-first truck', async () => {
    const bySup = mine((await listRicePurchases(db, { supplier_id: ids.supB })).purchases);
    expect(bySup.map((r) => r.vehicle_no)).toEqual([`ZZL-${run}`]);
    const byProduct = mine((await listRicePurchases(db, { product_id: ids.pB })).purchases);
    expect(byProduct.map((r) => r.vehicle_no)).toEqual([`ZZL-${run}`]);
    const s = (await listRicePurchases(db, { supplier_id: ids.supA })).summary;
    expect(s).toMatchObject({ count: 1, totalWeightKg: 10000, totalValuePKR: 855000 });
  });

  test('GET /api/milling/rice-purchases returns the same KG figures', async () => {
    const res = await request(app).get('/api/milling/rice-purchases')
      .query({ supplier_id: ids.supB }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({ count: 1, totalWeightKg: 4000, totalValuePKR: 360000 });
    expect(res.body.data.summary).not.toHaveProperty('totalWeightMT');
    expect(res.body.data.purchases[0]).toMatchObject({ weight_kg: 4000, price_per_kg: 90, value_pkr: 360000 });
  });
});
