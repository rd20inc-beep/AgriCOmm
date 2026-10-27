/**
 * The Mill Operator sees the mill's money (owner decision 2026-10-05):
 * "Mill operator should be able to enter prices, we expect mill operator to
 *  see everything regarding the mill."
 *
 * 1. Migration 314 EXECUTED against the in-memory knex: up() grants exactly
 *    reports.view_cost + reports.view_profit to the role named 'Mill Operator'
 *    (idempotent, other roles untouched); down() removes exactly those two.
 * 2. The real route stacks: the mill reports no longer carry the role deny,
 *    every company-finance report still does, and the mill cash account / batch
 *    profitability are permission-gated (requireCostVisibility) instead.
 */
jest.mock('../config/database', () => require('./helpers/memoryDb').db);

// authorize() guards carry their permission tag; denyRoles() guards carry the
// roles they deny, so the stacks can be read without a database.
jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  const authorizeAny = (...pairs) => {
    const guard = (req, res, next) => next();
    guard.anyOf = pairs.map(([m, a]) => `${m}.${a}`);
    return guard;
  };
  const denyRoles = (...roles) => {
    const guard = (req, res, next) => next();
    guard.deniedRoles = roles;
    return guard;
  };
  const userHasPermission = async (req, module, action) => {
    if (['Owner', 'Super Admin'].includes(req.user?.role)) return true;
    return !!req.user?.permissions?.has(`${module}.${action}`);
  };
  return Object.assign(authorize, {
    authorize, authorizeAny, authorizeRole: passThrough, denyRoles,
    userHasPermission, getScopedWarehouseIds: async () => null,
  });
});

const { db, state, reset } = require('./helpers/memoryDb');
const mig = require('../../migrations/20261005_314_mill_operator_sees_mill_money');
const { requireCostVisibility } = require('../utils/costVisibility');

describe('migration 314 — Mill Operator gains view_cost + view_profit', () => {
  const seed = () => reset({
    roles: [
      { id: 1, name: 'Mill Manager' },
      { id: 4, name: 'QC Analyst' },
      { id: 12, name: 'Mill Operator' },
    ],
    permissions: [
      { id: 10, module: 'reports', action: 'view' },
      { id: 20, module: 'reports', action: 'view_cost' },
      { id: 21, module: 'reports', action: 'view_profit' },
      { id: 30, module: 'finance', action: 'view' },
    ],
    role_permissions: [
      { id: 1, role_id: 12, permission_id: 10 },
      { id: 2, role_id: 1, permission_id: 20 },
      { id: 3, role_id: 1, permission_id: 21 },
    ],
  });
  const grantsOf = (roleId) => state.tables.role_permissions
    .filter((r) => r.role_id === roleId).map((r) => r.permission_id).sort((a, b) => a - b);

  test('up() grants exactly the two money permissions to the Mill Operator', async () => {
    seed();
    await mig.up(db);
    expect(grantsOf(12)).toEqual([10, 20, 21]);
    expect(grantsOf(4)).toEqual([]); // QC Analyst stays cost-blind
    expect(grantsOf(1)).toEqual([20, 21]); // others untouched
    expect(grantsOf(12)).not.toContain(30); // no finance.view
  });

  test('up() is idempotent — re-running adds no duplicate rows', async () => {
    seed();
    await mig.up(db);
    const n = state.tables.role_permissions.length;
    await mig.up(db);
    expect(state.tables.role_permissions.length).toBe(n);
  });

  test('down() removes exactly those two grants and nothing else', async () => {
    seed();
    await mig.up(db);
    await mig.down(db);
    expect(grantsOf(12)).toEqual([10]);
    expect(grantsOf(1)).toEqual([20, 21]);
    expect(state.tables.permissions).toHaveLength(4); // permissions themselves stay (mig 222 owns them)
  });

  test('a database without the role is a no-op', async () => {
    reset({ roles: [{ id: 1, name: 'Owner' }], permissions: [{ id: 20, module: 'reports', action: 'view_cost' }], role_permissions: [] });
    await mig.up(db);
    await mig.down(db);
    expect(state.tables.role_permissions).toEqual([]);
  });
});

