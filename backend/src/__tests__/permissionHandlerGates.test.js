/**
 * P1-18 — permissions that were granted but never checked, now enforced inside
 * a route chain: consuming mill stock past zero needs
 * mill_store.override_negative_stock; closing an export order needs
 * export_orders.close.
 */
let mockAllowed = new Set();
jest.mock('../middleware/rbac', () => {
  const tag = (authz) => { const g = (req, res, next) => next(); g.authz = authz; return g; };
  const authorize = (m, a) => tag({ kind: 'authorize', perms: [[m, a]] });
  authorize.authorize = authorize;
  authorize.authorizeAny = (...perms) => tag({ kind: 'authorizeAny', perms });
  authorize.authorizeRole = (...roles) => tag({ kind: 'authorizeRole', roles });
  authorize.denyRoles = (...roles) => tag({ kind: 'denyRoles', roles });
  authorize.userHasPermission = async (req, m, a) => mockAllowed.has(`${m}.${a}`);
  authorize.getScopedWarehouseIds = async () => null;
  return authorize;
});
jest.mock('../modules/millStore/consumption.service', () => ({ confirm: jest.fn(async () => ({ ok: true })) }));

const consumptionService = require('../modules/millStore/consumption.service');
const ctrl = require('../modules/millStore/consumption.controller');
const exportRoutes = require('../modules/exportOrders/exportOrders.routes');

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const LINES = [{ item_id: 1, quantity: 5 }];

describe('consumption past zero', () => {
  beforeEach(() => { consumptionService.confirm.mockClear(); mockAllowed = new Set(); });

  test('allow_negative without override_negative_stock is refused', async () => {
    const r = res();
    await ctrl.confirm({ params: { id: '3' }, body: { lines: LINES, allow_negative: true }, user: { id: 9 } }, r, jest.fn());
    expect(r.statusCode).toBe(403);
    expect(consumptionService.confirm).not.toHaveBeenCalled();
  });

  test('allow_negative with the permission goes through', async () => {
    mockAllowed = new Set(['mill_store.override_negative_stock']);
    const r = res();
    await ctrl.confirm({ params: { id: '3' }, body: { lines: LINES, allow_negative: true }, user: { id: 9 } }, r, jest.fn());
    expect(consumptionService.confirm).toHaveBeenCalledWith('3', LINES, 9, true);
  });

  test('normal consumption is unaffected', async () => {
    const r = res();
    await ctrl.confirm({ params: { id: '3' }, body: { lines: LINES }, user: { id: 9 } }, r, jest.fn());
    expect(consumptionService.confirm).toHaveBeenCalledWith('3', LINES, 9, false);
  });
});

describe('closing an export order', () => {
  const layer = exportRoutes.stack.find((l) => l.route && l.route.path === '/:id/status' && l.route.methods.put);
  const closeGuard = layer.route.stack[1].handle;

  test('status → Closed needs export_orders.close', async () => {
    mockAllowed = new Set(['export_orders.approve']);
    const r = res(); const next = jest.fn();
    await closeGuard({ body: { status: 'Closed' } }, r, next);
    expect(r.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    mockAllowed.add('export_orders.close');
    await closeGuard({ body: { status: 'Closed' } }, res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('other transitions need only the approve gate before it', async () => {
    mockAllowed = new Set();
    const next = jest.fn();
    await closeGuard({ body: { status: 'Shipped' } }, res(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(layer.route.stack[0].handle.authz).toEqual({ kind: 'authorize', perms: [['export_orders', 'approve']] });
  });
});
