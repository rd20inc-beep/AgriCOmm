// Offline Stage 6a — sync PULL path. Additive, device-bound, RBAC-gated.
//   POST /api/sync/bootstrap  — register/upsert this device, return sync config.
//   POST /api/sync/pull       — return records for a domain changed since a
//                               watermark (incremental delta), + the new watermark.
// The push path (offline writes → server) lands in Stage 6b.
const db = require('../../config/database');
const { userHasPermission } = require('../../middleware/rbac');

// Whitelist of syncable domains. Each maps to a source table, the cursor column
// used for "changed since", and the RBAC permission required to pull it — so pull
// returns only what the user is allowed to see. Cursor is a timestamp column
// (updated_at for mutable rows, created_at for insert-only ledgers).
const DOMAINS = {
  customers:    { table: 'customers',        cursor: 'updated_at', perm: ['customers', 'view'] },
  suppliers:    { table: 'suppliers',        cursor: 'updated_at', perm: ['suppliers', 'view'] },
  products:     { table: 'products',         cursor: 'updated_at', perm: ['products', 'view'] },
  warehouses:   { table: 'warehouses',       cursor: 'updated_at', perm: ['inventory', 'view'] },
  bank_accounts:{ table: 'bank_accounts',    cursor: 'updated_at', perm: ['finance', 'view'] },
  inventory:    { table: 'inventory_lots',   cursor: 'updated_at', perm: ['inventory', 'view'] },
  lot_ledger:   { table: 'lot_transactions', cursor: 'created_at', perm: ['inventory', 'view'] },
  milling:      { table: 'milling_batches',  cursor: 'updated_at', perm: ['milling', 'view'] },
  local_sales:  { table: 'local_sales',      cursor: 'updated_at', perm: ['local_sales', 'view'] },
  export_orders:{ table: 'export_orders',    cursor: 'updated_at', perm: ['export_orders', 'view'] },
};

const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;

// Sync protocol version (Stage 17). The offline client sends its protocol via the
// X-Sync-Protocol header. Bump SYNC_PROTOCOL_VERSION when the sync payload/contract
// changes; raise MIN_CLIENT_PROTOCOL to force stale clients to update BEFORE they push
// incompatible writes after a server schema migration (§6: schema-migration / app-
// version-mismatch). A client below the minimum gets 426 and pauses its sync.
const SYNC_PROTOCOL_VERSION = 1;
const MIN_CLIENT_PROTOCOL = 1;

// Returns a 426 response object when the client's protocol is too old, else null.
function checkSyncProtocol(req, res) {
  const raw = req.headers && req.headers['x-sync-protocol'];
  if (raw === undefined || raw === null || raw === '') return null; // legacy client — allow (back-compat)
  const client = parseInt(raw, 10);
  if (Number.isFinite(client) && client < MIN_CLIENT_PROTOCOL) {
    res.status(426).json({
      success: false,
      code: 'sync_outdated',
      message: 'This app version is too old to sync. Please update.',
      data: { serverProtocol: SYNC_PROTOCOL_VERSION, minClientProtocol: MIN_CLIENT_PROTOCOL },
    });
    return true;
  }
  return null;
}

// device_uuid is a Postgres uuid column — reject malformed input with a clean 400
// (a bad string would otherwise error the uuid cast → 500). Clients generate a
// valid UUID via crypto.randomUUID().
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

