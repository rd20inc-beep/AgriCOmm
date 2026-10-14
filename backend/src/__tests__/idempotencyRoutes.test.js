/**
 * P2-12 — the money-creating writes refuse a request without an
 * Idempotency-Key (requireIdempotencyKey on the route). Pins WHICH routes carry
 * the gate so a refactor cannot silently drop it.
 */
jest.mock('../config', () => ({ port: 3001, corsOrigin: '*', jwtSecret: 'FAKE-test-secret-1', db: {} }));

const { requireIdempotencyKey } = require('../middleware/idempotency');

function gated(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  return layer.route.stack.some((s) => s.handle === requireIdempotencyKey);
}

describe('money-creating routes require an Idempotency-Key', () => {
  test.each([
    ['../modules/localSales/localSales.routes', 'post', '/'],
    ['../modules/localSales/localSales.routes', 'post', '/:id/payments'],
    ['../modules/localSales/localSales.routes', 'post', '/group/:groupNo/payments'],
    ['../modules/expenses/expenses.routes', 'post', '/'],
    ['../modules/expenses/expenses.routes', 'put', '/:id/pay'],
    ['../modules/millStore/millStore.routes', 'post', '/purchases'],
    ['../modules/millStore/millStore.routes', 'put', '/purchases/:id/pay'],
    ['../modules/transportCosts/transportCosts.routes', 'post', '/'],
  ])('%s %s %s', (mod, method, path) => {
    expect(gated(require(mod), method, path)).toBe(true);
  });
});
