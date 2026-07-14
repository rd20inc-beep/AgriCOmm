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

// device_uuid is a Postgres uuid column — reject malformed input with a clean 400
// (a bad string would otherwise error the uuid cast → 500). Clients generate a
// valid UUID via crypto.randomUUID().
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

async function bootstrap(req, res) {
  try {
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
      data: { device, serverTime: new Date().toISOString(), domains: Object.keys(DOMAINS) },
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

module.exports = { bootstrap, pull, DOMAINS };
