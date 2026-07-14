// Offline Stage 16 — site-sync worker state machine (DB-gated). Exercises the outbox
// push (synced / conflict / transient-retry-with-FIFO-stop) and the master-domain
// pull (upsert + watermark) against a REAL local Postgres, with a fake cloud fetch —
// no live cloud needed. Runs only when DB_HOST is set (skipped in DB-less CI).
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

// Minimal Response-like stub keyed by URL substring → { status, body }.
const fakeFetch = (routes) => async (url) => {
  const match = Object.keys(routes).find((k) => url.includes(k));
  const { status, body } = match ? routes[match] : { status: 404, body: {} };
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

d('site-sync worker (DB-gated)', () => {
  let db, sync;
  const CFG = { cloudApiUrl: 'http://cloud.test', id: 'site-test', pullDomains: ['customers'] };
  const DEV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeAll(() => {
    db = require('../config/database');
    sync = require('../site/siteSync');
  });

  afterEach(async () => {
    await db('site_outbox').where('path', 'like', '/api/ZZTEST%').del().catch(() => {});
  });

  afterAll(async () => {
    await db('site_outbox').where('path', 'like', '/api/ZZTEST%').del().catch(() => {});
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    await db('site_sync_state').where('domain', 'customers').del().catch(() => {});
    await db.destroy();
  });

  test('push marks 2xx as synced and business-4xx as conflict', async () => {
    const [ok] = await db('site_outbox').insert({ idempotency_key: db.raw('gen_random_uuid()'), method: 'POST', path: '/api/ZZTEST/ok', body: null, status: 'pending' }).returning('id');
    const [bad] = await db('site_outbox').insert({ idempotency_key: db.raw('gen_random_uuid()'), method: 'POST', path: '/api/ZZTEST/bad', body: null, status: 'pending' }).returning('id');

    const fetchImpl = fakeFetch({
      '/api/ZZTEST/ok': { status: 200, body: { success: true } },
      '/api/ZZTEST/bad': { status: 409, body: { code: 'insufficient_stock' } },
    });
    const summary = await sync.pushOutbox({ db, cfg: CFG, token: 't', deviceUuid: DEV, fetchImpl });
    expect(summary.synced).toBe(1);
    expect(summary.conflicts).toBe(1);

    const okRow = await db('site_outbox').where({ id: ok.id ?? ok }).first();
    const badRow = await db('site_outbox').where({ id: bad.id ?? bad }).first();
    expect(okRow.status).toBe('synced');
    expect(badRow.status).toBe('conflict');
    expect(badRow.conflict_code).toBe('insufficient_stock');
  });

  test('a transient failure leaves the row pending and stops the FIFO drain', async () => {
    const [first] = await db('site_outbox').insert({ idempotency_key: db.raw('gen_random_uuid()'), method: 'POST', path: '/api/ZZTEST/boom', body: null, status: 'pending' }).returning('id');
    const [second] = await db('site_outbox').insert({ idempotency_key: db.raw('gen_random_uuid()'), method: 'POST', path: '/api/ZZTEST/after', body: null, status: 'pending' }).returning('id');

    const fetchImpl = fakeFetch({
      '/api/ZZTEST/boom': { status: 500, body: {} },
      '/api/ZZTEST/after': { status: 200, body: { success: true } },
    });
    const summary = await sync.pushOutbox({ db, cfg: CFG, token: 't', deviceUuid: DEV, fetchImpl });
    expect(summary.retried).toBe(1);
    expect(summary.synced).toBe(0); // stopped before reaching the later row

    const firstRow = await db('site_outbox').where({ id: first.id ?? first }).first();
    const secondRow = await db('site_outbox').where({ id: second.id ?? second }).first();
    expect(firstRow.status).toBe('pending');
    expect(Number(firstRow.attempts)).toBe(1);
    expect(secondRow.status).toBe('pending'); // untouched — FIFO preserved
  });

  test('pull upserts cloud master rows into the local table and advances the watermark', async () => {
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    // Pick an id well clear of existing rows to avoid clobbering seed data.
    const id = 900000001;
    const cloudRow = {
      id, name: 'ZZTEST Pulled Cust', customer_type: 'local', currency: 'PKR',
      credit_limit: 0, is_active: true, is_favorite: false, archived: false,
      approval_status: 'approved', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    };
    const fetchImpl = fakeFetch({
      '/api/sync/pull': { status: 200, body: { data: { domain: 'customers', rows: [cloudRow], watermark: '2026-06-01T00:00:00Z', hasMore: false } } },
    });
    const applied = await sync.pullDomain({ db, cfg: CFG, token: 't', deviceUuid: DEV, domain: 'customers', fetchImpl });
    expect(applied).toBe(1);

    const local = await db('customers').where({ id }).first();
    expect(local).toBeTruthy();
    expect(local.name).toBe('ZZTEST Pulled Cust');
    const state = await db('site_sync_state').where({ domain: 'customers' }).first();
    expect(state.watermark).toBe('2026-06-01T00:00:00Z');

    await db('customers').where({ id }).del().catch(() => {});
  });
});
