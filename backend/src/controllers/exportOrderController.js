const db = require('../config/database');
const inventoryService = require('../services/inventoryService');
const accountingService = require('../services/accountingService');
const documentService = require('../services/documentService');
const automationService = require('../services/automationService');
const emailService = require('../services/emailService');
const { publishExportOrderUpdate } = require('../services/exportOrderEventBus');
const workflowService = require('../services/exportOrderWorkflowService');
const { MONEY_EPSILON, settledAmount, getStepForStatus, getAllowedActions } = workflowService;

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

      return {
        sequence_no: index + 1,
        container_no: containerNo,
        seal_no: container.seal_no || container.sealNo || null,
        gross_weight_kg: Number.isFinite(grossWeight) ? grossWeight : null,
        net_weight_kg: Number.isFinite(netWeight) ? netWeight : null,
        notes: container.notes || null,
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
        gross_weight_kg: null,
        net_weight_kg: null,
        notes: null,
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

const ALLOWED_UPDATE_FIELDS = [
  'customer_id', 'product_id', 'product_name', 'qty_mt', 'price_per_mt',
  'currency', 'incoterm', 'country', 'destination_port', 'advance_pct',
  'shipment_eta', 'source', 'notes',
  'bag_type', 'bag_quality', 'bag_size_kg', 'bag_weight_gm',
  'bag_printing', 'bag_color', 'bag_brand', 'bag_notes',
  'receiving_mode', 'quantity_unit', 'packing_notes',
  'packing_lines',
  // Document generation fields
  'hs_code', 'brand_marking', 'broken_pct_target', 'quality_description',
  'production_date', 'expiry_date', 'freight_terms', 'fi_number', 'fi_date',
  'invoice_number', 'contract_number', 'consignee_type', 'bl_date',
  'production_remarks', 'shipment_window_start', 'shipment_window_end',
  'voyage_number', 'gd_number', 'gd_date', 'fi_number_2', 'fi_number_3',
  'notify_party_name', 'notify_party_address', 'notify_party_phone', 'notify_party_email',
  'shipment_remarks',
];

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
          'c.email as customer_email',
          'p.name as product_name'
        )
        .where(whereClause)
        .first();

      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      const orderId = order.id; // resolved numeric ID
      const [costs, documents, statusHistory, millingBatch, packingLines, shipmentContainers] = await Promise.all([
        db('export_order_costs').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_documents').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_status_history')
          .where({ order_id: orderId })
          .orderBy('created_at', 'desc'),
        db('milling_batches').where({ linked_export_order_id: orderId }).first(),
        db('order_packing_lines').where({ order_id: orderId }).orderBy('line_no', 'asc'),
        db('shipment_containers').where({ order_id: orderId }).orderBy('sequence_no', 'asc'),
      ]);

      order.shipment_containers = shipmentContainers || [];
      order.shipmentContainers = shipmentContainers || [];
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
        'l.id', 'l.lot_no', 'l.item_name', 'l.type', 'l.entity',
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

        // Path 2 & 3: Lots with export_allocation transactions
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
          .where(function () {
            // Match by explicit reference to this order
            this.where(function () {
              this.where('lt.reference_module', 'export_order')
                .where(function () {
                  this.where('lt.reference_id', orderId)
                    .orWhere('lt.reference_no', order.order_no);
                });
            })
            // OR match export_allocation transactions (even without reference_id)
            .orWhere(function () {
              this.whereIn('lt.transaction_type', ['export_allocation', 'dispatch_out']);
            });
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
      for (const lot of millingOutputLots) {
        if (!lotMap.has(lot.id)) {
          lotMap.set(lot.id, {
            ...lot,
            allocated_qty_kg: (parseFloat(lot.net_weight_kg) || (parseFloat(lot.qty) || 0) * 1000),
            source: 'milling_output',
          });
        }
      }
      const purchaseLots = Array.from(lotMap.values());

      return res.json({
        success: true,
        data: {
          order,
          costs,
          documents,
          statusHistory,
          millingBatch: millingBatch || null,
          packingLines: packingLines || [],
          shipmentContainers: shipmentContainers || [],
          purchaseLots,
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
        // Packing / receiving mode
        receiving_mode,
        quantity_unit,
        quantity_input_value,
        total_bags: input_total_bags,
        total_loose_weight_kg,
        packing_notes,
        packing_lines, // array of packing line objects for mixed mode
      } = req.body;

      if (!customer_id || !product_id || !qty_mt || !price_per_mt) {
        return res.status(400).json({
          success: false,
          message: 'customer_id, product_id, qty_mt, and price_per_mt are required.',
        });
      }

      const contractValue = parseFloat(qty_mt) * parseFloat(price_per_mt);
      const advancePct = parseFloat(advance_pct) || 0;
      const advanceExpected = contractValue * (advancePct / 100);
      const balanceExpected = contractValue - advanceExpected;

      const result = await db.transaction(async (trx) => {
        const orderNo = await generateOrderNo(trx);

        const [order] = await trx('export_orders')
          .insert({
            order_no: orderNo,
            customer_id,
            product_id,
            product_name: product_name || null,
            qty_mt: parseFloat(qty_mt),
            price_per_mt: parseFloat(price_per_mt),
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
            status: requestedStatus || 'Draft',
            current_step: getStepForStatus(requestedStatus || 'Draft', 1),
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
            // Packing / receiving mode
            receiving_mode: receiving_mode || null,
            quantity_unit: quantity_unit || null,
            quantity_input_value: quantity_input_value ? parseFloat(quantity_input_value) : null,
            total_bags: input_total_bags ? parseInt(input_total_bags) : null,
            total_loose_weight_kg: total_loose_weight_kg ? parseFloat(total_loose_weight_kg) : null,
            packing_notes: packing_notes || null,
          })
          .returning('*');

        // Insert initial cost entries (all zero)
        const costCategories = [
          'raw_rice',
          'milling',
          'bags',
          'transport',
          'fumigation',
          'inspection',
          'loading',
          'customs',
          'commission',
          'other',
        ];

        const costRows = costCategories.map((category) => ({
          order_id: order.id,
          category,
          amount: 0,
          notes: null,
        }));

        await trx('export_order_costs').insert(costRows);

        // Insert initial status history (log actual status, not always Draft)
        const initialStatus = requestedStatus || 'Draft';
        await trx('export_order_status_history').insert({
          order_id: order.id,
          from_status: null,
          to_status: initialStatus,
          changed_by: req.user.id,
          reason: initialStatus === 'Draft' ? 'Order saved as draft' : 'Order created',
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
      const { id } = req.params;
      const updates = req.body || {};
      const safeUpdates = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (updates[key] !== undefined) {
          safeUpdates[key] = updates[key];
        }
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

      safeUpdates.updated_at = db.fn.now();

      const [order] = await db('export_orders')
        .where({ id })
        .update(safeUpdates)
        .returning('*');

      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      emitExportOrderUpdate(order.id, 'updated');
      return res.json({
        success: true,
        data: { order },
      });
    } catch (err) {
      console.error('Export order update error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
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
      const { id } = req.params;
      const {
        vessel_name, booking_no, container_no, containers,
        bl_number, shipping_line, etd, atd, eta, ata,
        destination_port, notes,
        voyage_number, gd_number, gd_date,
        fi_number, fi_number_2, fi_number_3, fi_date,
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
          await trx('shipment_containers').where({ order_id: order.id }).del();
          if (normalizedContainers.length > 0) {
            await trx('shipment_containers').insert(
              normalizedContainers.map((container) => ({
                ...container,
                order_id: order.id,
                created_by: req.user.id,
              }))
            );
          }
        }

        await trx('export_orders').where({ id }).update({
          vessel_name: vessel_name || null,
          booking_no: booking_no || null,
          bl_number: bl_number || null,
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
          fi_number_2: fi_number_2 || null,
          fi_number_3: fi_number_3 || null,
          fi_date: fi_date || order.fi_date || null,
          notify_party_name: notify_party_name || null,
          notify_party_address: notify_party_address || null,
          notify_party_phone: notify_party_phone || null,
          notify_party_email: notify_party_email || null,
          shipment_remarks: shipment_remarks || null,
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
      const { id } = req.params;
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
      const { id } = req.params;
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

      // Upsert: update if category exists, otherwise insert
      const existing = await db('export_order_costs')
        .where({ order_id: id, category })
        .first();

      let cost;
      if (existing) {
        [cost] = await db('export_order_costs')
          .where({ id: existing.id })
          .update({ amount: parseFloat(amount), notes: notes || null, updated_at: db.fn.now() })
          .returning('*');
      } else {
        [cost] = await db('export_order_costs')
          .insert({
            order_id: id,
            category,
            amount: parseFloat(amount),
            notes: notes || null,
          })
          .returning('*');
      }

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
      const { id } = req.params;
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
      const { id } = req.params;
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
      const { id } = req.params;
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
      const { amount, payment_date, payment_method, reference, bank_reference, bank_account_id, notes } = req.body;
      const bankRef = bank_reference || reference || null;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      }

      const confirmedAmount = settledAmount(amount);
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

        // Update order advance fields
        await trx('export_orders').where({ id: order.id }).update({
          advance_received: newAdvanceReceived,
          advance_date: payment_date || trx.fn.now(),
          updated_at: trx.fn.now(),
        });

        const advReceivable = await trx('receivables')
          .where({ order_id: order.id, type: 'Advance' })
          .first();

        const advPayNo = await generatePaymentNo(trx, 'PAY');
        await trx('payments').insert({
          payment_no: advPayNo,
          type: 'receipt',
          linked_receivable_id: advReceivable ? advReceivable.id : null,
          amount: confirmedAmount,
          currency: order.currency || 'USD',
          payment_method: payment_method || null,
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
            status: newOutstanding <= MONEY_EPSILON ? 'Received' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Credit bank account balance if a bank account was selected
        if (bank_account_id) {
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', confirmedAmount);
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
          currency: order.currency || 'USD',
          newAdvanceReceived,
        };
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking)
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'advance_receipt', entity: 'export',
          amount: confirmedAmount, currency: paymentContext.currency,
          refType: 'Export Order', refNo: paymentContext.orderNo,
          description: `Adv rcpt ${paymentContext.orderNo}`, userId: req.user?.id,
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
      const { amount, payment_date, payment_method, reference, bank_reference, bank_account_id, notes } = req.body;
      const bankRef = bank_reference || reference || null;

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

        await trx('export_orders').where({ id: order.id }).update({
          balance_received: newBalanceReceived,
          balance_date: payment_date || trx.fn.now(),
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
          currency: order.currency || 'USD',
          payment_method: payment_method || null,
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
            status: newOutstanding <= MONEY_EPSILON ? 'Received' : 'Partial',
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
          currency: order.currency || 'USD',
        };
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking)
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'balance_receipt', entity: 'export',
          amount: confirmedAmount, currency: paymentContext.currency,
          refType: 'Export Order', refNo: paymentContext.orderNo,
          description: `Bal rcpt ${paymentContext.orderNo}`, userId: req.user?.id,
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
      const { lot_id, qty_mt, notes } = req.body;

      if (!lot_id) {
        return res.status(400).json({ success: false, message: 'lot_id is required.' });
      }
      const qtyMT = parseFloat(qty_mt);
      if (!qtyMT || qtyMT <= 0) {
        return res.status(400).json({ success: false, message: 'A positive qty_mt is required.' });
      }

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

        await inventoryService.reserveStock(trx, {
          lotId: lot.id,
          orderId: order.id,
          qtyMT,
          userId: req.user?.id,
        });

        // Mark the lot as reserved against this order
        await trx('inventory_lots').where({ id: lot.id }).update({
          reserved_against: order.order_no,
          entity: 'export',
          updated_at: trx.fn.now(),
        });

        // Record allocation transaction
        await trx('lot_transactions').insert({
          lot_id: lot.id,
          transaction_type: 'export_allocation',
          transaction_no: `ALLOC-${order.order_no}-${lot.lot_no}-${Date.now()}`,
          quantity_kg: qtyMT * 1000,
          rate_per_kg: parseFloat(lot.rate_per_kg) || 0,
          reference_module: 'export_order',
          reference_id: order.id,
          transaction_date: trx.fn.now(),
          remarks: notes || `Allocated ${qtyMT} MT to ${order.order_no}`,
          created_by: req.user?.id,
        });

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
