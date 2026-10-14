/**
 * P1-03 / P1-04 / P1-10 / P1-14(users.js) — session & sign-in hardening.
 *
 * Runs the real middleware, auth service and users router against the in-memory
 * Knex stand-in (helpers/memoryDb). A switch (`global.__dbDown`) makes every query
 * throw, to prove the auth paths fail CLOSED (503) rather than open.
 */
jest.mock('../config/database', () => {
  const mem = require('./helpers/memoryDb');
  const wrapper = (...args) => {
    if (global.__dbDown) throw new Error('connect ECONNREFUSED (simulated)');
    return mem.db(...args);
  };
  wrapper.fn = mem.db.fn;
  wrapper.raw = mem.db.raw;
  wrapper.transaction = async (fn) => fn(wrapper);
  return wrapper;
});

// The repository's joined lookups (users ⋈ roles) are served from the same state.
jest.mock('../modules/auth/auth.repository', () => {
  const actual = jest.requireActual('../modules/auth/auth.repository');
  const { state } = require('./helpers/memoryDb');
  const withRole = (u) => {
    if (!u) return undefined;
    const r = (state.tables.roles || []).find((x) => x.id === u.role_id);
    return { ...u, role_name: r ? r.name : null };
  };
  return {
    ...actual,
    findUserByEmail: async (email) => withRole((state.tables.users || []).find((u) => u.email === String(email).toLowerCase())),
    findUserById: async (id) => withRole((state.tables.users || []).find((u) => Number(u.id) === Number(id))),
    getPermissionsForRole: async () => [],
    getMobileNavForRole: async () => null,
  };
});

jest.mock('../services/auditService', () => ({ log: jest.fn().mockResolvedValue(null) }));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { state, reset } = require('./helpers/memoryDb');
const authenticate = require('../middleware/auth');
const { authenticateTicket, issueTicket } = require('../middleware/authEventSource');
const authService = require('../modules/auth/auth.service');
const throttle = require('../modules/auth/loginThrottle');
const repo = require('../modules/auth/auth.repository');

const PW = 'FAKE-test-password-1';
let PW_HASH;

const ROLES = [
  { id: 1, name: 'Super Admin' },
  { id: 9, name: 'Owner' },
  { id: 3, name: 'Finance Manager' },
  { id: 5, name: 'Read-Only Auditor' },
];

function user(over = {}) {
  return {
    id: 10, email: 'fm@example.test', full_name: 'Fin Mgr', role_id: 3, password_hash: PW_HASH,
    status: 'active', is_active: true, token_version: 0, failed_login_count: 0,
    locked_until: null, locked_at: null, force_password_change: false, ...over,
  };
}

function seed(users = [user()]) {
  reset({ roles: ROLES, users, password_reset_tokens: [], devices: [], user_scopes: [], email_logs: [] });
}

const tokenFor = (u, extra = {}) => jwt.sign({ id: u.id, email: u.email, role_id: u.role_id, tv: u.token_version || 0, ...extra }, config.jwt.secret);

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(j) { this.body = j; return this; },
  };
}

