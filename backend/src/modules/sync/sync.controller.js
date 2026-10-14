// Offline Stage 6a — sync PULL path. Additive, device-bound, RBAC-gated.
//   POST /api/sync/bootstrap  — register/upsert this device, return sync config.
//   POST /api/sync/pull       — return records for a domain changed since a
//                               watermark (incremental delta), + the new watermark.
// The push path (offline writes → server) lands in Stage 6b.
const db = require('../../config/database');
const { userHasPermission } = require('../../middleware/rbac');
const { isCostKey, isProfitKey, moneyVisibility } = require('../../utils/costVisibility');
const whScope = require('../../utils/warehouseScope');

const cols = (s) => s.trim().split(/\s+/);

// Whitelist of syncable domains. Each maps to a source table, the cursor column
// used for "changed since", and the permissions that may pull it — the SAME
// gates the online list endpoints use (customers → export_orders.view, as
// GET /api/customers; suppliers → milling.view; products → inventory.view;
// local sales → inventory.view OR finance.view). Any one of `perms` suffices.
// Cursor is a timestamp column (updated_at for mutable rows, created_at for
// insert-only ledgers); `id` breaks ties (see the cursor below).
//
// `columns` is the projection — never SELECT *. Money columns (cost / profit
// by the shared costVisibility rule) are dropped for a user who may not see
// them, except those in `keep`: a contract or sale price the same user sees on
// the online page. `bankDetails` columns need finance.view_bank_details.
// `scope` names how the per-user warehouse scope applies.
const DOMAINS = {
  customers: {
    table: 'customers', cursor: 'updated_at', perms: [['export_orders', 'view']],
    columns: cols(`id uid name customer_type contact_person email phone address country port currency
      credit_limit payment_terms vat_number bank_name bank_account bank_iban bank_swift is_active is_favorite
      archived approval_status created_at updated_at`),
  },
  suppliers: {
    table: 'suppliers', cursor: 'updated_at', perms: [['milling', 'view']],
    columns: cols(`id uid supplier_code name type contact_person email phone address country is_active
      is_favorite archived approval_status created_at updated_at`),
  },
  products: {
    table: 'products', cursor: 'updated_at', perms: [['inventory', 'view']],
    columns: cols(`id code name description category category_id grade hs_code is_byproduct reorder_level
      is_active approval_status created_at updated_at`),
  },
  warehouses: {
    table: 'warehouses', cursor: 'updated_at', perms: [['inventory', 'view']], scope: 'id',
    columns: cols('id name type entity is_active created_at updated_at'),
  },
  bank_accounts: {
    table: 'bank_accounts', cursor: 'updated_at', perms: [['finance', 'view']],
    columns: cols(`id uid name type entity currency bank_name branch account_title account_number iban
      swift_bic correspondent_bank_name correspondent_swift correspondent_account current_balance
      gl_account_id is_active is_export_default is_favorite approved_for_customer created_at updated_at`),
    bankDetails: ['account_number', 'iban', 'correspondent_account'],
  },
  inventory: {
    table: 'inventory_lots', cursor: 'updated_at', perms: [['inventory', 'view']], scope: 'warehouse_id',
    columns: cols(`id uuid lot_no item_name type entity ownership status product_id variety grade crop_year
      warehouse_id supplier_id owner_customer_id batch_ref blend_batch_no service_batch_id purchase_date
      expiry_date unit standard_unit_type qty available_qty reserved_qty milling_reserved_qty net_weight_kg
      gross_weight_kg received_net_weight_kg ordered_net_weight_kg sold_weight_kg damaged_weight_kg
      total_bags bag_size_kg bag_weight_kg bag_type bag_quality bag_color brand moisture_pct broken_pct
      whiteness quality_json quality_notes processing_type milling_status sortex_status export_ready
      export_display_name notes payment_status rate_per_kg landed_cost_per_kg landed_cost_total
      cost_per_unit total_value purchase_amount paid_amount due_amount transport_cost labor_cost
      unloading_cost packing_cost other_cost bag_cost_per_bag total_bag_cost commission_per_bag
      commission_total raw_cost_component milling_cost_component rate_input_value rate_input_unit
      cost_currency cost_incomplete bag_cost_included record_version created_at updated_at`),
  },
  lot_ledger: {
    table: 'lot_transactions', cursor: 'created_at', perms: [['inventory', 'view']], scope: 'lot',
    columns: cols(`id uuid transaction_no transaction_type transaction_date lot_id quantity_kg quantity_bags
      input_qty input_unit balance_kg balance_bags warehouse_from_id warehouse_to_id entity_from entity_to
      reference_module reference_id reference_no reservation_effect remarks rate_per_kg rate_input_value
      rate_input_unit unit_cost total_cost cost_impact currency performed_at performed_by created_at
      updated_at`),
  },
  milling: {
    table: 'milling_batches', cursor: 'updated_at', perms: [['milling', 'view']],
    columns: cols(`id uuid batch_no batch_name custom_tags status processing_type is_service_milling
      product_id supplier_id supplier_name client_customer_id linked_export_order_id parent_batch_id
      mill_id machine_line shift operator_name date_received completed_at raw_qty_kg milled_qty_kg
      planned_finished_kg expected_output_kg actual_finished_kg yield_pct b1_kg b2_kg b3_kg csr_kg
      short_grain_kg broken_kg bran_kg husk_kg powder_kg sweeping_kg choba_kg sortex_rejects_kg stone_kg
      ov_kg wastage_kg moisture_loss_pct bag_count katta_count pack_bag_type pack_bag_size_kg
      pack_master_bag_size_kg post_milling_grade service_lot_status notes prices_confirmed
      finished_price_per_kg b1_price_per_kg b2_price_per_kg b3_price_per_kg csr_price_per_kg
      short_grain_price_per_kg broken_price_per_kg bran_price_per_kg husk_price_per_kg powder_price_per_kg
      sweeping_price_per_kg choba_price_per_kg sortex_rejects_price_per_kg purchase_price_per_kg
      raw_cost_total raw_cost_per_kg_finished milling_cost_per_kg_finished total_cost_per_kg_finished
      manual_milling_cost_pkr manual_other_expenses_pkr milling_fee_per_kg service_milling_rate_per_kg
      service_labour_rate_per_katta service_rental_rate_per_katta record_version created_at updated_at`),
  },
  local_sales: {
    table: 'local_sales', cursor: 'updated_at', perms: [['inventory', 'view'], ['finance', 'view']],
    columns: cols(`id uuid sale_no sale_group_no sale_date status entity customer_id buyer_name buyer_phone
      buyer_address item_type item_name lot_id lot_no mill_item_id quantity_input quantity_unit
      quantity_kg quantity_bags bag_weight_kg rate_input rate_unit rate_per_kg total_amount currency
      payment_mode payment_status payment_reference paid_amount due_amount due_date bank_account_id
      dispatched dispatch_date vehicle_no driver_name gate_pass_no collection_location notes
      cost_per_kg cogs_per_kg cogs_total_pkr landed_cost_total gross_profit gross_profit_pkr
      profit_per_kg margin_pct confirmed_at record_version created_at updated_at`),
    // The sale's own price and settlement — shown on the online Local Sales list.
    keep: ['rate_input', 'rate_per_kg', 'paid_amount', 'due_amount'],
  },
  export_orders: {
    table: 'export_orders', cursor: 'updated_at', perms: [['export_orders', 'view']],
    columns: cols(`id uuid order_no status current_step financial_status customer_id product_id
      product_name country destination_port port_of_loading incoterm currency qty_mt price_per_mt
      contract_value advance_pct advance_expected advance_received advance_date balance_expected
      balance_received balance_date balance_term_days payment_terms freight_terms freight_per_mt
      insurance_per_mt bag_type bag_size_kg bag_quality bag_brand units_per_bag total_bags
      master_bag_type master_bag_size_kg packing_type shipment_window_start shipment_window_end
      shipment_eta etd eta atd ata vessel_name voyage_number booking_no shipping_line container_no
      bl_number bl_date invoice_number contract_number notes inventory_cogs_per_mt_pkr
      inventory_cogs_total_pkr gross_profit_pkr gross_profit_usd record_version created_at updated_at`),
    // The contract price is what the order sells at, not stock cost.
    keep: ['price_per_mt'],
  },
};

