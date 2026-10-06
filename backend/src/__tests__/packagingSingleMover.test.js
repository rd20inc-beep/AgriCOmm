/**
 * Packaging stock has exactly ONE mover per kind (owner decision 2026-10-07,
 * audit MIL-M1). Three mechanisms used to move mill_stock for the same bags:
 * batch packaging lines, the katta reconcile at yield, and the packing run.
 *
 *   katta                       → reconcileBatchKatta at yield ('batch_katta')
 *   P.P. bags / masters / poly  → the packing run ('packing')
 *   batch packaging lines       → record-only, never move stock
 *
 * These EXECUTE the services against an in-memory knex stand-in.
 */

// ── A small in-memory knex: enough of the builder for these three services ──
const state = { tables: {}, seq: 1000 };
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => (a == null || b == null ? a == null && b == null : String(a) === String(b));

function evalRaw(current, raw) {
  const [arg] = raw.bindings || [];
  const n = (parseFloat(current) || 0);
  const a = parseFloat(arg) || 0;
  switch (raw.sql) {
    case 'quantity_available + ?': return n + a;
    case 'quantity_available - ?': return n - a;
    case 'GREATEST(quantity_available + ?, 0)': return Math.max(n + a, 0);
    case 'GREATEST(quantity_available - ?, 0)': return Math.max(n - a, 0);
    default: throw new Error(`fake knex: unsupported raw ${raw.sql}`);
  }
}

function q(tableRef) {
  const table = String(tableRef).split(/\s+as\s+/i)[0];
  if (!state.tables[table]) state.tables[table] = [];
  const conds = [];
  let only = false; let agg = null; let group = null; let fields = null;
  const rows = () => state.tables[table].filter((r) => conds.every((c) => c(r)));
  const b = {
    where(a, op, c) {
      if (a && typeof a === 'object') {
        for (const [k, v] of Object.entries(a)) conds.push((r) => same(r[k], v));
      } else if (c === undefined) conds.push((r) => same(r[a], op));
      else if (op === '=') conds.push((r) => same(r[a], c));
      else throw new Error(`fake knex: op ${op}`);
      return b;
    },
    andWhere(...x) { return b.where(...x); },
    whereIn(f, vals) { conds.push((r) => vals.some((v) => same(r[f], v))); return b; },
    orderBy() { return b; },
    orderByRaw() { return b; },
    forUpdate() { return b; },
    select(...f) { fields = f.flat(); return b; },
    first(...f) { only = true; if (f.length) fields = f.flat(); return b; },
    sum(obj) { agg = obj; return b; },
    groupBy(col) { group = col; return b; },
    insert(payload) {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r) => {
        const rec = { id: r.id || (state.seq += 1), ...clone(r) };
        state.tables[table].push(rec);
        return rec;
      });
      const out = list.map((r) => ({ ...r }));
      return { returning: async () => out, then: (ok, ko) => Promise.resolve(out.length).then(ok, ko) };
    },
    update(patch) {
      const hit = rows();
      for (const r of hit) {
        for (const [k, v] of Object.entries(patch)) r[k] = v && v.__raw ? evalRaw(r[k], v) : v;
      }
      return { returning: async () => clone(hit), then: (ok, ko) => Promise.resolve(hit.length).then(ok, ko) };
    },
    async del() {
      const hit = rows();
      state.tables[table] = state.tables[table].filter((r) => !hit.includes(r));
      return hit.length;
    },
    then(ok, ko) {
      let result;
      if (agg) {
        const [[alias, col]] = Object.entries(agg);
        const sumOf = (rs) => rs.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
        if (group) {
          const by = new Map();
          for (const r of rows()) {
            if (!by.has(r[group])) by.set(r[group], []);
            by.get(r[group]).push(r);
          }
          result = [...by.entries()].map(([g, rs]) => ({ [group]: g, [alias]: sumOf(rs) }));
        } else {
          result = [{ [alias]: sumOf(rows()) }];
        }
      } else {
        result = rows().map((r) => {
          if (!fields || !fields.length || fields[0] === '*') return clone(r);
          return Object.fromEntries(fields.map((f) => [f, r[f]]));
        });
      }
      if (only) result = result[0];
      return Promise.resolve(result).then(ok, ko);
    },
  };
  return b;
}
const fakeDb = (t) => q(t);
fakeDb.fn = { now: () => '2026-10-07T00:00:00.000Z' };
fakeDb.raw = (sql, bindings) => ({ __raw: true, sql, bindings });
fakeDb.transaction = async (fn) => fn(fakeDb);

jest.mock('../config/database', () => fakeDb);
jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async () => ({ id: 1 })),
  postJournal: jest.fn(async () => {}),
}));

