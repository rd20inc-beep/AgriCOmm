// Offline Stage 16 — site-sync worker core. Runs on the LAN site box (never on the
// cloud). Two directions, both reusing existing, validated cloud mechanisms:
//   PUSH  — drain site_outbox, replaying each captured business mutation to the cloud
//           with its stored Idempotency-Key (the cloud re-runs it through the real
//           controller: numbering, GL, stock checks). The cloud stays authoritative.
//   PULL  — refresh master/reference domains from /api/sync/pull into the local PG.
//
// Functions take their deps (db, fetch, config) as arguments so they're unit-testable
// without a live cloud. The cloud is treated as globally authoritative; the site is
// "a big offline device".
const { classifyPushResult, shouldApplyPulledRow } = require('./reconcile');

// Domain → local table (mirror of the cloud sync controller's whitelist).
const DOMAIN_TABLE = {
  customers: 'customers',
  suppliers: 'suppliers',
  products: 'products',
  warehouses: 'warehouses',
  bank_accounts: 'bank_accounts',
};

// A stable device identity for this site box, persisted in site_sync_state so the
// same UUID is reused across restarts (the cloud registers it as one device).
async function getSiteDeviceUuid(db, crypto) {
  const KEY = '__device_uuid__';
  const row = await db('site_sync_state').where({ domain: KEY }).first();
  if (row && row.watermark) return row.watermark;
  const uuid = crypto.randomUUID();
  await db('site_sync_state')
    .insert({ domain: KEY, watermark: uuid, updated_at: db.fn.now() })
    .onConflict('domain').merge({ watermark: uuid });
  return uuid;
}

async function cloudLogin(cfg, fetchImpl) {
  const res = await fetchImpl(`${cfg.cloudApiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.syncUser, password: cfg.syncPassword }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.token) {
    throw new Error(`Cloud login failed (${res.status})`);
  }
  return json.data.token;
}

async function bootstrapDevice(cfg, token, deviceUuid, fetchImpl) {
  await fetchImpl(`${cfg.cloudApiUrl}/api/sync/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Id': deviceUuid },
    body: JSON.stringify({ device_uuid: deviceUuid, platform: 'site', label: cfg.id }),
  });
}

// Replay one queued mutation to the cloud. Returns the classified outcome.
async function replayOne(cfg, token, deviceUuid, item, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${cfg.cloudApiUrl}${item.path}`, {
      method: item.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': item.idempotency_key,
        'X-Device-Id': deviceUuid,
      },
      body: item.method === 'DELETE' && !item.body ? undefined
        : JSON.stringify(typeof item.body === 'string' ? JSON.parse(item.body) : (item.body || {})),
    });
  } catch (err) {
    return { outcome: 'retry', code: 'unreachable', status: 0, error: err.message };
  }
  const body = await res.json().catch(() => ({}));
  return { ...classifyPushResult(res.status, body), status: res.status };
}

// Drain pending site_outbox rows FIFO. Stops at the first transient failure to
// preserve order and avoid hammering an unreachable cloud. Returns a summary.
async function pushOutbox({ db, cfg, token, deviceUuid, fetchImpl, limit = 200 }) {
  const pending = await db('site_outbox').where({ status: 'pending' }).orderBy('id', 'asc').limit(limit);
  const summary = { synced: 0, conflicts: 0, retried: 0 };
  for (const item of pending) {
    const r = await replayOne(cfg, token, deviceUuid, item, fetchImpl);
    if (r.outcome === 'synced') {
      await db('site_outbox').where({ id: item.id }).update({ status: 'synced', cloud_status: r.status, synced_at: db.fn.now() });
      summary.synced += 1;
    } else if (r.outcome === 'conflict') {
      await db('site_outbox').where({ id: item.id }).update({ status: 'conflict', conflict_code: r.code, cloud_status: r.status });
      summary.conflicts += 1;
    } else {
      await db('site_outbox').where({ id: item.id }).update({ attempts: (item.attempts || 0) + 1, last_error: r.code || r.error || 'retry' });
      summary.retried += 1;
      break; // preserve FIFO — retry this one next cycle before anything after it
    }
  }
  return summary;
}

// Pull one master domain from the cloud into the local PG, page by page, applying the
// reconciliation policy per row. Returns the number of rows applied.
async function pullDomain({ db, cfg, token, deviceUuid, domain, fetchImpl }) {
  const table = DOMAIN_TABLE[domain];
  if (!table) return 0;
  const state = await db('site_sync_state').where({ domain }).first();
  let since = state?.watermark || null;
  let applied = 0;
  let guard = 0;
  for (;;) {
    if (guard++ > 1000) break; // safety
    const res = await fetchImpl(`${cfg.cloudApiUrl}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Id': deviceUuid },
      body: JSON.stringify({ device_uuid: deviceUuid, domain, since, limit: 500 }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.data) break;
    const { rows = [], watermark, hasMore } = json.data;
    for (const row of rows) {
      const local = await db(table).where({ id: row.id }).first();
      if (shouldApplyPulledRow(local, row)) {
        await db(table).insert(row).onConflict('id').merge();
        applied += 1;
      }
    }
    if (watermark) {
      since = watermark;
      await db('site_sync_state').insert({ domain, watermark, last_pull_at: db.fn.now(), updated_at: db.fn.now() })
        .onConflict('domain').merge({ watermark, last_pull_at: db.fn.now(), updated_at: db.fn.now() });
    }
    if (!hasMore) break;
  }
  return applied;
}

// One full push+pull cycle. Logs in, bootstraps the site device, pushes, then pulls
// each configured master domain. Throws on login failure (caller backs off).
async function runCycle({ db, cfg, fetchImpl, crypto }) {
  const deviceUuid = await getSiteDeviceUuid(db, crypto);
  const token = await cloudLogin(cfg, fetchImpl);
  await bootstrapDevice(cfg, token, deviceUuid, fetchImpl);
  const push = await pushOutbox({ db, cfg, token, deviceUuid, fetchImpl });
  const pull = {};
  for (const domain of cfg.pullDomains) {
    pull[domain] = await pullDomain({ db, cfg, token, deviceUuid, domain, fetchImpl });
  }
  return { push, pull };
}

module.exports = {
  DOMAIN_TABLE, getSiteDeviceUuid, cloudLogin, bootstrapDevice,
  replayOne, pushOutbox, pullDomain, runCycle,
};
