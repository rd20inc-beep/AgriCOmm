/**
 * Where a milling batch's raw-rice cost comes from, and when yield may be
 * recorded (#427: no milling yield until the raw rice is priced).
 *
 *  - A batch started from a PRICED purchase lot takes its raw cost from the lot
 *    (landed cost — freight, commission, bags — × the qty committed). Per-truck
 *    prices on the carried-over vehicles used to overwrite it with
 *    Σ truck weight × truck price, ignoring landed cost and partial milling,
 *    while the GL was posted at the lot price.
 *  - The truck price still drives the cost where it is the only price: a direct
 *    intake batch (no source lots) or a lot that has no price of its own.
 *  - Yield is checked per source lot: a blend with one unpriced lot is refused
 *    and the error names it, even though the priced lots give a non-zero total.
 *
 * Runs the real inventoryService against a small in-memory knex stand-in.
 */

const mockTables = {};
let mockSeq = 100;

function mockBuilder(rawName) {
  const name = rawName.split(' as ')[0];
  const conds = [];
  let sumCol = null;
  const col = (c) => (c.includes('.') ? c.split('.').pop() : c);
  const b = {
    where(a, op, v) {
      if (typeof a === 'object') { for (const [k, val] of Object.entries(a)) conds.push((r) => String(r[col(k)]) === String(val)); return b; }
      if (v === undefined) { conds.push((r) => String(r[col(a)]) === String(op)); return b; }
      if (op === 'like') { const needle = String(v).split('%').filter(Boolean); conds.push((r) => needle.every((n) => String(r[col(a)] || '').includes(n))); return b; }
      throw new Error(`unsupported op ${op}`);
    },
    whereIn(c, vals) { conds.push((r) => vals.map(String).includes(String(r[col(c)]))); return b; },
    whereNotIn(c, vals) { conds.push((r) => !vals.map(String).includes(String(r[col(c)]))); return b; },
    leftJoin() { return b; }, // the batch_source_lots seed rows carry the joined lot columns
    select() { return b; },
    sum(expr) { sumCol = expr.split(' as ')[0]; return b; },
    rows() { return (mockTables[name] || []).filter((r) => conds.every((c) => c(r))); },
    async first() {
      if (sumCol) return { t: b.rows().reduce((s, r) => s + (parseFloat(r[sumCol]) || 0), 0) };
      return b.rows()[0];
    },
    async update(patch) { const hit = b.rows(); for (const r of hit) Object.assign(r, patch); return hit.length; },
    async del() { const hit = new Set(b.rows()); mockTables[name] = (mockTables[name] || []).filter((r) => !hit.has(r)); return hit.size; },
    async insert(row) { const rec = { id: ++mockSeq, ...row }; (mockTables[name] = mockTables[name] || []).push(rec); return [rec]; },
    then(ok, ko) { return Promise.resolve(b.rows()).then(ok, ko); },
  };
  return b;
}

jest.mock('../config/database', () => {
  const fn = (name) => mockBuilder(name);
  fn.fn = { now: () => new Date() };
  return fn;
});

const db = require('../config/database');
const inventoryService = require('../modules/inventory/inventory.service');

const trx = db;
const rawCost = () => (mockTables.milling_costs || [])
  .filter((c) => c.category === 'raw_rice').reduce((s, c) => s + c.amount, 0);

function seed(t) {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const [k, rows] of Object.entries(t)) mockTables[k] = rows.map((r) => ({ ...r }));
}

// Lot L-1: 10,000 kg bought at Rs 100/kg, landed Rs 105/kg (freight +
// commission). 6,000 kg of it is being milled (partial). Its one truck carried
// a per-truck price of Rs 98/kg (98,000/MT) for the full 10,000 kg.
const pricedLotBatch = () => ({
  milling_batches: [{ id: 1, actual_finished_kg: 0 }],
  batch_source_lots: [{ id: 11, batch_id: 1, lot_id: 5, qty_kg: 6000, unit_cost_pkr: null, lot_no: 'L-1', landed_cost_per_kg: 105, rate_per_kg: 100 }],
  milling_vehicle_arrivals: [{ id: 21, batch_id: 1, lot_id: 5, weight_kg: 10000, quality_json: { price_per_mt: 98000 } }],
  milling_costs: [],
  inventory_lots: [],
});