const inventoryService = require('../modules/inventory/inventory.service');
const packingService = require('../modules/millStore/packing.service');
const batchPackagingService = require('../modules/milling/batchPackaging.service');

// ── Fixtures ────────────────────────────────────────────────────────────────
const KATTA = 1; const PP25 = 2; const MASTER = 3; const POLY = 4;
const BATCH = 10;

function seed({ yielded = true, exportOrder = false, kattaStock = 0 } = {}) {
  state.seq = 1000;
  state.tables = {
    milling_batches: [{
      id: BATCH, batch_no: 'M-TEST', actual_finished_kg: yielded ? 2500 : 0,
      linked_export_order_id: exportOrder ? 77 : null,
    }],
    export_orders: [{ id: 77, order_no: 'EXP-T', packing_type: 'retail', bag_size_kg: 25 }],
    mill_items: [
      { id: KATTA, code: 'KATTA-50', name: 'Katta 50kg', pack_type: 'katta', capacity_kg: 50, tare_weight_kg: 0.2, avg_cost_per_unit: 0, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: PP25, code: 'PP-25', name: 'PP Bag 25kg', pack_type: 'pp_bag', capacity_kg: 25, tare_weight_kg: 0.1, avg_cost_per_unit: 10, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: MASTER, code: 'MASTER-50', name: 'Master Bag 50kg', pack_type: 'master_bag', capacity_kg: 50, avg_cost_per_unit: 26, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: POLY, code: 'POLY-1', name: 'Polythene sheet', pack_type: 'polythene', capacity_kg: 0, avg_cost_per_unit: 2, is_active: true, category: 'packaging', unit: 'pcs' },
    ],
    mill_stock: [
      { id: 1, item_id: KATTA, warehouse_id: null, quantity_available: kattaStock, quantity_reserved: 0 },
      { id: 2, item_id: PP25, warehouse_id: null, quantity_available: 200, quantity_reserved: 0 },
      { id: 3, item_id: MASTER, warehouse_id: null, quantity_available: 100, quantity_reserved: 0 },
      { id: 4, item_id: POLY, warehouse_id: null, quantity_available: 500, quantity_reserved: 0 },
    ],
    mill_stock_movements: [],
    milling_batch_packaging: [],
    mill_packing_logs: [],
    milling_costs: [],
    chart_of_accounts: [{ id: 60, code: '6000', name: 'Operating Expenses' }, { id: 12, code: '1250', name: 'Bags & Packaging' }],
    // 100 x 50 kg katta of raw arrived on the batch.
    milling_vehicle_arrivals: [{ id: 1, batch_id: BATCH, total_bags: 100, bag_size_kg: 50, weight_kg: 5000 }],
    inventory_lots: yielded ? [
      { id: 501, batch_ref: `batch-${BATCH}`, type: 'finished', net_weight_kg: 2500, qty: 2500 },
      { id: 502, batch_ref: `batch-${BATCH}`, type: 'byproduct', net_weight_kg: 500, qty: 500 },
    ] : [],
    batch_source_lots: [],
  };
}

const stockOf = (itemId) => Number(state.tables.mill_stock.find((s) => s.item_id === itemId && s.warehouse_id == null)?.quantity_available || 0);
const movesOf = (ref) => state.tables.mill_stock_movements.filter((m) => m.reference_type === ref);
const allStock = () => Object.fromEntries(state.tables.mill_stock.map((s) => [s.item_id, Number(s.quantity_available)]));

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(inventoryService, 'recomputeBatchOutputsAfterPriceChange').mockResolvedValue(null);
  jest.spyOn(batchPackagingService, 'list').mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

