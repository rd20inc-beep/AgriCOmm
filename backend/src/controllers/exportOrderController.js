const db = require('../config/database');
const inventoryService = require('../services/inventoryService');
const accountingService = require('../services/accountingService');
const documentService = require('../services/documentService');
const automationService = require('../services/automationService');

// Valid status transitions — aligned with frontend workflowSteps & schema validation
const STATUS_TRANSITIONS = {
  'Draft': ['Awaiting Advance'],
  'Awaiting Advance': ['Advance Received'],
  'Advance Received': ['Procurement Pending', 'In Milling'],
  'Procurement Pending': ['In Milling'],
  'In Milling': ['Docs In Preparation'],
  'Docs In Preparation': ['Awaiting Balance'],
  'Awaiting Balance': ['Shipped'],
  'Shipped': ['Arrived'],
  'Arrived': ['Closed'],
  'Closed': [],
  'Cancelled': [],
};

// Map status to workflow step number
const STATUS_STEP = {
  'Draft': 1,
  'Awaiting Advance': 2,
  'Advance Received': 3,
  'Procurement Pending': 4,
  'In Milling': 5,
  'Docs In Preparation': 6,
  'Awaiting Balance': 7,
  'Shipped': 8,
  'Arrived': 9,
  'Closed': 10,
};

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
      const [costs, documents, statusHistory, millingBatch, packingLines] = await Promise.all([
        db('export_order_costs').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_documents').where({ order_id: orderId }).orderBy('created_at', 'asc'),
        db('export_order_status_history')
          .where({ order_id: orderId })
          .orderBy('created_at', 'desc'),
        db('milling_batches').where({ linked_export_order_id: orderId }).first(),
        db('order_packing_lines').where({ order_id: orderId }).orderBy('line_no', 'asc'),
      ]);

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
            current_step: requestedStatus === 'Awaiting Advance' ? 2 : 1,
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
      const updates = req.body;

      // Remove fields that should not be directly updated
      delete updates.id;
      delete updates.order_no;
      delete updates.created_at;
      delete updates.created_by;

      // Recalculate totals if price or qty changed
      if (updates.qty_mt || updates.price_per_mt) {
        const existing = await db('export_orders').where({ id }).first();
        if (!existing) {
          return res.status(404).json({ success: false, message: 'Export order not found.' });
        }
        const qty = parseFloat(updates.qty_mt || existing.qty_mt);
        const price = parseFloat(updates.price_per_mt || existing.price_per_mt);
        updates.contract_value = qty * price;
        const advPct = parseFloat(updates.advance_pct != null ? updates.advance_pct : existing.advance_pct) || 0;
        updates.advance_expected = updates.contract_value * (advPct / 100);
        updates.balance_expected = updates.contract_value - updates.advance_expected;
      }

      updates.updated_at = db.fn.now();

      const [order] = await db('export_orders')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

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

      const allowed = STATUS_TRANSITIONS[order.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot transition from '${order.status}' to '${status}'. Allowed: ${allowed.join(', ') || 'none'}.`,
        });
      }

      // When transitioning to Shipped, check document completeness
      if (status === 'Shipped') {
        const docsComplete = await documentService.isDocumentationComplete('export_order', order.id);
        if (!docsComplete) {
          return res.status(400).json({
            success: false,
            message: 'Cannot ship: required export documents are not all approved. Check document checklist.',
          });
        }
      }

      await db.transaction(async (trx) => {
        await trx('export_orders').where({ id }).update({
          status,
          current_step: STATUS_STEP[status] || order.current_step,
          updated_at: trx.fn.now(),
        });

        await trx('export_order_status_history').insert({
          order_id: id,
          from_status: order.status,
          to_status: status,
          changed_by: req.user.id,
          reason: notes || null,
        });

        // When marking as shipped, dispatch inventory
        if (status === 'Shipped') {
          const exportLot = await trx('inventory_lots')
            .where({ entity: 'export', type: 'finished', reserved_against: order.order_no })
            .first();

          if (exportLot) {
            await inventoryService.dispatchForShipment(trx, {
              orderId: order.id,
              lotId: exportLot.id,
              qtyMT: order.qty_mt,
              userId: req.user?.id,
            });
          }

          // Trigger automation: shipment departed
          await automationService.onShipmentDeparted(trx, {
            orderId: parseInt(id),
            userId: req.user.id,
          });
        }
      });

      const updated = await db('export_orders').where({ id }).first();

      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      console.error('Export order updateStatus error:', err);
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

      return res.json({
        success: true,
        data: { cost },
      });
    } catch (err) {
      console.error('Export order addCost error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addDocument(req, res) {
    try {
      const { id } = req.params;
      const { doc_type, status: docStatus, file_path, version, notes } = req.body;

      if (!doc_type) {
        return res.status(400).json({ success: false, message: 'doc_type is required.' });
      }

      const order = await db('export_orders').where({ id }).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      // Upsert by doc_type
      const existing = await db('export_order_documents')
        .where({ order_id: id, doc_type })
        .first();

      let doc;
      if (existing) {
        [doc] = await db('export_order_documents')
          .where({ id: existing.id })
          .update({
            status: docStatus || existing.status,
            file_path: file_path || existing.file_path,
            version: version || existing.version,
            notes: notes != null ? notes : existing.notes,
            updated_at: db.fn.now(),
          })
          .returning('*');
      } else {
        [doc] = await db('export_order_documents')
          .insert({
            order_id: id,
            doc_type,
            status: docStatus || 'pending',
            uploaded_by: req.user.id,
            upload_date: db.fn.now(),
            file_path: file_path || null,
            version: version || 1,
            notes: notes || null,
          })
          .returning('*');
      }

      return res.json({
        success: true,
        data: { document: doc },
      });
    } catch (err) {
      console.error('Export order addDocument error:', err);
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

      const order = await db('export_orders').where(whereClause).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      const newAdvanceReceived = parseFloat(order.advance_received || 0) + parseFloat(amount);
      const advanceFull = newAdvanceReceived >= parseFloat(order.advance_expected || 0);

      await db.transaction(async (trx) => {
        // Update order advance fields
        const updateData = {
          advance_received: newAdvanceReceived,
          advance_date: payment_date || trx.fn.now(),
          updated_at: trx.fn.now(),
        };

        // Auto-transition status if advance fully received
        if (advanceFull && ['Awaiting Advance', 'Draft'].includes(order.status)) {
          updateData.status = 'Advance Received';
          updateData.current_step = STATUS_STEP['Advance Received'] || 3;
        }

        await trx('export_orders').where({ id: order.id }).update(updateData);

        // Create payment record (unique per payment)
        const paySeq = await trx('payments').count('id as c').first();
        const advPayNo = `PA-${(parseInt(paySeq?.c || 0) + 1)}`;
        await trx('payments').insert({
          payment_no: advPayNo,
          type: 'receipt',
          amount: parseFloat(amount),
          currency: 'USD',
          payment_method: payment_method || null,
          bank_account_id: bank_account_id || null,
          bank_reference: bankRef,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Advance payment for ${order.order_no}`,
          created_by: req.user.id,
        });

        // Update receivable record
        const advReceivable = await trx('receivables')
          .where({ order_id: order.id, type: 'Advance' }).first();
        if (advReceivable) {
          const newReceived = parseFloat(advReceivable.received_amount || 0) + parseFloat(amount);
          const newOutstanding = Math.max(0, parseFloat(advReceivable.expected_amount) - newReceived);
          await trx('receivables').where({ id: advReceivable.id }).update({
            received_amount: newReceived,
            outstanding: newOutstanding,
            status: newOutstanding <= 0 ? 'Received' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Credit bank account balance if a bank account was selected
        if (bank_account_id) {
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', parseFloat(amount));
        }

        // Add status history if status changed
        if (advanceFull && ['Awaiting Advance', 'Draft'].includes(order.status)) {
          await trx('export_order_status_history').insert({
            order_id: order.id,
            from_status: order.status,
            to_status: 'Advance Received',
            changed_by: req.user.id,
            reason: `Advance payment of ${amount} confirmed`,
          });
        }

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
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking)
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'advance_receipt', entity: 'export',
          amount: parseFloat(amount), currency: 'USD',
          refType: 'Export Order', refNo: order.order_no,
          description: `Adv rcpt ${order.order_no}`, userId: req.user?.id,
        });
      } catch (e) { console.warn('Advance journal failed:', e.message); }
      try {
        await automationService.onAdvanceConfirmed(db, {
          orderId: order.id, amount: parseFloat(amount), userId: req.user.id,
        });
      } catch (e) { console.warn('Advance automation failed:', e.message); }

      const updated = await db('export_orders').where({ id: order.id }).first();

      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
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

      const order = await db('export_orders').where(whereClauseBal).first();
      if (!order) {
        return res.status(404).json({ success: false, message: 'Export order not found.' });
      }

      const id = order.id; // resolved numeric ID
      const newBalanceReceived = parseFloat(order.balance_received || 0) + parseFloat(amount);
      const balanceFull = newBalanceReceived >= parseFloat(order.balance_expected || 0);

      await db.transaction(async (trx) => {
        const updateData = {
          balance_received: newBalanceReceived,
          balance_date: payment_date || trx.fn.now(),
          updated_at: trx.fn.now(),
        };

        if (balanceFull && order.status === 'Awaiting Balance') {
          updateData.status = 'Shipped';
          updateData.current_step = STATUS_STEP['Shipped'] || 8;
        }

        await trx('export_orders').where({ id }).update(updateData);

        const balPaySeq = await trx('payments').count('id as c').first();
        const balPayNo = `PB-${(parseInt(balPaySeq?.c || 0) + 1)}`;
        await trx('payments').insert({
          payment_no: balPayNo,
          type: 'receipt',
          amount: parseFloat(amount),
          currency: 'USD',
          payment_method: payment_method || null,
          bank_account_id: bank_account_id || null,
          bank_reference: bankRef,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Balance payment for ${order.order_no}`,
          created_by: req.user.id,
        });

        // Update receivable record
        const balReceivable = await trx('receivables')
          .where({ order_id: id, type: 'Balance' }).first();
        if (balReceivable) {
          const newReceived = parseFloat(balReceivable.received_amount || 0) + parseFloat(amount);
          const newOutstanding = Math.max(0, parseFloat(balReceivable.expected_amount) - newReceived);
          await trx('receivables').where({ id: balReceivable.id }).update({
            received_amount: newReceived,
            outstanding: newOutstanding,
            status: newOutstanding <= 0 ? 'Received' : 'Partial',
            updated_at: trx.fn.now(),
          });
        }

        // Credit bank account balance if a bank account was selected
        if (bank_account_id) {
          await trx('bank_accounts')
            .where({ id: bank_account_id })
            .increment('current_balance', parseFloat(amount));
        }

        if (balanceFull && order.status === 'Awaiting Balance') {
          await trx('export_order_status_history').insert({
            order_id: id,
            from_status: order.status,
            to_status: 'Shipped',
            changed_by: req.user.id,
            reason: `Balance payment of ${amount} confirmed`,
          });
        }
      });

      // Auto-post journal & automation OUTSIDE transaction (non-blocking)
      try {
        await accountingService.autoPost(db, {
          triggerEvent: 'balance_receipt', entity: 'export',
          amount: parseFloat(amount), currency: 'USD',
          refType: 'Export Order', refNo: order.order_no,
          description: `Bal rcpt ${order.order_no}`, userId: req.user?.id,
        });
      } catch (e) { console.warn('Balance journal failed:', e.message); }
      try {
        await automationService.onBalanceConfirmed(db, {
          orderId: order.id, amount: parseFloat(amount), userId: req.user.id,
        });
      } catch (e) { console.warn('Balance automation failed:', e.message); }

      const updated = await db('export_orders').where({ id }).first();

      return res.json({
        success: true,
        data: { order: updated },
      });
    } catch (err) {
      console.error('Export order confirmBalance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = exportOrderController;
