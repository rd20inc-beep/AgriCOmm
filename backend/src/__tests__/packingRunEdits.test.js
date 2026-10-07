/**
 * Packing runs can be corrected or deleted, and a batch carries a packing spec
 * (owner decisions 2026-10-08). Executes the services against an in-memory
 * knex stand-in (same one as packagingSingleMover.test.js).
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
    leftJoin() { return b; },
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
  createJournal: jest.fn(async (trx, j) => ({ id: 1, ...j })),
  postJournal: jest.fn(async () => {}),
}));

const accountingService = require('../modules/accounting/accounting.service');
const inventoryService = require('../modules/inventory/inventory.service');
const packingService = require('../modules/millStore/packing.service');
const { packingEditDecision, isBatchCompleted } = require('../modules/milling/packingGate');
const { effectivePackSpec, resolveBatchPackSpec } = require('../modules/milling/batchPackSpec');

// ── Fixtures ────────────────────────────────────────────────────────────────
const KATTA = 1; const PP25 = 2; const MASTER = 3; const POLY = 4;
const BATCH = 10;

const OWNER = { id: 1, role_id: 1, permissions: new Set() };
const MANAGER = { id: 2, role_id: 2, permissions: new Set(['mill_store.record_consumption', 'milling.edit']) };
const OPERATOR = { id: 3, role_id: 3, permissions: new Set(['mill_store.record_consumption', 'milling.edit']) };
const VIEWER = { id: 4, role_id: 4, permissions: new Set(['mill_store.view']) };
const fresh = (u) => ({ ...u, permissions: new Set(u.permissions) });

function seed({ yielded = false, status = null, kattaStock = 0, pp = 200, exportOrder = false } = {}) {
  state.seq = 1000;
  state.tables = {
    roles: [{ id: 1, name: 'Owner' }, { id: 2, name: 'Mill Manager' }, { id: 3, name: 'Mill Operator' }, { id: 4, name: 'QC Analyst' }],
    milling_batches: [{
      id: BATCH, batch_no: 'M-TEST', status: status || (yielded ? 'Completed' : 'In Progress'),
      actual_finished_kg: yielded ? 2500 : 0, product_id: 5,
      linked_export_order_id: exportOrder ? 77 : null,
    }],
    export_orders: [{ id: 77, order_no: 'EXP-T', packing_type: 'retail', bag_size_kg: 25 }],
    export_order_items: [],
    mill_items: [
      { id: KATTA, code: 'KATTA-50', name: 'Katta 50kg', pack_type: 'katta', capacity_kg: 50, tare_weight_kg: 0.2, avg_cost_per_unit: 0, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: PP25, code: 'PP-25', name: 'PP Bag 25kg', pack_type: 'pp_bag', capacity_kg: 25, tare_weight_kg: 0.1, avg_cost_per_unit: 10, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: MASTER, code: 'MASTER-50', name: 'Master Bag 50kg', pack_type: 'master_bag', capacity_kg: 50, avg_cost_per_unit: 26, is_active: true, category: 'packaging', unit: 'pcs' },
      { id: POLY, code: 'POLY-1', name: 'Polythene sheet', pack_type: 'polythene', capacity_kg: 0, avg_cost_per_unit: 2, is_active: true, category: 'packaging', unit: 'pcs' },
    ],
    mill_stock: [
      { id: 1, item_id: KATTA, warehouse_id: null, quantity_available: kattaStock, quantity_reserved: 0 },
      { id: 2, item_id: PP25, warehouse_id: null, quantity_available: pp, quantity_reserved: 0 },
      { id: 3, item_id: MASTER, warehouse_id: null, quantity_available: 100, quantity_reserved: 0 },
      { id: 4, item_id: POLY, warehouse_id: null, quantity_available: 500, quantity_reserved: 0 },
    ],
    mill_stock_movements: [],
    mill_packing_logs: [],
    milling_costs: [],
    journal_entries: [{ id: 1, ref_type: 'Mill Packing', ref_no: 'M-TEST', status: 'Posted' }],
    chart_of_accounts: [{ id: 60, code: '6000', name: 'Operating Expenses' }, { id: 12, code: '1250', name: 'Bags & Packaging' }],
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
const netPacking = (itemId) => movesOf('packing').filter((m) => m.item_id === itemId).reduce((s, m) => s + Number(m.quantity), 0);
const packagingCosts = () => state.tables.milling_costs.filter((c) => c.category === 'packaging');
const journalLines = () => accountingService.createJournal.mock.calls.map(([, j]) => j.lines.map((l) => [l.narration.slice(0, 7), l.debit || -l.credit]));

async function packFullRun() {
  return packingService.pack(BATCH, {
    bag_item_id: PP25, bags_count: 100,
    master_bag_item_id: MASTER, master_bags_count: 50,
    poly_item_id: POLY, poly_count: 100,
  }, 1);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(inventoryService, 'recomputeBatchOutputsAfterPriceChange').mockResolvedValue(null);
  accountingService.createJournal.mockClear();
});
afterEach(() => jest.restoreAllMocks());

// ── 1. Editing applies the DIFFERENCE ──────────────────────────────────────
describe('correcting a packing run moves only the difference', () => {
  it('more bags and masters: draws the extra, posts the cost delta, updates the batch cost', async () => {
    seed();
    const run = await packFullRun();
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([100, 50, 400]);
    accountingService.createJournal.mockClear();

    const res = await packingService.updateRun(BATCH, run.id, { bags_count: 120, master_bags_count: 60 }, fresh(OPERATOR));
    // Stock: only the 20 bags + 10 masters; polythene kept its count.
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([80, 40, 400]);
    expect([netPacking(PP25), netPacking(MASTER), netPacking(POLY)]).toEqual([-120, -60, -100]);
    // Cost: 2,500 → 2,960 (+460), at the unit costs the run was booked at.
    expect(res.costBefore).toBe(2500);
    expect(res.costAfter).toBe(2960);
    expect(res.costDelta).toBe(460);
    expect(journalLines()).toEqual([[['DR 6000', 460], ['CR 1250', -460]]]);
    expect(packagingCosts()).toHaveLength(1);
    expect(Number(packagingCosts()[0].amount)).toBe(2960);
    const log = state.tables.mill_packing_logs[0];
    expect([log.bags_count, log.packed_weight_kg, Number(log.total_cost)]).toEqual([120, 3000, 2960]);
    expect(res.before.bags_count).toBe(100);
  });

  it('fewer bags and no master: returns them and posts the signed delta the other way', async () => {
    seed();
    const run = await packFullRun();
    accountingService.createJournal.mockClear();
    await packingService.updateRun(BATCH, run.id, { bags_count: 80, master_bag_item_id: null, master_bags_count: null }, fresh(OPERATOR));
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([120, 100, 400]);
    expect(movesOf('packing').filter((m) => m.movement_type === 'return').map((m) => [m.item_id, m.quantity]))
      .toEqual(expect.arrayContaining([[PP25, 20], [MASTER, 50]]));
    // 2,500 → 800 + 200 = 1,000: a cut of 1,500, DR 1250 / CR 6000.
    expect(journalLines()).toEqual([[['DR 1250', 1500], ['CR 6000', -1500]]]);
    expect(Number(packagingCosts()[0].amount)).toBe(1000);
    expect(state.tables.mill_packing_logs[0].master_bag_item_id).toBeNull();
  });

  it('re-costs a yielded batch\'s outputs when the cost moves', async () => {
    seed({ yielded: true, kattaStock: 0 });
    const run = await packFullRun();
    inventoryService.recomputeBatchOutputsAfterPriceChange.mockClear();
    await packingService.updateRun(BATCH, run.id, { bags_count: 90 }, fresh(MANAGER));
    expect(inventoryService.recomputeBatchOutputsAfterPriceChange).toHaveBeenCalledTimes(1);
  });

  it('refuses a draw the store cannot cover with 409 and moves nothing', async () => {
    seed({ pp: 120 });
    const run = await packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 100 }, 1);
    expect(stockOf(PP25)).toBe(20);
    const before = JSON.stringify(state.tables.mill_packing_logs);
    accountingService.createJournal.mockClear();
    await expect(packingService.updateRun(BATCH, run.id, { bags_count: 150 }, fresh(OPERATOR)))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Not enough PP Bag 25kg.*needs 50 more, only 20/) });
    expect(stockOf(PP25)).toBe(20);
    expect(JSON.stringify(state.tables.mill_packing_logs)).toBe(before);
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  it('a run that ran short draws only the difference, not the old shortfall', async () => {
    seed({ pp: 60 });
    const run = await packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 100 }, 1); // 40 short
    expect(stockOf(PP25)).toBe(0);
    state.tables.mill_stock.find((s) => s.item_id === PP25).quantity_available = 10; // 10 received since
    await packingService.updateRun(BATCH, run.id, { bags_count: 110 }, fresh(OPERATOR));
    expect(stockOf(PP25)).toBe(0);
    expect(netPacking(PP25)).toBe(-70);
  });
});

// ── 2. Delete is a full reversal ───────────────────────────────────────────
describe('deleting a packing run', () => {
  it('returns every bag, master and sheet it drew, reverses the cost and removes the run', async () => {
    seed();
    const run = await packFullRun();
    accountingService.createJournal.mockClear();
    const res = await packingService.deleteRun(BATCH, run.id, fresh(OPERATOR));
    expect([stockOf(PP25), stockOf(MASTER), stockOf(POLY)]).toEqual([200, 100, 500]);
    expect([netPacking(PP25), netPacking(MASTER), netPacking(POLY)]).toEqual([0, 0, 0]);
    expect(state.tables.mill_packing_logs).toHaveLength(0);
    expect(packagingCosts()).toHaveLength(0);
    expect(journalLines()).toEqual([[['DR 1250', 2500], ['CR 6000', -2500]]]);
    expect(res.before.id).toBe(run.id);
    expect(res.deleted).toBe(true);
  });

  it('no reversal journal when the batch never had a packing journal posted', async () => {
    seed();
    state.tables.journal_entries = [];
    const run = await packFullRun();
    accountingService.createJournal.mockClear();
    await packingService.deleteRun(BATCH, run.id, fresh(OPERATOR));
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });
});

// ── 3. Katta is never double-moved ─────────────────────────────────────────
describe('katta runs: the yield reconcile stays the one mover', () => {
  it('editing and deleting a katta run on a yielded batch moves katta exactly once', async () => {
    seed({ yielded: true, kattaStock: 0 });
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1); // the yield
    const run = await packingService.pack(BATCH, { bag_item_id: KATTA, bags_count: 50 }, 1);
    // +100 freed, −10 by-products, −50 the run.
    expect(stockOf(KATTA)).toBe(40);

    await packingService.updateRun(BATCH, run.id, { bags_count: 40 }, fresh(MANAGER));
    expect(stockOf(KATTA)).toBe(50);
    await packingService.updateRun(BATCH, run.id, { bags_count: 40 }, fresh(MANAGER)); // same again
    expect(stockOf(KATTA)).toBe(50);
    expect(movesOf('packing').filter((m) => m.item_id === KATTA)).toHaveLength(0);

    // Deleted: finished falls back to the predominant katta by weight (50).
    await packingService.deleteRun(BATCH, run.id, fresh(MANAGER));
    expect(stockOf(KATTA)).toBe(40);
    expect(movesOf('packing').filter((m) => m.item_id === KATTA)).toHaveLength(0);
  });

  it('a legacy run that drew its own katta gives back what the new count no longer needs', async () => {
    seed({ yielded: true, kattaStock: 0 });
    state.tables.mill_packing_logs.push({ id: 300, batch_id: BATCH, bag_item_id: KATTA, bags_count: 50, capacity_kg_per_bag: 50, tare_kg_per_bag: 0, cost_per_bag: 0, total_cost: 0, packed_weight_kg: 2500, warehouse_id: null });
    state.tables.mill_stock_movements.push({ id: 901, item_id: KATTA, warehouse_id: null, movement_type: 'consumption', quantity: -50, reference_type: 'packing', reference_id: 300 });
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    expect(stockOf(KATTA)).toBe(90); // +100 −10; the run's 50 came from before
    await packingService.updateRun(BATCH, 300, { bags_count: 30 }, fresh(OWNER));
    // 20 handed back by the run, nothing drawn by the reconcile for it.
    expect(netPacking(KATTA)).toBe(-30);
    expect(stockOf(KATTA)).toBe(110);
  });
});

// ── 4. Gating ──────────────────────────────────────────────────────────────
describe('who may change a batch\'s packing', () => {
  const decide = (status, roleName, hasPermission = true, finished = 0) =>
    packingEditDecision({ batch: { status, actual_finished_kg: finished }, roleName, hasPermission });

  it('matrix', () => {
    expect(decide('In Progress', 'Mill Operator').allowed).toBe(true);
    expect(decide('Queued', 'Mill Operator').allowed).toBe(true);
    expect(decide('On Hold', 'Mill Operator').allowed).toBe(true);
    expect(decide('In Progress', 'QC Analyst', false).allowed).toBe(false);
    const op = decide('Completed', 'Mill Operator');
    expect(op.allowed).toBe(false);
    expect(op.reason).toBe('This batch is Completed — only an Owner or Mill Manager can change its packing.');
    expect(decide('Completed', 'Mill Manager').allowed).toBe(true);
    expect(decide('Completed', 'Owner', false).allowed).toBe(true);
    expect(decide('Completed', 'Super Admin', false).allowed).toBe(true);
    for (const role of ['Owner', 'Super Admin', 'Mill Manager', 'Mill Operator']) {
      for (const s of ['Cancelled', 'Rejected']) {
        const d = decide(s, role);
        expect(d.allowed).toBe(false);
        expect(d.locked).toBe(true);
        expect(d.reason).toMatch(new RegExp(`${s}`));
      }
    }
    // A yield recorded under a legacy status counts as completed.
    expect(decide('Pending Approval', 'Mill Operator', true, 2500).allowed).toBe(false);
    expect(isBatchCompleted({ status: 'In Progress', actual_finished_kg: 0 })).toBe(false);
  });

  it('the service enforces it: operator before / after Completed, Mill Manager after, Cancelled locked', async () => {
    seed();
    const run = await packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 10 }, 1);
    await expect(packingService.updateRun(BATCH, run.id, { bags_count: 12 }, fresh(OPERATOR))).resolves.toBeTruthy();

    state.tables.milling_batches[0].status = 'Completed';
    await expect(packingService.updateRun(BATCH, run.id, { bags_count: 14 }, fresh(OPERATOR)))
      .rejects.toMatchObject({ statusCode: 403, message: 'This batch is Completed — only an Owner or Mill Manager can change its packing.' });
    await expect(packingService.deleteRun(BATCH, run.id, fresh(OPERATOR))).rejects.toMatchObject({ statusCode: 403 });
    await expect(packingService.updateRun(BATCH, run.id, { bags_count: 14 }, fresh(MANAGER))).resolves.toBeTruthy();
    expect(state.tables.mill_packing_logs[0].bags_count).toBe(14);

    state.tables.milling_batches[0].status = 'Cancelled';
    await expect(packingService.updateRun(BATCH, run.id, { bags_count: 15 }, fresh(OWNER))).rejects.toMatchObject({ statusCode: 403 });
    await expect(packingService.deleteRun(BATCH, run.id, fresh(MANAGER))).rejects.toMatchObject({ statusCode: 403 });
    await expect(packingService.setPackSpec(BATCH, { pack_bag_size_kg: 25 }, fresh(OWNER))).rejects.toMatchObject({ statusCode: 403 });
    // New runs on a cancelled batch are refused too.
    await expect(packingService.pack(BATCH, { bag_item_id: PP25, bags_count: 1 }, 1)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('history tells the UI what this user may do', async () => {
    seed({ yielded: true });
    const asOp = await packingService.history(BATCH, fresh(OPERATOR));
    expect(asOp.access.runs.allowed).toBe(false);
    expect(asOp.access.runs.reason).toMatch(/only an Owner or Mill Manager/);
    const asMgr = await packingService.history(BATCH, fresh(MANAGER));
    expect(asMgr.access.runs.allowed).toBe(true);
    expect(asMgr.access.spec.allowed).toBe(true);
  });
});

// ── 5. Packing spec: override > order line > none ──────────────────────────
describe('the batch packing spec', () => {
  const order = { id: 77, order_no: 'EX-004', packing_type: 'retail', bag_size_kg: 2, bag_type: 'PP', master_bag_size_kg: 10 };
  const lines = [
    { id: 1, line_no: 1, product_id: 4, bag_size_kg: 2, bag_type: 'PP', master_bag_size_kg: 10 },
    { id: 2, line_no: 2, product_id: 5, bag_size_kg: 5, bag_type: 'Jute', master_bag_size_kg: 20 },
  ];

  it('resolution order', () => {
    const batch = { product_id: 5 };
    expect(effectivePackSpec({ batch, order, lines })).toMatchObject({
      source: 'order_line', bagSizeKg: 5, bagType: 'Jute', masterBagSizeKg: 20, lineNo: 2, label: 'from EX-004 line 2',
    });
    expect(effectivePackSpec({ batch: { ...batch, pack_bag_size_kg: '25.00', pack_bag_type: 'P.P. bag' }, order, lines })).toMatchObject({
      source: 'override', bagSizeKg: 25, bagType: 'P.P. bag', masterBagSizeKg: null, label: 'Batch override',
    });
    expect(effectivePackSpec({ batch })).toMatchObject({ source: 'none', active: false, bagSizeKg: null });
    // Single-line order: its line.
    expect(effectivePackSpec({ batch, order, lines: [lines[0]] })).toMatchObject({ source: 'order_line', bagSizeKg: 2, lineNo: 1 });
    // No lines: the header.
    expect(effectivePackSpec({ batch, order, lines: [] })).toMatchObject({ source: 'order', bagSizeKg: 2, label: 'from EX-004' });
    // Jumbo and container.
    expect(effectivePackSpec({ batch, order: { ...order, packing_type: 'jumbo' }, lines: [] })).toMatchObject({ bagSizeKg: 1200 });
    expect(effectivePackSpec({ batch, order: { ...order, packing_type: 'container' }, lines: [] })).toMatchObject({ active: true, bagSizeKg: null, packingType: 'container' });
  });

  it('the outputs pack into the override at yield (no packing run)', async () => {
    seed({ yielded: true, exportOrder: true, kattaStock: 0 });
    state.tables.milling_batches[0].pack_bag_size_kg = 10;
    expect((await resolveBatchPackSpec(fakeDb, BATCH)).source).toBe('override');
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    const lot = state.tables.inventory_lots.find((l) => l.id === 501);
    expect([lot.total_bags, lot.bag_size_kg]).toEqual([250, 10]);
  });

  it('without an override the outputs follow the order line for the batch product', async () => {
    seed({ yielded: true, exportOrder: true, kattaStock: 0 });
    state.tables.export_order_items = [
      { id: 1, order_id: 77, line_no: 1, product_id: 4, bag_size_kg: 2 },
      { id: 2, order_id: 77, line_no: 2, product_id: 5, bag_size_kg: 5 },
    ];
    expect(await resolveBatchPackSpec(fakeDb, BATCH)).toMatchObject({ source: 'order_line', lineNo: 2, label: 'from EXP-T line 2' });
    await inventoryService.reconcileBatchKatta(fakeDb, BATCH, 1);
    const lot = state.tables.inventory_lots.find((l) => l.id === 501);
    expect([lot.total_bags, lot.bag_size_kg]).toEqual([500, 5]);
  });

  it('setPackSpec saves / clears the override and re-stamps a yielded batch', async () => {
    seed({ yielded: true, kattaStock: 0 });
    await expect(packingService.setPackSpec(BATCH, { pack_bag_size_kg: 25 }, fresh(OPERATOR))).rejects.toMatchObject({ statusCode: 403 });
    const res = await packingService.setPackSpec(BATCH, { pack_bag_size_kg: 25, pack_bag_type: ' P.P. bag ', pack_master_bag_size_kg: null }, fresh(MANAGER));
    expect(res.packSpec).toMatchObject({ source: 'override', bagSizeKg: 25, bagType: 'P.P. bag' });
    expect(state.tables.milling_batches[0].pack_bag_size_kg).toBe(25);
    expect(state.tables.inventory_lots.find((l) => l.id === 501).bag_size_kg).toBe(25);
    const cleared = await packingService.setPackSpec(BATCH, { pack_bag_size_kg: null }, fresh(OWNER));
    expect(cleared.packSpec.source).toBe('none');
    expect(state.tables.milling_batches[0].pack_bag_size_kg).toBeNull();
    await expect(packingService.setPackSpec(BATCH, { pack_bag_size_kg: null, pack_bag_type: 'PP' }, fresh(OWNER)))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
