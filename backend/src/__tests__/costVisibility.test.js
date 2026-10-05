/**
 * Cost visibility (owner decision 2026-10-05): purchase rates, stock value/cost
 * and profit are hidden from the Mill Operator and the QC Analyst; everyone
 * holding reports.view_cost (or finance.view) keeps them.
 *
 * Executes the real redaction helper, the real requireCostVisibility guard, the
 * real route chains (authorize() tagged, as paymentCorrectness.test.js does) and
 * a real lot controller against a fake database.
 */

// ── Fake database: every query resolves to the rows registered for its table.
jest.mock('../config/database', () => {
  let rows = {};
  const updates = [];
  const builder = (table) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(rows[table] || []).then(res, rej);
        if (prop === 'first') return async () => (rows[table] || [])[0];
        if (prop === 'update') return (data) => { updates.push({ table, data }); return b; };
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(String(table).split(' ')[0]);
  db.raw = (x) => x;
  db.fn = { now: () => 'now()' };
  db.schema = { hasTable: async () => false };
  db.__set = (r) => { rows = r; updates.length = 0; };
  db.__updates = updates;
  return db;
});

// ── RBAC: authorize() guards carry their permission tag and pass; the
// programmatic check reads a Set on req.user, with the Owner / Super Admin
// bypass the real userHasPermission applies.
jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  const userHasPermission = async (req, module, action) => {
    if (['Owner', 'Super Admin'].includes(req.user?.role)) return true;
    return !!req.user?.permissions?.has(`${module}.${action}`);
  };
  return Object.assign(authorize, {
    authorize, authorizeAny: passThrough, authorizeRole: passThrough, denyRoles: passThrough,
    userHasPermission, getScopedWarehouseIds: async () => null,
  });
});

const db = require('../config/database');
const { redactMoney, redactForUser, requireCostVisibility, canSeeCost } = require('../utils/costVisibility');

// What each role holds after migrations 008 / 200 / 222.
const ROLES = {
  millOperator: { role: 'Mill Operator', permissions: new Set(['reports.view', 'milling.view', 'inventory.view', 'milling.record_yield']) },
  qcAnalyst: { role: 'QC Analyst', permissions: new Set(['milling.view', 'milling.approve_quality', 'inventory.view']) },
  millManager: { role: 'Mill Manager', permissions: new Set(['milling.view', 'inventory.view', 'reports.view', 'reports.view_cost', 'reports.view_profit']) },
  financeManager: { role: 'Finance Manager', permissions: new Set(['finance.view', 'reports.view']) },
  owner: { role: 'Owner', permissions: new Set() },
};
const reqAs = (who, extra = {}) => ({ user: { id: 7, ...ROLES[who] }, params: {}, query: {}, ...extra });

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const lotRow = () => ({
  id: 3, lot_no: 'LOT-3', net_weight_kg: 1000, available_qty: 800,
  rate_per_kg: 120, landed_cost_per_kg: 125, landed_cost_total: 125000, purchase_amount: 120000,
  total_value: 100000, cost_per_unit: 120, transport_cost: 5000, paid_amount: 1, due_amount: 2,
  cost_incomplete: false, bag_cost_included: true,
  quality_json: { moisture: 12, price_per_mt: 120000 },
});

