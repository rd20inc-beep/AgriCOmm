// Stage 7 — idempotency middleware (DB-gated). Locks the no-double-post guarantee:
// a replayed (completed) key returns the stored response WITHOUT re-running the
// handler; an in-progress key → 409; a key reused with a different body → 422; and
// retention pruning drops keys past the window. Runs only when DB_HOST is set.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

// The signed-in caller (set in beforeAll): a replay re-checks the token.
const auth = { userId: 7, header: undefined };
const mockReq = (key, method, url, body, authHeader = auth.header) => ({
  method, originalUrl: url, url, body,
  headers: authHeader ? { authorization: authHeader } : {},
  get: (h) => (h.toLowerCase() === 'idempotency-key' ? key : undefined),
  is: (t) => t === 'application/json',
  user: { id: auth.userId },
});
const mockRes = () => ({
  statusCode: 200, _status: undefined, _body: undefined,
  status(c) { this.statusCode = c; this._status = c; return this; },
  json(b) { this._body = b; if (this._status == null) this._status = this.statusCode; return this; },
});
const settle = () => new Promise((r) => setTimeout(r, 150));

// Run the middleware; if it calls next(), simulate the handler responding.
async function runRequest(middleware, { key, method = 'POST', url = '/api/local-sales', body = { qty: 5 }, authHeader }, handler) {
  const req = mockReq(key, method, url, body, authHeader === undefined ? auth.header : authHeader);
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
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').first('id');
    await db('users').whereIn('email', ['zztest-idem-a@local.test', 'zztest-idem-b@local.test']).del();
    const [a, b] = await db('users').insert([
      { email: 'zztest-idem-a@local.test', full_name: 'ZZ Idem A', password_hash: 'x', role_id: role.id, is_active: true, status: 'active' },
      { email: 'zztest-idem-b@local.test', full_name: 'ZZ Idem B', password_hash: 'x', role_id: role.id, is_active: true, status: 'active' },
    ]).returning('*');
    auth.userId = a.id;
    auth.header = `Bearer ${jwt.sign({ id: a.id, tv: a.token_version || 0 }, config.jwt.secret)}`;
    auth.otherHeader = `Bearer ${jwt.sign({ id: b.id, tv: b.token_version || 0 }, config.jwt.secret)}`;
  });
  afterAll(async () => {
    await db('idempotency_keys').where('key', 'like', 'ZZTEST%').del();
    await db('users').whereIn('email', ['zztest-idem-a@local.test', 'zztest-idem-b@local.test']).del();
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

  test("another user's key (or no token) never replays the stored response", async () => {
    await runRequest(middleware, { key: 'ZZTEST-OWN' }, handler);
    executions = 0;
    const other = await runRequest(middleware, { key: 'ZZTEST-OWN', authHeader: auth.otherHeader }, handler);
    expect([other.status, other.nexted, executions]).toEqual([401, false, 0]);
    expect(JSON.stringify(other.body)).not.toContain('LS-9999');
    const anon = await runRequest(middleware, { key: 'ZZTEST-OWN', authHeader: null }, handler);
    expect([anon.status, anon.nexted, executions]).toEqual([401, false, 0]);
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

  // ── P2-12 ──────────────────────────────────────────────────────────────
  test('the in-progress 409 carries code idempotency_in_progress (clients retry it)', async () => {
    await db('idempotency_keys').insert({ key: 'ZZTEST-CODE', method: 'POST', path: '/api/local-sales', status: 'in_progress' });
    const r = await runRequest(middleware, { key: 'ZZTEST-CODE' }, handler);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('idempotency_in_progress');
  });

  test('a stale in_progress key (holder died) is taken over and completes once', async () => {
    await db('idempotency_keys').insert({
      key: 'ZZTEST-STALE', method: 'POST', path: '/api/local-sales', status: 'in_progress',
      created_at: db.raw(`now() - interval '${middleware.STALE_MINUTES + 5} minutes'`),
    });
    const r = await runRequest(middleware, { key: 'ZZTEST-STALE' }, handler);
    expect(r.nexted).toBe(true);
    expect(executions).toBe(1);
    const row = await db('idempotency_keys').where({ key: 'ZZTEST-STALE' }).first();
    expect(row.status).toBe('completed');
    // …and a later replay returns that result without running again.
    const again = await runRequest(middleware, { key: 'ZZTEST-STALE' }, handler);
    expect(again.nexted).toBe(false);
    expect(executions).toBe(1);
  });

  test('concurrent identical requests → exactly one execution', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => runRequest(middleware, { key: 'ZZTEST-RACE' }, handler)));
    expect(executions).toBe(1);
    expect(results.filter((r) => r.nexted)).toHaveLength(1);
    // The losers were told it is in flight (or, if they arrived after it
    // finished, got the stored response) — never a second execution.
    for (const r of results.filter((x) => !x.nexted)) expect([201, 409]).toContain(r.status);
  });

  test('a handler answering without res.json still finalizes its key on finish', async () => {
    const req = mockReq('ZZTEST-SEND', 'POST', '/api/x', { a: 1 });
    const listeners = {};
    const res = { ...mockRes(), on: (ev, fn) => { listeners[ev] = fn; } };
    let nexted = false;
    await middleware(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    res.statusCode = 204;
    listeners.finish();
    await settle();
    const row = await db('idempotency_keys').where({ key: 'ZZTEST-SEND' }).first();
    expect(row.status).toBe('completed');
  });
});

describe('requireIdempotencyKey (per-route gate)', () => {
  const { requireIdempotencyKey } = require('../middleware/idempotency');
  const run = (method, key) => {
    const req = { method, originalUrl: '/api/local-sales', get: (h) => (h.toLowerCase() === 'idempotency-key' ? key : undefined) };
    const res = mockRes();
    let nexted = false;
    requireIdempotencyKey(req, res, () => { nexted = true; });
    return { nexted, status: res._status, body: res._body };
  };
  afterEach(() => { delete process.env.IDEMPOTENCY_ENFORCE; });

  test('a money POST without a key is refused 428', () => {
    const r = run('POST', undefined);
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(428);
    expect(r.body.code).toBe('idempotency_key_required');
  });
  test('with a key it proceeds', () => expect(run('POST', 'k-1').nexted).toBe(true));
  test('reads are never gated', () => expect(run('GET', undefined).nexted).toBe(true));
  test('IDEMPOTENCY_ENFORCE=off downgrades to a warning', () => {
    process.env.IDEMPOTENCY_ENFORCE = 'off';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(run('POST', undefined).nexted).toBe(true);
  });
});