// Columns this caller may pull for a domain.
function projectionFor(cfg, { cost, profit, bankDetails }) {
  const keep = new Set(cfg.keep || []);
  const hideBank = new Set(bankDetails ? [] : (cfg.bankDetails || []));
  return cfg.columns.filter((c) => {
    if (hideBank.has(c)) return false;
    if (keep.has(c)) return true;
    if (!cost && isCostKey(c)) return false;
    if (!profit && isProfitKey(c)) return false;
    return true;
  });
}

// Pull cursor. A watermark is "v2|<cursor timestamp, full precision>|<id>":
// rows come back ordered by (cursor, id) and the next page starts strictly
// after that pair, so rows sharing a timestamp across a page boundary are not
// skipped. A bare timestamp (what clients stored before v2) is still accepted
// and read INCLUSIVELY — re-sending the boundary rows is harmless (the client
// upserts by id), skipping them is not. Clients treat the watermark as opaque.
// Postgres timestamp text, e.g. "2026-10-14 09:30:01.123456+05".
const PG_TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

function parseSince(since) {
  if (since == null || since === '') return null;
  if (typeof since !== 'string') return { bad: true };
  if (since.startsWith('v2|')) {
    const parts = since.split('|');
    const id = parseInt(parts[2], 10);
    if (parts.length !== 3 || !PG_TS_RE.test(parts[1]) || !/^\d+$/.test(parts[2]) || !Number.isFinite(id)) return { bad: true };
    return { ts: parts[1], id };
  }
  if (Number.isNaN(Date.parse(since))) return { bad: true };
  return { ts: since, id: null };
}

