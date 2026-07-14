// Stage 7 — idempotency middleware (DB-gated). Locks the no-double-post guarantee:
// a replayed (completed) key returns the stored response WITHOUT re-running the
// handler; an in-progress key → 409; a key reused with a different body → 422; and
// retention pruning drops keys past the window. Runs only when DB_HOST is set.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockReq = (key, method, url, body) => ({
  method, originalUrl: url, url, body,
  get: (h) => (h.toLowerCase() === 'idempotency-key' ? key : undefined),
  is: (t) => t === 'application/json',
  user: { id: 7 },
});
const mockRes = () => ({
  statusCode: 200, _status: undefined, _body: undefined,
  status(c) { this.statusCode = c; this._status = c; return this; },
  json(b) { this._body = b; if (this._status == null) this._status = this.statusCode; return this; },
});
const settle = () => new Promise((r) => setTimeout(r, 150));

// Run the middleware; if it calls next(), simulate the handler responding.
async function runRequest(middleware, { key, method = 'POST', url = '/api/local-sales', body = { qty: 5 } }, handler) {
  const req = mockReq(key, method, url, body);
  const res = mockRes();
  let nexted = false;
  await middleware(req, res, () => { nexted = true; });
  if (nexted && handler) handler(req, res);
  await settle();
  return { nexted, status: res._status ?? res.statusCode, body: res._body };
}

d('idempotency middleware (DB-gated)', () => {
  let db, middleware, pruneOldKeys, executions;
  const handler = (req, res) => { executions += 1; res.status(201).json({ success: true, id: 42, saleNo: 'LS-9999' }); };

  beforeAll(async () => {
    db = require('../config/database');
    middleware = require('../middleware/idempotency');
    pruneOldKeys = middleware.pruneOldKeys;
    await db('idempotency_keys').where('key', 'like', 'ZZTEST%').del();
  });
  afterAll(async () => {
    await db('idempotency_keys').where('key', 'like', 'ZZTEST%').del();
    await db.destroy();
  });
  beforeEach(() => { executions = 0; });

  test('first call runs the handler and stores the result', async () => {
    const r = await runRequest(middleware, { key: 'ZZTEST-A' }, handler);
    expect(r.nexted).toBe(true);
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(42);
    expect(executions).toBe(1);
  });

  test('replay of a completed key returns the stored response WITHOUT re-running', async () => {
    await runRequest(middleware, { key: 'ZZTEST-B' }, handler); // complete it
    executions = 0;
    const r = await runRequest(middleware, { key: 'ZZTEST-B' }, handler); // replay
    expect(r.nexted).toBe(false);          // handler NOT invoked
    expect(executions).toBe(0);
    expect(r.status).toBe(201);
    expect(r.body.saleNo).toBe('LS-9999'); // original response
  });

  test('a key stuck in-progress → 409 (never re-runs → no double-post)', async () => {
    await db('idempotency_keys').insert({ key: 'ZZTEST-INPROG', method: 'POST', path: '/api/local-sales', status: 'in_progress' });
    const r = await runRequest(middleware, { key: 'ZZTEST-INPROG' }, handler);
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(409);
    expect(executions).toBe(0);
  });

  test('same key + different body → 422 (client bug), handler not run', async () => {
    await runRequest(middleware, { key: 'ZZTEST-C', body: { qty: 5 } }, handler);
    executions = 0;
    const r = await runRequest(middleware, { key: 'ZZTEST-C', body: { qty: 999 } }, handler);
    expect(r.status).toBe(422);
    expect(executions).toBe(0);
  });

  test('a failed handler (>=400) releases the key so a retry can succeed', async () => {
    const failing = (req, res) => { executions += 1; res.status(400).json({ success: false, message: 'bad' }); };
    await runRequest(middleware, { key: 'ZZTEST-D' }, failing);
    const row = await db('idempotency_keys').where({ key: 'ZZTEST-D' }).first();
    expect(row).toBeUndefined(); // released
  });

  test('retention prune removes old keys, keeps recent', async () => {
    await db('idempotency_keys').insert([
      { key: 'ZZTEST-OLD', method: 'POST', path: '/x', status: 'completed', created_at: db.raw("now() - interval '90 days'") },
      { key: 'ZZTEST-NEW', method: 'POST', path: '/x', status: 'completed', created_at: db.fn.now() },
    ]);
    await pruneOldKeys();
    expect(await db('idempotency_keys').where({ key: 'ZZTEST-OLD' }).first()).toBeUndefined();
    expect(await db('idempotency_keys').where({ key: 'ZZTEST-NEW' }).first()).toBeTruthy();
  });
});
