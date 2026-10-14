/**
 * Route-permission inventory (P1-18): every mutating route (POST / PUT / PATCH /
 * DELETE) under /api carries an authorize-family guard — authorize,
 * authorizeAny, authorizeRole or retired — on the route itself or on its
 * router before it. The guards are recognised by the `authz` tag rbac.js and
 * retired.js put on them. The exceptions below are routes that are public by
 * design or check access themselves; each says why. A new unguarded write
 * fails this test with its method and path.
 *
 * Also pins the gates P1-14 / P1-18 moved from role lists to permissions, so
 * the matrix in Admin › Permissions is what is enforced.
 */
jest.mock('../config', () => ({ port: 3001, corsOrigin: '*', jwtSecret: 'FAKE-test-secret-1', db: {} }));

// Express 5 layers keep only a matcher, not the mount string: record the path
// each router.use(path, …) mounts at, before the route files load.
const Router = require('express').Router;
const origUse = Router.prototype.use;
Router.prototype.use = function use(...args) {
  const before = this.stack.length;
  const out = origUse.apply(this, args);
  if (typeof args[0] === 'string') for (const l of this.stack.slice(before)) l.__mount = args[0];
  return out;
};
const routes = require('../routes');
Router.prototype.use = origUse;

const MUTATING = ['post', 'put', 'patch', 'delete'];
const mountOf = (layer) => (layer.__mount && layer.__mount !== '/' ? layer.__mount : '');

function walk(router, prefix = '', inherited = null, out = []) {
  let guard = inherited;
  for (const layer of router.stack) {
    if (layer.route) {
      const own = layer.route.stack.map((s) => s.handle && s.handle.authz).find(Boolean);
      for (const m of Object.keys(layer.route.methods)) {
        out.push({ method: m, path: `${prefix}${layer.route.path}`, authz: own || guard });
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle, `${prefix}${mountOf(layer)}`, guard, out);
    } else if (layer.handle && layer.handle.authz) {
      guard = layer.handle.authz; // router.use(authorize(...)) guards what follows
    }
  }
  return out;
}

// Public by design, or the handler checks access itself.
const EXCEPTIONS = [
  [/^\/auth\//, 'login / logout / password flows — authenticated by the auth module itself'],
  [/^\/portal\//, 'employee self-service portal — own CNIC + PIN auth'],
  [/^\/chat\//, 'team chat — any signed-in user; the service checks participants'],
  [/^\/enterprise\/preferences$/, "a user's own UI preferences"],
  [/^\/users\/me\b|^\/users\/change-password$/, "a user's own profile / password"],
  [/^\/sync\/(push|pull|register|heartbeat|ack|bootstrap|conflicts$)/, 'offline sync — device-bound; per-domain permission checked in the handler (userHasPermission)'],
  [/^\/communication\/(comments|tasks|follow-ups|notifications)/, "per-user collaboration — a user's own comments, tasks, follow-ups, notifications"],
  [/^\/communication\/whatsapp\/preview$/, 'renders a template preview; sends nothing, writes nothing'],
  [/^\/finance\/fund-transfers\/:id\/accept$/, 'authorizeTransferAccept: receiving side needs confirm_payment (HO) or milling.edit (Mill), checked per transfer'],
  [/^\/finance\/internal-transfers$/, 'retired in the controller (410 Gone)'],
  // KNOWN OPEN — owned by the portal + uploads remediation task, not P1-18:
  [/^\/smart\/mobile\/upload$/, 'any signed-in user may upload a mobile photo/file (uploads task)'],
  [/^\/communication\/whatsapp\/(link|unlink|session)/, "a user's own WhatsApp session"],
  [/^\/ai\//, 'AI assistant — role / permission checks inside the module'],
];
const exempt = (r) => EXCEPTIONS.find(([re]) => re.test(r.path));

describe('every mutating route is guarded', () => {
  const all = walk(routes);

  it('finds the routes (the walker still understands the router tree)', () => {
    expect(all.length).toBeGreaterThan(500);
    expect(all.find((r) => r.method === 'post' && r.path === '/finance/payments')).toBeDefined();
  });

  it('has an authorize-family guard or a listed exception', () => {
    const unguarded = all
      .filter((r) => MUTATING.includes(r.method) && !r.authz && !exempt(r))
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(unguarded).toEqual([]);
  });
});

describe('gates moved from role lists to permissions (behaviour-preserving)', () => {
  const all = walk(routes);
  const gate = (method, path) => (all.find((r) => r.method === method && r.path === path) || {}).authz;

  test.each([
    ['post', '/inventory/adjust', 'inventory', 'approve_write_off'],
    ['put', '/lot-inventory/adjustments/:id/approve', 'inventory', 'approve_write_off'],
    ['put', '/lot-inventory/adjustments/:id/reject', 'inventory', 'approve_write_off'],
    ['put', '/control/stock-counts/:id/approve', 'inventory', 'approve_write_off'],
    ['put', '/mill-store/items/:id/stock', 'mill_store', 'approve_adjustment'],
    ['put', '/mill-store/adjustments/:id/approve', 'mill_store', 'approve_adjustment'],
    ['put', '/mill-store/adjustments/:id/reject', 'mill_store', 'approve_adjustment'],
    ['delete', '/milling/batches/:id', 'milling', 'delete'],
    ['post', '/documents/upload', 'documents', 'upload'],
    ['put', '/documents/:id/reject', 'documents', 'reject'],
    ['post', '/finance/payments/:id/reverse', 'finance', 'reverse_payment'],
    ['post', '/finance/fx-rates', 'finance', 'set_rates'],
    ['post', '/finance/commodity-rates', 'finance', 'set_rates'],
    ['post', '/finance/suspense/:id/review', 'finance', 'confirm_payment'],
    ['delete', '/customers/:id', 'admin', 'manage_master_data'],
  ])('%s %s → %s.%s', (method, path, module, action) => {
    expect(gate(method, path)).toEqual({ kind: 'authorize', perms: [[module, action]] });
  });

  it('expense vendors list is finance.view OR milling.view (FIN-25)', () => {
    expect(gate('get', '/expense-vendors/')).toEqual({ kind: 'authorizeAny', perms: [['finance', 'view'], ['milling', 'view']] });
  });

  it('write-off gates are no longer hard-coded role lists', () => {
    const roleGated = all.filter((r) => r.authz && r.authz.kind === 'authorizeRole').map((r) => `${r.method} ${r.path}`);
    for (const p of ['post /inventory/adjust', 'put /control/stock-counts/:id/approve', 'put /mill-store/items/:id/stock', 'delete /milling/batches/:id']) {
      expect(roleGated).not.toContain(p);
    }
  });
});