// ── 1. Batch packaging lines are record-only ───────────────────────────────
describe('recording packaging lines moves no stock', () => {
  it('received + consumed lines of every kind leave store stock untouched', async () => {
    seed({ kattaStock: 100 });
    const before = allStock();
    await batchPackagingService.save(BATCH, [
      { mill_item_id: KATTA, direction: 'received', quantity: 300 },
      { mill_item_id: PP25, direction: 'consumed', quantity: 50, output_type: 'finished' },
      { mill_item_id: MASTER, direction: 'consumed', quantity: 10, output_type: 'finished' },
      { mill_item_id: KATTA, direction: 'consumed', quantity: 120, output_type: 'byproduct' },
    ], 1);
    expect(allStock()).toEqual(before);
    expect(state.tables.mill_stock_movements).toHaveLength(0);
    expect(state.tables.milling_batch_packaging).toHaveLength(4);

    // An edit and a full removal still move nothing.
    await batchPackagingService.save(BATCH, [{ mill_item_id: KATTA, direction: 'received', quantity: 320 }], 1);
    expect(state.tables.milling_batch_packaging).toHaveLength(1);
    expect(Number(state.tables.milling_batch_packaging[0].quantity)).toBe(320);
    await batchPackagingService.save(BATCH, [], 1);
    expect(state.tables.milling_batch_packaging).toHaveLength(0);
    expect(allStock()).toEqual(before);
    expect(state.tables.mill_stock_movements).toHaveLength(0);
  });

  it('a line saved under the old rule has its stock move undone exactly once', async () => {
    seed({ kattaStock: 400 });
    // Legacy: line 7 had freed 300 katta into store via 'batch_packaging'.
    state.tables.milling_batch_packaging.push({ id: 7, batch_id: BATCH, mill_item_id: KATTA, direction: 'received', output_type: null, quantity: 300, unit_cost_pkr: 0 });
    state.tables.mill_stock_movements.push({ id: 900, item_id: KATTA, warehouse_id: null, movement_type: 'return', quantity: 300, cost_per_unit: 0, reference_type: 'batch_packaging', reference_id: 7 });

    await batchPackagingService.save(BATCH, [{ mill_item_id: KATTA, direction: 'received', quantity: 300 }], 1);
    expect(stockOf(KATTA)).toBe(100);
    await batchPackagingService.save(BATCH, [{ mill_item_id: KATTA, direction: 'received', quantity: 300 }], 1);
    await batchPackagingService.save(BATCH, [], 1);
    expect(stockOf(KATTA)).toBe(100);
    const net = movesOf('batch_packaging').reduce((s, m) => s + Number(m.quantity), 0);
    expect(net).toBe(0);
  });

  it('the cost adjustment is labelled as not posted to batch cost', async () => {
    seed();
    const src = require('fs').readFileSync(require('path').join(__dirname, '../modules/milling/batchPackaging.service.js'), 'utf8');
    expect(src).toContain('postedToBatchCost: false');
  });
});

// ── 2. A packing run never deducts katta ───────────────────────────────────
describe('a packing run does not deduct katta', () => {
  it('before yield: the katta run is recorded, no katta stock moves', async () => {
    seed({ yielded: false, kattaStock: 80 });
    const res = await packingService.pack(BATCH, { bag_item_id: KATTA, bags_count: 50 }, 1);
    expect(res.bags_count).toBe(50);
    expect(state.tables.mill_packing_logs).toHaveLength(1);
    expect(stockOf(KATTA)).toBe(80);
    expect(movesOf('packing').filter((m) => m.item_id === KATTA)).toHaveLength(0);
    expect(res.shortages).toEqual([]);
    // The bag cost still reaches the batch once, through the packing cost path.
    expect(state.tables.milling_costs.filter((c) => c.category === 'packaging')).toHaveLength(0); // katta cost 0
  });

  it('a katta used as the master is recorded but not drawn either', async () => {
    seed({ yielded: false, kattaStock: 80 });
    await packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 20, master_bag_item_id: KATTA, master_bags_count: 10 }, 1);
    expect(stockOf(KATTA)).toBe(80);
    expect(stockOf(PP25)).toBe(180);
  });
});