describe('redaction helper', () => {
  test('strips cost keys in snake_case and camelCase, keeps quantities and flags', () => {
    const data = {
      lots: [lotRow()],
      grand: { totalKg: 1000, valuePkr: 125000, perKg: 125, landedCostPerKg: 125 },
      rows: [{ name: 'x', costPerKg: 9, unitCostPkr: 3, totalKg: 10 }],
    };
    redactMoney(data, { cost: false, profit: true });
    const lot = data.lots[0];
    for (const k of ['rate_per_kg', 'landed_cost_per_kg', 'landed_cost_total', 'purchase_amount', 'total_value', 'cost_per_unit', 'transport_cost', 'paid_amount', 'due_amount']) {
      expect(lot[k]).toBeNull();
    }
    expect(lot.quality_json).toEqual({ moisture: 12, price_per_mt: null });
    expect(lot).toMatchObject({ net_weight_kg: 1000, available_qty: 800, cost_incomplete: false, bag_cost_included: true, lot_no: 'LOT-3' });
    expect(data.grand).toEqual({ totalKg: 1000, valuePkr: null, perKg: null, landedCostPerKg: null });
    expect(data.rows[0]).toEqual({ name: 'x', costPerKg: null, unitCostPkr: null, totalKg: 10 });
  });

  test('profit / margin keys follow view_profit independently', () => {
    const data = { profit_pkr: 5, realizedProfit: 6, marginPct: 7, margin_pct: 8, revenue: 9, totalKg: 1 };
    redactMoney(data, { cost: true, profit: false });
    expect(data).toEqual({ profit_pkr: null, realizedProfit: null, marginPct: null, margin_pct: null, revenue: null, totalKg: 1 });
  });

  test('extraCostKeys covers payload-specific money (e.g. stock valuation grandTotal)', () => {
    const data = { grandTotal: 10, byType: [{ totalValue: 4, totalQty: 2 }] };
    redactMoney(data, { cost: false, profit: false, extraCostKeys: ['grandTotal'] });
    expect(data).toEqual({ grandTotal: null, byType: [{ totalValue: null, totalQty: 2 }] });
  });

  test.each([
    ['millOperator', true],
    ['qcAnalyst', true],
    ['millManager', false],
    ['financeManager', false],
    ['owner', false],
  ])('redactForUser as %s → redacted=%s', async (who, redacted) => {
    const data = { lots: [lotRow()] };
    await redactForUser(reqAs(who), data);
    expect(data.lots[0].rate_per_kg === null).toBe(redacted);
    expect(data.lots[0].landed_cost_total === null).toBe(redacted);
    expect(data.lots[0].net_weight_kg).toBe(1000);
    expect(await canSeeCost(reqAs(who))).toBe(!redacted);
  });
});

describe('requireCostVisibility guard', () => {
  test.each([
    ['millOperator', 403],
    ['qcAnalyst', 403],
    ['millManager', 'next'],
    ['financeManager', 'next'],
    ['owner', 'next'],
  ])('%s → %s', async (who, expected) => {
    const r = res();
    const next = jest.fn();
    requireCostVisibility(reqAs(who), r, next);
    await new Promise((resolve) => setImmediate(resolve));
    if (expected === 'next') {
      expect(next).toHaveBeenCalledWith();
      expect(r.body).toBeNull();
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(r.statusCode).toBe(403);
      expect(r.body).toMatchObject({ success: false });
    }
  });
});

