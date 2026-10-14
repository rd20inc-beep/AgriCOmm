/**
 * P1-15 — API-only write endpoints that bypassed the GL / stock / approval
 * engines answer 410 Gone, before any permission check or handler runs; the
 * public health check writes nothing and says almost nothing; approving a
 * generic approval-queue request no longer UPDATEs the target table; the
 * mill / benchmark masters copy only their own columns.
 */
jest.mock('../config/database', () => {
  const calls = [];
  const builder = (table) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve([]).then(res, rej);
        if (prop === 'first') return async () => (table === 'approval_queue'
          ? { id: 1, status: 'Pending', requested_by: 2, entity_type: 'journal_entry', entity_id: 9, proposed_data: { status: 'Draft' } }
          : undefined);
        if (prop === 'insert' || prop === 'update') return (data) => { calls.push({ table, op: prop, data }); return b; };
        if (prop === 'returning') return async () => [{ id: 1, table }];
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(String(table).split(' ')[0]);
  db.raw = async () => ({ rows: [] });
  db.fn = { now: () => 'now()' };
  db.schema = { hasTable: async () => true, hasColumn: async () => true };
  db.__calls = calls;
  return db;
});
jest.mock('../config', () => ({ port: 3001, corsOrigin: '*', jwtSecret: 'FAKE-test-secret-1', db: {} }));
jest.mock('../middleware/rateLimiter', () => ({ authLimiter: (q, r, n) => n(), apiLimiter: (q, r, n) => n() }));
jest.mock('../services/auditService', () => ({ log: async () => {} }));

const request = require('supertest');
const db = require('../config/database');
const routeLayer = (router, method, path) => router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);

const RETIRED = [
  ['routes/enterprise', 'post', '/imports'],
  ['routes/enterprise', 'post', '/bulk/status-update'],
  ['routes/enterprise', 'post', '/bulk/archive'],
  ['modules/inventory/inventory.routes', 'post', '/movements'],
  ['modules/milling/milling.routes', 'put', '/plans/:id/start'],
  ['modules/milling/milling.routes', 'post', '/reprocessing'],
  ['modules/milling/milling.routes', 'put', '/reprocessing/:id/complete'],
  ['modules/analytics/control.routes', 'post', '/approvals/submit'],
];

describe('retired endpoints answer 410 before anything else runs', () => {
  test.each(RETIRED)('%s %s %s', async (file, method, path) => {
    const router = require(`../${file}`);
    const layer = routeLayer(router, method, path);
    expect(layer).toBeDefined();
    const first = layer.route.stack[0].handle;
    expect(first.authz).toEqual({ kind: 'retired' });
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    first({ body: { file_path: '/etc/passwd' } }, res, jest.fn());
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ success: false, retired: true });
    expect(res.body.message).toEqual(expect.any(String));
  });
});

describe('public health check', () => {
  test('GET /api/enterprise/health is read-only and minimal', async () => {
    const app = require('../app')();
    db.__calls.length = 0;
    const res = await request(app).get('/api/enterprise/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['status', 'success', 'timestamp']);
    expect(db.__calls.filter((c) => c.table === 'system_health')).toEqual([]);
  });

  test('runAllChecks does not persist unless asked, and reports both memory checks', async () => {
    const health = require('../services/healthService');
    db.__calls.length = 0;
    const checks = await health.runAllChecks();
    expect(db.__calls.filter((c) => c.table === 'system_health')).toEqual([]);
    expect(checks.map((c) => c.checkType)).toEqual(expect.arrayContaining(['system_memory', 'memory']));
  });
});

describe('generic approval queue', () => {
  test('approving records the decision only — no UPDATE on the target table', async () => {
    const control = require('../modules/analytics/control.service');
    db.__calls.length = 0;
    await control.approveRequest(null, { approvalId: 1, approvedBy: 7 });
    const tables = db.__calls.filter((c) => c.op === 'update').map((c) => c.table);
    expect(tables).toEqual(['approval_queue']);
  });
});

describe('mill / benchmark master updates copy only their own columns', () => {
  const ctrl = require('../modules/milling/millingAdvanced.controller');
  const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

  test.each([['updateMill', 'mills', { name: 'M1' }], ['updateBenchmark', 'recovery_benchmarks', { variety: 'Super' }]])(
    '%s', async (fn, table, good) => {
      db.__calls.length = 0;
      await ctrl[fn]({ params: { id: '3' }, body: { ...good, id: 99, created_at: 'x', is_admin: true } }, res());
      const upd = db.__calls.find((c) => c.table === table && c.op === 'update');
      expect(Object.keys(upd.data).sort()).toEqual([...Object.keys(good), 'updated_at'].sort());
    });

  test('an update with no editable field is refused', async () => {
    const r = res();
    await ctrl.updateMill({ params: { id: '3' }, body: { id: 5 } }, r);
    expect(r.statusCode).toBe(400);
  });
});
