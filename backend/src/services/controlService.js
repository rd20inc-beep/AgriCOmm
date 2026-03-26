const db = require('../config/database');
const auditService = require('./auditService');

const controlService = {
  // ═══════════════════════════════════════════════════════════════════
  // APPROVAL QUEUE (Maker-Checker)
  // ═══════════════════════════════════════════════════════════════════

  async submitForApproval(trx, { approvalType, entityType, entityId, entityRef, requestedBy, currentData, proposedData, amount, currency, notes, priority }) {
    const knex = trx || db;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const [record] = await knex('approval_queue')
      .insert({
        approval_type: approvalType,
        entity_type: entityType,
        entity_id: entityId,
        entity_ref: entityRef || null,
        requested_by: requestedBy,
        current_data: currentData ? JSON.stringify(currentData) : null,
        proposed_data: proposedData ? JSON.stringify(proposedData) : null,
        amount: amount || null,
        currency: currency || null,
        notes: notes || null,
        priority: priority || 'Normal',
        expires_at: expiresAt,
        status: 'Pending',
      })
      .returning('*');

    await auditService.log({
      userId: requestedBy,
      action: 'submit_for_approval',
      entityType: 'approval_queue',
      entityId: record.id,
      details: { approvalType, entityType, entityId, entityRef, amount },
      db_instance: knex,
    });

    return record;
  },

  async approveRequest(trx, { approvalId, approvedBy, notes }) {
    const knex = trx || db;

    const approval = await knex('approval_queue').where({ id: approvalId }).first();
    if (!approval) throw new Error('Approval request not found.');
    if (approval.status !== 'Pending') throw new Error(`Cannot approve: status is ${approval.status}.`);
    if (approval.requested_by === approvedBy) throw new Error('Maker-checker violation: approver cannot be the same as requester.');

    // Apply the proposed change to the actual entity
    if (approval.proposed_data) {
      const proposed = typeof approval.proposed_data === 'string' ? JSON.parse(approval.proposed_data) : approval.proposed_data;

      const entityTableMap = {
        export_order: 'export_orders',
        milling_batch: 'milling_batches',
        inventory_lot: 'inventory_lots',
        journal_entry: 'journal_entries',
        internal_transfer: 'internal_transfers',
        receivable: 'receivables',
        payable: 'payables',
      };

      const table = entityTableMap[approval.entity_type];
      if (table) {
        const exists = await knex.schema.hasTable(table);
        if (exists) {
          await knex(table).where({ id: approval.entity_id }).update(proposed);
        }
      }
    }

    const [updated] = await knex('approval_queue')
      .where({ id: approvalId })
      .update({
        status: 'Approved',
        approved_by: approvedBy,
        approved_at: new Date(),
        notes: notes || approval.notes,
      })
      .returning('*');

    await auditService.log({
      userId: approvedBy,
      action: 'approve_request',
      entityType: 'approval_queue',
      entityId: approvalId,
      details: { entityType: approval.entity_type, entityId: approval.entity_id, entityRef: approval.entity_ref },
      db_instance: knex,
    });

    return updated;
  },

  async rejectRequest(trx, { approvalId, rejectedBy, reason }) {
    const knex = trx || db;

    const approval = await knex('approval_queue').where({ id: approvalId }).first();
    if (!approval) throw new Error('Approval request not found.');
    if (approval.status !== 'Pending') throw new Error(`Cannot reject: status is ${approval.status}.`);

    const [updated] = await knex('approval_queue')
      .where({ id: approvalId })
      .update({
        status: 'Rejected',
        approved_by: rejectedBy,
        approved_at: new Date(),
        rejection_reason: reason || null,
      })
      .returning('*');

    await auditService.log({
      userId: rejectedBy,
      action: 'reject_request',
      entityType: 'approval_queue',
      entityId: approvalId,
      details: { entityType: approval.entity_type, entityId: approval.entity_id, reason },
      db_instance: knex,
    });

    return updated;
  },

  async getPendingApprovals({ userId, approvalType, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;

    const query = db('approval_queue as aq')
      .leftJoin('users as req', 'aq.requested_by', 'req.id')
      .where('aq.status', 'Pending')
      .where(function () {
        // Exclude own requests (maker-checker: can't approve own)
        if (userId) this.whereNot('aq.requested_by', userId);
      });

    if (approvalType) query.where('aq.approval_type', approvalType);

    const [{ count }] = await query.clone().count('aq.id as count');
    const rows = await query
      .clone()
      .select(
        'aq.*',
        'req.full_name as requested_by_name',
        'req.email as requested_by_email'
      )
      .orderByRaw("CASE aq.priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 WHEN 'Low' THEN 4 END")
      .orderBy('aq.requested_at', 'asc')
      .offset(offset)
      .limit(limit);

    return {
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(count, 10),
        totalPages: Math.ceil(count / limit),
      },
    };
  },

  async getMyRequests(userId, { page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;

    const query = db('approval_queue as aq')
      .leftJoin('users as appr', 'aq.approved_by', 'appr.id')
      .where('aq.requested_by', userId);

    const [{ count }] = await query.clone().count('aq.id as count');
    const rows = await query
      .clone()
      .select(
        'aq.*',
        'appr.full_name as approved_by_name'
      )
      .orderBy('aq.created_at', 'desc')
      .offset(offset)
      .limit(limit);

    return {
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(count, 10),
        totalPages: Math.ceil(count / limit),
      },
    };
  },

  async getApprovalHistory({ entityType, entityId }) {
    return db('approval_queue as aq')
      .leftJoin('users as req', 'aq.requested_by', 'req.id')
      .leftJoin('users as appr', 'aq.approved_by', 'appr.id')
      .where('aq.entity_type', entityType)
      .where('aq.entity_id', entityId)
      .select(
        'aq.*',
        'req.full_name as requested_by_name',
        'appr.full_name as approved_by_name'
      )
      .orderBy('aq.created_at', 'desc');
  },

  // ═══════════════════════════════════════════════════════════════════
  // MARGIN ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  async calculateOrderMargin(orderId) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Export order not found.');

    // Get actual costs from export_order_costs
    const costRows = await db('export_order_costs').where({ order_id: orderId });
    const actualCosts = {};
    let totalActualCost = 0;
    for (const c of costRows) {
      actualCosts[c.category] = parseFloat(c.amount) || 0;
      totalActualCost += parseFloat(c.amount) || 0;
    }

    // Estimated costs: use contract_value-based estimates (industry norms per MT)
    const qtyMT = parseFloat(order.qty_mt) || 1;
    const pricePerMT = parseFloat(order.price_per_mt) || 0;
    const contractValue = parseFloat(order.contract_value) || 0;

    const estimatedCosts = {
      rice: qtyMT * pricePerMT * 0.50,     // ~50% of selling price for raw material
      bags: qtyMT * 25,                      // ~$25/MT for bags
      loading: qtyMT * 20,                   // ~$20/MT for loading
      clearing: qtyMT * 15,                  // ~$15/MT for clearing
      freight: qtyMT * 65,                   // ~$65/MT for freight (CIF/CNF)
      misc: qtyMT * 10,                      // ~$10/MT misc
    };
    let totalEstimatedCost = Object.values(estimatedCosts).reduce((s, v) => s + v, 0);

    // Revenue
    const estimatedRevenue = contractValue;
    const actualRevenue = parseFloat(order.advance_received || 0) + parseFloat(order.balance_received || 0);

    // Margin calculations
    const estimatedMarginPct = estimatedRevenue > 0 ? ((estimatedRevenue - totalEstimatedCost) / estimatedRevenue * 100) : 0;
    const actualMarginPct = actualRevenue > 0 ? ((actualRevenue - totalActualCost) / actualRevenue * 100) : 0;

    const varianceAmount = (actualRevenue - totalActualCost) - (estimatedRevenue - totalEstimatedCost);
    const variancePct = estimatedRevenue > 0 ? (varianceAmount / estimatedRevenue * 100) : 0;

    // FX rates
    const fxRateBooked = await db('fx_rates')
      .where('from_currency', 'USD')
      .where('to_currency', 'PKR')
      .where('effective_date', '<=', order.created_at || new Date())
      .orderBy('effective_date', 'desc')
      .select('rate')
      .first();

    const fxRateActual = await db('fx_rates')
      .where('from_currency', 'USD')
      .where('to_currency', 'PKR')
      .orderBy('effective_date', 'desc')
      .select('rate')
      .first();

    const bookedRate = fxRateBooked ? parseFloat(fxRateBooked.rate) : 280.00;
    const currentRate = fxRateActual ? parseFloat(fxRateActual.rate) : 280.00;
    const fxGainLoss = (currentRate - bookedRate) * actualRevenue / currentRate;

    // Risk flags
    const riskFlags = [];
    if (actualMarginPct < 0) riskFlags.push('negative_margin');
    if (actualMarginPct < 5) riskFlags.push('low_margin');
    if (Math.abs(variancePct) > 10) riskFlags.push('high_variance');
    if (order.balance_received < order.balance_expected && order.status !== 'Draft') riskFlags.push('outstanding_balance');
    if (Math.abs(fxGainLoss) > 500) riskFlags.push(fxGainLoss > 0 ? 'fx_gain' : 'fx_loss');

    // Upsert margin_analysis record
    const existing = await db('margin_analysis').where({ order_id: orderId }).first();
    const record = {
      order_id: orderId,
      analysis_date: new Date(),
      estimated_revenue: estimatedRevenue,
      actual_revenue: actualRevenue,
      estimated_costs: JSON.stringify(estimatedCosts),
      actual_costs: JSON.stringify(actualCosts),
      estimated_margin_pct: Math.round(estimatedMarginPct * 100) / 100,
      actual_margin_pct: Math.round(actualMarginPct * 100) / 100,
      variance_amount: Math.round(varianceAmount * 100) / 100,
      variance_pct: Math.round(variancePct * 100) / 100,
      fx_rate_booked: bookedRate,
      fx_rate_actual: currentRate,
      fx_gain_loss: Math.round(fxGainLoss * 100) / 100,
      risk_flags: JSON.stringify(riskFlags),
    };

    let result;
    if (existing) {
      [result] = await db('margin_analysis').where({ id: existing.id }).update(record).returning('*');
    } else {
      [result] = await db('margin_analysis').insert(record).returning('*');
    }

    return {
      ...result,
      order_no: order.order_no,
      customer_id: order.customer_id,
      total_estimated_cost: totalEstimatedCost,
      total_actual_cost: totalActualCost,
    };
  },

  async getMarginComparison({ dateFrom, dateTo, customerId, country }) {
    const query = db('margin_analysis as ma')
      .join('export_orders as eo', 'ma.order_id', 'eo.id')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select(
        'ma.*',
        'eo.order_no',
        'eo.customer_id',
        'eo.country',
        'eo.product_name',
        'eo.qty_mt',
        'eo.contract_value',
        'eo.status as order_status',
        'c.name as customer_name'
      );

    if (dateFrom) query.where('ma.analysis_date', '>=', dateFrom);
    if (dateTo) query.where('ma.analysis_date', '<=', dateTo);
    if (customerId) query.where('eo.customer_id', customerId);
    if (country) query.where('eo.country', country);

    const rows = await query.orderBy('ma.analysis_date', 'desc');

    // Aggregate summary
    const summary = {
      total_orders: rows.length,
      total_estimated_revenue: rows.reduce((s, r) => s + parseFloat(r.estimated_revenue || 0), 0),
      total_actual_revenue: rows.reduce((s, r) => s + parseFloat(r.actual_revenue || 0), 0),
      avg_estimated_margin_pct: rows.length > 0
        ? rows.reduce((s, r) => s + parseFloat(r.estimated_margin_pct || 0), 0) / rows.length
        : 0,
      avg_actual_margin_pct: rows.length > 0
        ? rows.reduce((s, r) => s + parseFloat(r.actual_margin_pct || 0), 0) / rows.length
        : 0,
      total_fx_gain_loss: rows.reduce((s, r) => s + parseFloat(r.fx_gain_loss || 0), 0),
    };

    return { data: rows, summary };
  },

  async simulatePricing({ productId, qtyMT, targetMarginPct, costs, fxRate, name, userId }) {
    const rawRiceCostPerMT = parseFloat(costs.rawRice || 0);
    const millingCostPerMT = parseFloat(costs.milling || 0);
    const bagsCostPerMT = parseFloat(costs.bags || 0);
    const freightCostPerMT = parseFloat(costs.freight || 0);
    const clearingCostPerMT = parseFloat(costs.clearing || 0);
    const otherCostsPerMT = parseFloat(costs.other || 0);

    const totalCostPerMT = rawRiceCostPerMT + millingCostPerMT + bagsCostPerMT + freightCostPerMT + clearingCostPerMT + otherCostsPerMT;
    const marginMultiplier = 1 - (parseFloat(targetMarginPct) / 100);
    const minimumSellingPrice = marginMultiplier > 0 ? totalCostPerMT / marginMultiplier : totalCostPerMT;
    const recommendedPrice = minimumSellingPrice * 1.05; // 5% buffer

    const [record] = await db('pricing_simulations')
      .insert({
        name: name || `Simulation ${new Date().toISOString().slice(0, 10)}`,
        product_id: productId || null,
        qty_mt: qtyMT || null,
        target_margin_pct: targetMarginPct,
        raw_rice_cost_per_mt: rawRiceCostPerMT,
        milling_cost_per_mt: millingCostPerMT,
        bags_cost_per_mt: bagsCostPerMT,
        freight_cost_per_mt: freightCostPerMT,
        clearing_cost_per_mt: clearingCostPerMT,
        other_costs_per_mt: otherCostsPerMT,
        total_cost_per_mt: Math.round(totalCostPerMT * 100) / 100,
        minimum_selling_price: Math.round(minimumSellingPrice * 100) / 100,
        recommended_price: Math.round(recommendedPrice * 100) / 100,
        fx_rate: fxRate || null,
        currency: 'USD',
        created_by: userId || null,
      })
      .returning('*');

    return {
      ...record,
      total_cost: Math.round(totalCostPerMT * (qtyMT || 1) * 100) / 100,
      total_revenue_at_min: Math.round(minimumSellingPrice * (qtyMT || 1) * 100) / 100,
      total_revenue_at_recommended: Math.round(recommendedPrice * (qtyMT || 1) * 100) / 100,
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIER INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateSupplierScore(supplierId, { periodStart, periodEnd }) {
    const supplier = await db('suppliers').where({ id: supplierId }).first();
    if (!supplier) throw new Error('Supplier not found.');

    // Get GRNs for this supplier in period
    const grns = await db('goods_receipt_notes')
      .where('supplier_id', supplierId)
      .where('receipt_date', '>=', periodStart)
      .where('receipt_date', '<=', periodEnd);

    const grnCount = grns.length;
    const totalQtyMT = grns.reduce((s, g) => s + parseFloat(g.accepted_qty_mt || 0), 0);
    const totalRejectedMT = grns.reduce((s, g) => s + parseFloat(g.rejected_qty_mt || 0), 0);
    const rejectionPct = (totalQtyMT + totalRejectedMT) > 0
      ? (totalRejectedMT / (totalQtyMT + totalRejectedMT)) * 100
      : 0;

    // Get milling batches for this supplier in period
    const batches = await db('milling_batches')
      .where('supplier_id', supplierId)
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd);

    const batchesCount = batches.length;

    // Quality: avg moisture and broken variance from GRNs with POs
    let avgMoistureVariance = 0;
    let avgBrokenVariance = 0;
    let qualityCount = 0;

    for (const grn of grns) {
      if (grn.po_id) {
        const po = await db('purchase_orders').where({ id: grn.po_id }).first();
        if (po) {
          const moistureVar = Math.abs(parseFloat(grn.moisture_actual || 0) - parseFloat(po.moisture_expected || 0));
          const brokenVar = Math.abs(parseFloat(grn.broken_actual || 0) - parseFloat(po.broken_expected || 0));
          avgMoistureVariance += moistureVar;
          avgBrokenVariance += brokenVar;
          qualityCount++;
        }
      }
    }
    avgMoistureVariance = qualityCount > 0 ? avgMoistureVariance / qualityCount : 0;
    avgBrokenVariance = qualityCount > 0 ? avgBrokenVariance / qualityCount : 0;

    // Delivery: average days between PO delivery_date and GRN receipt_date
    let totalLateDays = 0;
    let deliveryCount = 0;
    for (const grn of grns) {
      if (grn.po_id) {
        const po = await db('purchase_orders').where({ id: grn.po_id }).first();
        if (po && po.delivery_date) {
          const expected = new Date(po.delivery_date);
          const actual = new Date(grn.receipt_date);
          const diffDays = (actual - expected) / (1000 * 60 * 60 * 24);
          totalLateDays += Math.max(0, diffDays);
          deliveryCount++;
        }
      }
    }
    const avgDeliveryDays = deliveryCount > 0 ? totalLateDays / deliveryCount : 0;

    // Total value from POs
    const poIds = [...new Set(grns.map(g => g.po_id).filter(Boolean))];
    let totalValue = 0;
    if (poIds.length > 0) {
      const pos = await db('purchase_orders').whereIn('id', poIds);
      totalValue = pos.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0);
    }

    // Price score: compare avg price vs market avg
    const allPOs = await db('purchase_orders')
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd)
      .whereNotNull('price_per_mt');
    const marketAvgPrice = allPOs.length > 0
      ? allPOs.reduce((s, p) => s + parseFloat(p.price_per_mt || 0), 0) / allPOs.length
      : 0;
    const supplierPOs = allPOs.filter(p => p.supplier_id === supplierId);
    const supplierAvgPrice = supplierPOs.length > 0
      ? supplierPOs.reduce((s, p) => s + parseFloat(p.price_per_mt || 0), 0) / supplierPOs.length
      : 0;
    const priceScore = marketAvgPrice > 0
      ? Math.max(0, Math.min(100, 100 - ((supplierAvgPrice - marketAvgPrice) / marketAvgPrice * 100 * 2)))
      : 50;

    // Quality score: 100 - (moisture_variance * 10 + broken_variance * 10 + rejection_pct)
    const qualityScore = Math.max(0, Math.min(100, 100 - (avgMoistureVariance * 10 + avgBrokenVariance * 10 + rejectionPct)));

    // Delivery score: 100 - (avg_late_days * 5)
    const deliveryScore = Math.max(0, Math.min(100, 100 - (avgDeliveryDays * 5)));

    // Overall = weighted avg (quality 40%, delivery 30%, price 30%)
    const overallScore = Math.round((qualityScore * 0.4 + deliveryScore * 0.3 + priceScore * 0.3) * 100) / 100;

    const [record] = await db('supplier_scores')
      .insert({
        supplier_id: supplierId,
        period_start: periodStart,
        period_end: periodEnd,
        quality_score: Math.round(qualityScore * 100) / 100,
        delivery_score: Math.round(deliveryScore * 100) / 100,
        price_score: Math.round(priceScore * 100) / 100,
        overall_score: overallScore,
        total_qty_mt: Math.round(totalQtyMT * 100) / 100,
        total_value: Math.round(totalValue * 100) / 100,
        avg_moisture_variance: Math.round(avgMoistureVariance * 100) / 100,
        avg_broken_variance: Math.round(avgBrokenVariance * 100) / 100,
        rejection_pct: Math.round(rejectionPct * 100) / 100,
        avg_delivery_days: Math.round(avgDeliveryDays * 10) / 10,
        batches_count: batchesCount,
        grn_count: grnCount,
      })
      .returning('*');

    return { ...record, supplier_name: supplier.name };
  },

  async getSupplierScoreboard({ periodStart, periodEnd }) {
    const query = db('supplier_scores as ss')
      .join('suppliers as s', 'ss.supplier_id', 's.id')
      .select(
        'ss.*',
        's.name as supplier_name',
        's.type as supplier_type',
        's.country as supplier_country'
      );

    if (periodStart) query.where('ss.period_start', '>=', periodStart);
    if (periodEnd) query.where('ss.period_end', '<=', periodEnd);

    // Get latest score per supplier
    const rows = await query.orderBy('ss.overall_score', 'desc');

    // Deduplicate: keep only latest per supplier
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      if (!seen.has(row.supplier_id)) {
        seen.add(row.supplier_id);
        unique.push(row);
      }
    }

    return { data: unique, total: unique.length };
  },

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOMER INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateCustomerScore(customerId, { periodStart, periodEnd }) {
    const customer = await db('customers').where({ id: customerId }).first();
    if (!customer) throw new Error('Customer not found.');

    // Get all export orders for this customer in period
    const orders = await db('export_orders')
      .where('customer_id', customerId)
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd);

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.contract_value || 0), 0);

    // Calculate margin per order
    let totalProfit = 0;
    let marginSum = 0;
    let overdueCount = 0;
    let advanceDaysSum = 0;
    let balanceDaysSum = 0;
    let advanceCount = 0;
    let balanceCount = 0;

    for (const order of orders) {
      // Get costs
      const costs = await db('export_order_costs').where({ order_id: order.id });
      const totalCost = costs.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
      const revenue = parseFloat(order.contract_value || 0);
      const profit = revenue - totalCost;
      totalProfit += profit;
      if (revenue > 0) marginSum += (profit / revenue) * 100;

      // Advance timing
      if (order.advance_date && order.created_at) {
        const created = new Date(order.created_at);
        const advancePaid = new Date(order.advance_date);
        const daysDiff = (advancePaid - created) / (1000 * 60 * 60 * 24);
        advanceDaysSum += daysDiff;
        advanceCount++;
      }

      // Balance timing
      if (order.balance_date && order.advance_date) {
        const advancePaid = new Date(order.advance_date);
        const balancePaid = new Date(order.balance_date);
        const daysDiff = (balancePaid - advancePaid) / (1000 * 60 * 60 * 24);
        balanceDaysSum += daysDiff;
        balanceCount++;
      }

      // Overdue: balance expected but not received, and shipment ETA passed
      if (
        parseFloat(order.balance_received || 0) < parseFloat(order.balance_expected || 0) &&
        order.shipment_eta &&
        new Date(order.shipment_eta) < new Date()
      ) {
        overdueCount++;
      }
    }

    const avgMarginPct = totalOrders > 0 ? marginSum / totalOrders : 0;
    const avgAdvanceDays = advanceCount > 0 ? advanceDaysSum / advanceCount : 0;
    const avgBalanceDays = balanceCount > 0 ? balanceDaysSum / balanceCount : 0;

    // Payment score: 100 - (avg_advance_delay * 3 + avg_balance_delay * 3 + overdue * 10)
    // Assume "on time" is 14 days for advance, 30 days for balance
    const advanceDelay = Math.max(0, avgAdvanceDays - 14);
    const balanceDelay = Math.max(0, avgBalanceDays - 30);
    const paymentScore = Math.max(0, Math.min(100, 100 - (advanceDelay * 3 + balanceDelay * 3 + overdueCount * 10)));

    // Profitability score: based on avg margin %
    const profitabilityScore = Math.max(0, Math.min(100, avgMarginPct * 4)); // 25% margin = 100

    // Volume score: based on total MT vs portfolio average
    const allOrders = await db('export_orders')
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd);
    const allCustomerIds = [...new Set(allOrders.map(o => o.customer_id))];
    const avgOrdersPerCustomer = allCustomerIds.length > 0 ? allOrders.length / allCustomerIds.length : 1;
    const volumeScore = Math.max(0, Math.min(100, (totalOrders / Math.max(avgOrdersPerCustomer, 1)) * 50));

    // Overall = weighted avg (payment 40%, profitability 35%, volume 25%)
    const overallScore = Math.round((paymentScore * 0.4 + profitabilityScore * 0.35 + volumeScore * 0.25) * 100) / 100;

    // Risk level
    let riskLevel = 'Low';
    if (paymentScore < 30) riskLevel = 'Critical';
    else if (paymentScore < 50) riskLevel = 'High';
    else if (paymentScore < 70) riskLevel = 'Medium';

    const [record] = await db('customer_scores')
      .insert({
        customer_id: customerId,
        period_start: periodStart,
        period_end: periodEnd,
        payment_score: Math.round(paymentScore * 100) / 100,
        profitability_score: Math.round(profitabilityScore * 100) / 100,
        volume_score: Math.round(volumeScore * 100) / 100,
        overall_score: overallScore,
        total_orders: totalOrders,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_profit: Math.round(totalProfit * 100) / 100,
        avg_margin_pct: Math.round(avgMarginPct * 100) / 100,
        avg_advance_days: Math.round(avgAdvanceDays * 10) / 10,
        avg_balance_days: Math.round(avgBalanceDays * 10) / 10,
        overdue_count: overdueCount,
        risk_level: riskLevel,
      })
      .returning('*');

    return { ...record, customer_name: customer.name };
  },

  async getCustomerScoreboard({ periodStart, periodEnd }) {
    const query = db('customer_scores as cs')
      .join('customers as c', 'cs.customer_id', 'c.id')
      .select(
        'cs.*',
        'c.name as customer_name',
        'c.country as customer_country'
      );

    if (periodStart) query.where('cs.period_start', '>=', periodStart);
    if (periodEnd) query.where('cs.period_end', '<=', periodEnd);

    const rows = await query.orderBy('cs.overall_score', 'desc');

    // Deduplicate: keep only latest per customer
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      if (!seen.has(row.customer_id)) {
        seen.add(row.customer_id);
        unique.push(row);
      }
    }

    return { data: unique, total: unique.length };
  },

  async getCustomerPaymentTrends(customerId) {
    const customer = await db('customers').where({ id: customerId }).first();
    if (!customer) throw new Error('Customer not found.');

    // Get all orders for this customer, sorted by date
    const orders = await db('export_orders')
      .where('customer_id', customerId)
      .orderBy('created_at', 'asc');

    const trends = [];
    for (const order of orders) {
      let advanceDays = null;
      let balanceDays = null;

      if (order.advance_date && order.created_at) {
        advanceDays = Math.round((new Date(order.advance_date) - new Date(order.created_at)) / (1000 * 60 * 60 * 24));
      }
      if (order.balance_date && order.advance_date) {
        balanceDays = Math.round((new Date(order.balance_date) - new Date(order.advance_date)) / (1000 * 60 * 60 * 24));
      }

      const balanceOutstanding = parseFloat(order.balance_expected || 0) - parseFloat(order.balance_received || 0);

      trends.push({
        order_id: order.id,
        order_no: order.order_no,
        contract_value: order.contract_value,
        status: order.status,
        created_at: order.created_at,
        advance_expected: order.advance_expected,
        advance_received: order.advance_received,
        advance_days: advanceDays,
        balance_expected: order.balance_expected,
        balance_received: order.balance_received,
        balance_days: balanceDays,
        balance_outstanding: balanceOutstanding,
        is_overdue: balanceOutstanding > 0 && order.shipment_eta && new Date(order.shipment_eta) < new Date(),
      });
    }

    // Monthly aggregation
    const monthly = {};
    for (const t of trends) {
      const month = t.created_at ? new Date(t.created_at).toISOString().slice(0, 7) : 'Unknown';
      if (!monthly[month]) {
        monthly[month] = { month, orders: 0, avg_advance_days: 0, avg_balance_days: 0, total_outstanding: 0, _advSum: 0, _advCnt: 0, _balSum: 0, _balCnt: 0 };
      }
      monthly[month].orders++;
      if (t.advance_days !== null) { monthly[month]._advSum += t.advance_days; monthly[month]._advCnt++; }
      if (t.balance_days !== null) { monthly[month]._balSum += t.balance_days; monthly[month]._balCnt++; }
      monthly[month].total_outstanding += t.balance_outstanding;
    }

    const monthlyTrends = Object.values(monthly).map(m => ({
      month: m.month,
      orders: m.orders,
      avg_advance_days: m._advCnt > 0 ? Math.round(m._advSum / m._advCnt * 10) / 10 : null,
      avg_balance_days: m._balCnt > 0 ? Math.round(m._balSum / m._balCnt * 10) / 10 : null,
      total_outstanding: Math.round(m.total_outstanding * 100) / 100,
    }));

    return {
      customer: { id: customer.id, name: customer.name, country: customer.country },
      orders: trends,
      monthly: monthlyTrends,
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // MILLING INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateMillPerformance(millId, { periodStart, periodEnd }) {
    const mill = await db('mills').where({ id: millId }).first();
    if (!mill) throw new Error('Mill not found.');

    // Get batches processed at this mill in period
    const batches = await db('milling_batches')
      .where('mill_id', millId)
      .where('created_at', '>=', periodStart)
      .where('created_at', '<=', periodEnd);

    const batchesProcessed = batches.length;
    const totalInputMT = batches.reduce((s, b) => s + parseFloat(b.raw_qty_mt || 0), 0);
    const totalOutputMT = batches.reduce((s, b) => s + parseFloat(b.actual_finished_mt || 0), 0);

    const avgYieldPct = totalInputMT > 0 ? (totalOutputMT / totalInputMT) * 100 : 0;
    const totalBrokenMT = batches.reduce((s, b) => s + parseFloat(b.broken_mt || 0), 0);
    const totalBranMT = batches.reduce((s, b) => s + parseFloat(b.bran_mt || 0), 0);
    const avgBrokenPct = totalInputMT > 0 ? (totalBrokenMT / totalInputMT) * 100 : 0;
    const avgBranPct = totalInputMT > 0 ? (totalBranMT / totalInputMT) * 100 : 0;

    // Total downtime from machine_downtime
    const downtimeRows = await db('machine_downtime')
      .where('mill_id', millId)
      .where('start_time', '>=', periodStart)
      .where('start_time', '<=', periodEnd);

    const totalDowntimeHours = downtimeRows.reduce((s, d) => s + (parseFloat(d.duration_minutes || 0) / 60), 0);

    // Utilization: available hours = days * 16h (2 shifts), actual = processing hours from batches
    const daysDiff = (new Date(periodEnd) - new Date(periodStart)) / (1000 * 60 * 60 * 24);
    const availableHours = daysDiff * 16;
    const totalProcessingHours = batches.reduce((s, b) => s + parseFloat(b.processing_hours || 0), 0);
    const utilizationPct = availableHours > 0 ? (totalProcessingHours / availableHours) * 100 : 0;

    // Costs from milling_costs
    const batchIds = batches.map(b => b.id);
    let totalElectricityCost = 0;
    let totalLaborCost = 0;
    let totalCost = 0;

    if (batchIds.length > 0) {
      const millingCosts = await db('milling_costs').whereIn('batch_id', batchIds);
      for (const mc of millingCosts) {
        const amt = parseFloat(mc.amount || 0);
        totalCost += amt;
        if (mc.category === 'electricity' || mc.category === 'power') totalElectricityCost += amt;
        if (mc.category === 'labor' || mc.category === 'labour') totalLaborCost += amt;
      }
    }

    // Electricity from utility_consumption
    const utilities = await db('utility_consumption')
      .where('mill_id', millId)
      .where('reading_date', '>=', periodStart)
      .where('reading_date', '<=', periodEnd);

    for (const u of utilities) {
      if (u.utility_type === 'electricity') {
        totalElectricityCost += parseFloat(u.cost || 0);
      }
    }

    const avgCostPerMT = totalOutputMT > 0 ? totalCost / totalOutputMT : 0;

    const [record] = await db('mill_performance')
      .insert({
        mill_id: millId,
        period_start: periodStart,
        period_end: periodEnd,
        batches_processed: batchesProcessed,
        total_input_mt: Math.round(totalInputMT * 100) / 100,
        total_output_mt: Math.round(totalOutputMT * 100) / 100,
        avg_yield_pct: Math.round(avgYieldPct * 100) / 100,
        avg_broken_pct: Math.round(avgBrokenPct * 100) / 100,
        avg_bran_pct: Math.round(avgBranPct * 100) / 100,
        avg_cost_per_mt: Math.round(avgCostPerMT * 100) / 100,
        total_downtime_hours: Math.round(totalDowntimeHours * 100) / 100,
        utilization_pct: Math.round(utilizationPct * 100) / 100,
        total_electricity_cost: Math.round(totalElectricityCost * 100) / 100,
        total_labor_cost: Math.round(totalLaborCost * 100) / 100,
        currency: 'PKR',
      })
      .returning('*');

    return { ...record, mill_name: mill.name, mill_location: mill.location };
  },

  async getRecoveryAnalysis({ supplierId, productId, dateFrom, dateTo }) {
    const query = db('milling_batches as mb')
      .leftJoin('recovery_benchmarks as rb', 'mb.benchmark_id', 'rb.id')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .select(
        'mb.id as batch_id',
        'mb.batch_no',
        'mb.supplier_id',
        's.name as supplier_name',
        'mb.raw_qty_mt',
        'mb.actual_finished_mt',
        'mb.broken_mt',
        'mb.bran_mt',
        'mb.husk_mt',
        'mb.wastage_mt',
        'mb.yield_pct as actual_yield_pct',
        'rb.expected_yield_pct as benchmark_yield_pct',
        'rb.expected_broken_pct as benchmark_broken_pct',
        'rb.expected_bran_pct as benchmark_bran_pct',
        'rb.variety',
        'mb.created_at'
      );

    if (supplierId) query.where('mb.supplier_id', supplierId);
    if (productId) query.where('rb.product_id', productId);
    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);

    const rows = await query.orderBy('mb.created_at', 'desc');

    // Enrich with variance
    const data = rows.map(r => {
      const rawQty = parseFloat(r.raw_qty_mt || 0);
      const actualBrokenPct = rawQty > 0 ? (parseFloat(r.broken_mt || 0) / rawQty) * 100 : 0;
      const actualBranPct = rawQty > 0 ? (parseFloat(r.bran_mt || 0) / rawQty) * 100 : 0;

      return {
        ...r,
        actual_broken_pct: Math.round(actualBrokenPct * 100) / 100,
        actual_bran_pct: Math.round(actualBranPct * 100) / 100,
        yield_variance: r.benchmark_yield_pct
          ? Math.round((parseFloat(r.actual_yield_pct || 0) - parseFloat(r.benchmark_yield_pct)) * 100) / 100
          : null,
        broken_variance: r.benchmark_broken_pct
          ? Math.round((actualBrokenPct - parseFloat(r.benchmark_broken_pct)) * 100) / 100
          : null,
      };
    });

    // Summary
    const summary = {
      total_batches: data.length,
      total_input_mt: data.reduce((s, r) => s + parseFloat(r.raw_qty_mt || 0), 0),
      total_output_mt: data.reduce((s, r) => s + parseFloat(r.actual_finished_mt || 0), 0),
      avg_yield_pct: data.length > 0
        ? Math.round(data.reduce((s, r) => s + parseFloat(r.actual_yield_pct || 0), 0) / data.length * 100) / 100
        : 0,
      avg_broken_pct: data.length > 0
        ? Math.round(data.reduce((s, r) => s + r.actual_broken_pct, 0) / data.length * 100) / 100
        : 0,
    };

    return { data, summary };
  },

  // ═══════════════════════════════════════════════════════════════════
  // STOCK COUNT / INVENTORY AUDIT
  // ═══════════════════════════════════════════════════════════════════

  async createStockCount(trx, { countType, warehouseId, plannedDate, userId }) {
    const knex = trx || db;

    // Generate count number: SC-001
    const last = await knex('stock_counts')
      .orderBy('id', 'desc')
      .select('count_no')
      .first();

    let seq = 1;
    if (last && last.count_no) {
      const parts = last.count_no.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    const countNo = `SC-${String(seq).padStart(3, '0')}`;

    // Create the stock count
    const [stockCount] = await knex('stock_counts')
      .insert({
        count_no: countNo,
        count_type: countType,
        warehouse_id: warehouseId || null,
        status: 'Planned',
        planned_date: plannedDate || null,
        created_by: userId,
      })
      .returning('*');

    // Get all lots in the warehouse (or all if no warehouse specified)
    const lotQuery = knex('inventory_lots').where('qty', '>', 0);
    if (warehouseId) lotQuery.where('warehouse_id', warehouseId);
    const lots = await lotQuery;

    // Create stock_count_items for each lot
    if (lots.length > 0) {
      const items = lots.map(lot => ({
        stock_count_id: stockCount.id,
        lot_id: lot.id,
        item_name: lot.item_name,
        system_qty: lot.qty,
        status: 'Pending',
      }));
      await knex('stock_count_items').insert(items);
    }

    // Fetch created items
    const countItems = await knex('stock_count_items').where({ stock_count_id: stockCount.id });

    await auditService.log({
      userId,
      action: 'create_stock_count',
      entityType: 'stock_count',
      entityId: stockCount.id,
      details: { countNo, countType, warehouseId, itemsCount: lots.length },
      db_instance: knex,
    });

    return { ...stockCount, items: countItems };
  },

  async recordCountItem(trx, { stockCountId, itemId, countedQty, notes, userId }) {
    const knex = trx || db;

    const item = await knex('stock_count_items').where({ id: itemId, stock_count_id: stockCountId }).first();
    if (!item) throw new Error('Stock count item not found.');

    const systemQty = parseFloat(item.system_qty || 0);
    const counted = parseFloat(countedQty);
    const varianceQty = counted - systemQty;
    const variancePct = systemQty > 0 ? (varianceQty / systemQty) * 100 : (counted > 0 ? 100 : 0);

    // Estimate variance value based on lot's average value
    let varianceValue = 0;
    if (item.lot_id) {
      // Get cost from recent movements or milling costs
      const lot = await knex('inventory_lots').where({ id: item.lot_id }).first();
      if (lot) {
        // Rough estimate: use a default price per MT for rice products
        const pricePerMT = 500; // USD default
        varianceValue = varianceQty * pricePerMT;
      }
    }

    const [updated] = await knex('stock_count_items')
      .where({ id: itemId })
      .update({
        counted_qty: counted,
        variance_qty: Math.round(varianceQty * 100) / 100,
        variance_pct: Math.round(variancePct * 100) / 100,
        variance_value: Math.round(varianceValue * 100) / 100,
        status: 'Counted',
        notes: notes || null,
        counted_at: new Date(),
      })
      .returning('*');

    // Update stock count status to In Progress if still Planned
    await knex('stock_counts')
      .where({ id: stockCountId, status: 'Planned' })
      .update({ status: 'In Progress', started_at: new Date(), counted_by: userId });

    return updated;
  },

  async approveStockCount(trx, { stockCountId, userId }) {
    const knex = trx || db;

    const stockCount = await knex('stock_counts').where({ id: stockCountId }).first();
    if (!stockCount) throw new Error('Stock count not found.');
    if (stockCount.status === 'Completed') throw new Error('Stock count already completed.');
    if (stockCount.status === 'Cancelled') throw new Error('Stock count is cancelled.');

    // Validate all items are counted
    const items = await knex('stock_count_items').where({ stock_count_id: stockCountId });
    const uncounted = items.filter(i => i.status === 'Pending');
    if (uncounted.length > 0) {
      throw new Error(`${uncounted.length} item(s) have not been counted yet.`);
    }

    // For items with variance: create inventory adjustment movements
    const itemsWithVariance = items.filter(i => parseFloat(i.variance_qty || 0) !== 0);

    for (const item of itemsWithVariance) {
      const varianceQty = parseFloat(item.variance_qty);

      if (item.lot_id) {
        // Get lot details
        const lot = await knex('inventory_lots').where({ id: item.lot_id }).first();

        // Update lot qty
        await knex('inventory_lots')
          .where({ id: item.lot_id })
          .increment('qty', varianceQty);

        // Create inventory movement
        const movementType = varianceQty > 0 ? 'adjustment_plus' : 'adjustment_minus';
        await knex('inventory_movements').insert({
          lot_id: item.lot_id,
          movement_type: movementType,
          qty: Math.abs(varianceQty),
          to_warehouse_id: varianceQty > 0 ? stockCount.warehouse_id : null,
          from_warehouse_id: varianceQty < 0 ? stockCount.warehouse_id : null,
          source_entity: lot.entity || 'mill',
          linked_ref: stockCount.count_no,
          notes: `Stock count ${stockCount.count_no}: ${item.item_name} variance ${varianceQty > 0 ? '+' : ''}${varianceQty} MT`,
          created_by: userId,
        });
      }

      // Mark item as Adjusted
      await knex('stock_count_items')
        .where({ id: item.id })
        .update({ status: 'Adjusted' });
    }

    // Mark non-variance items as Approved
    await knex('stock_count_items')
      .where({ stock_count_id: stockCountId })
      .whereIn('status', ['Counted'])
      .update({ status: 'Approved' });

    // Complete stock count
    const [updated] = await knex('stock_counts')
      .where({ id: stockCountId })
      .update({
        status: 'Completed',
        completed_at: new Date(),
        approved_by: userId,
      })
      .returning('*');

    await auditService.log({
      userId,
      action: 'approve_stock_count',
      entityType: 'stock_count',
      entityId: stockCountId,
      details: {
        countNo: stockCount.count_no,
        totalItems: items.length,
        adjustedItems: itemsWithVariance.length,
      },
      db_instance: knex,
    });

    // Fetch final items
    const finalItems = await knex('stock_count_items').where({ stock_count_id: stockCountId });

    return { ...updated, items: finalItems };
  },

  async getStockCounts({ status, warehouseId, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;

    const query = db('stock_counts as sc')
      .leftJoin('warehouses as w', 'sc.warehouse_id', 'w.id')
      .leftJoin('users as cb', 'sc.created_by', 'cb.id')
      .leftJoin('users as cby', 'sc.counted_by', 'cby.id')
      .leftJoin('users as ab', 'sc.approved_by', 'ab.id');

    if (status) query.where('sc.status', status);
    if (warehouseId) query.where('sc.warehouse_id', warehouseId);

    const [{ count }] = await query.clone().count('sc.id as count');
    const rows = await query
      .clone()
      .select(
        'sc.*',
        'w.name as warehouse_name',
        'cb.full_name as created_by_name',
        'cby.full_name as counted_by_name',
        'ab.full_name as approved_by_name'
      )
      .orderBy('sc.created_at', 'desc')
      .offset(offset)
      .limit(limit);

    return {
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(count, 10),
        totalPages: Math.ceil(count / limit),
      },
    };
  },

  async getStockCountDetail(countId) {
    const stockCount = await db('stock_counts as sc')
      .leftJoin('warehouses as w', 'sc.warehouse_id', 'w.id')
      .leftJoin('users as cb', 'sc.created_by', 'cb.id')
      .leftJoin('users as cby', 'sc.counted_by', 'cby.id')
      .leftJoin('users as ab', 'sc.approved_by', 'ab.id')
      .where('sc.id', countId)
      .select(
        'sc.*',
        'w.name as warehouse_name',
        'cb.full_name as created_by_name',
        'cby.full_name as counted_by_name',
        'ab.full_name as approved_by_name'
      )
      .first();

    if (!stockCount) return null;

    const items = await db('stock_count_items as sci')
      .leftJoin('inventory_lots as il', 'sci.lot_id', 'il.id')
      .where('sci.stock_count_id', countId)
      .select(
        'sci.*',
        'il.lot_no',
        'il.type as lot_type',
        'il.unit'
      )
      .orderBy('sci.id', 'asc');

    // Summary
    const summary = {
      total_items: items.length,
      counted_items: items.filter(i => i.status !== 'Pending').length,
      items_with_variance: items.filter(i => parseFloat(i.variance_qty || 0) !== 0).length,
      total_variance_value: items.reduce((s, i) => s + parseFloat(i.variance_value || 0), 0),
    };

    return { ...stockCount, items, summary };
  },
};

module.exports = controlService;