// Run a route's real middleware chain, in order, the way Express would.
async function runRoute(router, method, path, req) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`);
  const r = res();
  for (const s of layer.route.stack) {
    let advanced = false;
    await s.handle(req, r, () => { advanced = true; });
    // requireCostVisibility resolves asynchronously.
    await new Promise((resolve) => setImmediate(resolve));
    if (r.body) return r;
    if (!advanced) {
      // A handler that answered nothing and did not call next — stop.
      return r;
    }
  }
  return r;
}

describe('money-only routes are cost-gated', () => {
  const lotRoutes = require('../modules/inventory/lotInventory.routes');
  const millingRoutes = require('../modules/milling/milling.routes');

  const routers = { 'lot-inventory': lotRoutes, milling: millingRoutes };
  test.each([
    ['lot-inventory', 'get', '/valuation'],
    ['lot-inventory', 'get', '/lots/:id/purchase-invoice'],
    ['lot-inventory', 'get', '/valuation-history'],
    ['lot-inventory', 'post', '/valuation-snapshot'],
    ['milling', 'get', '/expenses'],
    ['milling', 'get', '/expenses/recurring'],
    ['milling', 'get', '/rice-purchases'],
  ])('/api/%s: %s %s carries requireCostVisibility', (name, method, path) => {
    const layer = routers[name].stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    expect(layer.route.stack.map((s) => s.handle)).toContain(requireCostVisibility);
  });

  test('GET /valuation answers 403 to the Mill Operator and never reaches the controller', async () => {
    db.__set({ inventory_lots: [lotRow()] });
    const r = await runRoute(lotRoutes, 'get', '/valuation', reqAs('millOperator'));
    expect(r.statusCode).toBe(403);
    expect(r.body.data).toBeUndefined();
  });

  test('GET /valuation answers the Mill Manager with the valuation', async () => {
    db.__set({ inventory_lots: [{ id: 3, lot_no: 'LOT-3', type: 'finished', available_qty: 800, cost_per_unit: 120 }] });
    const r = await runRoute(lotRoutes, 'get', '/valuation', reqAs('millManager'));
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.lots[0].cost_per_unit).toBe(120);
  });

  test('GET /expenses answers 403 to the QC Analyst', async () => {
    const r = await runRoute(millingRoutes, 'get', '/expenses', reqAs('qcAnalyst'));
    expect(r.statusCode).toBe(403);
  });
});

describe('lot endpoints redact for cost-blind roles', () => {
  const controller = require('../modules/inventory/lotInventory.controller');

  const txns = () => [{ id: 1, lot_id: 3, quantity_kg: -100, balance_kg: 900, rate_per_kg: 120, total_cost: 12000, unit_cost: 120, cost_impact: 12000 }];

  test('lot transactions: Mill Operator gets quantities, no rates or cost', async () => {
    db.__set({ lot_transactions: txns() });
    const r = res();
    await controller.getLotTransactions(reqAs('millOperator', { params: { id: '3' } }), r);
    const t = r.body.data.transactions[0];
    expect(t).toMatchObject({ quantity_kg: -100, balance_kg: 900, rate_per_kg: null, total_cost: null, unit_cost: null, cost_impact: null });
  });

  test('lot transactions: Mill Manager keeps the money', async () => {
    db.__set({ lot_transactions: txns() });
    const r = res();
    await controller.getLotTransactions(reqAs('millManager', { params: { id: '3' } }), r);
    expect(r.body.data.transactions[0]).toMatchObject({ rate_per_kg: 120, total_cost: 12000, cost_impact: 12000 });
  });

  test('lot list: list rows and derived rate equivalents are nulled for the QC Analyst', async () => {
    db.__set({ inventory_lots: [lotRow()], user_scopes: [] });
    const r = res();
    await controller.listLots(reqAs('qcAnalyst', { query: {} }), r);
    expect(r.statusCode).toBe(200);
    const lot = r.body.data.lots[0];
    expect(lot).toMatchObject({ rate_per_kg: null, rate_per_katta: null, landed_cost_per_maund: null, landed_cost_total: null, net_weight_kg: 1000 });
    expect(lot.total_katta).toBeGreaterThan(0);
  });

  test('stock report: total_value nulled for the Mill Operator, kept for the Owner', async () => {
    const rows = () => [{ group_name: 'Super', group_id: 1, total_kg: 1000, available_kg: 800, total_value: 125000 }];
    db.__set({ inventory_lots: rows(), user_scopes: [] });
    const op = res();
    await controller.getStockReport(reqAs('millOperator', { query: {} }), op);
    expect(op.body.data.report[0]).toMatchObject({ total_kg: 1000, total_value: null });

    db.__set({ inventory_lots: rows(), user_scopes: [] });
    const own = res();
    await controller.getStockReport(reqAs('owner', { query: {} }), own);
    expect(own.body.data.report[0].total_value).toBe(125000);
  });
});

describe('milling batch detail redacts for cost-blind roles', () => {
  const millingController = require('../modules/milling/milling.controller');

  const batchRows = () => ({
    milling_batches: [{
      id: 9, batch_no: 'M-009', status: 'Completed', raw_qty_kg: 10000, actual_finished_kg: 6500, yield_pct: 65,
      purchase_price_per_kg: 110, finished_price_per_kg: 190, b1_price_per_kg: 90, prices_confirmed: true,
      raw_cost_total: 1100000, raw_cost_per_kg_finished: 169.2, milling_cost_per_kg_finished: 12,
      total_cost_per_kg_finished: 181.2, manual_milling_cost_pkr: 78000, milling_fee_per_kg: 5,
      service_milling_rate_per_kg: 4, service_rental_rate_per_katta: 20,
    }],
    milling_quality_samples: [{ id: 1, analysis_type: 'arrival', moisture: 12, broken: 4, price_per_kg: 110, price_per_mt: 110000 }],
    milling_costs: [{ id: 1, category: 'raw_rice', amount: 1100000 }],
    milling_vehicle_arrivals: [{ id: 2, vehicle_no: 'LES-1', weight_kg: 10000, quality_json: { moisture: 12, price_per_kg: 110, price_per_mt: 110000 } }],
    mill_packing_logs: [{ bag_item_id: 4, bag_name: 'PP 25kg', bags_count: 260, total_cost: 5200, master_cost: 0, poly_cost: 0 }],
  });

  test('Mill Operator: quantities and quality stay, every cost, price and rate is nulled', async () => {
    db.__set(batchRows());
    const r = res();
    await millingController.getById(reqAs('millOperator', { params: { id: '9' } }), r);
    expect(r.statusCode).toBe(200);
    const d = r.body.data;
    expect(d.batch).toMatchObject({
      batch_no: 'M-009', raw_qty_kg: 10000, actual_finished_kg: 6500, yield_pct: 65, prices_confirmed: true,
      purchase_price_per_kg: null, finished_price_per_kg: null, b1_price_per_kg: null,
      raw_cost_total: null, total_cost_per_kg_finished: null, manual_milling_cost_pkr: null,
      milling_fee_per_kg: null, service_milling_rate_per_kg: null, service_rental_rate_per_katta: null,
    });
    expect(d.costs).toBeNull();
    expect(d.quality.arrival[0]).toMatchObject({ moisture: 12, broken: 4, price_per_kg: null, price_per_mt: null });
    expect(d.vehicles[0].quality_json).toEqual({ moisture: 12, price_per_kg: null, price_per_mt: null });
    expect(d.vehicles[0].weight_kg).toBe(10000);
  });

  test('Mill Manager: the same batch comes back with its money', async () => {
    db.__set(batchRows());
    const r = res();
    await millingController.getById(reqAs('millManager', { params: { id: '9' } }), r);
    const d = r.body.data;
    expect(d.batch).toMatchObject({ purchase_price_per_kg: 110, raw_cost_total: 1100000, total_cost_per_kg_finished: 181.2, service_milling_rate_per_kg: 4 });
    expect(d.costs).toEqual([{ id: 1, category: 'raw_rice', amount: 1100000 }]);
    expect(d.quality.arrival[0].price_per_mt).toBe(110000);
    expect(d.vehicles[0].quality_json.price_per_kg).toBe(110);
  });

  test('QC Analyst gets the batch list without costs or prices', async () => {
    db.__set(batchRows());
    const r = res();
    await millingController.list(reqAs('qcAnalyst', { query: {} }), r);
    if (r.statusCode !== 200) throw new Error(JSON.stringify(r.body));
    const b = r.body.data.batches[0];
    expect(b).toMatchObject({ batch_no: 'M-009', raw_qty_kg: 10000, purchase_price_per_kg: null, raw_cost_total: null });
  });
});

describe('a cost-blind re-save keeps the hidden price', () => {
  const controller = require('../modules/inventory/lotInventory.controller');
  const lot = () => ({ inventory_lots: [{ id: 3, lot_no: 'LOT-3', type: 'raw', quality_json: { moisture: 12, price_per_mt: 120000 } }] });

  test('lot quality saved by the QC Analyst without a price keeps the stored price', async () => {
    db.__set(lot());
    const r = res();
    await controller.updateLotQuality(reqAs('qcAnalyst', { params: { id: '3' }, body: { quality_json: { moisture: 13 } } }), r);
    expect(r.statusCode).toBe(200);
    const upd = db.__updates.find((u) => u.table === 'inventory_lots');
    expect(upd.data.quality_json).toEqual({ moisture: 13, price_per_mt: 120000 });
    // ...and the response still does not show it.
    expect(r.body.data.lot.quality_json.price_per_mt).toBeNull();
  });

  test('a Mill Manager clearing the price is honoured', async () => {
    db.__set(lot());
    const r = res();
    await controller.updateLotQuality(reqAs('millManager', { params: { id: '3' }, body: { quality_json: { moisture: 13 } } }), r);
    const upd = db.__updates.find((u) => u.table === 'inventory_lots');
    expect(upd.data.quality_json).toEqual({ moisture: 13 });
  });
});
