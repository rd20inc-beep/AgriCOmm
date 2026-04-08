const db = require('../../config/database');
const inventoryService = require('../inventory/inventory.service');
const accountingService = require('../accounting/accounting.service');

const procurementService = {
  // ===========================================================================
  // Reference Number Generators
  // ===========================================================================

  /**
   * Generate next purchase requisition number: PR-001, PR-002, ...
   */
  async generateReqNo(trx) {
    const last = await (trx || db)('purchase_requisitions')
      .orderBy('id', 'desc')
      .select('req_no')
      .first();

    let seq = 1;
    if (last && last.req_no) {
      const num = parseInt(last.req_no.replace('PR-', ''), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `PR-${String(seq).padStart(3, '0')}`;
  },

  /**
   * Generate next purchase order number: PO-001, PO-002, ...
   */
  async generatePONo(trx) {
    const last = await (trx || db)('purchase_orders')
      .orderBy('id', 'desc')
      .select('po_no')
      .first();

    let seq = 1;
    if (last && last.po_no) {
      const num = parseInt(last.po_no.replace('PO-', ''), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `PO-${String(seq).padStart(3, '0')}`;
  },

  /**
   * Generate next GRN number: GRN-001, GRN-002, ...
   */
  async generateGRNNo(trx) {
    const last = await (trx || db)('goods_receipt_notes')
      .orderBy('id', 'desc')
      .select('grn_no')
      .first();

    let seq = 1;
    if (last && last.grn_no) {
      const num = parseInt(last.grn_no.replace('GRN-', ''), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `GRN-${String(seq).padStart(3, '0')}`;
  },

  /**
   * Generate next return number: RET-001, RET-002, ...
   */
  async generateReturnNo(trx) {
    const last = await (trx || db)('purchase_returns')
      .orderBy('id', 'desc')
      .select('return_no')
      .first();

    let seq = 1;
    if (last && last.return_no) {
      const num = parseInt(last.return_no.replace('RET-', ''), 10);
      if (!isNaN(num)) seq = num + 1;
    }
    return `RET-${String(seq).padStart(3, '0')}`;
  },

  // ===========================================================================
  // Purchase Requisitions
  // ===========================================================================

  /**
   * Create a new purchase requisition.
   */
  async createRequisition(trx, data) {
    const reqNo = await procurementService.generateReqNo(trx);

    const [requisition] = await trx('purchase_requisitions')
      .insert({
        req_no: reqNo,
        entity: data.entity || 'mill',
        requested_by: data.requested_by || null,
        product_id: data.product_id || null,
        product_name: data.product_name || null,
        qty_mt: data.qty_mt,
        required_by_date: data.required_by_date || null,
        linked_export_order_id: data.linked_export_order_id || null,
        linked_batch_id: data.linked_batch_id || null,
        priority: data.priority || 'Normal',
        status: data.status || 'Draft',
        notes: data.notes || null,
      })
      .returning('*');

    return requisition;
  },

  /**
   * Approve a purchase requisition.
   */
  async approveRequisition(trx, { reqId, approvedBy }) {
    const req = await trx('purchase_requisitions').where('id', reqId).first();
    if (!req) throw new Error(`Requisition ${reqId} not found`);
    if (req.status !== 'Submitted') {
      throw new Error(`Cannot approve requisition in status '${req.status}'. Must be 'Submitted'.`);
    }

    const [updated] = await trx('purchase_requisitions')
      .where('id', reqId)
      .update({
        status: 'Approved',
        approved_by: approvedBy,
        approved_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return updated;
  },

  /**
   * Reject a purchase requisition.
   */
  async rejectRequisition(trx, { reqId, rejectedBy, reason }) {
    const req = await trx('purchase_requisitions').where('id', reqId).first();
    if (!req) throw new Error(`Requisition ${reqId} not found`);
    if (req.status !== 'Submitted') {
      throw new Error(`Cannot reject requisition in status '${req.status}'. Must be 'Submitted'.`);
    }

    const [updated] = await trx('purchase_requisitions')
      .where('id', reqId)
      .update({
        status: 'Rejected',
        approved_by: rejectedBy,
        approved_at: trx.fn.now(),
        notes: reason ? `${req.notes ? req.notes + '\n' : ''}Rejection reason: ${reason}` : req.notes,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // ===========================================================================
  // Purchase Orders
  // ===========================================================================

  /**
   * Create a new purchase order.
   */
  async createPurchaseOrder(trx, data) {
    const poNo = await procurementService.generatePONo(trx);

    const qtyMt = parseFloat(data.qty_mt);
    const pricePerMt = parseFloat(data.price_per_mt);
    const totalAmount = parseFloat((qtyMt * pricePerMt).toFixed(2));

    const [po] = await trx('purchase_orders')
      .insert({
        po_no: poNo,
        requisition_id: data.requisition_id || null,
        supplier_id: data.supplier_id,
        entity: data.entity || 'mill',
        product_id: data.product_id || null,
        product_name: data.product_name || null,
        qty_mt: qtyMt,
        price_per_mt: pricePerMt,
        currency: data.currency || 'PKR',
        total_amount: totalAmount,
        transport_terms: data.transport_terms || null,
        delivery_date: data.delivery_date || null,
        payment_terms: data.payment_terms || null,
        moisture_expected: data.moisture_expected || null,
        broken_expected: data.broken_expected || null,
        status: data.status || 'Draft',
        linked_batch_id: data.linked_batch_id || null,
        notes: data.notes || null,
        created_by: data.created_by || null,
      })
      .returning('*');

    // If linked to a requisition, update requisition status to 'Ordered'
    if (data.requisition_id) {
      await trx('purchase_requisitions')
        .where('id', data.requisition_id)
        .update({
          status: 'Ordered',
          updated_at: trx.fn.now(),
        });
    }

    return po;
  },

  /**
   * Cancel a purchase order.
   */
  async cancelPO(trx, { poId, userId }) {
    const po = await trx('purchase_orders').where('id', poId).first();
    if (!po) throw new Error(`Purchase order ${poId} not found`);
    if (po.status === 'Fully Received') {
      throw new Error('Cannot cancel a fully received purchase order.');
    }
    if (po.status === 'Cancelled') {
      throw new Error('Purchase order is already cancelled.');
    }

    const [updated] = await trx('purchase_orders')
      .where('id', poId)
      .update({
        status: 'Cancelled',
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // ===========================================================================
  // Goods Receipt Notes
  // ===========================================================================

  /**
   * Create a GRN, post inventory receipt, and update PO status.
   */
  async createGRN(trx, data) {
    const grnNo = await procurementService.generateGRNNo(trx);

    const grossWeight = parseFloat(data.gross_weight_mt) || 0;
    const tareWeight = parseFloat(data.tare_weight_mt) || 0;
    const netWeight = parseFloat((grossWeight - tareWeight).toFixed(2));
    const acceptedQty = data.accepted_qty_mt != null
      ? parseFloat(data.accepted_qty_mt)
      : netWeight;
    const pricePerMt = parseFloat(data.price_per_mt) || 0;
    const totalValue = parseFloat((acceptedQty * pricePerMt).toFixed(2));

    // Get PO to resolve supplier
    const po = await trx('purchase_orders').where('id', data.po_id).first();
    if (!po) throw new Error(`Purchase order ${data.po_id} not found`);

    const supplierId = data.supplier_id || po.supplier_id;

    // Determine warehouse — use provided or find/create the mill raw warehouse
    let warehouseId = data.warehouse_id;
    if (!warehouseId) {
      let warehouse = await trx('warehouses')
        .where({ entity: 'mill', type: 'raw' })
        .first();
      if (!warehouse) {
        [warehouse] = await trx('warehouses')
          .insert({ name: 'Mill Raw Stock', entity: 'mill', type: 'raw' })
          .returning('*');
      }
      warehouseId = warehouse.id;
    }

    const [grn] = await trx('goods_receipt_notes')
      .insert({
        grn_no: grnNo,
        po_id: data.po_id,
        supplier_id: supplierId,
        batch_id: data.batch_id || po.linked_batch_id || null,
        warehouse_id: warehouseId,
        receipt_date: data.receipt_date || new Date().toISOString().slice(0, 10),
        vehicle_no: data.vehicle_no || null,
        driver_name: data.driver_name || null,
        driver_phone: data.driver_phone || null,
        gross_weight_mt: grossWeight,
        tare_weight_mt: tareWeight,
        net_weight_mt: netWeight,
        accepted_qty_mt: acceptedQty,
        rejected_qty_mt: data.rejected_qty_mt || 0,
        rejection_reason: data.rejection_reason || null,
        quality_status: data.quality_status || 'Pending',
        moisture_actual: data.moisture_actual || null,
        broken_actual: data.broken_actual || null,
        price_per_mt: pricePerMt,
        total_value: totalValue,
        currency: data.currency || 'PKR',
        status: 'Posted',
        received_by: data.received_by || null,
        inspected_by: data.inspected_by || null,
      })
      .returning('*');

    // If batch_id provided, create a vehicle arrival in milling_vehicle_arrivals
    const batchId = data.batch_id || po.linked_batch_id;
    if (batchId && data.vehicle_no) {
      await trx('milling_vehicle_arrivals').insert({
        batch_id: batchId,
        vehicle_no: data.vehicle_no,
        driver_name: data.driver_name || null,
        driver_phone: data.driver_phone || null,
        weight_mt: netWeight,
        arrival_date: data.receipt_date || new Date().toISOString().slice(0, 10),
        notes: `Auto-created from GRN ${grnNo}`,
      });
    }

    // Post inventory: receive raw paddy
    if (acceptedQty > 0 && batchId) {
      await inventoryService.receiveRawPaddy(trx, {
        batchId,
        weightMT: acceptedQty,
        costPerMT: pricePerMt,
        currency: data.currency || 'PKR',
        supplierId,
        vehicleNo: data.vehicle_no || null,
        userId: data.received_by || null,
      });
    }

    // Update PO status based on total received
    const totalReceived = await trx('goods_receipt_notes')
      .where('po_id', data.po_id)
      .whereNot('status', 'Cancelled')
      .sum('accepted_qty_mt as total')
      .first();

    const receivedQty = parseFloat(totalReceived.total) || 0;
    const poQty = parseFloat(po.qty_mt) || 0;
    let newPoStatus = po.status;

    if (receivedQty >= poQty) {
      newPoStatus = 'Fully Received';
    } else if (receivedQty > 0) {
      newPoStatus = 'Partially Received';
    }

    if (newPoStatus !== po.status) {
      await trx('purchase_orders')
        .where('id', data.po_id)
        .update({ status: newPoStatus, updated_at: trx.fn.now() });
    }

    return grn;
  },

  /**
   * Approve or reject GRN quality.
   */
  async approveGRNQuality(trx, { grnId, qualityStatus, inspectedBy, deductions }) {
    const grn = await trx('goods_receipt_notes').where('id', grnId).first();
    if (!grn) throw new Error(`GRN ${grnId} not found`);

    const updates = {
      quality_status: qualityStatus,
      inspected_by: inspectedBy || null,
      updated_at: trx.fn.now(),
    };

    if (qualityStatus === 'Rejected') {
      // Create a purchase return for the rejected goods
      updates.status = 'Cancelled';
      updates.rejected_qty_mt = grn.accepted_qty_mt;
      updates.accepted_qty_mt = 0;
      updates.total_value = 0;

      const returnNo = await procurementService.generateReturnNo(trx);
      await trx('purchase_returns').insert({
        return_no: returnNo,
        grn_id: grnId,
        supplier_id: grn.supplier_id,
        qty_mt: grn.accepted_qty_mt,
        reason: `Quality rejected by inspector. GRN ${grn.grn_no}`,
        status: 'Pending',
        created_by: inspectedBy || null,
      });

      // Post negative inventory adjustment if stock was already posted
      if (grn.batch_id && parseFloat(grn.accepted_qty_mt) > 0) {
        const lot = await trx('inventory_lots')
          .where({ batch_ref: `batch-${grn.batch_id}`, type: 'raw', entity: 'mill' })
          .first();

        if (lot) {
          await inventoryService.postMovement(trx, {
            movementType: inventoryService.MOVEMENT_TYPES.ADJUSTMENT_MINUS,
            lotId: lot.id,
            qty: parseFloat(grn.accepted_qty_mt),
            fromWarehouseId: lot.warehouse_id,
            sourceEntity: 'mill',
            notes: `Quality rejection reversal for GRN ${grn.grn_no}`,
            costPerUnit: parseFloat(grn.price_per_mt) || 0,
            currency: grn.currency || 'PKR',
            userId: inspectedBy,
          });
        }
      }
    } else if (qualityStatus === 'Approved' || qualityStatus === 'Conditional') {
      // If there are quality deductions, adjust accepted_qty and recalculate value
      if (deductions && parseFloat(deductions) > 0) {
        const deductionMt = parseFloat(deductions);
        const originalAccepted = parseFloat(grn.accepted_qty_mt) || 0;
        const newAccepted = Math.max(0, originalAccepted - deductionMt);
        const pricePerMt = parseFloat(grn.price_per_mt) || 0;

        updates.accepted_qty_mt = newAccepted;
        updates.rejected_qty_mt = (parseFloat(grn.rejected_qty_mt) || 0) + deductionMt;
        updates.total_value = parseFloat((newAccepted * pricePerMt).toFixed(2));

        // Adjust inventory if needed
        if (grn.batch_id && deductionMt > 0) {
          const lot = await trx('inventory_lots')
            .where({ batch_ref: `batch-${grn.batch_id}`, type: 'raw', entity: 'mill' })
            .first();

          if (lot) {
            await inventoryService.postMovement(trx, {
              movementType: inventoryService.MOVEMENT_TYPES.ADJUSTMENT_MINUS,
              lotId: lot.id,
              qty: deductionMt,
              fromWarehouseId: lot.warehouse_id,
              sourceEntity: 'mill',
              notes: `Quality deduction for GRN ${grn.grn_no}`,
              costPerUnit: parseFloat(grn.price_per_mt) || 0,
              currency: grn.currency || 'PKR',
              userId: inspectedBy,
            });
          }
        }
      }

      if (grn.batch_id && parseFloat(grn.accepted_qty_mt) > 0) {
        await inventoryService.receiveRawPaddy(trx, {
          batchId: grn.batch_id,
          weightMT: parseFloat(grn.accepted_qty_mt),
          costPerMT: parseFloat(grn.price_per_mt) || 0,
          currency: grn.currency || 'PKR',
          supplierId: grn.supplier_id,
          vehicleNo: grn.vehicle_no || null,
          userId: inspectedBy,
        });
      }
    }

    const [updated] = await trx('goods_receipt_notes')
      .where('id', grnId)
      .update(updates)
      .returning('*');

    return updated;
  },

  // ===========================================================================
  // Supplier Invoices
  // ===========================================================================

  /**
   * Create a supplier invoice and auto-create a payable.
   */
  async createSupplierInvoice(trx, data) {
    const grossAmount = parseFloat(data.gross_amount) || 0;
    const deductionsAmt = parseFloat(data.deductions) || 0;
    const netAmount = data.net_amount != null
      ? parseFloat(data.net_amount)
      : parseFloat((grossAmount - deductionsAmt).toFixed(2));

    const [invoice] = await trx('supplier_invoices')
      .insert({
        invoice_no: data.invoice_no,
        supplier_id: data.supplier_id,
        po_id: data.po_id || null,
        grn_id: data.grn_id || null,
        invoice_date: data.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: data.due_date || null,
        gross_amount: grossAmount,
        deductions: deductionsAmt,
        net_amount: netAmount,
        currency: data.currency || 'PKR',
        status: data.status || 'Pending',
        approved_by: data.approved_by || null,
        notes: data.notes || null,
        created_by: data.created_by || null,
      })
      .returning('*');

    // Auto-create a payable in the payables table
    // Generate pay_no
    const lastPayable = await trx('payables')
      .orderBy('id', 'desc')
      .select('pay_no')
      .first();

    let paySeq = 1;
    if (lastPayable && lastPayable.pay_no) {
      const num = parseInt(lastPayable.pay_no.replace('PAY-', ''), 10);
      if (!isNaN(num)) paySeq = num + 1;
    }
    const payNo = `PAY-${String(paySeq).padStart(3, '0')}`;

    await trx('payables').insert({
      pay_no: payNo,
      entity: 'mill',
      category: 'Supplier Invoice',
      supplier_id: data.supplier_id,
      linked_ref: `INV-${invoice.id}`,
      original_amount: netAmount,
      paid_amount: 0,
      outstanding: netAmount,
      due_date: data.due_date || null,
      status: 'Pending',
      currency: data.currency || 'PKR',
      notes: `Auto-created from supplier invoice ${data.invoice_no}`,
    });

    // Auto-post accounting journal for purchase invoice
    if (netAmount > 0) {
      await accountingService.autoPost(trx, {
        triggerEvent: 'purchase_invoice',
        entity: 'mill',
        amount: netAmount,
        currency: data.currency || 'PKR',
        refType: 'Supplier Invoice',
        refNo: data.invoice_no,
        description: `Purchase invoice ${data.invoice_no} for supplier #${data.supplier_id}`,
        userId: data.created_by || null,
      });
    }

    return invoice;
  },

  /**
   * Approve a supplier invoice.
   */
  async approveInvoice(trx, { invoiceId, approvedBy }) {
    const invoice = await trx('supplier_invoices').where('id', invoiceId).first();
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status !== 'Pending') {
      throw new Error(`Cannot approve invoice in status '${invoice.status}'. Must be 'Pending'.`);
    }

    const [updated] = await trx('supplier_invoices')
      .where('id', invoiceId)
      .update({
        status: 'Approved',
        approved_by: approvedBy,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Update linked payable status
    await trx('payables')
      .where('linked_ref', `INV-${invoiceId}`)
      .update({
        status: 'Approved',
        updated_at: trx.fn.now(),
      });

    return updated;
  },

  // ===========================================================================
  // Purchase Returns
  // ===========================================================================

  /**
   * Create a purchase return and post negative inventory adjustment.
   */
  async createReturn(trx, data) {
    const returnNo = await procurementService.generateReturnNo(trx);

    const qtyMt = parseFloat(data.qty_mt) || 0;

    const [purchaseReturn] = await trx('purchase_returns')
      .insert({
        return_no: returnNo,
        grn_id: data.grn_id || null,
        supplier_id: data.supplier_id,
        qty_mt: qtyMt,
        reason: data.reason || null,
        status: data.status || 'Pending',
        created_by: data.created_by || null,
      })
      .returning('*');

    // Post negative inventory adjustment if GRN has a batch reference
    if (data.grn_id && qtyMt > 0) {
      const grn = await trx('goods_receipt_notes').where('id', data.grn_id).first();
      if (grn && grn.batch_id) {
        const lot = await trx('inventory_lots')
          .where({ batch_ref: `batch-${grn.batch_id}`, type: 'raw', entity: 'mill' })
          .first();

        if (lot) {
          await inventoryService.postMovement(trx, {
            movementType: inventoryService.MOVEMENT_TYPES.RETURN,
            lotId: lot.id,
            qty: qtyMt,
            fromWarehouseId: lot.warehouse_id,
            sourceEntity: 'mill',
            notes: `Purchase return ${returnNo} for GRN ${grn.grn_no}`,
            costPerUnit: parseFloat(grn.price_per_mt) || 0,
            currency: grn.currency || 'PKR',
            userId: data.created_by || null,
          });
        }
      }
    }

    return purchaseReturn;
  },

  // ===========================================================================
  // Landed Cost Allocation
  // ===========================================================================

  /**
   * Add landed costs (transport, loading, etc.) to a GRN and update lot cost.
   */
  async allocateLandedCost(trx, { grnId, costType, amount, currency }) {
    const grn = await trx('goods_receipt_notes').where('id', grnId).first();
    if (!grn) throw new Error(`GRN ${grnId} not found`);

    const costAmount = parseFloat(amount) || 0;

    // Insert cost allocation record
    // Generate cost_no
    const lastCost = await trx('cost_allocations')
      .orderBy('id', 'desc')
      .select('cost_no')
      .first();

    let costSeq = 1;
    if (lastCost && lastCost.cost_no) {
      const num = parseInt(lastCost.cost_no.replace('CA-', ''), 10);
      if (!isNaN(num)) costSeq = num + 1;
    }
    const costNo = `CA-${String(costSeq).padStart(3, '0')}`;

    const [allocation] = await trx('cost_allocations')
      .insert({
        cost_no: costNo,
        date: new Date().toISOString().slice(0, 10),
        entity: 'mill',
        category: costType || 'Transport',
        vendor: null,
        gross_amount: costAmount,
        currency: currency || grn.currency || 'PKR',
        status: 'Allocated',
      })
      .returning('*');

    // Link to the GRN
    await trx('cost_allocation_lines').insert({
      allocation_id: allocation.id,
      target_type: 'grn',
      target_id: String(grnId),
      amount: costAmount,
      pct: 100.0,
    });

    // Update the lot's cost_per_unit to include landed cost
    if (grn.batch_id) {
      const lot = await trx('inventory_lots')
        .where({ batch_ref: `batch-${grn.batch_id}`, type: 'raw', entity: 'mill' })
        .first();

      if (lot) {
        const lotQty = parseFloat(lot.qty) || 1;
        const currentCost = parseFloat(lot.cost_per_unit) || 0;
        const additionalPerUnit = costAmount / lotQty;
        const newCostPerUnit = parseFloat((currentCost + additionalPerUnit).toFixed(2));
        const newTotalValue = parseFloat((newCostPerUnit * lotQty).toFixed(2));

        await trx('inventory_lots')
          .where('id', lot.id)
          .update({
            cost_per_unit: newCostPerUnit,
            total_value: newTotalValue,
            updated_at: trx.fn.now(),
          });
      }
    }

    return allocation;
  },

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * List purchase requisitions with filters.
   */
  async getRequisitions(filters = {}) {
    const {
      page = 1,
      limit = 50,
      status,
      entity,
      priority,
      search,
    } = filters;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('purchase_requisitions as pr')
      .leftJoin('users as u', 'pr.requested_by', 'u.id')
      .leftJoin('users as a', 'pr.approved_by', 'a.id')
      .leftJoin('products as p', 'pr.product_id', 'p.id')
      .select(
        'pr.*',
        'u.full_name as requested_by_name',
        'a.full_name as approved_by_name',
        'p.name as product_name_ref'
      );

    if (status) query = query.where('pr.status', status);
    if (entity) query = query.where('pr.entity', entity);
    if (priority) query = query.where('pr.priority', priority);
    if (search) {
      query = query.where(function () {
        this.where('pr.req_no', 'ilike', `%${search}%`)
          .orWhere('pr.product_name', 'ilike', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('pr.id as total').first();

    const [rows, countResult] = await Promise.all([
      query.orderBy('pr.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      requisitions: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  /**
   * List purchase orders with filters.
   */
  async getPurchaseOrders(filters = {}) {
    const {
      page = 1,
      limit = 50,
      status,
      entity,
      supplier_id,
      search,
    } = filters;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('purchase_orders as po')
      .leftJoin('suppliers as s', 'po.supplier_id', 's.id')
      .leftJoin('users as u', 'po.created_by', 'u.id')
      .leftJoin('purchase_requisitions as pr', 'po.requisition_id', 'pr.id')
      .select(
        'po.*',
        's.name as supplier_name',
        'u.full_name as created_by_name',
        'pr.req_no as requisition_no'
      );

    if (status) query = query.where('po.status', status);
    if (entity) query = query.where('po.entity', entity);
    if (supplier_id) query = query.where('po.supplier_id', supplier_id);
    if (search) {
      query = query.where(function () {
        this.where('po.po_no', 'ilike', `%${search}%`)
          .orWhere('po.product_name', 'ilike', `%${search}%`)
          .orWhere('s.name', 'ilike', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('po.id as total').first();

    const [rows, countResult] = await Promise.all([
      query.orderBy('po.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      purchaseOrders: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  /**
   * Get a single PO with its GRNs and invoices.
   */
  async getPurchaseOrderDetail(poId) {
    const po = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 'po.supplier_id', 's.id')
      .leftJoin('users as u', 'po.created_by', 'u.id')
      .leftJoin('purchase_requisitions as pr', 'po.requisition_id', 'pr.id')
      .select(
        'po.*',
        's.name as supplier_name',
        'u.full_name as created_by_name',
        'pr.req_no as requisition_no'
      )
      .where('po.id', poId)
      .first();

    if (!po) return null;

    const [grns, invoices] = await Promise.all([
      db('goods_receipt_notes').where('po_id', poId).orderBy('created_at', 'desc'),
      db('supplier_invoices').where('po_id', poId).orderBy('created_at', 'desc'),
    ]);

    return { ...po, grns, invoices };
  },

  /**
   * List GRNs with filters.
   */
  async getGRNs(filters = {}) {
    const {
      page = 1,
      limit = 50,
      status,
      quality_status,
      po_id,
      supplier_id,
      search,
    } = filters;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('goods_receipt_notes as g')
      .leftJoin('purchase_orders as po', 'g.po_id', 'po.id')
      .leftJoin('suppliers as s', 'g.supplier_id', 's.id')
      .leftJoin('warehouses as w', 'g.warehouse_id', 'w.id')
      .leftJoin('users as r', 'g.received_by', 'r.id')
      .select(
        'g.*',
        'po.po_no',
        's.name as supplier_name',
        'w.name as warehouse_name',
        'r.full_name as received_by_name'
      );

    if (status) query = query.where('g.status', status);
    if (quality_status) query = query.where('g.quality_status', quality_status);
    if (po_id) query = query.where('g.po_id', po_id);
    if (supplier_id) query = query.where('g.supplier_id', supplier_id);
    if (search) {
      query = query.where(function () {
        this.where('g.grn_no', 'ilike', `%${search}%`)
          .orWhere('g.vehicle_no', 'ilike', `%${search}%`)
          .orWhere('s.name', 'ilike', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('g.id as total').first();

    const [rows, countResult] = await Promise.all([
      query.orderBy('g.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      grns: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  /**
   * Get a single GRN with details.
   */
  async getGRNDetail(grnId) {
    const grn = await db('goods_receipt_notes as g')
      .leftJoin('purchase_orders as po', 'g.po_id', 'po.id')
      .leftJoin('suppliers as s', 'g.supplier_id', 's.id')
      .leftJoin('warehouses as w', 'g.warehouse_id', 'w.id')
      .leftJoin('users as r', 'g.received_by', 'r.id')
      .leftJoin('users as i', 'g.inspected_by', 'i.id')
      .select(
        'g.*',
        'po.po_no',
        's.name as supplier_name',
        'w.name as warehouse_name',
        'r.full_name as received_by_name',
        'i.full_name as inspected_by_name'
      )
      .where('g.id', grnId)
      .first();

    if (!grn) return null;

    const [returns, costAllocations] = await Promise.all([
      db('purchase_returns').where('grn_id', grnId).orderBy('created_at', 'desc'),
      db('cost_allocation_lines as cal')
        .join('cost_allocations as ca', 'cal.allocation_id', 'ca.id')
        .where('cal.target_type', 'grn')
        .where('cal.target_id', String(grnId))
        .select('ca.*', 'cal.amount as line_amount'),
    ]);

    return { ...grn, returns, costAllocations };
  },

  /**
   * List supplier invoices with filters.
   */
  async getSupplierInvoices(filters = {}) {
    const {
      page = 1,
      limit = 50,
      status,
      supplier_id,
      search,
    } = filters;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('supplier_invoices as si')
      .leftJoin('suppliers as s', 'si.supplier_id', 's.id')
      .leftJoin('purchase_orders as po', 'si.po_id', 'po.id')
      .leftJoin('goods_receipt_notes as g', 'si.grn_id', 'g.id')
      .leftJoin('users as u', 'si.created_by', 'u.id')
      .select(
        'si.*',
        's.name as supplier_name',
        'po.po_no',
        'g.grn_no',
        'u.full_name as created_by_name'
      );

    if (status) query = query.where('si.status', status);
    if (supplier_id) query = query.where('si.supplier_id', supplier_id);
    if (search) {
      query = query.where(function () {
        this.where('si.invoice_no', 'ilike', `%${search}%`)
          .orWhere('s.name', 'ilike', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('si.id as total').first();

    const [rows, countResult] = await Promise.all([
      query.orderBy('si.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      invoices: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  /**
   * Get supplier performance metrics.
   */
  async getSupplierPerformance(supplierId) {
    // Total qty purchased & number of POs
    const poStats = await db('purchase_orders')
      .where('supplier_id', supplierId)
      .whereNot('status', 'Cancelled')
      .select(
        db.raw('COUNT(*) as total_pos'),
        db.raw('COALESCE(SUM(qty_mt), 0) as total_qty_ordered'),
        db.raw('COALESCE(SUM(total_amount), 0) as total_value')
      )
      .first();

    // GRN stats: average quality variance, rejection rate
    const grnStats = await db('goods_receipt_notes as g')
      .join('purchase_orders as po', 'g.po_id', 'po.id')
      .where('g.supplier_id', supplierId)
      .whereNot('g.status', 'Cancelled')
      .select(
        db.raw('COUNT(*) as total_grns'),
        db.raw('COALESCE(SUM(g.accepted_qty_mt), 0) as total_qty_received'),
        db.raw('COALESCE(SUM(g.rejected_qty_mt), 0) as total_qty_rejected'),
        db.raw('COALESCE(AVG(g.moisture_actual - po.moisture_expected), 0) as avg_moisture_variance'),
        db.raw('COALESCE(AVG(g.broken_actual - po.broken_expected), 0) as avg_broken_variance')
      )
      .first();

    // Average delivery time (days between PO created and GRN receipt)
    const deliveryStats = await db('goods_receipt_notes as g')
      .join('purchase_orders as po', 'g.po_id', 'po.id')
      .where('g.supplier_id', supplierId)
      .whereNot('g.status', 'Cancelled')
      .select(
        db.raw("COALESCE(AVG(g.receipt_date - po.created_at::date), 0) as avg_delivery_days")
      )
      .first();

    const totalReceived = parseFloat(grnStats.total_qty_received) || 0;
    const totalRejected = parseFloat(grnStats.total_qty_rejected) || 0;
    const rejectionRate = totalReceived + totalRejected > 0
      ? parseFloat(((totalRejected / (totalReceived + totalRejected)) * 100).toFixed(2))
      : 0;

    return {
      supplier_id: parseInt(supplierId),
      total_pos: parseInt(poStats.total_pos) || 0,
      total_qty_ordered: parseFloat(poStats.total_qty_ordered) || 0,
      total_value: parseFloat(poStats.total_value) || 0,
      total_grns: parseInt(grnStats.total_grns) || 0,
      total_qty_received: totalReceived,
      total_qty_rejected: totalRejected,
      rejection_rate_pct: rejectionRate,
      avg_moisture_variance: parseFloat(parseFloat(grnStats.avg_moisture_variance).toFixed(2)),
      avg_broken_variance: parseFloat(parseFloat(grnStats.avg_broken_variance).toFixed(2)),
      avg_delivery_days: parseFloat(parseFloat(deliveryStats.avg_delivery_days).toFixed(1)),
    };
  },
};

module.exports = procurementService;