async function bootstrap(req, res) {
  try {
    // Version handshake first — a too-old client must update before it pushes.
    if (checkSyncProtocol(req, res)) return undefined;
    const { device_uuid, platform, label, app_version } = req.body || {};
    if (!isUuid(device_uuid)) return res.status(400).json({ success: false, message: 'A valid device_uuid is required' });

    const existing = await db('devices').where({ device_uuid }).first();
    if (existing && existing.status === 'revoked') {
      return res.status(403).json({ success: false, message: 'This device has been revoked.' });
    }
    if (existing) {
      await db('devices').where({ id: existing.id }).update({
        user_id: req.user.id, last_seen_at: db.fn.now(),
        platform: platform || existing.platform || null,
        label: label || existing.label || null,
        app_version: app_version || existing.app_version || null,
      });
    } else {
      await db('devices').insert({
        device_uuid, user_id: req.user.id,
        platform: platform || null, label: label || null, app_version: app_version || null,
        registered_at: db.fn.now(), last_seen_at: db.fn.now(),
      });
    }
    const device = await db('devices').where({ device_uuid }).first();
    return res.json({
      success: true,
      data: {
        device, serverTime: new Date().toISOString(), domains: Object.keys(DOMAINS),
        syncProtocol: SYNC_PROTOCOL_VERSION, minClientProtocol: MIN_CLIENT_PROTOCOL,
      },
    });
  } catch (err) {
    console.error('sync.bootstrap error:', err);
    return res.status(500).json({ success: false, message: 'Bootstrap failed' });
  }
}

async function pull(req, res) {
  try {
    const { device_uuid, domain, since, limit } = req.body || {};
    const cfg = DOMAINS[domain];
    if (!cfg) return res.status(400).json({ success: false, message: `Unknown sync domain: ${domain}` });
    if (!isUuid(device_uuid)) return res.status(400).json({ success: false, message: 'A valid device_uuid is required' });

    // Device must be registered and active.
    const dev = await db('devices').where({ device_uuid }).first();
    if (!dev) return res.status(403).json({ success: false, message: 'Device not registered — bootstrap first.' });
    if (dev.status === 'revoked') return res.status(403).json({ success: false, message: 'This device has been revoked.' });

    // RBAC: the user must be allowed to view this domain.
    if (!(await userHasPermission(req, cfg.perm[0], cfg.perm[1]))) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const pageSize = Math.min(parseInt(limit, 10) || DEFAULT_PAGE, MAX_PAGE);
    let q = db(cfg.table).orderBy(cfg.cursor, 'asc').limit(pageSize + 1);
    if (since) q = q.where(cfg.cursor, '>', since);
    const rows = await q;

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const watermark = page.length ? page[page.length - 1][cfg.cursor] : (since || null);

    await db('devices').where({ id: dev.id }).update({ last_seen_at: db.fn.now() });

    return res.json({ success: true, data: { domain, rows: page, watermark, hasMore } });
  } catch (err) {
    console.error('sync.pull error:', err);
    return res.status(500).json({ success: false, message: 'Pull failed' });
  }
}

// ── Conflicts (Stage 8) ──────────────────────────────────────────────────────

// A device records a conflict when the server refused one of its replayed writes.
async function recordConflict(req, res) {
  try {
    const { device_uuid, item_uuid, endpoint, method, conflict_code, status_code, message, label, payload } = req.body || {};
    if (!isUuid(device_uuid)) return res.status(400).json({ success: false, message: 'A valid device_uuid is required' });
    const dev = await db('devices').where({ device_uuid }).first();
    if (!dev) return res.status(403).json({ success: false, message: 'Device not registered — bootstrap first.' });
    if (dev.status === 'revoked') return res.status(403).json({ success: false, message: 'This device has been revoked.' });

    await db('sync_conflicts').insert({
      device_uuid,
      user_id: req.user.id,
      item_uuid: isUuid(item_uuid) ? item_uuid : null,
      endpoint: endpoint ? String(endpoint).slice(0, 500) : null,
      method: method ? String(method).slice(0, 10) : null,
      conflict_code: conflict_code ? String(conflict_code).slice(0, 40) : 'rejected',
      status_code: status_code || null,
      message: message ? String(message).slice(0, 2000) : null,
      label: label ? String(label).slice(0, 200) : null,
      payload: payload ? JSON.stringify(payload) : null,
      resolution: 'pending',
      created_at: db.fn.now(),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('sync.recordConflict error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record conflict' });
  }
}

// Managers review open conflicts across devices.
async function listConflicts(req, res) {
  try {
    const status = req.query.status || 'pending';
    let q = db('sync_conflicts').orderBy('created_at', 'desc').limit(200);
    if (status !== 'all') q = q.where('resolution', status);
    const conflicts = await q;
    return res.json({ success: true, data: { conflicts } });
  } catch (err) {
    console.error('sync.listConflicts error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list conflicts' });
  }
}

