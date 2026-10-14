/**
 * P1-12 — the 2026-10-05 "hide cost" decision on every inventory / milling /
 * export endpoint that returns stock money (INV-06, INV-16, INV-43, MIL-39,
 * EXP-31).
 *
 * A role-by-endpoint matrix: each endpoint's REAL route stack (router-level
 * middleware included, the way Express runs it) and REAL controller run against
 * a fake database whose rows carry cost. For a cost-blind role (QC Analyst,
 * Inventory Officer) the response must hold no non-null cost key; for a
 * cost-seeing role (Mill Manager, Owner) the same response still carries the
 * figures — so the matrix proves the fixture really has cost in it.
 * The cost-CHANGING routes answer 403 to the cost-blind roles.
 */

// ── Fake database: every query resolves to the rows registered for its table.
jest.mock('../config/database', () => {
  let rows = {};
  const builder = (table) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(rows[table] || []).then(res, rej);
        if (prop === 'first') return async () => (rows[table] || [])[0];
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(String(table).split(' ')[0]);
  db.raw = (x) => x;
  db.fn = { now: () => 'now()' };
  db.schema = { hasTable: async () => false, hasColumn: async () => false };
  db.transaction = async (fn) => fn(db);
  db.__set = (r) => { rows = r; };
  return db;
});

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

// Audit writes are not under test here.
jest.mock('../middleware/audit', () => () => (req, res, next) => next());

const db = require('../config/database');
const { isCostKey, requireCostVisibility } = require('../utils/costVisibility');

const ROLES = {
  qcAnalyst: { role: 'QC Analyst', permissions: new Set(['milling.view', 'milling.approve_quality', 'inventory.view', 'mill_store.view', 'export_orders.view']) },
  inventoryOfficer: { role: 'Inventory Officer', permissions: new Set(['inventory.view', 'inventory.edit', 'inventory.create', 'milling.view', 'mill_store.view']) },
  millManager: { role: 'Mill Manager', permissions: new Set(['milling.view', 'inventory.view', 'reports.view', 'reports.view_cost', 'reports.view_profit']) },
  owner: { role: 'Owner', permissions: new Set() },
};
const COST_BLIND = ['qcAnalyst', 'inventoryOfficer'];
const COST_SEEING = ['millManager', 'owner'];

const reqAs = (who, extra = {}) => ({
  user: { id: 7, role_id: 3, _roleName: ROLES[who].role, ...ROLES[who] },
  params: { id: '3' }, query: {}, body: {}, headers: {}, ...extra,
});

// Payload keys whose whole object is money though its own keys are bare names.
const MONEY_OBJECTS = new Set(['lastPrices']);

// Every non-null cost key anywhere in a payload, as dotted paths.
function costKeys(node, path = '') {
  if (Array.isArray(node)) return node.flatMap((x, i) => costKeys(x, `${path}[${i}]`));
  if (!node || typeof node !== 'object' || node instanceof Date) return [];
  return Object.entries(node).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    if (MONEY_OBJECTS.has(k) && v != null) return [p];
    if (isCostKey(k) && v != null && typeof v !== 'object') return [p];
    return costKeys(v, p);
  });
}

// Run a route the way Express would: the router-level middleware registered
// before it (router.use), then the route's own chain. Resolves on the response.
function runRoute(router, method, path, req) {
  const idx = router.stack.findIndex((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (idx < 0) throw new Error(`no ${method.toUpperCase()} ${path}`);
  const handlers = [
    ...router.stack.slice(0, idx).filter((l) => !l.route).map((l) => l.handle),
    ...router.stack[idx].route.stack.map((s) => s.handle),
  ];
  return new Promise((resolve, reject) => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; resolve(r); return r; };
    r.set = () => r; r.setHeader = () => r;
    let i = 0;
    const next = (err) => {
      if (err) { reject(err); return; }
      const h = handlers[i++];
      if (!h) { resolve(r); return; }
      try {
        const p = h(req, r, next);
        if (p && typeof p.catch === 'function') p.catch(reject);
      } catch (e) { reject(e); }
    };
    next();
  });
}

const lot = () => ({
  id: 3, lot_no: 'LOT-3', item_name: 'Super Basmati', type: 'raw', entity: 'mill', warehouse_id: 1,
  net_weight_kg: 1000, available_qty: 800, qty: 1000, reserved_qty: 0, status: 'Available',
  rate_per_kg: 120, landed_cost_per_kg: 125, landed_cost_total: 125000, purchase_amount: 120000,
  total_value: 100000, cost_per_unit: 120, transport_cost: 5000, paid_amount: 1, due_amount: 2,
  commission_total: 300, total_bag_cost: 40, raw_cost_component: 9, milling_cost_component: 8,
  rate_input_value: 6000, cost_incomplete: false, bag_cost_included: true,
});

