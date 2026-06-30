const db = require('../../config/database');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../../services/accountingService');
const documentService = require('../../services/documentService');
const automationService = require('../../services/automationService');
const emailService = require('../../services/emailService');
const { publishExportOrderUpdate } = require('../../services/exportOrderEventBus');
const workflowService = require('../../services/exportOrderWorkflowService');
const { MONEY_EPSILON, settledAmount, getStepForStatus, getAllowedActions } = workflowService;

/**
 * Resolve an :id route param to a numeric export_orders.id.
 * The same param sometimes arrives as a numeric id ("21") and sometimes as
 * the order number ("EX-007"). Use this at the top of any handler that
 * does `where({ id })` so callers can use either form interchangeably.
 *
 * Returns the numeric id, or null if no order matches.
 */
async function resolveExportOrderId(idOrOrderNo, trxOrDb) {
  if (idOrOrderNo == null) return null;
  const conn = trxOrDb || db;
  const s = String(idOrOrderNo);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const row = await conn('export_orders').where({ order_no: s }).select('id').first();
  return row ? row.id : null;
}

async function generateOrderNo(trx) {
  // Get the highest order number by parsing the numeric part
  const all = await (trx || db)('export_orders').select('order_no');
  let maxNum = 0;
  for (const row of all) {
    const num = parseInt((row.order_no || '').replace('EX-', ''), 10) || 0;
    if (num > maxNum) maxNum = num;
  }
  const num = maxNum;
  return `EX-${String(num + 1).padStart(3, '0')}`;
}

async function generatePaymentNo(trx, prefix = 'PAY') {
  const last = await trx('payments')
    .select('payment_no')
    .where('payment_no', 'like', `${prefix}-%`)
    .orderBy('id', 'desc')
    .first();

  if (!last || !last.payment_no) {
    return `${prefix}-001`;
  }

  const num = parseInt(last.payment_no.replace(`${prefix}-`, ''), 10) || 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

function lockRow(query) {
  return typeof query?.forUpdate === 'function' ? query.forUpdate() : query;
}

// Normalize + dedupe a container's structured lot links (P4c). Accepts either
// snake or camel casing; keeps the first occurrence of each lot_id.
function dedupeContainerLots(lots) {
  const rows = Array.isArray(lots) ? lots : [];
  const seen = new Set();
  const out = [];
  for (const l of rows) {
    const lotId = parseInt(l.lot_id ?? l.lotId, 10);
    if (!Number.isFinite(lotId) || seen.has(lotId)) continue;
    seen.add(lotId);
    const qty = (l.qty_kg ?? l.qtyKg);
    const bags = (l.bags ?? l.bagsCount);
    out.push({
      lot_id: lotId,
      qty_kg: qty != null && qty !== '' ? parseFloat(qty) : null,
      bags: bags != null && bags !== '' ? parseInt(bags, 10) : null,
    });
  }
  return out;
}

function parseShipmentContainerRows(containers, fallbackContainerNo = null) {
  const rows = Array.isArray(containers) ? containers : [];
  const normalized = rows
    .map((container, index) => {
      const containerNo = String(container.container_no || container.containerNo || '').trim();
      if (!containerNo) {
        return null;
      }

      const grossWeight = container.gross_weight_kg != null
        ? parseFloat(container.gross_weight_kg)
        : (container.grossWeightKg != null ? parseFloat(container.grossWeightKg) : null);
      const netWeight = container.net_weight_kg != null
        ? parseFloat(container.net_weight_kg)
        : (container.netWeightKg != null ? parseFloat(container.netWeightKg) : null);

      const tareWeight = container.tare_weight_kg != null
        ? parseFloat(container.tare_weight_kg)
        : (container.tareWeightKg != null ? parseFloat(container.tareWeightKg) : null);
      const bagsCount = container.bags_count != null
        ? parseInt(container.bags_count)
        : (container.bagsCount != null ? parseInt(container.bagsCount) : null);

      return {
        sequence_no: index + 1,
        container_no: containerNo,
        seal_no: container.seal_no || container.sealNo || null,
        lot_number: container.lot_number || container.lotNumber || null,
        bags_count: Number.isFinite(bagsCount) ? bagsCount : null,
        gross_weight_kg: Number.isFinite(grossWeight) ? grossWeight : null,
        net_weight_kg: Number.isFinite(netWeight) ? netWeight : null,
        tare_weight_kg: Number.isFinite(tareWeight) ? tareWeight : null,
        container_type: container.container_type || container.containerType || null,
        notes: container.notes || null,
        // Structured lot links (P4c) — carried alongside the DB columns and
        // split off before the shipment_containers insert. Deduped by lot_id.
        lots: dedupeContainerLots(container.lots),
      };
    })
    .filter(Boolean);

  if (normalized.length === 0 && fallbackContainerNo) {
    const containerNo = String(fallbackContainerNo).trim();
    if (containerNo) {
      normalized.push({
        sequence_no: 1,
        container_no: containerNo,
        seal_no: null,
        lot_number: null,
        bags_count: null,
        gross_weight_kg: null,
        net_weight_kg: null,
        tare_weight_kg: null,
        container_type: null,
        notes: null,
        lots: [],
      });
    }
  }

  return normalized.map((container, index) => ({
    ...container,
    sequence_no: index + 1,
  }));
}

function emitExportOrderUpdate(orderId, eventType, extra = {}) {
  publishExportOrderUpdate(orderId, {
    eventType,
    ...extra,
  });
}

// Map frontend camelCase doc keys to checklist snake_case doc_type values
const DOC_TYPE_TO_CHECKLIST = {
  'phyto': 'phyto',
  'blDraft': 'bl_draft',
  'bl_draft': 'bl_draft',
  'blFinal': 'bl_final',
  'bl_final': 'bl_final',
  'invoice': 'commercial_invoice',
  'commercial_invoice': 'commercial_invoice',
  'packingList': 'packing_list',
  'packing_list': 'packing_list',
  'coo': 'coo',
  'fumigation': 'fumigation',
};

// Map short frontend keys to all possible DB doc_type values
const DOC_TYPE_ALIASES = {
  'phyto': ['phyto', 'Phytosanitary Certificate'],
  'blDraft': ['blDraft', 'bl_draft', 'BL Draft'],
  'blFinal': ['blFinal', 'bl_final', 'BL Final'],
  'invoice': ['invoice', 'commercial_invoice', 'Commercial Invoice'],
  'packingList': ['packingList', 'packing_list', 'Packing List'],
  'coo': ['coo', 'Certificate of Origin'],
  'fumigation': ['fumigation', 'Fumigation Certificate'],
};

async function applyDocumentAction({ orderRef, userId, docType, targetStatus, filePath, version, notes }) {
  const isNumeric = /^\d+$/.test(String(orderRef));
  const whereClause = isNumeric ? { id: parseInt(orderRef) } : { order_no: orderRef };
  const order = await db('export_orders').where(whereClause).first();
  if (!order) {
    const err = new Error('Export order not found.');
    err.statusCode = 404;
    throw err;
  }

  // Find existing doc by any alias of this doc_type
  const aliases = DOC_TYPE_ALIASES[docType] || [docType];
  const existing = await db('export_order_documents')
    .where('order_id', order.id)
    .whereIn('doc_type', aliases)
    .first();

  let doc;
  let orderStatusChanged = false;

  await db.transaction(async (trx) => {
    if (existing) {
      [doc] = await trx('export_order_documents')
        .where({ id: existing.id })
        .update({
          status: targetStatus || existing.status,
          file_path: filePath || existing.file_path,
          version: version || existing.version,
          notes: notes != null ? notes : existing.notes,
          updated_at: trx.fn.now(),
        })
        .returning('*');
    } else {
      [doc] = await trx('export_order_documents')
        .insert({
          order_id: order.id,
          doc_type: docType,
          status: targetStatus || 'Pending',
          uploaded_by: userId,
          upload_date: trx.fn.now(),
          file_path: filePath || null,
          version: version || 1,
          notes: notes || null,
        })
        .returning('*');
    }

    const fulfilledStatuses = new Set(['Approved', 'Final']);
    const checklistDocType = DOC_TYPE_TO_CHECKLIST[docType] || docType;
    await trx('document_checklists')
      .where({ linked_type: 'export_order', linked_id: order.id, doc_type: checklistDocType })
      .update({
        is_fulfilled: fulfilledStatuses.has(doc.status),
        updated_at: trx.fn.now(),
      });

    if (fulfilledStatuses.has(doc.status)) {
      const transition = await workflowService.maybePromoteAfterDocuments(trx, {
        order,
        userId,
        reason: 'All required documents approved',
      });
      orderStatusChanged = transition.changed;
    }
  });

  return { doc, orderStatusChanged, orderId: order.id };
}

// Normalize an `items[]` payload into rows for `export_order_items`.
// Returns null if items is not an array (caller should fall back to single-product handling).
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map((it, idx) => {
    const qty = parseFloat(it.qty_mt) || 0;
    const price = parseFloat(it.price_per_mt) || 0;
    return {
      line_no: idx + 1,
      product_id: it.product_id != null ? parseInt(it.product_id) || null : null,
      product_name: it.product_name || null,
      qty_mt: qty,
      price_per_mt: price,
      line_total: qty * price,
      hs_code: it.hs_code || null,
      packing: it.packing || null,
      bag_size_kg: it.bag_size_kg != null && it.bag_size_kg !== '' ? parseFloat(it.bag_size_kg) : null,
      bag_count: it.bag_count != null && it.bag_count !== '' ? parseInt(it.bag_count) : null,
      bag_type: it.bag_type || null,
      bag_quality: it.bag_quality || null,
      bag_brand: it.bag_brand || null,
      bag_color: it.bag_color || null,
      bag_printing: it.bag_printing || null,
      master_bag_size_kg: it.master_bag_size_kg != null && it.master_bag_size_kg !== '' ? parseFloat(it.master_bag_size_kg) : null,
      master_bag_type: it.master_bag_type || null,
      quality_description: it.quality_description || null,
      broken_pct_target: it.broken_pct_target != null && it.broken_pct_target !== '' ? parseFloat(it.broken_pct_target) : null,
      notes: it.notes || null,
    };
  });
}