function stackOf(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} ${path}`);
  return layer.route.stack.map((s) => s.handle);
}
const deniesOperator = (stack) => stack.some((h) => (h.deniedRoles || []).includes('Mill Operator'));

describe('reporting routes — mill reports opened, company finance still closed', () => {
  const reporting = require('../modules/analytics/reporting.routes');

  test.each([
    '/profitability/batches', '/profitability/batch-margin', '/lot-tracker', '/sales-tracker',
    '/supplier-ledger', '/supplier-ledger/:id', '/rice-type-ledger', '/rice-type-ledger/:id',
    '/warehouse-ledger', '/warehouse-ledger/:id', '/processing-loss-ledger', '/printable/purchase-ledger',
    '/sale-detail/:id',
  ])('GET %s: no Mill Operator deny, still reports.view', (path) => {
    const stack = stackOf(reporting, 'get', path);
    expect(deniesOperator(stack)).toBe(false);
    expect(stack.map((h) => h.permission)).toContain('reports.view');
  });

  // Company finance is reports.view_finance (mig 470), which the Mill Operator
  // (and Mill Manager) are not granted — no longer a role-name deny.
  test.each([
    ['get', '/scheduled-reports'], ['post', '/scheduled-reports'], ['delete', '/scheduled-reports/:id'], ['post', '/scheduled-reports/:id/run'],
    ['get', '/invoice-ledger'],
    ['get', '/executive/summary'], ['get', '/executive/pipeline'], ['get', '/executive/advance-funnel'],
    ['get', '/financial/receivable-recovery'], ['get', '/financial/payable-analysis'], ['get', '/financial/cash-forecast'], ['get', '/financial/fx-exposure'],
    ['get', '/printable/pnl'], ['get', '/printable/pnl-accrual'], ['get', '/printable/cashflow'],
    ['get', '/printable/ar-aging'], ['get', '/printable/ap-aging'], ['get', '/printable/sales-ledger'],
  ])('%s %s: still closed to the Mill Operator (reports.view_finance)', (method, path) => {
    expect(stackOf(reporting, method, path).map((h) => h.permission)).toContain('reports.view_finance');
  });

  // Payroll reports are payroll.view on top of reports.view — whoever runs
  // payroll (the Mill Manager) reads them; the Mill Operator holds no payroll.view.
  test.each(['/payroll-ledger', '/payroll-overview', '/payroll-pending', '/payroll-analytics'])('GET %s: payroll.view, not a finance report', (path) => {
    const perms = stackOf(reporting, 'get', path).map((h) => h.permission);
    expect(perms).toEqual(expect.arrayContaining(['reports.view', 'payroll.view']));
    expect(perms).not.toContain('reports.view_finance');
  });

  // Export profitability: the company finance reports OR the export desk
  // (export_orders.view) — the Mill roles hold neither; the Export Manager
  // keeps it without reports.view_finance (mig 471).
  test.each(['/profitability/orders', '/profitability/customers', '/profitability/countries', '/profitability/products', '/profitability/monthly-trend'])(
    'GET %s: reports.view_finance or export_orders.view', (path) => {
      const anyOf = stackOf(reporting, 'get', path).find((h) => h.anyOf);
      expect(anyOf.anyOf).toEqual(['reports.view_finance', 'export_orders.view']);
    });

  test.each(['/sales-tracker', '/sale-detail/:id', '/local-sales'])('GET %s: local-sale reports also need local_sales.view', (path) => {
    expect(stackOf(reporting, 'get', path).map((h) => h.permission)).toContain('local_sales.view');
  });
});

describe('milling routes — the mill cash account and batch profit', () => {
  const milling = require('../modules/milling/milling.routes');

  test.each(['/cash-flow', '/cost-trend', '/analytics/batch-profitability/:id', '/payables', '/receivables'])(
    'GET %s: no role deny; gated on cost visibility instead', (path) => {
      const stack = stackOf(milling, 'get', path);
      expect(deniesOperator(stack)).toBe(false);
      expect(stack).toContain(requireCostVisibility);
    });

  test('nothing in the milling router denies the Mill Operator by role any more', () => {
    for (const layer of milling.stack.filter((l) => l.route)) {
      expect(deniesOperator(layer.route.stack.map((s) => s.handle))).toBe(false);
    }
  });
});

describe('AI routes are unchanged — still closed to the Mill Operator', () => {
  const ai = require('../modules/ai/ai.routes');
  test.each([['post', '/query'], ['post', '/draft'], ['get', '/anomalies'], ['post', '/categorize-expense'], ['post', '/summarize-report']])(
    '%s %s', (method, path) => {
      expect(deniesOperator(stackOf(ai, method, path))).toBe(true);
    });
});

describe('requireCostVisibility now lets the Mill Operator through', () => {
  const run = async (user) => {
    const r = { statusCode: 200, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    const next = jest.fn();
    requireCostVisibility({ user }, r, next);
    await new Promise((resolve) => setImmediate(resolve));
    return { r, next };
  };

  test('Mill Operator after mig 314 → next()', async () => {
    const { next } = await run({ role: 'Mill Operator', permissions: new Set(['reports.view', 'milling.view', 'reports.view_cost', 'reports.view_profit']) });
    expect(next).toHaveBeenCalledWith();
  });

  test('QC Analyst → 403', async () => {
    const { r, next } = await run({ role: 'QC Analyst', permissions: new Set(['milling.view', 'inventory.view']) });
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
  });
});