// ── 3. The yield reconcile moves katta exactly once ────────────────────────
describe('the yield reconcile is the one katta mover', () => {
  it('frees the raw katta and consumes the packing run katta + by-product katta', async () => {
    seed({ yielded: false, kattaStock: 0 });
    await packingService.pack(BATCH, { bag_item_id: KATTA, bags_count: 50 }, 1); // pre-yield run
    expect(stockOf(KATTA)).toBe(0);

    // Yield.
    state.tables.milling_batches[0].actual_finished_kg = 2500;
    state.tables.inventory_lots.push(
      { id: 501, batch_ref: `batch-${BATCH}`, type: 'finished', net_weight_kg: 2500, qty: 2500 },
      { id: 502, batch_ref: `batch-${BATCH}`, type: 'byproduct', net_weight_kg: 500, qty: 500 },
    );
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    // +100 freed, −10 by-products (500 kg / 50), −50 the packing run.
    expect(stockOf(KATTA)).toBe(40);
    const once = clone(movesOf('batch_katta'));
    expect(once.reduce((s, m) => s + Number(m.quantity), 0)).toBe(40);
    expect(once.filter((m) => m.quantity === -50)).toHaveLength(1);

    // Re-running is idempotent: same stock, same movement set.
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    expect(stockOf(KATTA)).toBe(40);
    expect(movesOf('batch_katta').map((m) => m.quantity).sort()).toEqual(once.map((m) => m.quantity).sort());
    expect(movesOf('packing').filter((m) => m.item_id === KATTA)).toHaveLength(0);
  });

  it('a katta run logged AFTER yield is drawn once by the reconcile pack() triggers', async () => {
    seed({ yielded: true, kattaStock: 0 });
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1); // yield
    // Without a run: +100 freed, −50 finished (2500/50), −10 by-products.
    expect(stockOf(KATTA)).toBe(40);
    await packingService.pack(BATCH, { bag_item_id: KATTA, bags_count: 50 }, 1);
    // The run replaces the by-weight assumption for finished: still 40, not −10.
    expect(stockOf(KATTA)).toBe(40);
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    expect(stockOf(KATTA)).toBe(40);
  });

  it('a katta run logged under the old rule (already drawn by the run) is not drawn again', async () => {
    seed({ yielded: true, kattaStock: 0 });
    state.tables.mill_packing_logs.push({ id: 300, batch_id: BATCH, bag_item_id: KATTA, bags_count: 50, capacity_kg_per_bag: 50, packed_weight_kg: 2500, warehouse_id: null });
    state.tables.mill_stock_movements.push({ id: 901, item_id: KATTA, warehouse_id: null, movement_type: 'consumption', quantity: -50, reference_type: 'packing', reference_id: 300 });
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    // +100 freed, −10 by-products; the run's 50 were already taken in 'packing'.
    expect(stockOf(KATTA)).toBe(90);
    expect(movesOf('batch_katta').some((m) => m.quantity === -50)).toBe(false);
  });

  it('a katta shortfall on the run is flagged, never driven negative', async () => {
    seed({ yielded: true, kattaStock: 0 });
    state.tables.milling_vehicle_arrivals[0].total_bags = 20; // only 20 freed
    state.tables.milling_vehicle_arrivals[0].weight_kg = 1000;
    const res = await packingService.pack(BATCH, { bag_item_id: KATTA, bags_count: 50 }, 1);
    expect(stockOf(KATTA)).toBe(0);
    expect(res.shortages.some((s) => s.item === 'Katta 50kg' && s.short > 0)).toBe(true);
  });
});

// ── 4. Non-katta material moves once, via the packing run ──────────────────
describe('P.P. bags, masters and polythene move once — with the packing run', () => {
  it('the run draws them; the yield reconcile does not touch them', async () => {
    seed({ yielded: false, kattaStock: 0 });
    await packingService.pack(BATCH, {
      bag_item_id: PP25, bags_count: 100,
      master_bag_item_id: MASTER, master_bags_count: 50,
      poly_item_id: POLY, poly_count: 100,
    }, 1);
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([100, 50, 400]);
    expect(movesOf('packing')).toHaveLength(3);

    state.tables.milling_batches[0].actual_finished_kg = 2500;
    state.tables.inventory_lots.push(
      { id: 501, batch_ref: `batch-${BATCH}`, type: 'finished', net_weight_kg: 2500, qty: 2500 },
      { id: 502, batch_ref: `batch-${BATCH}`, type: 'byproduct', net_weight_kg: 500, qty: 500 },
    );
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([100, 50, 400]);
    expect(movesOf('batch_katta').some((m) => [PP25, MASTER, POLY].includes(m.item_id))).toBe(false);
    // Katta: +100 freed, −10 by-products; the finished rice went into P.P. bags.
    expect(stockOf(KATTA)).toBe(90);
    // The packing cost reached the batch once, as one 'packaging' milling cost.
    const pc = state.tables.milling_costs.filter((c) => c.category === 'packaging');
    expect(pc).toHaveLength(1);
    expect(Number(pc[0].amount)).toBe(100 * 10 + 50 * 26 + 100 * 2);
  });

  it('export batch with a packing run: the run is the truth, the reconcile does not draw the bags again', async () => {
    seed({ yielded: false, exportOrder: true, kattaStock: 0 });
    await packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 100 }, 1);
    expect(stockOf(PP25)).toBe(100);
    state.tables.milling_batches[0].actual_finished_kg = 2500;
    state.tables.inventory_lots.push({ id: 501, batch_ref: `batch-${BATCH}`, type: 'finished', net_weight_kg: 2500, qty: 2500 });
    const res = await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    expect(stockOf(PP25)).toBe(100);
    expect(state.tables.mill_items.some((i) => i.code === 'KATTA-25')).toBe(false);
    expect(res.shortages).toEqual([]);
    const lot = state.tables.inventory_lots.find((l) => l.id === 501);
    expect([lot.total_bags, lot.bag_size_kg, lot.bag_weight_kg]).toEqual([100, 25, 25]);
  });
});