const FIXTURE = () => ({
  inventory_lots: [lot()],
  lot_transactions: [{ id: 1, lot_id: 3, movement_type: 'purchase_in', qty: 1000, cost_per_unit: 120, total_cost: 120000, unit_cost: 120, rate_per_kg: 120 }],
  inventory_reservations: [{ id: 1, lot_id: 3, qty: 10, order_no: 'EX-1' }],
  stock_adjustments: [{ id: 1, lot_id: 3, quantity_kg: -5, unit_cost: 125, total_cost_impact: -625, approval_status: 'Pending' }],
  utility_consumption: [{ id: 1, utility_type: 'electricity', consumption: 100, rate_per_unit: 50, total_cost: 5000 }],
  milling_batches: [{
    id: 3, batch_no: 'M-3', actual_finished_kg: 600, finished_price_per_kg: 180, b1_price_per_kg: 90,
    broken_price_per_kg: 80, bran_price_per_kg: 20, husk_price_per_kg: 5, prices_confirmed: true,
  }],
  milling_batch_packaging: [{ id: 1, batch_id: 3, mill_item_id: 4, direction: 'consumed', quantity: 10, unit_cost_pkr: 55, total_cost_pkr: 550, current_cost: 60, pack_type: 'katta' }],
  mill_packing_logs: [{ id: 1, batch_id: 3, bags_count: 10, packed_weight_kg: 500, cost_per_bag: 55, total_cost: 550, master_cost: 0, poly_cost: 0 }],
  warehouses: [{ id: 1, name: 'Main' }],
});

describe('P1-12 role × endpoint matrix — no cost keys for cost-blind roles', () => {
  const inventoryRoutes = require('../modules/inventory/inventory.routes');
  const lotRoutes = require('../modules/inventory/lotInventory.routes');
  const millingRoutes = require('../modules/milling/milling.routes');
  const routers = { inventory: inventoryRoutes, 'lot-inventory': lotRoutes, milling: millingRoutes };

  const ENDPOINTS = [
    ['inventory', 'get', '/'],
    ['inventory', 'get', '/summary'],
    ['inventory', 'get', '/lots/:id'],
    ['inventory', 'get', '/lots/:id/movements'],
    ['inventory', 'get', '/movements'],
    ['inventory', 'get', '/reservations'],
    ['lot-inventory', 'get', '/adjustments'],
    ['lot-inventory', 'get', '/lots'],
    ['milling', 'get', '/utilities'],
    ['milling', 'get', '/last-prices'],
    ['milling', 'get', '/batches/:id/packaging'],
    ['milling', 'get', '/batches/:id/packing'],
  ];

  // Cost-seeing roles: the fixture's cost comes through (except summary,
  // which aggregates in SQL — the fake returns raw rows, so it still has cost).
  const cases = [];
  for (const [name, method, path] of ENDPOINTS) {
    for (const who of [...COST_BLIND, ...COST_SEEING]) cases.push([name, method, path, who]);
  }

  test.each(cases)('/api/%s %s %s as %s', async (name, method, path, who) => {
    db.__set(FIXTURE());
    const r = await runRoute(routers[name], method, path, reqAs(who));
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ success: true });
    const leaked = costKeys(r.body);
    if (COST_BLIND.includes(who)) expect(leaked).toEqual([]);
    // Reservations carry no money at all; everything else must still show it.
    else if (path !== '/reservations') expect(leaked.length).toBeGreaterThan(0);
  });

  test('quantities survive redaction (AppContext inventory list stays usable)', async () => {
    db.__set(FIXTURE());
    const r = await runRoute(inventoryRoutes, 'get', '/', reqAs('qcAnalyst'));
    expect(r.body.data.lots[0]).toMatchObject({
      lot_no: 'LOT-3', net_weight_kg: 1000, available_qty: 800, rate_per_kg: null, landed_cost_per_kg: null,
      cost_incomplete: false, bag_cost_included: true,
    });
  });
});