// Aggregate normalized items into the summary fields stored on `export_orders`.
// First item defines the order-level product/HS-code summary for backwards
// compatibility with milling, document renderers, and dashboards.
function summarizeItems(rows) {
  const totalQty = rows.reduce((s, r) => s + (r.qty_mt || 0), 0);
  const totalValue = rows.reduce((s, r) => s + (r.line_total || 0), 0);
  const head = rows[0] || {};
  return {
    qty_mt: totalQty,
    contract_value: totalValue,
    price_per_mt: totalQty > 0 ? totalValue / totalQty : 0,
    product_id: head.product_id || null,
    product_name: head.product_name || null,
    hs_code: head.hs_code || null,
  };
}

const ALLOWED_UPDATE_FIELDS = [
  'customer_id', 'product_id', 'product_name', 'qty_mt', 'price_per_mt',
  'currency', 'incoterm', 'country', 'destination_port', 'advance_pct',
  'shipment_eta', 'source', 'notes',
  'bag_type', 'bag_quality', 'bag_size_kg', 'bag_weight_gm',
  'bag_printing', 'bag_color', 'bag_brand', 'bag_notes',
  'master_bag_size_kg', 'master_bag_type',
  'receiving_mode', 'quantity_unit', 'packing_notes',
  'packing_lines', 'doc_address_mode',
  // Document generation fields
  'hs_code', 'brand_marking', 'broken_pct_target', 'quality_description',
  'production_date', 'expiry_date', 'freight_terms', 'fi_number', 'fi_date',
  'invoice_number', 'contract_number', 'consignee_type', 'bl_date',
  'production_remarks', 'shipment_window_start', 'shipment_window_end',
  'voyage_number', 'gd_number', 'gd_date', 'fi_number_2', 'fi_number_3',
  'notify_party_name', 'notify_party_address', 'notify_party_phone', 'notify_party_email',
  'shipment_remarks',
  'payment_terms',
];

// Columns where Postgres rejects '' — coerce empty strings to null on update.
const NUMERIC_UPDATE_FIELDS = new Set([
  'qty_mt', 'price_per_mt', 'advance_pct',
  'bag_size_kg', 'bag_weight_gm', 'broken_pct_target',
  'master_bag_size_kg',
]);
const DATE_UPDATE_FIELDS = new Set([
  'shipment_eta', 'production_date', 'expiry_date',
  'fi_date', 'bl_date', 'gd_date',
  'shipment_window_start', 'shipment_window_end',
]);

