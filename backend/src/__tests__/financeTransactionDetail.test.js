/**
 * Phase 3 read-only finance views: GET /finance/transactions/:kind/:id and
 * GET /finance/search sit behind finance.view (read only — they never write),
 * and the Reverse hint mirrors the conditions reversePayment enforces.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const authorizeAny = (...pairs) => {
    const guard = (req, res, next) => next();
    guard.anyOf = pairs.map(([m, a]) => `${m}.${a}`);
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  return Object.assign(authorize, {
    authorize, authorizeAny, authorizeRole: passThrough, denyRoles: passThrough,
    userHasPermission: async () => true, getScopedWarehouseIds: async () => null,
  });
});

const { reversalFor } = require('../modules/finance/transactionDetail');

describe('routes', () => {
  const router = require('../modules/finance/finance.routes');
  const stackOf = (method, path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    return layer ? layer.route.stack.map((s) => s.handle) : null;
  };

  test.each(['/transactions/:kind/:id', '/search'])('GET %s is finance.view and nothing looser', (path) => {
    const stack = stackOf('get', path);
    expect(stack).not.toBeNull();
    expect(stack.map((h) => h.permission).filter(Boolean)).toEqual(['finance.view']);
    expect(stack.some((h) => h.anyOf)).toBe(false);
  });

  test('attaching a document to a payment is finance.confirm_payment (the upload\'s own guard)', () => {
    const stack = stackOf('put', '/payments/:id/attachment');
    expect(stack.map((h) => h.permission).filter(Boolean)).toEqual(['finance.confirm_payment']);
    expect(stack.some((h) => h.anyOf)).toBe(false);
  });

  test.each(['/transactions/:kind/:id', '/search'])('no write verb is registered on %s', (path) => {
    for (const verb of ['post', 'put', 'patch', 'delete']) expect(stackOf(verb, path)).toBeNull();
  });
});

describe('reversal hint mirrors reversePayment', () => {
  const base = { id: 1, payment_no: 'PAY-001', status: 'Completed' };
  const hint = (p, ctx = {}) => reversalFor({ ...base, ...p }, { receivable: null, hasAnyJournal: true, hasOwnPaymentJournal: true, ...ctx });

  test('a payment against a payable can be reversed', async () => {
    expect(await hint({ type: 'payment', linked_payable_id: 5 })).toEqual({ allowed: true, reason: null });
  });
  test('a receipt against a receivable can be reversed', async () => {
    expect((await hint({ type: 'receipt', linked_receivable_id: 9 })).allowed).toBe(true);
  });
  test('already reversed / pending / rejected cannot', async () => {
    expect((await hint({ type: 'payment', linked_payable_id: 5, status: 'Reversed' })).allowed).toBe(false);
    expect((await hint({ type: 'receipt', linked_receivable_id: 9, status: 'Pending Finance Confirmation' })).allowed).toBe(false);
    expect((await hint({ type: 'receipt', linked_receivable_id: 9, status: 'Rejected' })).allowed).toBe(false);
  });
  test('an export-order receipt is reversed from the order', async () => {
    const r = await hint({ type: 'receipt', linked_receivable_id: 9, source_table: 'export_orders', source_id: 3 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/export order/);
    const r2 = await hint({ type: 'receipt', linked_receivable_id: 9 }, { receivable: { order_id: 3 }, hasOwnPaymentJournal: false });
    expect(r2.allowed).toBe(false);
  });
  test('an old service-milling receipt with no journal is undone by voiding the invoice', async () => {
    const r = await hint({ type: 'receipt', service_invoice_id: 4 }, { hasAnyJournal: false });
    expect(r).toEqual({ allowed: false, reason: expect.stringMatching(/voiding its invoice/) });
  });
  test('a payment with nothing behind it cannot', async () => {
    expect((await hint({ type: 'payment' })).allowed).toBe(false);
  });
});