describe('P1-12 cost-changing routes carry requireCostVisibility', () => {
  const lotRoutes = require('../modules/inventory/lotInventory.routes');
  const millingRoutes = require('../modules/milling/milling.routes');
  const routers = { 'lot-inventory': lotRoutes, milling: millingRoutes };

  test.each([
    ['lot-inventory', 'post', '/lots/:id/add-purchase'],
    ['milling', 'put', '/batches/:id/prices'],
  ])('/api/%s %s %s', (name, method, path) => {
    const layer = routers[name].stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    expect(layer.route.stack.map((s) => s.handle)).toContain(requireCostVisibility);
  });

  test.each(COST_BLIND)('Add Purchase answers 403 to %s before the controller', async (who) => {
    db.__set(FIXTURE());
    const r = await runRoute(lotRoutes, 'post', '/lots/:id/add-purchase',
      reqAs(who, { body: { quantity_input: 100, rate_input: 120 } }));
    expect(r.statusCode).toBe(403);
  });

  test.each(COST_BLIND)('Confirm Prices answers 403 to %s', async (who) => {
    db.__set(FIXTURE());
    const r = await runRoute(millingRoutes, 'put', '/batches/:id/prices', reqAs(who, { body: { b1_price_per_kg: 90 } }));
    expect(r.statusCode).toBe(403);
  });

  test('Edit Received validates its body (Joi) and stays open to cost-blind roles', async () => {
    const layer = lotRoutes.stack.find((l) => l.route && l.route.path === '/lots/:id/received-qty');
    expect(layer.route.stack.map((s) => s.handle)).not.toContain(requireCostVisibility);
    db.__set(FIXTURE());
    const bad = await runRoute(lotRoutes, 'put', '/lots/:id/received-qty',
      reqAs('inventoryOfficer', { body: { received_net_weight_kg: -1 } }));
    expect(bad.statusCode).toBe(400);
  });
});

describe('P1-12 batch packaging — a cost-blind save never re-prices a line', () => {
  const ctrl = require('../modules/milling/batchPackaging.controller');
  const service = require('../modules/milling/batchPackaging.service');

  test.each([
    ['qcAnalyst', [{ mill_item_id: 4, direction: 'consumed', quantity: 12, unit_cost_pkr: 55 }, { mill_item_id: 9, direction: 'consumed', quantity: 2 }]],
    ['millManager', [{ mill_item_id: 4, direction: 'consumed', quantity: 12, unit_cost_pkr: 1 }, { mill_item_id: 9, direction: 'consumed', quantity: 2, unit_cost_pkr: 3 }]],
  ])('%s', async (who, expected) => {
    db.__set({ milling_batch_packaging: [{ mill_item_id: 4, direction: 'consumed', output_type: null, unit_cost_pkr: '55' }] });
    const save = jest.spyOn(service, 'save').mockResolvedValue([]);
    jest.spyOn(service, 'costAdjustments').mockResolvedValue({});
    const req = reqAs(who, {
      body: { lines: [
        { mill_item_id: 4, direction: 'consumed', quantity: 12, unit_cost_pkr: 1 }, // existing line
        { mill_item_id: 9, direction: 'consumed', quantity: 2, unit_cost_pkr: 3 }, // new line
      ] },
    });
    const r = { json: jest.fn() };
    await ctrl.save(req, r, (e) => { throw e; });
    expect(save.mock.calls[0][1]).toEqual(expected);
    save.mockRestore();
  });
});

describe('P1-12 GET /export-orders/:id — lot and batch cost hidden from cost-blind roles (EXP-31)', () => {
  const ctrl = require('../modules/exportOrders/exportOrders.controller');
  const orderFixture = () => ({
    ...FIXTURE(),
    export_orders: [{ id: 3, order_no: 'EX-3', status: 'Draft', price_per_mt: 900, contract_value: 9000 }],
    inventory_lots: [{ ...lot(), reserved_against: 'EX-3' }],
    lot_transactions: [],
  });
  const run = async (who) => {
    db.__set(orderFixture());
    const r = { statusCode: 200, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    await ctrl.getById(reqAs(who), r);
    return r;
  };

  test.each(COST_BLIND)('%s: purchase lots + milling batch carry no cost; the contract price stays', async (who) => {
    const r = await run(who);
    expect(r.statusCode).toBe(200);
    const { purchaseLots, millingBatch, order } = r.body.data;
    expect(purchaseLots.length).toBeGreaterThan(0);
    expect(costKeys({ purchaseLots, millingBatch })).toEqual([]);
    expect(purchaseLots[0]).toMatchObject({ lot_no: 'LOT-3', net_weight_kg: 1000 });
    expect(order.price_per_mt).toBe(900);
  });

  test.each(COST_SEEING)('%s still sees lot cost', async (who) => {
    const r = await run(who);
    expect(r.body.data.purchaseLots[0].landed_cost_per_kg).toBe(125);
    expect(r.body.data.millingBatch.finished_price_per_kg).toBe(180);
  });
});