const makeWatermark = (ts, id) => `v2|${ts}|${id}`;

// A per-user module allow-list (#9-scoping) applies to sync as to authorize():
// with one set, the domain's module must be on it. Owner / Super Admin bypass.
async function moduleScopeAllows(req, modules) {
  const role = req.user.role_id && await db('roles').where({ id: req.user.role_id }).first('name');
  if (role && ['Owner', 'Super Admin'].includes(role.name)) return true;
  const scoped = await db('user_scopes').where({ user_id: req.user.id, scope_type: 'module' }).pluck('scope_value');
  return !scoped.length || modules.some((m) => scoped.includes(m));
}

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
    if (existing && existing.user_id && existing.user_id !== req.user.id) {
      // Registered to someone else (a shared mill PC, or a guessed uuid). Never
      // re-bind another user's device — that would take over its identity in
      // the fleet view. Touch last_seen only; this user still syncs under their
      // own permissions (pull checks req.user, not the device's owner).
      await db('devices').where({ id: existing.id }).update({ last_seen_at: db.fn.now() });
    } else if (existing) {
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
        device, ownedByAnotherUser: !!(device.user_id && device.user_id !== req.user.id), serverTime: new Date().toISOString(), domains: Object.keys(DOMAINS),
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

    const cursor = parseSince(since);
    if (cursor && cursor.bad) return res.status(400).json({ success: false, message: 'Invalid sync watermark.' });

    // RBAC: the user must hold one of the domain's permissions (the online
    // list endpoint's gate) and, if module-scoped, be scoped to its module.
    let allowed = false;
    for (const [m, a] of cfg.perms) {
      if (await userHasPermission(req, m, a)) { allowed = true; break; }
    }
    if (!allowed || !(await moduleScopeAllows(req, cfg.perms.map(([m]) => m)))) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const [vis, bankDetails] = await Promise.all([
      moneyVisibility(req),
      cfg.bankDetails ? userHasPermission(req, 'finance', 'view_bank_details') : false,
    ]);
    const columns = projectionFor(cfg, { ...vis, bankDetails });

    const pageSize = Math.min(parseInt(limit, 10) || DEFAULT_PAGE, MAX_PAGE);
    let q = db(cfg.table)
      .select(columns)
      // Full-precision cursor text for the watermark (a JS Date drops microseconds).
      .select(db.raw('??::text as "__sync_ts"', [cfg.cursor]))
      .whereNotNull(cfg.cursor)
      .orderBy([{ column: cfg.cursor, order: 'asc' }, { column: 'id', order: 'asc' }])
      .limit(pageSize + 1);
    if (cursor && cursor.id != null) q = q.whereRaw('(??, ??) > (?, ?)', [cfg.cursor, 'id', cursor.ts, cursor.id]);
    else if (cursor) q = q.where(cfg.cursor, '>=', cursor.ts);

    // #9-scoping: a warehouse-scoped user pulls only their warehouses' stock.
    if (cfg.scope) {
      const scope = await whScope.resolveWarehouseScope(req);
      if (scope) {
        const ids = scope.length ? scope : [-1];
        if (cfg.scope === 'lot') q = q.whereIn('lot_id', db('inventory_lots').select('id').whereIn('warehouse_id', ids));
        else q = q.whereIn(cfg.scope, ids);
      }
    }
    const rows = await q;

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];
    const watermark = last ? makeWatermark(last.__sync_ts, last.id) : (since || null);
    for (const r of page) delete r.__sync_ts;

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
    await db.transaction(async (trx) => {
      await trx('devices').where({ id }).update({
        status: 'revoked', revoked_at: db.fn.now(), revoked_by: req.user.id,
      });
      // P1-04: end the device owner's sessions too, so a token copied off the
      // revoked device stops working for reads as well (deviceGuard only sees
      // requests that volunteer X-Device-Id). The owner signs in again elsewhere.
      if (dev.user_id && dev.status !== 'revoked') {
        await trx('users').where({ id: dev.user_id }).increment('token_version', 1);
      }
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