const exportOrderController = {
  async list(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        customer_id,
        country,
        search,
      } = req.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .leftJoin('products as p', 'eo.product_id', 'p.id')
        .select(
          'eo.*',
          'c.name as customer_name',
          'c.country as customer_country',
          'p.name as product_name'
        );

      if (status) {
        query = query.where('eo.status', status);
      }
      if (customer_id) {
        query = query.where('eo.customer_id', customer_id);
      }
      if (country) {
        query = query.where('c.country', country);
      }
      if (search) {
        query = query.where(function () {
          this.whereILike('eo.order_no', `%${search}%`)
            .orWhereILike('c.name', `%${search}%`);
        });
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('eo.id as total').first();

      const [orders, countResult] = await Promise.all([
        query.orderBy('eo.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          orders,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Export orders list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getById(req, res) {
    try {
      const { id } = req.params;

      // Support lookup by numeric id OR order_no (e.g. "EX-112")
      const isNumeric = /^\d+$/.test(id);
      const whereClause = isNumeric ? { 'eo.id': parseInt(id) } : { 'eo.order_no': id };

      const order = await db('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .leftJoin('products as p', 'eo.product_id', 'p.id')
        .select(
          'eo.*',
          'c.name as customer_name',
          'c.country as customer_country',
          'c.address as customer_address',
          'c.port as customer_port',
          'c.email as customer_email',
          'p.name as product_name'
        )
        .where(whereClause)
        .first();

      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      const orderId = order.id; // resolved numeric ID
      const [costs, documents, statusHistory, millingBatch, packingLines, shipmentContainers, items] = await Promise.all([
        db('export_order_costs').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_documents').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_status_history as h')
          .leftJoin('users as u', 'u.id', 'h.changed_by')
          .where('h.order_id', orderId)
          .orderBy('h.created_at', 'desc')
          .select('h.id', 'h.order_id', 'h.from_status', 'h.to_status',
            'h.changed_by', 'h.reason', 'h.created_at', 'u.full_name as changed_by_name'),
        db('milling_batches').where({ linked_export_order_id: orderId }).first(),
        db('order_packing_lines').where({ order_id: orderId }).orderBy('line_no', 'asc'),
        db('shipment_containers').where({ order_id: orderId }).orderBy('sequence_no', 'asc'),
        db('export_order_items as i')
          .leftJoin('products as p', 'i.product_id', 'p.id')
          .select('i.*', 'p.name as product_name_lookup')
          .where({ order_id: orderId })
          .orderBy('line_no', 'asc'),
      ]);

      order.items = (items || []).map((it) => ({
        ...it,
        product_name: it.product_name || it.product_name_lookup || null,
      }));

      // Attach each container's structured lot links (P4c).
      const containerRows = shipmentContainers || [];
      const containerIds = containerRows.map((c) => c.id).filter(Boolean);
      let lotsByContainer = {};
      if (containerIds.length) {
        const links = await db('container_lots as cl')
          .leftJoin('inventory_lots as l', 'cl.lot_id', 'l.id')
          .whereIn('cl.container_id', containerIds)
          .select('cl.container_id', 'cl.lot_id', 'cl.qty_kg', 'cl.bags', 'l.lot_no');
        lotsByContainer = links.reduce((acc, r) => {
          (acc[r.container_id] = acc[r.container_id] || []).push({
            lotId: r.lot_id, lotNo: r.lot_no, qtyKg: r.qty_kg != null ? parseFloat(r.qty_kg) : null,
            bags: r.bags != null ? Number(r.bags) : null, href: `/lot-inventory/${r.lot_id}`,
          });
          return acc;
        }, {});
      }
      const withLots = containerRows.map((c) => ({ ...c, lots: lotsByContainer[c.id] || [] }));
      order.shipment_containers = withLots;
      order.shipmentContainers = withLots;
      order.allowed_actions = getAllowedActions(order);
      order.allowedActions = order.allowed_actions;

      // Fetch purchase lots linked to this order via multiple paths:
      // 1. reserved_against matching the order_no
      // 2. lot_transactions with reference_module='export_order'
      // 3. lot_transactions with type='export_allocation' (even without reference_id)
      //    matched via milling batch linkage
      // 4. lots linked via milling batch (batch_ref matching batch_no)

      // Get the milling batch identifiers for lot linkage
      const batchNo = millingBatch ? millingBatch.batch_no : null;
      const batchRef = millingBatch ? `batch-${millingBatch.id}` : null;

      const lotSelectFields = [
        'l.id', 'l.lot_no', 'l.item_name', 'l.type', 'l.entity', 'l.batch_ref',
        'l.qty', 'l.available_qty', 'l.reserved_qty', 'l.status',
        'l.net_weight_kg', 'l.rate_per_kg', 'l.landed_cost_per_kg',
        'l.variety', 'l.grade', 'l.moisture_pct', 'l.broken_pct',
        'l.total_bags', 'l.bag_size_kg', 'l.purchase_date',
        's.name as supplier_name',
        'w.name as warehouse_name',
        'p.name as product_name',
      ];

      const [reservedLots, allocatedTxns, millingOutputLots] = await Promise.all([
        // Path 1: Lots explicitly reserved against this order
        db('inventory_lots as l')
          .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
          .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
          .leftJoin('products as p', 'l.product_id', 'p.id')
          .select(...lotSelectFields)
          .where('l.reserved_against', order.order_no),

        // Path 2: Lots with allocation transactions for THIS order only
        // Exclude outbound transfers (warehouse_transfer_out) — those are the source side
        // of a mill→export transfer, not an actual allocation TO this order
        db('lot_transactions as lt')
          .leftJoin('inventory_lots as l', 'lt.lot_id', 'l.id')
          .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
          .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
          .leftJoin('products as p', 'l.product_id', 'p.id')
          .select(
            ...lotSelectFields,
            'lt.quantity_kg as allocated_qty_kg',
            'lt.rate_per_kg as txn_rate_per_kg',
            'lt.transaction_type',
            'lt.transaction_no',
            'lt.transaction_date'
          )
          .where('lt.reference_module', 'export_order')
          .whereNotIn('lt.transaction_type', ['warehouse_transfer_out'])
          .where(function () {
            this.where('lt.reference_id', orderId)
              .orWhere('lt.reference_no', order.order_no);
          }),

        // Path 4: Finished/byproduct lots from milling batch linked to this order
        // batch_ref can be batch_no (M-229) or batch-{id} (batch-12)
        millingBatch
          ? db('inventory_lots as l')
              .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
              .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
              .leftJoin('products as p', 'l.product_id', 'p.id')
              .select(...lotSelectFields)
              .where(function () {
                this.where('l.batch_ref', batchRef)
                  .orWhere('l.batch_ref', batchNo);
              })
              .whereIn('l.type', ['finished', 'byproduct'])
          : Promise.resolve([]),
      ]);

      // Merge and deduplicate lots (a lot may appear in multiple queries)
      const lotMap = new Map();
      for (const lot of reservedLots) {
        lotMap.set(lot.id, {
          ...lot,
          allocated_qty_kg: null,
          source: 'reservation',
        });
      }
      for (const txn of allocatedTxns) {
        const existing = lotMap.get(txn.id);
        if (existing) {
          existing.allocated_qty_kg = Math.abs(parseFloat(txn.allocated_qty_kg) || 0);
          existing.source = 'both';
        } else {
          lotMap.set(txn.id, {
            ...txn,
            allocated_qty_kg: Math.abs(parseFloat(txn.allocated_qty_kg) || 0),
            source: 'allocation',
          });
        }
      }
      // Collect batch_refs already present from export-entity lots (via allocation/transfer)
      const exportBatchRefs = new Set();
      for (const [, lot] of lotMap) {
        if (lot.entity === 'export' && lot.batch_ref) exportBatchRefs.add(lot.batch_ref);
      }

      for (const lot of millingOutputLots) {
        if (lotMap.has(lot.id)) continue;
        // Skip mill-entity finished lots when an export-entity lot from the same batch
        // already exists (it was transferred — showing both would double-count)
        if (lot.entity === 'mill' && lot.type === 'finished' && lot.batch_ref && exportBatchRefs.has(lot.batch_ref)) continue;
        const isReservedForUs = lot.reserved_against === order.order_no;
        lotMap.set(lot.id, {
          ...lot,
          allocated_qty_kg: isReservedForUs ? (parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000) : 0,
          source: 'milling_output',
        });
      }
      const purchaseLots = Array.from(lotMap.values());

      // Source-batch by-product pricing (INTERNAL/ADMIN ONLY — never on the
      // customer-facing export documents): the per-grade output valuation of the
      // milling batch(es) that produced the exported rice (same basis as Batch
      // 360). Gated to admin roles; omitted entirely for everyone else.
      const num = (v) => parseFloat(v) || 0;
      const ADMIN_PRICING_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];
      let roleName = req.user && req.user._roleName;
      if (!roleName && req.user && req.user.role_id) {
        const rr = await db('roles').where({ id: req.user.role_id }).select('name').first();
        roleName = rr && rr.name;
      }
      let batchByproducts = [];
      if (ADMIN_PRICING_ROLES.includes(roleName)) {
        const refSet = new Set();
        if (millingBatch) refSet.add(`batch-${millingBatch.id}`);
        for (const lot of purchaseLots) if (lot.batch_ref) refSet.add(lot.batch_ref);
        const numericIds = new Set(); const batchNos = new Set();
        for (const ref of refSet) { const m = /^batch-(\d+)$/.exec(String(ref)); if (m) numericIds.add(parseInt(m[1], 10)); else batchNos.add(String(ref)); }
        if (batchNos.size) { const bs = await db('milling_batches').whereIn('batch_no', [...batchNos]).select('id'); bs.forEach(b => numericIds.add(b.id)); }
        const batchIds = [...numericIds];
        if (batchIds.length) {
          const priceBatches = await db('milling_batches').whereIn('id', batchIds)
            .select('id', 'batch_no', 'finished_price_per_mt', 'b1_price_per_mt', 'b2_price_per_mt', 'b3_price_per_mt',
              'csr_price_per_mt', 'short_grain_price_per_mt', 'broken_price_per_mt', 'powder_price_per_mt',
              'sweeping_price_per_mt', 'choba_price_per_mt', 'sortex_rejects_price_per_mt');
          const priceById = {}; const refToId = {};
          for (const b of priceBatches) { priceById[b.id] = b; refToId[`batch-${b.id}`] = b.id; if (b.batch_no) refToId[b.batch_no] = b.id; }
          const outLots = await db('inventory_lots as l').leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
            .whereIn('l.batch_ref', Object.keys(refToId)).whereIn('l.type', ['finished', 'byproduct'])
            .select('l.id', 'l.lot_no', 'l.batch_ref', 'l.type', 'l.item_name', 'l.grade', 'l.variety',
              'l.net_weight_kg', 'l.received_net_weight_kg', 'l.landed_cost_per_kg', 'w.name as warehouse_name');
          const priceForOutput = (o, b) => {
            const g = String(o.grade || '').toUpperCase();
            const n = String(o.item_name || '').toLowerCase();
            let perMt = 0;
            if (o.type === 'finished') perMt = num(b.finished_price_per_mt);
            else if (g === 'B1') perMt = num(b.b1_price_per_mt);
            else if (g === 'B2') perMt = num(b.b2_price_per_mt);
            else if (g === 'B3') perMt = num(b.b3_price_per_mt);
            else if (g === 'CSR') perMt = num(b.csr_price_per_mt);
            else if (g === 'SHORT GRAIN') perMt = num(b.short_grain_price_per_mt);
            else if (n.includes('powder')) perMt = num(b.powder_price_per_mt);
            else if (n.includes('sweep')) perMt = num(b.sweeping_price_per_mt);
            else if (n.includes('choba')) perMt = num(b.choba_price_per_mt);
            else if (n.includes('sortex')) perMt = num(b.sortex_rejects_price_per_mt);
            else if (n.includes('broken')) perMt = num(b.broken_price_per_mt);
            return perMt / 1000;
          };
          const byBatch = {};
          for (const o of outLots) {
            const bid = refToId[o.batch_ref]; if (!bid) continue;
            const b = priceById[bid] || {};
            const produced = num(o.received_net_weight_kg) || num(o.net_weight_kg);
            const salePerKg = priceForOutput(o, b);
            (byBatch[bid] = byBatch[bid] || []).push({
              lotId: o.id, lotNo: o.lot_no, type: o.type,
              productGrade: o.grade || o.item_name || '—', riceType: o.variety || o.item_name || '—',
              producedKg: produced, costPerKg: num(o.landed_cost_per_kg),
              salePricePerKg: salePerKg, recoveryValue: produced * salePerKg,
              warehouse: o.warehouse_name || null, href: `/lot-inventory/${o.id}`,
            });
          }
          batchByproducts = batchIds.map(bid => ({
            batchId: bid, batchNo: (priceById[bid] || {}).batch_no || `#${bid}`, batchHref: `/milling/${bid}`,
            outputs: (byBatch[bid] || []).sort((a, c) => (a.type === 'byproduct' ? 0 : 1) - (c.type === 'byproduct' ? 0 : 1)),
            byproductRecovery: (byBatch[bid] || []).filter(o => o.type === 'byproduct').reduce((s, o) => s + o.recoveryValue, 0),
          })).filter(x => x.outputs.length);
        }
      }

      return res.json({
        success: true,
        data: {
          order,
          costs,
          documents,
          statusHistory,
          millingBatch: millingBatch || null,
          packingLines: packingLines || [],
          shipmentContainers: withLots,
          purchaseLots,
          batchByproducts, // INTERNAL/ADMIN ONLY — empty for non-admin viewers
        },
      });
    } catch (err) {
      console.error('Export order getById error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async create(req, res) {
    try {
      const {
        customer_id,
        product_id,
        product_name,
        qty_mt,
        price_per_mt,
        currency,
        incoterm,
        country,
        destination_port,
        advance_pct,
        shipment_eta,
        source,
        notes,
        status: requestedStatus,
        // Bag specification fields
        bag_type,
        bag_quality,
        bag_size_kg,
        bag_weight_gm,
        bag_printing,
        bag_color,
        bag_brand,
        units_per_bag,
        bag_notes,
        master_bag_size_kg,
        master_bag_type,
        payment_terms,
        // Packing / receiving mode
        receiving_mode,
        quantity_unit,
        quantity_input_value,
        total_bags: input_total_bags,
        total_loose_weight_kg,
        packing_notes,
        packing_lines, // array of packing line objects for mixed mode
        items, // array of P.I. line items (multi-product)
      } = req.body;

      // When `items[]` is sent, derive summary fields from the lines so the
      // single-product path below stays identical. The first line's product
      // becomes the order's display/summary product for backwards compat.
      const itemRows = normalizeItems(items);
      let effectiveCustomerId = customer_id;
      let effectiveProductId = product_id;
      let effectiveProductName = product_name;
      let effectiveQtyMt = qty_mt;
      let effectivePricePerMt = price_per_mt;
      if (itemRows) {
        const summary = summarizeItems(itemRows);
        effectiveProductId = summary.product_id || product_id;
        effectiveProductName = summary.product_name || product_name;
        effectiveQtyMt = summary.qty_mt;
        effectivePricePerMt = summary.price_per_mt;
      }

      if (!effectiveCustomerId || !effectiveProductId || !effectiveQtyMt || !effectivePricePerMt) {
        return res.status(400).json({
          success: false,
          message: 'customer_id, product_id, qty_mt, and price_per_mt are required (or provide items[]).',
        });
      }

      const contractValue = parseFloat(effectiveQtyMt) * parseFloat(effectivePricePerMt);
      const advancePct = parseFloat(advance_pct) || 0;
      const advanceExpected = contractValue * (advancePct / 100);
      const balanceExpected = contractValue - advanceExpected;

      // If no advance is required, skip the "Awaiting Advance" gate entirely so
      // the order can proceed to procurement / docs preparation immediately.
      const effectiveStatus = (() => {
        if (!requestedStatus || requestedStatus === 'Draft') return requestedStatus || 'Draft';
        if (advanceExpected === 0 && requestedStatus === 'Awaiting Advance') return 'Advance Received';
        return requestedStatus;
      })();

      // Get locked FX rate via service (unless manually provided)
      const fxRateService = require('../../services/fxRateService');
      const fxResult = await fxRateService.lockRateForOrder(currency || 'USD', new Date().toISOString().split('T')[0], parseFloat(req.body.booked_fx_rate) || null);
      const _lockedFxRate = fxResult.rate;

      const result = await db.transaction(async (trx) => {
        const orderNo = await generateOrderNo(trx);

        const [order] = await trx('export_orders')
          .insert({
            order_no: orderNo,
            customer_id: effectiveCustomerId,
            product_id: effectiveProductId,
            product_name: effectiveProductName || null,
            qty_mt: parseFloat(effectiveQtyMt),
            price_per_mt: parseFloat(effectivePricePerMt),
            currency: currency || 'USD',
            contract_value: contractValue,
            incoterm: incoterm || null,
            country: country || null,
            destination_port: destination_port || null,
            advance_pct: advancePct,
            advance_expected: advanceExpected,
            balance_expected: balanceExpected,
            advance_received: 0,
            balance_received: 0,
            shipment_eta: shipment_eta || null,
            source: source || 'Internal Mill',
            status: effectiveStatus,
            current_step: getStepForStatus(effectiveStatus, 1),
            notes: notes || null,
            created_by: req.user.id,
            // Bag specification
            bag_type: bag_type || null,
            bag_quality: bag_quality || null,
            bag_size_kg: bag_size_kg ? parseFloat(bag_size_kg) : null,
            bag_weight_gm: bag_weight_gm ? parseFloat(bag_weight_gm) : null,
            bag_printing: bag_printing || null,
            bag_color: bag_color || null,
            bag_brand: bag_brand || null,
            units_per_bag: units_per_bag ? parseInt(units_per_bag) : null,
            bag_notes: bag_notes || null,
            master_bag_size_kg: master_bag_size_kg ? parseFloat(master_bag_size_kg) : null,
            master_bag_type: master_bag_type || null,
            payment_terms: payment_terms || null,
            // Which buyer location lines print on documents
            doc_address_mode: ['country', 'port', 'full', 'country_port'].includes(req.body.doc_address_mode)
              ? req.body.doc_address_mode : 'country',
            // Packing / receiving mode
            receiving_mode: receiving_mode || null,
            quantity_unit: quantity_unit || null,
            quantity_input_value: quantity_input_value ? parseFloat(quantity_input_value) : null,
            total_bags: input_total_bags ? parseInt(input_total_bags) : null,
            total_loose_weight_kg: total_loose_weight_kg ? parseFloat(total_loose_weight_kg) : null,
            packing_notes: packing_notes || null,
            // FX rate locking — lock rate at order creation via fxRateService
            booked_fx_rate: (() => {
              const manual = parseFloat(req.body.booked_fx_rate);
              return manual > 0 ? manual : _lockedFxRate;
            })(),
            fx_rate_source: parseFloat(req.body.booked_fx_rate) > 0 ? 'manual' : 'system',
            fx_rate_locked_at: new Date(),
            contract_value_pkr_locked: contractValue * (parseFloat(req.body.booked_fx_rate) > 0 ? parseFloat(req.body.booked_fx_rate) : _lockedFxRate),
          })
          .returning('*');

        // Cost rows are inserted lazily — addCost upserts whatever category
        // the user actually records. Pre-seeding every category at Rs 0
        // produced 10 placeholder rows per order that polluted finance
        // feeds and inflated the table forever.

        // Insert initial status history (log actual status, not always Draft)
        const initialStatus = effectiveStatus;
        const reasonText = initialStatus === 'Draft'
          ? 'Order saved as draft'
          : (advanceExpected === 0 && requestedStatus === 'Awaiting Advance'
              ? 'Order created (0% advance — advance stage skipped)'
              : 'Order created');
        await trx('export_order_status_history').insert({
          order_id: order.id,
          from_status: null,
          to_status: initialStatus,
          changed_by: req.user.id,
          reason: reasonText,
        });

        // Auto-create document checklist for export order
        await documentService.createChecklist(trx, {
          linkedType: 'export_order',
          linkedId: order.id,
          items: [
            { doc_type: 'phyto', is_required: true },
            { doc_type: 'bl_draft', is_required: true },
            { doc_type: 'bl_final', is_required: true },
            { doc_type: 'commercial_invoice', is_required: true },
            { doc_type: 'packing_list', is_required: true },
            { doc_type: 'coo', is_required: true },
            { doc_type: 'fumigation', is_required: true },
          ],
        });

        // Auto-create receivables for advance and balance
        if (order.advance_expected > 0) {
          const advDueDate = new Date();
          advDueDate.setDate(advDueDate.getDate() + 14); // 14 days for advance
          await trx('receivables').insert({
            recv_no: `RCV-ADV-${orderNo}`,
            entity: 'export',
            order_id: order.id,
            customer_id: order.customer_id,
            type: 'Advance',
            expected_amount: order.advance_expected,
            received_amount: 0,
            outstanding: order.advance_expected,
            due_date: advDueDate.toISOString().split('T')[0],
            status: 'Pending',
            currency: order.currency || 'USD',
            aging: 0,
            notes: `Advance ${order.advance_pct}% for order ${orderNo}`,
            fx_rate: order.booked_fx_rate,
            base_amount_pkr: order.advance_expected * (order.booked_fx_rate || 280),
          });
        }
        if (order.balance_expected > 0) {
          const balDueDate = new Date();
          balDueDate.setDate(balDueDate.getDate() + 60); // 60 days for balance
          await trx('receivables').insert({
            recv_no: `RCV-BAL-${orderNo}`,
            entity: 'export',
            order_id: order.id,
            customer_id: order.customer_id,
            type: 'Balance',
            expected_amount: order.balance_expected,
            received_amount: 0,
            outstanding: order.balance_expected,
            due_date: balDueDate.toISOString().split('T')[0],
            status: 'Pending',
            currency: order.currency || 'USD',
            aging: 0,
            notes: `Balance payment for order ${orderNo} (against BL)`,
            fx_rate: order.booked_fx_rate,
            base_amount_pkr: order.balance_expected * (order.booked_fx_rate || 280),
          });
        }

        // Insert P.I. line items (multi-product). When absent, materialize a
        // single line from the order's summary fields so every order has at
        // least one row in export_order_items going forward.
        if (itemRows && itemRows.length > 0) {
          await trx('export_order_items').insert(
            itemRows.map((r) => ({ ...r, order_id: order.id }))
          );
        } else {
          await trx('export_order_items').insert({
            order_id: order.id,
            line_no: 1,
            product_id: effectiveProductId,
            product_name: effectiveProductName || null,
            qty_mt: parseFloat(effectiveQtyMt),
            price_per_mt: parseFloat(effectivePricePerMt),
            line_total: contractValue,
            hs_code: req.body.hs_code || null,
            packing: bag_size_kg
              ? `Packed in ${parseFloat(bag_size_kg)} KG ${bag_type || 'PP'} BAG`
              : null,
            bag_size_kg: bag_size_kg ? parseFloat(bag_size_kg) : null,
            bag_count: input_total_bags ? parseInt(input_total_bags) : null,
            bag_type: bag_type || null,
            bag_quality: bag_quality || null,
            bag_brand: bag_brand || null,
            bag_color: bag_color || null,
            bag_printing: bag_printing || null,
            quality_description: req.body.quality_description || null,
            broken_pct_target: req.body.broken_pct_target ? parseFloat(req.body.broken_pct_target) : null,
            notes: packing_notes || null,
          });
        }

        // Insert packing lines for mixed/bags mode
        if (Array.isArray(packing_lines) && packing_lines.length > 0) {
          const lineRows = packing_lines.map((line, idx) => ({
            order_id: order.id,
            line_no: idx + 1,
            bag_type: line.bag_type || null,
            bag_quality: line.bag_quality || null,
            fill_weight_kg: parseFloat(line.fill_weight_kg) || 0,
            bag_count: parseInt(line.bag_count) || 0,
            total_weight_kg: (parseFloat(line.fill_weight_kg) || 0) * (parseInt(line.bag_count) || 0),
            bag_printing: line.bag_printing || null,
            bag_color: line.bag_color || null,
            bag_brand: line.bag_brand || null,
            notes: line.notes || null,
          }));
          await trx('order_packing_lines').insert(lineRows);
        }

        return order;
      });

      emitExportOrderUpdate(result.id, 'created', { status: result.status });
      return res.status(201).json({
        success: true,
        data: { order: result },
      });
    } catch (err) {
      console.error('Export order create error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async update(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const updates = req.body || {};
      const safeUpdates = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (updates[key] !== undefined) {
          let v = updates[key];
          // Postgres rejects '' for numeric/date columns. Coerce blank
          // strings to null so the same payload works for "clear field"
          // and "leave unset" semantics. Frontend forms send '' for
          // empty inputs by default.
          if (typeof v === 'string' && v.trim() === '' &&
              (NUMERIC_UPDATE_FIELDS.has(key) || DATE_UPDATE_FIELDS.has(key))) {
            v = null;
          }
          safeUpdates[key] = v;
        }
      }

      // Multi-line items override qty/price/contract_value derived from the
      // single-product fields. When items[] is provided, totals are computed
      // from the line rows and the request's qty_mt/price_per_mt are ignored.
      const itemRowsForUpdate = normalizeItems(updates.items);
      if (itemRowsForUpdate) {
        const summary = summarizeItems(itemRowsForUpdate);
        safeUpdates.qty_mt = summary.qty_mt;
        safeUpdates.price_per_mt = summary.price_per_mt;
        safeUpdates.contract_value = summary.contract_value;
        if (summary.product_id) safeUpdates.product_id = summary.product_id;
        if (summary.product_name) safeUpdates.product_name = summary.product_name;
        if (summary.hs_code) safeUpdates.hs_code = summary.hs_code;
      }

      if (safeUpdates.qty_mt != null || safeUpdates.price_per_mt != null || safeUpdates.advance_pct != null) {
        const existing = await db('export_orders').where({ id }).first();
        if (!existing) {
          return res.status(404).json({ success: false, message: 'Export order not found.' });
        }
        const qty = parseFloat(safeUpdates.qty_mt != null ? safeUpdates.qty_mt : existing.qty_mt);
        const price = parseFloat(safeUpdates.price_per_mt != null ? safeUpdates.price_per_mt : existing.price_per_mt);
        const advPct = parseFloat(safeUpdates.advance_pct != null ? safeUpdates.advance_pct : existing.advance_pct) || 0;
        const contractValue = qty * price;
        safeUpdates.contract_value = contractValue;
        safeUpdates.advance_expected = contractValue * (advPct / 100);
        safeUpdates.balance_expected = contractValue - safeUpdates.advance_expected;
      }

      // Extract packing_lines before DB update (it's a separate table, not a column)
      const packingLines = safeUpdates.packing_lines;
      delete safeUpdates.packing_lines;

      safeUpdates.updated_at = db.fn.now();

      const result = await db.transaction(async (trx) => {
        const [order] = await trx('export_orders')
          .where({ id })
          .update(safeUpdates)
          .returning('*');

        if (!order) return null;

        // Replace P.I. line items if items[] was provided.
        if (itemRowsForUpdate) {
          await trx('export_order_items').where({ order_id: id }).del();
          if (itemRowsForUpdate.length > 0) {
            await trx('export_order_items').insert(
              itemRowsForUpdate.map((r) => ({ ...r, order_id: parseInt(id) }))
            );
          }
        }

        // Handle packing_lines update: delete old, insert new
        if (Array.isArray(packingLines)) {
          await trx('order_packing_lines').where({ order_id: id }).del();
          if (packingLines.length > 0) {
            const lineRows = packingLines.map((line, idx) => ({
              order_id: parseInt(id),
              line_no: idx + 1,
              bag_type: line.bag_type || null,
              bag_quality: line.bag_quality || null,
              fill_weight_kg: parseFloat(line.fill_weight_kg) || 0,
              bag_count: parseInt(line.bag_count) || 0,
              total_weight_kg: (parseFloat(line.fill_weight_kg) || 0) * (parseInt(line.bag_count) || 0),
              bag_printing: line.bag_printing || null,
              bag_color: line.bag_color || null,
              bag_brand: line.bag_brand || null,
              notes: line.notes || null,
            }));
            await trx('order_packing_lines').insert(lineRows);
          }
        }

        return order;
      });

      if (!result) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      emitExportOrderUpdate(result.id, 'updated');
      return res.json({
        success: true,
        data: { order: result },
      });
    } catch (err) {
      console.error('Export order update error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateStatus(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { status, notes } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, message: 'New status is required.' });
      }

      const order = await db('export_orders').where({ id }).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      await db.transaction(async (trx) => {
        await workflowService.transitionOrder(trx, {
          order,
          toStatus: status,
          userId: req.user.id,
          reason: notes || null,
        });
      });

      const updated = await db('export_orders').where({ id }).first();

      emitExportOrderUpdate(updated.id, 'status_updated', { status: updated.status });
      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order updateStatus error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateShipment(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const {
        vessel_name, booking_no, container_no, containers,
        bl_number, bl_date, shipping_line, etd, atd, eta, ata,
        destination_port, notes,
        voyage_number, gd_number, gd_date,
        fi_number, fi_number_2, fi_number_3, fi_date,
        freight_terms, consignee_type,
        shipment_window_start, shipment_window_end,
        notify_party_name, notify_party_address, notify_party_phone, notify_party_email,
        shipment_remarks,
      } = req.body;

      const order = await db('export_orders').where({ id }).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      if (['Closed', 'Cancelled'].includes(order.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update shipment for an order in '${order.status}' status.`,
        });
      }

      let transitionedTo = null;
      const hasContainerRows = Array.isArray(containers)
        || Object.prototype.hasOwnProperty.call(req.body, 'containers')
        || Object.prototype.hasOwnProperty.call(req.body, 'container_no');
      const normalizedContainers = parseShipmentContainerRows(containers, container_no);

      await db.transaction(async (trx) => {
        if (hasContainerRows) {
          // Deleting the containers cascades their container_lots away.
          await trx('shipment_containers').where({ order_id: order.id }).del();
          if (normalizedContainers.length > 0) {
            // Split the structured lot links off the DB columns, insert the
            // containers, then map each back to its new id by sequence_no to
            // write container_lots. lot_number stays in sync (joined lot_nos)
            // for back-compat / documents.
            const dbRows = normalizedContainers.map(({ lots, ...row }) => ({
              ...row,
              // These columns are NOT NULL with a default; an explicit null
              // bypasses the default, so coerce when the caller omitted them.
              gross_weight_kg: row.gross_weight_kg ?? 0,
              net_weight_kg: row.net_weight_kg ?? 0,
              container_type: row.container_type ?? '20ft',
              order_id: order.id,
              created_by: req.user.id,
            }));
            const inserted = await trx('shipment_containers')
              .insert(dbRows)
              .returning(['id', 'sequence_no']);
            const idBySeq = Object.fromEntries(inserted.map((r) => [Number(r.sequence_no), r.id]));

            const lotLinks = [];
            for (const c of normalizedContainers) {
              const cid = idBySeq[Number(c.sequence_no)];
              if (!cid) continue;
              for (const l of (c.lots || [])) {
                lotLinks.push({ container_id: cid, lot_id: l.lot_id, qty_kg: l.qty_kg, bags: l.bags, created_by: req.user.id });
              }
            }
            if (lotLinks.length > 0) {
              // Only link lots that actually exist; FK would reject bad ids and
              // abort the whole shipment save otherwise.
              const lotIds = [...new Set(lotLinks.map((l) => l.lot_id))];
              const realIds = new Set(await trx('inventory_lots').whereIn('id', lotIds).pluck('id'));
              const valid = lotLinks.filter((l) => realIds.has(l.lot_id));
              if (valid.length > 0) await trx('container_lots').insert(valid);
              // Sync lot_number text from the linked lots (per sequence) for docs.
              const noByCid = {};
              const lotNoById = Object.fromEntries(
                (await trx('inventory_lots').whereIn('id', lotIds).select('id', 'lot_no')).map((r) => [r.id, r.lot_no])
              );
              for (const l of valid) {
                noByCid[l.container_id] = noByCid[l.container_id] ? `${noByCid[l.container_id]}, ${lotNoById[l.lot_id]}` : lotNoById[l.lot_id];
              }
              for (const [cid, lotNo] of Object.entries(noByCid)) {
                await trx('shipment_containers').where('id', cid).update({ lot_number: lotNo });
              }
            }
          }
        }

        await trx('export_orders').where({ id }).update({
          vessel_name: vessel_name || null,
          booking_no: booking_no || null,
          bl_number: bl_number || null,
          bl_date: bl_date || order.bl_date || null,
          shipping_line: shipping_line || null,
          etd: etd || null,
          atd: atd || null,
          eta: eta || null,
          ata: ata || null,
          destination_port: destination_port || null,
          voyage_number: voyage_number || null,
          gd_number: gd_number || null,
          gd_date: gd_date || null,
          fi_number: fi_number || order.fi_number || null,
          fi_number_2: fi_number_2 || order.fi_number_2 || null,
          fi_number_3: fi_number_3 || order.fi_number_3 || null,
          fi_date: fi_date || order.fi_date || null,
          freight_terms: freight_terms || order.freight_terms || null,
          consignee_type: consignee_type || order.consignee_type || null,
          shipment_window_start: shipment_window_start || order.shipment_window_start || null,
          shipment_window_end: shipment_window_end || order.shipment_window_end || null,
          notify_party_name: notify_party_name || order.notify_party_name || null,
          notify_party_address: notify_party_address || order.notify_party_address || null,
          notify_party_phone: notify_party_phone || order.notify_party_phone || null,
          notify_party_email: notify_party_email || order.notify_party_email || null,
          shipment_remarks: shipment_remarks || order.shipment_remarks || null,
          updated_at: trx.fn.now(),
        });

        let currentOrder = {
          ...order,
          vessel_name: vessel_name || null,
          booking_no: booking_no || null,
          bl_number: bl_number || null,
          shipping_line: shipping_line || null,
          etd: etd || null,
          atd: atd || null,
          eta: eta || null,
          ata: ata || null,
          destination_port: destination_port || null,
        };

        if (ata) {
          if (currentOrder.status === 'Shipped') {
            currentOrder = await workflowService.transitionOrder(trx, {
              order: currentOrder,
              toStatus: 'Arrived',
              userId: req.user.id,
              reason: notes || `Shipment arrived on ${ata}`,
            });
            transitionedTo = 'Arrived';
          } else if (currentOrder.status !== 'Arrived') {
            const err = new Error(`Cannot mark arrival while order is in '${currentOrder.status}' status.`);
            err.statusCode = 400;
            throw err;
          }
        } else if (atd) {
          if (currentOrder.status === 'Ready to Ship') {
            currentOrder = await workflowService.transitionOrder(trx, {
              order: currentOrder,
              toStatus: 'Shipped',
              userId: req.user.id,
              reason: notes || `Shipment departed on ${atd}`,
            });
            transitionedTo = 'Shipped';
          } else if (currentOrder.status !== 'Shipped') {
            const err = new Error(`Cannot mark shipment departure while order is in '${currentOrder.status}' status.`);
            err.statusCode = 400;
            throw err;
          }
        }
      });

      const [updated, shipmentRows] = await Promise.all([
        db('export_orders').where({ id }).first(),
        db('shipment_containers').where({ order_id: id }).orderBy('sequence_no', 'asc'),
      ]);
      if (updated) {
        updated.shipment_containers = shipmentRows || [];
        updated.shipmentContainers = shipmentRows || [];
      }
      emitExportOrderUpdate(updated.id, 'shipment_updated', { transitionedTo });
      return res.json({
        success: true,
        data: { order: updated, shipmentContainers: shipmentRows || [], transitioned_to: transitionedTo },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order updateShipment error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async startDocsPreparation(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { notes } = req.body;

      const order = await db('export_orders').where({ id }).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      await db.transaction(async (trx) => {
        await workflowService.transitionOrder(trx, {
          order,
          toStatus: 'Docs In Preparation',
          userId: req.user.id,
          reason: notes || 'Document preparation started',
        });
      });

      const updated = await db('export_orders').where({ id }).first();
      emitExportOrderUpdate(updated.id, 'docs_started', { status: updated.status });
      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order startDocsPreparation error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async requestBalance(req, res) {
    try {
      const rawId = req.params.id;
      const isNumeric = /^\d+$/.test(rawId);
      const whereClause = isNumeric ? { id: parseInt(rawId) } : { order_no: rawId };
      const { notes } = req.body;

      const order = await db('export_orders').where(whereClause).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      if (order.status !== 'Awaiting Balance') {
        return res.status(400).json({
          success: false,
          message: `Balance can only be requested while order is in 'Awaiting Balance', not '${order.status}'.`,
        });
      }

      const outstandingBalance = Math.max(
        0,
        settledAmount(order.balance_expected) - settledAmount(order.balance_received)
      );
      if (outstandingBalance <= MONEY_EPSILON) {
        return res.status(400).json({
          success: false,
          message: 'Balance has already been fully received for this order.',
        });
      }

      try {
        await emailService.sendBalanceReminder({ orderId: order.id, userId: req.user.id });
      } catch (err) {
        console.error('Balance reminder email failed:', err.message);
      }

      await db('export_order_status_history').insert({
        order_id: order.id,
        from_status: order.status,
        to_status: order.status,
        changed_by: req.user.id,
        reason: notes || 'Balance payment requested',
      });

      const updated = await db('export_orders').where({ id: order.id }).first();
      emitExportOrderUpdate(updated.id, 'balance_requested', { outstandingBalance });
      return res.json({
        success: true,
        data: { order: updated, requested_amount: outstandingBalance },
      });
    } catch (err) {
      console.error('Export order requestBalance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addCost(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { category, amount, notes } = req.body;

      if (!category || amount == null) {
        return res.status(400).json({
          success: false,
          message: 'category and amount are required.',
        });
      }

      const order = await db('export_orders').where({ id }).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      // Export-order outflows are always paid in PKR — keep base_amount_pkr
      // in lock-step with amount so the unified finance/purchases query and
      // any PKR-based reporting see the same number.
      const amtPkr = parseFloat(amount);

      const cost = await db.transaction(async (trx) => {
        const existing = await trx('export_order_costs')
          .where({ order_id: id, category })
          .first();

        let row;
        let priorAmtPkr = 0;
        if (existing) {
          priorAmtPkr = parseFloat(existing.base_amount_pkr) || (parseFloat(existing.amount) || 0) * (parseFloat(existing.fx_rate) || 1);
          [row] = await trx('export_order_costs')
            .where({ id: existing.id })
            .update({
              amount: amtPkr,
              base_amount_pkr: amtPkr,
              fx_rate: 1,
              notes: notes || null,
              updated_at: trx.fn.now(),
            })
            .returning('*');
        } else {
          [row] = await trx('export_order_costs')
            .insert({
              order_id: id,
              category,
              amount: amtPkr,
              currency: 'PKR',
              base_amount_pkr: amtPkr,
              fx_rate: 1,
              notes: notes || null,
              created_by: req.user?.id || null,
            })
            .returning('*');
        }

        // ─── Cost-recognition journal ───────────────────────────
        // Recording a cost creates an obligation: DR Operating Expenses,
        // CR Supplier Payable. The matching payment journal (DR
        // Supplier Payable, CR Cash & Bank) is posted later by
        // payPurchase. If the user edits an existing cost, post the
        // *delta* so we don't double-count. Skipped silently if the
        // GL chart isn't seeded yet.
        try {
          const delta = amtPkr - priorAmtPkr;
          if (Math.abs(delta) > 0.01) {
            const opExp = await trx('chart_of_accounts').where({ code: '6000' }).first();
            const supplierPayable = await trx('chart_of_accounts').where({ code: '2010' }).first();
            if (opExp && supplierPayable) {
              const sign = delta > 0 ? 1 : -1;
              const absDelta = Math.abs(delta);
              const debitAcc  = sign > 0 ? opExp           : supplierPayable;
              const creditAcc = sign > 0 ? supplierPayable : opExp;
              const refLabel = `${order.order_no} ${category}`;
              const journal = await accountingService.createJournal(trx, {
                date: new Date().toISOString().slice(0, 10),
                entity: 'export',
                refType: 'Export Order Cost',
                refNo: refLabel,
                description: existing
                  ? `Cost adjustment Rs ${Math.round(absDelta).toLocaleString()} for ${refLabel}${delta < 0 ? ' (reduced)' : ''}`
                  : `Cost recorded Rs ${Math.round(absDelta).toLocaleString()} for ${refLabel}`,
                currency: 'PKR',
                fxRate: 1,
                isAuto: true,
                userId: req.user?.id || null,
                lines: [
                  { account_id: debitAcc.id,  account: debitAcc.name,  debit: absDelta, credit: 0,        narration: `DR ${debitAcc.code} ${debitAcc.name} — ${refLabel}` },
                  { account_id: creditAcc.id, account: creditAcc.name, debit: 0,        credit: absDelta, narration: `CR ${creditAcc.code} ${creditAcc.name} — ${refLabel}` },
                ],
              });
              if (journal?.id) await accountingService.postJournal(trx, journal.id);
            } else {
              console.warn(`addCost: chart_of_accounts missing 6000/2010 — journal skipped for ${order.order_no} ${category}`);
            }
          }
        } catch (jeErr) {
          console.error('addCost journal error (cost still recorded):', jeErr.message);
        }

        // ─── Mirror to payables ────────────────────────────────────
        // Make every export-order cost show up on /finance/money-out by
        // ensuring it has a 1:1 row in payables (source_table='export_order_costs',
        // source_id=row.id). On edits, sync original_amount / outstanding
        // to the new amount.
        try {
          const existingPayable = await trx('payables')
            .where({ source_table: 'export_order_costs', source_id: row.id })
            .first();
          const paidAmt = parseFloat(row.paid_amount) || 0;
          const status = paidAmt >= amtPkr - 0.01 ? 'Paid' : (paidAmt > 0 ? 'Partial' : 'Pending');
          const refLabel = `${order.order_no} ${category}`;
          if (existingPayable) {
            await trx('payables')
              .where({ id: existingPayable.id })
              .update({
                linked_ref: refLabel,
                original_amount: amtPkr,
                outstanding: Math.max(0, amtPkr - paidAmt),
                status,
                notes: notes || existingPayable.notes,
                updated_at: trx.fn.now(),
              });
          } else {
            const last = await trx('payables').where('pay_no', 'like', 'PAY-EOC%').orderBy('id', 'desc').first();
            const nextSeq = last ? (parseInt(String(last.pay_no).replace(/^PAY-EOC/, ''), 10) || 0) + 1 : 1;
            const payNo = `PAY-EOC${String(nextSeq).padStart(4, '0')}`;
            await trx('payables').insert({
              pay_no: payNo,
              entity: 'export',
              category: category || 'export_cost',
              supplier_id: null,
              linked_ref: refLabel,
              original_amount: amtPkr,
              paid_amount: paidAmt,
              outstanding: Math.max(0, amtPkr - paidAmt),
              currency: 'PKR',
              due_date: new Date().toISOString().slice(0, 10),
              status,
              source_table: 'export_order_costs',
              source_id: row.id,
              payable_type: 'expense',
              notes: notes || `Export order cost ${refLabel}`,
            });
          }
        } catch (payErr) {
          console.error('addCost payables sync error (cost still recorded):', payErr.message);
        }

        return row;
      });

      emitExportOrderUpdate(order.id, 'cost_updated', { category });
      return res.json({
        success: true,
        data: { cost },
      });
    } catch (err) {
      console.error('Export order addCost error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async uploadDocument(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { doc_type, file_path, version, notes } = req.body;
      const result = await applyDocumentAction({
        orderRef: id,
        userId: req.user.id,
        docType: doc_type,
        targetStatus: 'Draft Uploaded',
        filePath: file_path,
        version,
        notes,
      });
      emitExportOrderUpdate(result.orderId, 'document_uploaded', { docType: doc_type, orderStatusChanged: result.orderStatusChanged });
      return res.json({ success: true, data: { document: result.doc, order_status_changed: result.orderStatusChanged } });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order uploadDocument error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async approveDocument(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { doc_type, file_path, version, notes } = req.body;
      const result = await applyDocumentAction({
        orderRef: id,
        userId: req.user.id,
        docType: doc_type,
        targetStatus: 'Approved',
        filePath: file_path,
        version,
        notes,
      });
      emitExportOrderUpdate(result.orderId, 'document_approved', { docType: doc_type, orderStatusChanged: result.orderStatusChanged });
      return res.json({ success: true, data: { document: result.doc, order_status_changed: result.orderStatusChanged } });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order approveDocument error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async finalizeDocument(req, res) {
    try {
      const id = await resolveExportOrderId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Export order not found.' });
      const { doc_type, file_path, version, notes } = req.body;
      const result = await applyDocumentAction({
        orderRef: id,
        userId: req.user.id,
        docType: doc_type,
        targetStatus: 'Final',
        filePath: file_path,
        version,
        notes,
      });
      emitExportOrderUpdate(result.orderId, 'document_finalized', { docType: doc_type, orderStatusChanged: result.orderStatusChanged });
      return res.json({ success: true, data: { document: result.doc, order_status_changed: result.orderStatusChanged } });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order finalizeDocument error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async confirmAdvance(req, res) {
    try {
      const rawId = req.params.id;
      const isNumeric = /^\d+$/.test(rawId);
      const whereClause = isNumeric ? { id: parseInt(rawId) } : { order_no: rawId };
      const { amount, payment_date, payment_method, reference, bank_reference, bank_account_id, notes, fx_rate } = req.body;
      const bankRef = bank_reference || reference || null;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      }

      const confirmedAmount = settledAmount(amount);
      // FX rate captured at receipt time. For PKR-denominated orders
      // this is always 1; for foreign orders the FE collects it from
      // the user (the rate the bank actually applied) — that's the
      // single point where USD→PKR conversion gets locked.
      const requestedFxRate = parseFloat(fx_rate);
      const paymentContext = await db.transaction(async (trx) => {
        const order = await lockRow(trx('export_orders').where(whereClause)).first();
        if (!order) {
          const err = new Error('Export order not found.');
          err.statusCode = 404;
          throw err;
        }

        if (['Closed', 'Cancelled'].includes(order.status)) {
          const err = new Error(`Cannot confirm advance for an order in '${order.status}' status.`);
          err.statusCode = 400;
          throw err;
        }

        const expectedAdvance = settledAmount(order.advance_expected);
        const receivedAdvance = settledAmount(order.advance_received);
        const outstandingAdvance = Math.max(0, settledAmount(expectedAdvance - receivedAdvance));

        if (outstandingAdvance <= MONEY_EPSILON) {
          const err = new Error('Advance has already been fully received for this order.');
          err.statusCode = 400;
          throw err;
        }

        if (confirmedAmount - outstandingAdvance > MONEY_EPSILON) {
          const err = new Error(`Advance confirmation exceeds outstanding amount of ${outstandingAdvance.toFixed(2)}.`);
          err.statusCode = 400;
          throw err;
        }

        const newAdvanceReceived = settledAmount(receivedAdvance + confirmedAmount);

        // Resolve effective FX rate for this advance receipt.
        // For PKR orders: 1. For foreign orders: prefer the rate the
        // user provided in the modal; fall back to the order's
        // booked_fx_rate so older clients (no fx_rate sent) keep
        // working.
        const orderCurrency = order.currency || 'USD';
        const isPkrOrder = orderCurrency === 'PKR';
        const effectiveFxRate = isPkrOrder
          ? 1
          : (Number.isFinite(requestedFxRate) && requestedFxRate > 0
              ? requestedFxRate
              : (parseFloat(order.booked_fx_rate) || 280));
        const advancePkr = settledAmount(confirmedAmount * effectiveFxRate);
        const totalAdvancePkr = settledAmount(
          (parseFloat(order.advance_received_pkr) || 0) + advancePkr
        );

        // Update order advance fields. advance_fx_rate locks the rate
        // for the most recent receipt; advance_received_pkr is the
        // running PKR equivalent banked. Together they let the FX
        // gain/loss vs booked_fx_rate be computed at any time.
        await trx('export_orders').where({ id: order.id }).update({
          advance_received: newAdvanceReceived,
          advance_date: payment_date || trx.fn.now(),
          advance_fx_rate: isPkrOrder ? null : effectiveFxRate,
          advance_received_pkr: totalAdvancePkr,
          updated_at: trx.fn.now(),
        });

        const advReceivable = await trx('receivables')
          .where({ order_id: order.id, type: 'Advance' })
          .first();

        // Guard against a double receipt: the advance may already have been
        // settled through the Money-In "Record Payment" drawer, which updates the
        // RECEIVABLE but NOT order.advance_received — so the order-level check
        // above can be blind to it (this is exactly how EX-001 got two PAY rows
        // on 2026-06-26). Re-check the actual advance receivable.
        if (advReceivable) {
          const recvOutstanding = Math.max(0, settledAmount(
            parseFloat(advReceivable.expected_amount || 0) - parseFloat(advReceivable.received_amount || 0),
          ));
          if (recvOutstanding <= MONEY_EPSILON) {
            const err = new Error('This advance has already been received (the receivable is settled). It may have been recorded via Money-In → Record Payment.');
            err.statusCode = 400;
            throw err;
          }
          if (confirmedAmount - recvOutstanding > MONEY_EPSILON) {
            const err = new Error(`Advance confirmation exceeds the receivable's outstanding amount of ${recvOutstanding.toFixed(2)}.`);
            err.statusCode = 400;
            throw err;
          }
        }

        const advPayNo = await generatePaymentNo(trx, 'PAY');
        await trx('payments').insert({
          payment_no: advPayNo,
          type: 'receipt',
          linked_receivable_id: advReceivable ? advReceivable.id : null,
          amount: confirmedAmount,
          currency: orderCurrency,
          fx_rate: effectiveFxRate,
          base_amount_pkr: advancePkr,
          payment_method: payment_method ? payment_method.toLowerCase().replace(/\s+/g, '_') : null,
          bank_account_id: bank_account_id || null,
          bank_reference: bankRef,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Advance payment for ${order.order_no}`,
          created_by: req.user.id,
        });

        // Update receivable record
        if (advReceivable) {
          const newReceived = settledAmount(parseFloat(advReceivable.received_amount || 0) + confirmedAmount);
          const newOutstanding = Math.max(0, settledAmount(parseFloat(advReceivable.expected_amount) - newReceived));
          await trx('receivables').where({ id: advReceivable.id }).update({
            received_amount: newReceived,
            outstanding: newOutstanding,
            status: newOutstanding <= MONEY_EPSILON ? 'Paid' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Credit bank account balance if a bank account was selected.
        // Use the amount in the account's currency: PKR accounts get
        // the converted PKR amount; foreign-currency accounts that
        // match the order currency get the original amount.
        if (bank_account_id) {
          const bank = await trx('bank_accounts').where({ id: bank_account_id }).first();
          const credit = bank && bank.currency === orderCurrency ? confirmedAmount : advancePkr;
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', credit);
        }

        await workflowService.maybePromoteAfterAdvance(trx, {
          order,
          newAdvanceReceived,
          userId: req.user.id,
          reason: `Advance payment of ${confirmedAmount} confirmed`,
        });

        // Reserve stock if available
        try {
          const availableLot = await trx('inventory_lots')
            .where({ entity: 'export', type: 'finished', status: 'Available' })
            .where('available_qty', '>=', order.qty_mt)
            .first();
          if (availableLot) {
            await inventoryService.reserveStock(trx, {
              lotId: availableLot.id, orderId: order.id,
              qtyMT: order.qty_mt, userId: req.user?.id,
            });
          }
        } catch (e) { console.warn('Stock reservation failed:', e.message); }

        return {
          orderId: order.id,
          orderNo: order.order_no,
          customerId: order.customer_id,
          currency: order.currency || 'USD',
          fxRate: effectiveFxRate,
          advancePkr,
          newAdvanceReceived,
        };
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking).
      // Per the "single conversion point" rule, journal entries are
      // posted in PKR using the receipt-time FX rate. The foreign
      // amount and rate are preserved on the journal header for audit.
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'advance_receipt', entity: 'export',
          amount: paymentContext.advancePkr, currency: 'PKR',
          refType: 'Export Order', refNo: paymentContext.orderNo,
          description: paymentContext.currency === 'PKR'
            ? `Adv rcpt ${paymentContext.orderNo}`
            : `Adv rcpt ${paymentContext.orderNo} (${paymentContext.currency} ${confirmedAmount.toLocaleString()} @ ${paymentContext.fxRate})`,
          userId: req.user?.id,
          partyType: paymentContext.customerId ? 'customer' : null,
          partyId: paymentContext.customerId || null,
          // Record the original foreign currency + rate so the ledger can show
          // an exact USD figure (PKR lines keep the GL consistent).
          origCurrency: paymentContext.currency !== 'PKR' ? paymentContext.currency : null,
          origFxRate: paymentContext.currency !== 'PKR' ? paymentContext.fxRate : null,
        });
      } catch (e) { console.warn('Advance journal failed:', e.message); }
      try {
        await automationService.onAdvanceConfirmed(db, {
          orderId: paymentContext.orderId, amount: confirmedAmount, userId: req.user.id,
        });
      } catch (e) { console.warn('Advance automation failed:', e.message); }

      const updated = await db('export_orders').where(whereClause).first();

      emitExportOrderUpdate(updated.id, 'advance_confirmed', { status: updated.status });
      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order confirmAdvance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async confirmBalance(req, res) {
    try {
      const rawId = req.params.id;
      const isNumericBal = /^\d+$/.test(rawId);
      const whereClauseBal = isNumericBal ? { id: parseInt(rawId) } : { order_no: rawId };
      const { amount, payment_date, payment_method, reference, bank_reference, bank_account_id, notes, fx_rate } = req.body;
      const bankRef = bank_reference || reference || null;
      const requestedFxRate = parseFloat(fx_rate);

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      }

      const confirmedAmount = settledAmount(amount);
      const paymentContext = await db.transaction(async (trx) => {
        const order = await lockRow(trx('export_orders').where(whereClauseBal)).first();
        if (!order) {
          const err = new Error('Export order not found.');
          err.statusCode = 404;
          throw err;
        }

        if (['Closed', 'Cancelled'].includes(order.status)) {
          const err = new Error(`Cannot confirm balance for an order in '${order.status}' status.`);
          err.statusCode = 400;
          throw err;
        }

        const expectedBalance = settledAmount(order.balance_expected);
        const receivedBalance = settledAmount(order.balance_received);
        const outstandingBalance = Math.max(0, settledAmount(expectedBalance - receivedBalance));

        if (outstandingBalance <= MONEY_EPSILON) {
          const err = new Error('Balance has already been fully received for this order.');
          err.statusCode = 400;
          throw err;
        }

        if (confirmedAmount - outstandingBalance > MONEY_EPSILON) {
          const err = new Error(`Balance confirmation exceeds outstanding amount of ${outstandingBalance.toFixed(2)}.`);
          err.statusCode = 400;
          throw err;
        }

        const newBalanceReceived = settledAmount(receivedBalance + confirmedAmount);

        // Resolve the FX rate to lock for this balance leg.
        // Foreign currency: require an explicit rate from the operator
        // (per business rule — bank's actual applied rate at receipt).
        // Fall back to advance/booked rate only when none was supplied,
        // so older clients keep working.
        const balanceCurrency = order.currency || 'USD';
        const isPkrOrder = balanceCurrency === 'PKR';
        const effectiveBalanceFxRate = isPkrOrder
          ? 1
          : (requestedFxRate > 0
              ? requestedFxRate
              : (parseFloat(order.advance_fx_rate) || parseFloat(order.booked_fx_rate) || 280));
        const balancePkr = settledAmount(confirmedAmount * effectiveBalanceFxRate);
        const totalBalanceReceivedPkr = settledAmount(
          (parseFloat(order.balance_received_pkr) || 0) + balancePkr
        );

        await trx('export_orders').where({ id: order.id }).update({
          balance_received: newBalanceReceived,
          balance_date: payment_date || trx.fn.now(),
          balance_fx_rate: isPkrOrder ? null : effectiveBalanceFxRate,
          balance_received_pkr: totalBalanceReceivedPkr,
          updated_at: trx.fn.now(),
        });

        const balReceivable = await trx('receivables')
          .where({ order_id: order.id, type: 'Balance' })
          .first();

        const balPayNo = await generatePaymentNo(trx, 'PAY');
        await trx('payments').insert({
          payment_no: balPayNo,
          type: 'receipt',
          linked_receivable_id: balReceivable ? balReceivable.id : null,
          amount: confirmedAmount,
          currency: balanceCurrency,
          fx_rate: effectiveBalanceFxRate,
          base_amount_pkr: balancePkr,
          payment_method: payment_method ? payment_method.toLowerCase().replace(/\s+/g, '_') : null,
          bank_account_id: bank_account_id || null,
          bank_reference: bankRef,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Balance payment for ${order.order_no}`,
          created_by: req.user.id,
        });

        // Update receivable record
        if (balReceivable) {
          const newReceived = settledAmount(parseFloat(balReceivable.received_amount || 0) + confirmedAmount);
          const newOutstanding = Math.max(0, settledAmount(parseFloat(balReceivable.expected_amount) - newReceived));
          await trx('receivables').where({ id: balReceivable.id }).update({
            received_amount: newReceived,
            outstanding: newOutstanding,
            status: newOutstanding <= MONEY_EPSILON ? 'Paid' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Credit bank account balance if a bank account was selected
        if (bank_account_id) {
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', confirmedAmount);
        }

        await workflowService.maybePromoteAfterBalance(trx, {
          order,
          newBalanceReceived,
          userId: req.user.id,
          reason: `Balance payment of ${confirmedAmount} confirmed`,
        });
        return {
          orderId: order.id,
          orderNo: order.order_no,
          customerId: order.customer_id,
          currency: balanceCurrency,
          fxRate: effectiveBalanceFxRate,
          balancePkr,
        };
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking).
      // Posted in PKR with the foreign amount + rate captured in the
      // narration for audit.
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'balance_receipt', entity: 'export',
          amount: paymentContext.balancePkr, currency: 'PKR',
          refType: 'Export Order', refNo: paymentContext.orderNo,
          description: paymentContext.currency === 'PKR'
            ? `Bal rcpt ${paymentContext.orderNo}`
            : `Bal rcpt ${paymentContext.orderNo} (${paymentContext.currency} ${confirmedAmount.toLocaleString()} @ ${paymentContext.fxRate})`,
          userId: req.user?.id,
          partyType: paymentContext.customerId ? 'customer' : null,
          partyId: paymentContext.customerId || null,
          origCurrency: paymentContext.currency !== 'PKR' ? paymentContext.currency : null,
          origFxRate: paymentContext.currency !== 'PKR' ? paymentContext.fxRate : null,
        });
      } catch (e) { console.warn('Balance journal failed:', e.message); }
      try {
        await automationService.onBalanceConfirmed(db, {
          orderId: paymentContext.orderId, amount: confirmedAmount, userId: req.user.id,
        });
      } catch (e) { console.warn('Balance automation failed:', e.message); }

      const updated = await db('export_orders').where(whereClauseBal).first();

      emitExportOrderUpdate(updated.id, 'balance_confirmed', { status: updated.status });
      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order confirmBalance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async allocateStock(req, res) {
    try {
      const rawId = req.params.id;
      const isNumeric = /^\d+$/.test(rawId);
      const whereClause = isNumeric ? { id: parseInt(rawId) } : { order_no: rawId };
      const { lot_id, qty_mt, notes, item_id } = req.body;

      if (!lot_id) {
        return res.status(400).json({ success: false, message: 'lot_id is required.' });
      }
      const qtyMT = parseFloat(qty_mt);
      if (!qtyMT || qtyMT <= 0) {
        return res.status(400).json({ success: false, message: 'A positive qty_mt is required.' });
      }
      const itemId = item_id ? parseInt(item_id, 10) : null;

      const allocationContext = await db.transaction(async (trx) => {
        const order = await lockRow(trx('export_orders').where(whereClause)).first();
        if (!order) {
          const err = new Error('Export order not found.');
          err.statusCode = 404;
          throw err;
        }

        const lot = await lockRow(trx('inventory_lots').where({ id: lot_id })).first();
        if (!lot) {
          const err = new Error('Inventory lot not found.');
          err.statusCode = 404;
          throw err;
        }

        const available = parseFloat(lot.available_qty) || 0;
        if (qtyMT > available) {
          const err = new Error(`Requested ${qtyMT} MT but only ${available} MT available in ${lot.lot_no}.`);
          err.statusCode = 400;
          throw err;
        }

        // If an order line was named, it must belong to this order.
        if (itemId) {
          const item = await trx('export_order_items').where({ id: itemId, order_id: order.id }).first();
          if (!item) {
            const err = new Error('Order line not found for this export order.');
            err.statusCode = 400;
            throw err;
          }
        }

        await inventoryService.reserveStock(trx, {
          lotId: lot.id,
          orderId: order.id,
          qtyMT,
          itemId,
          userId: req.user?.id,
        });

        // reserveStock now handles: lot update, reservation record, AND ledger entry
        // No direct inventory_lots or lot_transactions writes needed here

        await trx('export_order_status_history').insert({
          order_id: order.id,
          from_status: order.status,
          to_status: order.status,
          changed_by: req.user?.id,
          reason: `${qtyMT} MT allocated from ${lot.lot_no}`,
        });

        return {
          orderId: order.id,
          lotId: lot.id,
          lotNo: lot.lot_no,
        };
      });

      const updated = await db('export_orders').where({ id: allocationContext.orderId }).first();

      emitExportOrderUpdate(updated.id, 'stock_allocated', {
        lotId: allocationContext.lotId,
        lotNo: allocationContext.lotNo,
        qtyMT,
      });
      return res.json({
        success: true,
        data: {
          order: updated,
          allocated: { lot_id: allocationContext.lotId, lot_no: allocationContext.lotNo, qty_mt: qtyMT },
        },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Export order allocateStock error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },
};

module.exports = exportOrderController;
