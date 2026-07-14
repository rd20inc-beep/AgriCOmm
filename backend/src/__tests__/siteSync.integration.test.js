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
    const keys = await db('site_outbox').where('path', 'like', '/api/ZZTEST%').pluck('idempotency_key').catch(() => []);
    if (keys.length) await db('site_id_map').whereIn('idempotency_key', keys).del().catch(() => {});
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

  // ── Stage 16b: transactional identity reconciliation ──────────────────────
  test('a synced POST records the local→cloud id/doc-number map (no row mutation)', async () => {
    const key = '55555555-5555-4555-8555-555555555555';
    await db('site_outbox').insert({
      idempotency_key: key, method: 'POST', path: '/api/ZZTEST/local-sales', body: null,
      entity: 'local-sales', local_ref: '5', status: 'pending',
    });
    const fetchImpl = fakeFetch({
      '/api/ZZTEST/local-sales': { status: 201, body: { success: true, data: { id: 9042, sale_no: 'LS-0042' } } },
    });
    const summary = await sync.pushOutbox({ db, cfg: CFG, token: 't', deviceUuid: DEV, fetchImpl });
    expect(summary.synced).toBe(1);

    const outbox = await db('site_outbox').where({ idempotency_key: key }).first();
    expect(outbox.status).toBe('synced');
    expect(outbox.cloud_ref).toBe('9042');
    expect(outbox.cloud_doc_no).toBe('LS-0042');

    const map = await db('site_id_map').where({ idempotency_key: key }).first();
    expect(map).toBeTruthy();
    expect(map.entity).toBe('local-sales');
    expect(map.local_ref).toBe('5');
    expect(map.cloud_ref).toBe('9042');
    expect(map.cloud_doc_no).toBe('LS-0042');
  });

  test('a refused replay (split-brain: cloud already sold the stock) records NO map', async () => {
    const key = '66666666-6666-4666-8666-666666666666';
    await db('site_outbox').insert({
      idempotency_key: key, method: 'POST', path: '/api/ZZTEST/local-sales', body: null,
      entity: 'local-sales', local_ref: '6', status: 'pending',
    });
    const fetchImpl = fakeFetch({
      '/api/ZZTEST/local-sales': { status: 409, body: { code: 'insufficient_stock' } },
    });
    await sync.pushOutbox({ db, cfg: CFG, token: 't', deviceUuid: DEV, fetchImpl });

    const outbox = await db('site_outbox').where({ idempotency_key: key }).first();
    expect(outbox.status).toBe('conflict');
    expect(outbox.conflict_code).toBe('insufficient_stock');
    const map = await db('site_id_map').where({ idempotency_key: key }).first();
    expect(map).toBeFalsy();
  });
});