async function runAuth(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nexted = false;
  await authenticate(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

beforeAll(async () => { PW_HASH = await bcrypt.hash(PW, 4); });
beforeEach(() => { global.__dbDown = false; throttle._reset(); seed(); });
afterAll(() => { global.__dbDown = false; });

// ── P1-04: config guard ──────────────────────────────────────────────────────
describe('JWT_SECRET production guard', () => {
  const { assertSecureConfig } = config;
  test('production with unset or default secret refuses to start', () => {
    for (const bad of [undefined, '', 'riceflow-jwt-secret-change-in-production', 'change-me-in-production']) {
      expect(() => assertSecureConfig({ env: 'production' }, bad)).toThrow(/JWT_SECRET/);
    }
  });
  test('production with a real secret, or any non-production env, starts', () => {
    expect(() => assertSecureConfig({ env: 'production' }, 'FAKE-test-secret-1-long-random')).not.toThrow();
    expect(() => assertSecureConfig({ env: 'development' }, undefined)).not.toThrow();
    expect(() => assertSecureConfig({ env: 'test' }, 'change-me-in-production')).not.toThrow();
  });
});

// ── P1-03 / P1-04: authenticate ──────────────────────────────────────────────
describe('authenticate middleware', () => {
  test('valid session passes, role comes from the DB', async () => {
    const { req, nexted } = await runAuth(tokenFor(user()));
    expect(nexted).toBe(true);
    expect(req.user.role_id).toBe(3);
  });

  test('demotion is immediate: token says Finance Manager, DB says Auditor → req.user.role_id is the DB role', async () => {
    const token = tokenFor(user());
    state.tables.users[0].role_id = 5; // demoted without a tv bump (belt and braces)
    const { req, nexted } = await runAuth(token);
    expect(nexted).toBe(true);
    expect(req.user.role_id).toBe(5);
  });

  test('stale token_version → 401 session_revoked', async () => {
    const token = tokenFor(user());
    state.tables.users[0].token_version = 1;
    const { res, nexted } = await runAuth(token);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('session_revoked');
  });

  test('suspended user → 403 account_inactive', async () => {
    const token = tokenFor(user());
    state.tables.users[0].status = 'suspended';
    const { res, nexted } = await runAuth(token);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('account_inactive');
  });

  test('DB down → 503, never access (fail closed); 503 is not a logout status', async () => {
    const token = tokenFor(user());
    global.__dbDown = true;
    const { res, nexted } = await runAuth(token);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('auth_unavailable');
  });

  test('a stream ticket is not accepted as a Bearer session token', async () => {
    const { ticket } = issueTicket({ id: 10, tv: 0 }, 'call-signals');
    const { res, nexted } = await runAuth(ticket);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

// ── P1-04: scope + device guard fail closed ──────────────────────────────────
describe('fail-closed helpers', () => {
  test('getScopedWarehouseIds returns [] (no warehouse) on a DB error, not null (everything)', async () => {
    const { getScopedWarehouseIds } = jest.requireActual('../middleware/rbac');
    global.__dbDown = true;
    const ids = await getScopedWarehouseIds({ id: 10, role_id: 3 });
    expect(ids).toEqual([]);
    const { applyWarehouseScope } = require('../utils/warehouseScope');
    const q = { whereIn: jest.fn(() => q) };
    applyWarehouseScope(q, ids, 'l.warehouse_id');
    expect(q.whereIn).toHaveBeenCalledWith('l.warehouse_id', [-1]);
  });

  test('deviceGuard: lookup error on a write → 503, not let through', async () => {
    const guard = require('../middleware/deviceGuard');
    global.__dbDown = true;
    const res = mockRes();
    let nexted = false;
    await guard({ method: 'POST', get: () => '33333333-3333-4333-8333-333333333333' }, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(503);
  });
});

// ── P1-04: stream tickets ────────────────────────────────────────────────────
describe('stream tickets', () => {
  function appWith(mw, path = '/s/:id') {
    const app = express();
    app.get(path, mw, (req, res) => res.json({ ok: true, user: req.user }));
    return app;
  }

  test('a ticket opens only its own purpose', async () => {
    const { ticket } = issueTicket({ id: 10, tv: 0 }, 'call-signals');
    const ok = await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?ticket=${ticket}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: 10, role_id: 3 });
    const wrong = await request(appWith(authenticateTicket('chat-attachment'))).get(`/s/1?ticket=${ticket}`);
    expect(wrong.status).toBe(401);
  });

  test('the session JWT in ?token= / ?ticket= is refused', async () => {
    const jwtTok = tokenFor(user());
    const r1 = await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?token=${jwtTok}`);
    expect(r1.status).toBe(401);
    const r2 = await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?ticket=${jwtTok}`);
    expect(r2.status).toBe(401);
  });

  test('export-order ticket is bound to its order id', async () => {
    const { ticket } = issueTicket({ id: 10, tv: 0 }, 'export-order', 7);
    const mw = authenticateTicket('export-order', { resourceParam: 'id' });
    expect((await request(appWith(mw)).get(`/s/7?ticket=${ticket}`)).status).toBe(200);
    expect((await request(appWith(mw)).get(`/s/8?ticket=${ticket}`)).status).toBe(401);
    expect(() => issueTicket({ id: 10 }, 'export-order')).toThrow(/resource_id/);
    expect(() => issueTicket({ id: 10 }, 'anything')).toThrow(/Unknown ticket purpose/);
  });

  test('expired ticket → 401; revoked session → 401; DB down → 503', async () => {
    const expired = jwt.sign({ id: 10, tv: 0, typ: 'stream_ticket', pur: 'call-signals', exp: Math.floor(Date.now() / 1000) - 5 }, config.jwt.secret);
    expect((await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?ticket=${expired}`)).status).toBe(401);

    const { ticket } = issueTicket({ id: 10, tv: 0 }, 'call-signals');
    state.tables.users[0].token_version = 2;
    expect((await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?ticket=${ticket}`)).status).toBe(401);

    state.tables.users[0].token_version = 0;
    global.__dbDown = true;
    expect((await request(appWith(authenticateTicket('call-signals'))).get(`/s/1?ticket=${ticket}`)).status).toBe(503);
  });

  test('tickets are short-lived', () => {
    const { ticket, expires_in } = issueTicket({ id: 10, tv: 0 }, 'call-signals');
    const d = jwt.decode(ticket);
    expect(expires_in).toBeLessThanOrEqual(600);
    expect(d.exp - d.iat).toBe(expires_in);
  });
});

// ── P1-04: request log has no query strings ──────────────────────────────────
describe('request logging', () => {
  test('logged URL drops the query string (no token= / ticket=)', async () => {
    const requestLogger = require('../middleware/requestLogger');
    expect(requestLogger.pathOnly('/api/streams/call-signals?ticket=abc&token=xyz')).toBe('/api/streams/call-signals');
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => {
      writes.push(String(chunk));
      const cb = rest.find((x) => typeof x === 'function');
      if (cb) cb();
      return true;
    });
    try {
      const app = express();
      app.use(requestLogger);
      app.get('/x', (req, res) => res.send('ok'));
      await request(app).get('/x?token=FAKE-SECRET-TOKEN&ticket=FAKE-TICKET');
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      spy.mockRestore();
    }
    const out = writes.join('');
    expect(out).toContain('GET /x 200');
    expect(out).not.toContain('FAKE-SECRET-TOKEN');
    expect(out).not.toContain('FAKE-TICKET');
  });
});

// ── P1-10: login lockout + enumeration parity ────────────────────────────────
describe('login', () => {
  const tryLogin = (email, pw) => authService.login(email, pw, '203.0.113.9').then(() => ({ status: 200 }), (e) => ({ status: e.statusCode, message: e.message }));

  test('unknown email and wrong password give the identical 401', async () => {
    const a = await tryLogin('nobody@example.test', 'x');
    const b = await tryLogin('fm@example.test', 'wrong');
    expect(a).toEqual({ status: 401, message: 'Invalid email or password.' });
    expect(b).toEqual(a);
  });

  test('a suspended account with a WRONG password looks like any bad login (status not revealed)', async () => {
    state.tables.users[0].status = 'suspended';
    expect(await tryLogin('fm@example.test', 'wrong')).toMatchObject({ status: 401 });
    expect(await tryLogin('fm@example.test', PW)).toMatchObject({ status: 403 });
  });

  test('5 misses → 429 for 15 minutes (even with the right password), account stays active; then it expires', async () => {
    for (let i = 0; i < 4; i += 1) expect((await tryLogin('fm@example.test', 'wrong')).status).toBe(401);
    expect((await tryLogin('fm@example.test', 'wrong')).status).toBe(429);
    const u = state.tables.users[0];
    expect(u.status).toBe('active');
    expect(new Date(u.locked_until).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect((await tryLogin('fm@example.test', PW)).status).toBe(429);

    // Lockout elapses (both the DB lock and the in-memory twin).
    u.locked_until = new Date(Date.now() - 1000).toISOString();
    throttle._reset();
    expect((await tryLogin('fm@example.test', PW)).status).toBe(200);
    expect(state.tables.users[0].locked_until).toBeNull();
    expect(state.tables.users[0].failed_login_count).toBe(0);
  });

  test('unknown email locks out after 5 misses too (lockout does not reveal account existence)', async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push((await tryLogin('ghost@example.test', 'x')).status);
    expect(results).toEqual([401, 401, 401, 401, 429, 429]);
  });

  test('legacy auto-lock (status locked, counter at 5) expires after 15 minutes', async () => {
    state.tables.users[0] = user({ status: 'locked', is_active: false, failed_login_count: 5, locked_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
    expect((await tryLogin('fm@example.test', PW)).status).toBe(200);
    expect(state.tables.users[0]).toMatchObject({ status: 'active', is_active: true, locked_at: null });
  });

  test("an admin's deliberate lock (counter untouched) is NOT auto-lifted", async () => {
    state.tables.users[0] = user({ status: 'locked', is_active: false, failed_login_count: 0, locked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    expect((await tryLogin('fm@example.test', PW)).status).toBe(403);
  });
});

// ── P1-10: per-IP limiter keys on req.ip, not spoofable headers ──────────────
describe('login rate limiter', () => {
  test('a forged cf-connecting-ip / X-Real-IP does not give a fresh bucket', async () => {
    const { loginLimiter } = jest.requireActual('../middleware/rateLimiter');
    const app = express();
    app.set('trust proxy', 1);
    app.post('/login', loginLimiter, (req, res) => res.status(401).json({}));
    let last;
    for (let i = 0; i < 101; i += 1) {
      last = await request(app).post('/login')
        .set('X-Forwarded-For', '198.51.100.7')
        .set('cf-connecting-ip', `10.0.0.${i}`)
        .set('X-Real-IP', `10.1.0.${i}`);
    }
    expect(last.status).toBe(429);
    // A different real client (per trust proxy) has its own bucket.
    const other = await request(app).post('/login').set('X-Forwarded-For', '198.51.100.8');
    expect(other.status).toBe(401);
  });
});

// ── P1-03: refresh-token ─────────────────────────────────────────────────────
describe('refresh-token', () => {
  const refresh = (t) => authService.refreshToken(t).then((r) => ({ status: 200, r }), (e) => ({ status: e.statusCode }));

  test('valid session refreshes', async () => {
    const { status, r } = await refresh(tokenFor(user()));
    expect(status).toBe(200);
    expect(jwt.decode(r.token).tv).toBe(0);
  });
  test('revoked (stale tv) cannot refresh', async () => {
    const t = tokenFor(user());
    state.tables.users[0].token_version = 1;
    expect((await refresh(t)).status).toBe(401);
  });
  test('suspended / locked users cannot refresh', async () => {
    const t = tokenFor(user());
    state.tables.users[0].status = 'suspended';
    expect((await refresh(t)).status).toBe(401);
    state.tables.users[0].status = 'locked';
    expect((await refresh(t)).status).toBe(401);
  });
  test('a stream ticket cannot be refreshed into a session', async () => {
    const { ticket } = issueTicket({ id: 10, tv: 0 }, 'chat-attachment');
    expect((await refresh(ticket)).status).toBe(401);
  });
});

// ── P1-03: password change ends other sessions, keeps this one ───────────────
describe('change password', () => {
  test('bumps token_version: old token dead, returned token works', async () => {
    const old = tokenFor(user());
    const { token } = await authService.changePassword(10, PW, 'FAKE-new-password-2', '127.0.0.1');
    expect((await runAuth(old)).res.statusCode).toBe(401);
    expect((await runAuth(token)).nexted).toBe(true);
  });
});

// ── P1-04 / P1-10: reset tokens hashed; reset clears lockout + sessions ───────
describe('password reset', () => {
  test('forgot-password stores only a hash; reset with the raw token works once and clears the lockout', async () => {
    const createSpy = jest.spyOn(repo, 'createPasswordResetToken');
    state.tables.users[0].locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await authService.requestPasswordReset('fm@example.test', '127.0.0.1');
    const raw = createSpy.mock.calls[0][1];
    createSpy.mockRestore();
    const row = state.tables.password_reset_tokens[0];
    expect(row.token).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(row.token).not.toContain(raw);

    // memoryDb can't compare timestamps; emulate the hashed lookup + expiry here.
    const findSpy = jest.spyOn(repo, 'findValidResetToken').mockImplementation(async (t) => state.tables.password_reset_tokens
      .find((x) => x.token === repo.hashResetToken(t) && !x.used && new Date(x.expires_at) > new Date()));

    const old = tokenFor(user());
    await authService.resetPassword(raw, 'FAKE-new-password-3', '127.0.0.1');
    const u = state.tables.users[0];
    expect(u.locked_until).toBeNull();
    expect(u.token_version).toBe(1);
    expect((await runAuth(old)).res.statusCode).toBe(401);
    await expect(authService.resetPassword(raw, 'FAKE-new-password-4', '127.0.0.1')).rejects.toThrow(/Invalid or expired/);
    expect((await authService.login('fm@example.test', 'FAKE-new-password-3', '127.0.0.1')).token).toBeTruthy();
    findSpy.mockRestore();
  });

  test('forgot-password is silent for unknown and suspended accounts', async () => {
    await authService.requestPasswordReset('ghost@example.test');
    state.tables.users[0].status = 'suspended';
    await authService.requestPasswordReset('fm@example.test');
    expect(state.tables.password_reset_tokens).toHaveLength(0);
  });

  test('emailed link uses the configured app URL and a #fragment token', () => {
    expect(authService.resetLink('abc')).toBe(`${config.appUrl}/reset-password#token=abc`);
  });
});

// ── P1-03 / P1-14: users router ──────────────────────────────────────────────
describe('users router', () => {
  jest.doMock('../middleware/rbac', () => {
    const pass = () => (req, res, next) => next();
    return Object.assign(pass, { authorize: pass });
  });
  jest.doMock('../middleware/audit', () => () => (req, res, next) => next());

  function app(caller) {
    const usersRouter = require('../routes/users');
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.user = caller; next(); });
    a.use('/users', usersRouter);
    return a;
  }

  beforeEach(() => {
    seed([
      user(),
      user({ id: 20, email: 'owner@example.test', role_id: 9 }),
      user({ id: 30, email: 'root@example.test', role_id: 1 }),
    ]);
  });

  const OWNER = { id: 20, role_id: 9 };
  const SUPER = { id: 30, role_id: 1 };

  test('an Owner cannot grant Super Admin — to others or to themselves', async () => {
    let r = await request(app(OWNER)).put('/users/10/role').send({ role_id: 1 });
    expect(r.status).toBe(403);
    r = await request(app(OWNER)).put('/users/20/role').send({ role_id: 1 });
    expect(r.status).toBe(403);
    r = await request(app(OWNER)).put('/users/20').send({ role_id: 1 });
    expect(r.status).toBe(403);
    r = await request(app(OWNER)).post('/users').send({ email: 'x@example.test', password: 'FAKE-pass-1234', full_name: 'X', role_id: 1 });
    expect(r.status).toBe(403);
    expect(state.tables.users.find((u) => u.id === 20).role_id).toBe(9);
  });

  test('a Super Admin can grant Super Admin; Owner can still assign other roles', async () => {
    expect((await request(app(SUPER)).put('/users/10/role').send({ role_id: 1 })).status).toBe(200);
    expect((await request(app(OWNER)).put('/users/10/role').send({ role_id: 5 })).status).toBe(200);
  });

  test('role change bumps token_version → demoted Finance user\'s old token gets 401', async () => {
    const old = tokenFor(user());
    expect((await request(app(OWNER)).put('/users/10/role').send({ role_id: 5 })).status).toBe(200);
    expect(state.tables.users[0].token_version).toBe(1);
    const { res, nexted } = await runAuth(old);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('status change, deactivate and admin password set each bump token_version', async () => {
    await request(app(OWNER)).put('/users/10/status').send({ status: 'suspended' });
    expect(state.tables.users[0].token_version).toBe(1);
    await request(app(OWNER)).put('/users/10/activate').send({});
    expect(state.tables.users[0].token_version).toBe(2);
    await request(app(OWNER)).put('/users/10/password').send({ password: 'FAKE-admin-set-9' });
    expect(state.tables.users[0].token_version).toBe(3);
    await request(app(OWNER)).put('/users/10/deactivate').send({});
    expect(state.tables.users[0].token_version).toBe(4);
  });

  test('admin reset link: stored hashed, link carries the raw token in a #fragment', async () => {
    const r = await request(app(OWNER)).post('/users/10/reset-link').send({});
    expect(r.status).toBe(200);
    expect(r.body.data.link).toMatch(/^\/reset-password#token=[0-9a-f]{64}$/);
    expect(state.tables.password_reset_tokens[0].token).toBe(repo.hashResetToken(r.body.data.token));
  });
});