async function resolveConflict(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['dismissed', 'resolved', 'retried'];
    const resolution = allowed.includes(req.body?.resolution) ? req.body.resolution : 'resolved';
    const row = await db('sync_conflicts').where({ id }).first();
    if (!row) return res.status(404).json({ success: false, message: 'Conflict not found' });
    await db('sync_conflicts').where({ id }).update({ resolution, resolved_by: req.user.id, resolved_at: db.fn.now() });
    return res.json({ success: true });
  } catch (err) {
    console.error('sync.resolveConflict error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resolve conflict' });
  }
}

// ── Device management (Stage 15) ─────────────────────────────────────────────
// Managers see every registered install; owners can revoke a lost/stolen or
// decommissioned device (its next mutating request is refused by deviceGuard and
// the client wipes its local cache) or reactivate one that was revoked in error.

async function listDevices(req, res) {
  try {
    const devices = await db('devices as d')
      .leftJoin('users as u', 'u.id', 'd.user_id')
      .leftJoin('roles as r', 'r.id', 'u.role_id')
      .select(
        'd.*',
        'u.full_name as user_name',
        'u.email as user_email',
        'r.name as role_name',
      )
      .orderBy('d.last_seen_at', 'desc');
    // Let the UI flag the caller's own device so it isn't revoked by accident.
    const current = req.headers['x-device-id'] || null;
    return res.json({ success: true, data: { devices, current_device_uuid: current } });
  } catch (err) {
    console.error('sync.listDevices error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list devices' });
  }
}

async function revokeDevice(req, res) {
  try {
    const { id } = req.params;
    const dev = await db('devices').where({ id }).first();
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    await db('devices').where({ id }).update({
      status: 'revoked', revoked_at: db.fn.now(), revoked_by: req.user.id,
    });
    const updated = await db('devices').where({ id }).first();
    return res.json({ success: true, data: { device: updated } });
  } catch (err) {
    console.error('sync.revokeDevice error:', err);
    return res.status(500).json({ success: false, message: 'Failed to revoke device' });
  }
}

async function reactivateDevice(req, res) {
  try {
    const { id } = req.params;
    const dev = await db('devices').where({ id }).first();
    if (!dev) return res.status(404).json({ success: false, message: 'Device not found' });
    await db('devices').where({ id }).update({
      status: 'active', revoked_at: null, revoked_by: null,
    });
    const updated = await db('devices').where({ id }).first();
    return res.json({ success: true, data: { device: updated } });
  } catch (err) {
    console.error('sync.reactivateDevice error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reactivate device' });
  }
}

// ── Site-server reconciliation view (Stage 16b) ──────────────────────────────
// Operators on a LAN site box see how their offline work reconciled to the cloud:
// the local→cloud id/doc-number map, replays the cloud refused (conflicts), and how
// many writes are still queued. On the cloud these tables are empty, so it returns
// zeros — harmless.
async function siteStatus(req, res) {
  try {
    const [idMap, conflicts, pendingRow] = await Promise.all([
      db('site_id_map').orderBy('id', 'desc').limit(200).catch(() => []),
      db('site_outbox').where({ status: 'conflict' }).orderBy('id', 'desc').limit(200).catch(() => []),
      db('site_outbox').where({ status: 'pending' }).count('* as c').first().catch(() => ({ c: 0 })),
    ]);
    return res.json({
      success: true,
      data: { idMap, conflicts, pending: Number(pendingRow?.c || 0) },
    });
  } catch (err) {
    console.error('sync.siteStatus error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load site status' });
  }
}

module.exports = {
  bootstrap, pull, recordConflict, listConflicts, resolveConflict,
  listDevices, revokeDevice, reactivateDevice, siteStatus,
  checkSyncProtocol, SYNC_PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL, DOMAINS,
};
