/**
 * P1-14 — payment reversal and rate-setting are their own permissions (split
 * from finance.confirm_payment by mig 339, granted to every holder of it), and
 * every rate change writes an audit row; suspense review is a write
 * (confirm_payment); deleting a customer through the legacy /api/customers
 * route needs admin.manage_master_data.
 */
jest.mock('../config/database', () => {
  const builder = () => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve([]).then(res, rej);
        if (prop === 'first') return async () => undefined;
        return () => b;
      },
    });
    return b;
  };
  const db = () => builder();
  db.raw = async () => ({ rows: [] });
  db.fn = { now: () => 'now()' };
  return db;
});
jest.mock('../services/auditService', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../services/fxRateService', () => ({
  addRate: jest.fn(async () => ({ id: 41, currency_code: 'USD', rate: 281 })),
  refreshCurrentFxValues: jest.fn(async () => ({ updated: 2 })),
  listRates: jest.fn(), getLatestRate: jest.fn(),
}));
jest.mock('../services/commodityRateService', () => ({
  upsertRate: jest.fn(async () => ({ id: 52, rate_type: 'paddy' })),
  listRates: jest.fn(), getCurrentRates: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const auditService = require('../services/auditService');
const finance = require('../modules/finance/finance.routes');
const customers = require('../routes/customers');

const layer = (router, method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
const guardOf = (router, method, p) => layer(router, method, p).route.stack.map((s) => s.handle.authz).find(Boolean);

describe('route gates', () => {
  test.each([
    [finance, 'post', '/payments/:id/reverse', [['finance', 'reverse_payment']]],
    [finance, 'post', '/fx-rates', [['finance', 'set_rates']]],
    [finance, 'post', '/fx-rates/refresh', [['finance', 'set_rates']]],
    [finance, 'post', '/commodity-rates', [['finance', 'set_rates']]],
    [finance, 'post', '/suspense/:id/review', [['finance', 'confirm_payment']]],
    [customers, 'delete', '/:id', [['admin', 'manage_master_data']]],
  ].map(([router, method, p, perms]) => [`${router === finance ? 'finance' : 'customers'} ${method.toUpperCase()} ${p}`, router, method, p, perms]))('%s', (_name, router, method, p, perms) => {
    expect(guardOf(router, method, p)).toEqual({ kind: 'authorize', perms });
  });

  test('clearing / bouncing a cheque and paying stay on confirm_payment', () => {
    expect(guardOf(finance, 'post', '/payments/:id/clear').perms).toEqual([['finance', 'confirm_payment']]);
    expect(guardOf(finance, 'post', '/payments/:id/bounce').perms).toEqual([['finance', 'confirm_payment']]);
  });
});

describe('rate changes are audited', () => {
  // Run the route chain after the permission guard: audit middleware + handler.
  async function run(p, body) {
    auditService.log.mockClear();
    const stack = layer(finance, 'post', p).route.stack.slice(1).map((s) => s.handle);
    const req = { body, params: {}, user: { id: 7 }, ip: '127.0.0.1' };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    for (const fn of stack) {
      let nextCalled = false;
      await fn(req, res, () => { nextCalled = true; });
      if (!nextCalled) break;
    }
    return res;
  }

  test.each([
    ['/fx-rates', { currency_code: 'USD', rate: 281, effective_date: '2026-10-15' }, 'set_fx_rate', 41],
    ['/commodity-rates', { rate_type: 'paddy', rate: 9000 }, 'set_commodity_rate', 52],
    ['/fx-rates/refresh', {}, 'refresh_fx_values', null],
  ])('%s writes an audit row', async (p, body, action, entityId) => {
    const res = await run(p, body);
    expect(res.body.success).toBe(true);
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log.mock.calls[0][0]).toMatchObject({ userId: 7, action, entityId });
  });
});

describe('migration 339', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../migrations/20261015_339_permission_matrix_split.js'), 'utf8');
  test('grants the split permissions to every confirm_payment holder', () => {
    expect(src).toMatch(/holders\(knex, 'finance', 'confirm_payment'\)/);
    expect(src).toMatch(/grant\(knex, ids\['finance\.reverse_payment'\], payers\)/);
    expect(src).toMatch(/grant\(knex, ids\['finance\.set_rates'\], payers\)/);
  });
  test('write-off approval is Owner + Super Admin only', () => {
    expect(src).toMatch(/ids\['inventory\.approve_write_off'\], await roleIdsByName\(knex, \['Owner', 'Super Admin'\]\)/);
  });
});