describe('raw cost of a batch started from a purchase lot', () => {
  test('a priced lot sets the cost: landed cost × committed qty, never Σ truck weight × truck price', async () => {
    seed(pricedLotBatch());
    await inventoryService.recomputeRawRiceCostFromVehicles(trx, 1, 9);
    expect(rawCost()).toBe(0); // the trucks wrote nothing
    await inventoryService.ensureRawCostFromSourceLots(trx, 1);
    expect(rawCost()).toBe(630000); // 6,000 kg × Rs 105 — not 10,000 × 98 = 980,000
  });

  test('a truck-derived cost already on a priced-lot batch is replaced by the lot cost', async () => {
    seed(pricedLotBatch());
    mockTables.milling_costs.push({ id: 1, batch_id: 1, category: 'raw_rice', amount: 980000, notes: 'Auto from 1 vehicle(s): 10000 KG @ ~Rs 98/KG' });
    await inventoryService.recomputeRawRiceCostFromVehicles(trx, 1, 9);
    expect(rawCost()).toBe(630000);
    expect(mockTables.milling_costs).toHaveLength(1);
  });

  test('trucks still refresh yield % on a priced-lot batch', async () => {
    seed(pricedLotBatch());
    mockTables.milling_batches[0].actual_finished_kg = 6500;
    await inventoryService.recomputeRawRiceCostFromVehicles(trx, 1, 9);
    expect(mockTables.milling_batches[0].yield_pct).toBe(65);
  });

  test('an UNPRICED lot: the per-truck price is the only price, so it drives the cost', async () => {
    seed(pricedLotBatch());
    Object.assign(mockTables.batch_source_lots[0], { landed_cost_per_kg: 0, rate_per_kg: 0 });
    await inventoryService.recomputeRawRiceCostFromVehicles(trx, 1, 9);
    expect(rawCost()).toBe(980000);
  });

  test('a direct-intake batch (no source lots) keeps costing from its trucks', async () => {
    seed({
      milling_batches: [{ id: 2, actual_finished_kg: 0 }],
      batch_source_lots: [],
      milling_vehicle_arrivals: [
        { id: 31, batch_id: 2, weight_kg: 4000, quality_json: { price_per_mt: 100000 } },
        { id: 32, batch_id: 2, weight_kg: 1000, quality_json: null }, // unpriced → weighted average
      ],
      milling_costs: [],
      inventory_lots: [],
    });
    await inventoryService.recomputeRawRiceCostFromVehicles(trx, 2, 9);
    expect(rawCost()).toBe(500000);
  });
});

describe('yield needs every source lot priced (#427)', () => {
  const blend = (lots) => ({
    batch_source_lots: lots.map((l, i) => ({ id: 40 + i, batch_id: 3, lot_id: l.id, qty_kg: 1000, unit_cost_pkr: l.unit || null, lot_no: l.no, landed_cost_per_kg: l.landed || 0, rate_per_kg: l.rate || 0 })),
  });

  test('a blend with one unpriced lot is refused, naming that lot, although the batch total is non-zero', async () => {
    seed(blend([{ id: 1, no: 'L-A', landed: 100 }, { id: 2, no: 'L-B' }]));
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 100000)).rejects.toMatchObject({
      status: 400, message: expect.stringMatching(/L-B has no purchase price/),
    });
  });

  test('several unpriced lots are all named', async () => {
    seed(blend([{ id: 1, no: 'L-A', landed: 100 }, { id: 2, no: 'L-B' }, { id: 3, no: 'L-C' }]));
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 100000)).rejects.toThrow(/L-B, L-C have no purchase price/);
  });

  test('every source lot priced → yield allowed', async () => {
    seed(blend([{ id: 1, no: 'L-A', landed: 100 }, { id: 2, no: 'L-B', rate: 90 }, { id: 3, no: 'L-C', unit: 95 }]));
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 285000)).resolves.toBeUndefined();
  });

  test('no source lot priced but the batch carries its own raw cost (truck / arrival price) → allowed', async () => {
    seed(blend([{ id: 1, no: 'L-A' }]));
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 98000)).resolves.toBeUndefined();
  });

  test('no source lot priced and no batch cost → refused', async () => {
    seed(blend([{ id: 1, no: 'L-A' }]));
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 0)).rejects.toThrow(/L-A has no purchase price/);
  });

  test('a direct-intake batch needs a non-zero raw cost', async () => {
    seed({ batch_source_lots: [] });
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 0)).rejects.toThrow(/no recorded raw-material cost/);
    await expect(inventoryService.assertBatchRawPriced(trx, 3, 5000)).resolves.toBeUndefined();
  });
});
