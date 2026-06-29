const db = require('../../config/database');

/**
 * Reporting & BI Engine — Phase 9
 * Every method queries LIVE data from the real database tables.
 */
const reportingService = {
  // ═══════════════════════════════════════════════════════════════════
  // EXECUTIVE DASHBOARDS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Count orders by status with total value at each stage.
   */
  async getOrderPipeline({ entity, dateFrom, dateTo }) {
    const query = db('export_orders')
      .select('status')
      .count('id as count')
      .sum('contract_value as total_value')
      .groupBy('status')
      .orderByRaw(`
        CASE status
          WHEN 'Draft' THEN 1
          WHEN 'Awaiting Advance' THEN 2
          WHEN 'Advance Received' THEN 3
          WHEN 'Procurement Pending' THEN 4
          WHEN 'In Milling' THEN 5
          WHEN 'Docs In Preparation' THEN 6
          WHEN 'Awaiting Balance' THEN 7
          WHEN 'Ready to Ship' THEN 8
          WHEN 'Shipped' THEN 9
          WHEN 'Arrived' THEN 10
          WHEN 'Closed' THEN 11
          ELSE 12
        END
      `);

    if (dateFrom) query.where('created_at', '>=', dateFrom);
    if (dateTo) query.where('created_at', '<=', dateTo);

    const rows = await query;
    return rows.map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
      totalValue: parseFloat(r.total_value) || 0,
    }));
  },

  /**
   * Advance collection funnel: Orders Created → Advance Requested → Advance Received → Procurement Started
   */
  async getAdvanceCollectionFunnel({ dateFrom, dateTo }) {
    const baseQuery = db('export_orders');
    if (dateFrom) baseQuery.where('created_at', '>=', dateFrom);
    if (dateTo) baseQuery.where('created_at', '<=', dateTo);

    // Stage 1: All orders created
    const created = await baseQuery.clone()
      .count('id as count')
      .sum('contract_value as value')
      .first();

    // Stage 2: Advance requested (advance_expected > 0)
    const advanceRequested = await baseQuery.clone()
      .where('advance_expected', '>', 0)
      .count('id as count')
      .sum('advance_expected as value')
      .first();

    // Stage 3: Advance received (advance_received > 0)
    const advanceReceived = await baseQuery.clone()
      .where('advance_received', '>', 0)
      .count('id as count')
      .sum('advance_received as value')
      .first();

    // Stage 4: Procurement started (has linked milling batch or status past advance)
    const procurementStarted = await baseQuery.clone()
      .where(function () {
        this.whereNotNull('milling_order_id')
          .orWhereIn('status', ['Procurement Pending', 'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed']);
      })
      .count('id as count')
      .sum('contract_value as value')
      .first();

    const stages = [
      { stage: 'Orders Created', count: parseInt(created.count, 10), value: parseFloat(created.value) || 0 },
      { stage: 'Advance Requested', count: parseInt(advanceRequested.count, 10), value: parseFloat(advanceRequested.value) || 0 },
      { stage: 'Advance Received', count: parseInt(advanceReceived.count, 10), value: parseFloat(advanceReceived.value) || 0 },
      { stage: 'Procurement Started', count: parseInt(procurementStarted.count, 10), value: parseFloat(procurementStarted.value) || 0 },
    ];

    // Add conversion rates
    for (let i = 1; i < stages.length; i++) {
      stages[i].conversionRate = stages[i - 1].count > 0
        ? parseFloat(((stages[i].count / stages[i - 1].count) * 100).toFixed(1))
        : 0;
    }
    stages[0].conversionRate = 100;

    return stages;
  },

  /**
   * Executive summary — key metrics in one call.
   */
  async getExecutiveSummary({ entity, dateFrom, dateTo }) {
    const orderQuery = db('export_orders');
    if (dateFrom) orderQuery.where('created_at', '>=', dateFrom);
    if (dateTo) orderQuery.where('created_at', '<=', dateTo);

    // Order metrics
    const orderStats = await orderQuery.clone()
      .select(
        db.raw('COUNT(id) as total_orders'),
        db.raw('COALESCE(SUM(contract_value), 0) as total_revenue')
      )
      .first();

    // Total costs from export_order_costs
    const costQuery = db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id');
    if (dateFrom) costQuery.where('eo.created_at', '>=', dateFrom);
    if (dateTo) costQuery.where('eo.created_at', '<=', dateTo);

    const costStats = await costQuery
      .select(db.raw('COALESCE(SUM(eoc.amount), 0) as total_costs'))
      .first();

    const totalRevenue = parseFloat(orderStats.total_revenue) || 0;
    const totalCosts = parseFloat(costStats.total_costs) || 0;
    const grossProfit = totalRevenue - totalCosts;
    const netMargin = totalRevenue > 0 ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(2)) : 0;

    // Receivables
    const recvStats = await db('receivables')
      .select(
        db.raw('COALESCE(SUM(expected_amount), 0) as total_receivables'),
        db.raw('COALESCE(SUM(received_amount), 0) as total_collected')
      )
      .first();

    const totalReceivables = parseFloat(recvStats.total_receivables) || 0;
    const totalCollected = parseFloat(recvStats.total_collected) || 0;
    const collectionRate = totalReceivables > 0
      ? parseFloat(((totalCollected / totalReceivables) * 100).toFixed(2))
      : 0;

    // Milling metrics
    const batchQuery = db('milling_batches');
    if (dateFrom) batchQuery.where('created_at', '>=', dateFrom);
    if (dateTo) batchQuery.where('created_at', '<=', dateTo);

    const activeBatches = await batchQuery.clone()
      .whereNotIn('status', ['Completed', 'Cancelled'])
      .count('id as count')
      .first();

    const completedBatches = await batchQuery.clone()
      .where('status', 'Completed')
      .count('id as count')
      .first();

    const avgYield = await batchQuery.clone()
      .where('status', 'Completed')
      .where('yield_pct', '>', 0)
      .avg('yield_pct as avg_yield')
      .first();

    // Working capital: total outstanding receivables + inventory value
    const inventoryValue = await db('inventory_lots')
      .where('qty', '>', 0)
      .select(db.raw('COALESCE(SUM(total_value), 0) as total'))
      .first();

    const outstandingRecv = await db('receivables')
      .where('status', '!=', 'Closed')
      .select(db.raw('COALESCE(SUM(outstanding), 0) as total'))
      .first();

    const outstandingPay = await db('payables')
      .where('status', '!=', 'Closed')
      .select(db.raw('COALESCE(SUM(outstanding), 0) as total'))
      .first();

    // Cash position from bank accounts
    const cashPosition = await db('bank_accounts')
      .where('is_active', true)
      .select(db.raw('COALESCE(SUM(current_balance), 0) as total'))
      .first();

    return {
      totalOrders: parseInt(orderStats.total_orders, 10),
      totalRevenue,
      totalCosts,
      grossProfit,
      netMargin,
      totalReceivables,
      totalCollected,
      collectionRate,
      activeMillBatches: parseInt(activeBatches.count, 10),
      completedBatches: parseInt(completedBatches.count, 10),
      avgYield: parseFloat(parseFloat(avgYield.avg_yield || 0).toFixed(1)),
      workingCapitalLocked: parseFloat(outstandingRecv.total) + parseFloat(inventoryValue.total) - parseFloat(outstandingPay.total),
      cashPosition: parseFloat(cashPosition.total),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // PROFITABILITY REPORTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Per-order profitability: revenue, costs by category, gross profit, margin%, cost/MT.
   */
  async getOrderProfitability({ entity, dateFrom, dateTo, customerId, country, page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;

    const query = db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select(
        'eo.id',
        'eo.order_no',
        'c.name as customer_name',
        'eo.country',
        'eo.product_name',
        'eo.qty_mt',
        'eo.price_per_mt',
        'eo.currency',
        'eo.contract_value',
        'eo.contract_value_pkr_locked',
        'eo.inventory_cogs_total_pkr',
        'eo.status',
        'eo.created_at'
      );

    if (dateFrom) query.where('eo.created_at', '>=', dateFrom);
    if (dateTo) query.where('eo.created_at', '<=', dateTo);
    if (customerId) query.where('eo.customer_id', customerId);
    if (country) query.where('eo.country', country);

    const countQuery = query.clone().clearSelect().count('eo.id as total').first();

    const orders = await query.orderBy('eo.created_at', 'desc').limit(limit).offset(offset);
    const total = await countQuery;

    // Get costs for these orders
    const orderIds = orders.map((o) => o.id);
    const costs = orderIds.length > 0
      ? await db('export_order_costs')
          .whereIn('order_id', orderIds)
          .select('order_id', 'category', 'amount')
      : [];

    // Group costs by order
    const costMap = {};
    for (const cost of costs) {
      if (!costMap[cost.order_id]) costMap[cost.order_id] = { total: 0, breakdown: {} };
      const amt = parseFloat(cost.amount) || 0;
      costMap[cost.order_id].total += amt;
      costMap[cost.order_id].breakdown[cost.category] = (costMap[cost.order_id].breakdown[cost.category] || 0) + amt;
    }

    const data = orders.map((o) => {
      // Revenue must be in PKR to compare against PKR costs. Use the locked PKR
      // contract value (contract_value_pkr_locked, set when the FX rate was
      // booked); fall back to the raw contract value only if it's missing.
      const contractCur = parseFloat(o.contract_value) || 0;          // original currency
      const revenuePkr = parseFloat(o.contract_value_pkr_locked) || contractCur;
      const orderCosts = costMap[o.id] || { total: 0, breakdown: {} };
      const opCostsPkr = orderCosts.total;                            // export operational costs (PKR)
      const cogsPkr = parseFloat(o.inventory_cogs_total_pkr) || 0;    // rice COGS (PKR, 0 until milled)
      const totalCost = opCostsPkr + cogsPkr;
      const grossProfit = revenuePkr - totalCost;
      const margin = revenuePkr > 0 ? parseFloat(((grossProfit / revenuePkr) * 100).toFixed(2)) : 0;
      const costPerMT = parseFloat(o.qty_mt) > 0 ? parseFloat((totalCost / parseFloat(o.qty_mt)).toFixed(2)) : 0;

      return {
        id: o.id,
        orderNo: o.order_no,
        customerName: o.customer_name,
        country: o.country,
        productName: o.product_name,
        qtyMT: parseFloat(o.qty_mt),
        pricePerMT: parseFloat(o.price_per_mt),
        currency: o.currency,
        contractValue: contractCur,   // original-currency contract value (for display)
        revenue: revenuePkr,          // PKR (kept name for back-compat)
        revenuePkr,
        costs: totalCost,             // PKR: operational + COGS
        opCostsPkr,
        cogsPkr,
        costBreakdown: orderCosts.breakdown,
        grossProfit,
        margin,
        costPerMT,
        status: o.status,
        riskFlags: margin < 10 ? ['low_margin'] : [],
      };
    });

    return { data, total: parseInt(total.total, 10), page, limit };
  },

  /**
   * Per-batch profitability: revenue (finished * 72800 + byproducts), costs, profit, yield%, margin.
   */
  async getBatchProfitability({ dateFrom, dateTo, supplierId, page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;

    const query = db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .select(
        'mb.id',
        'mb.batch_no',
        's.name as supplier_name',
        'mb.raw_qty_mt',
        'mb.actual_finished_mt',
        'mb.broken_mt',
        'mb.bran_mt',
        'mb.husk_mt',
        'mb.wastage_mt',
        'mb.yield_pct',
        'mb.status',
        'mb.created_at'
      );

    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);
    if (supplierId) query.where('mb.supplier_id', supplierId);

    const countQuery = query.clone().clearSelect().count('mb.id as total').first();

    const batches = await query.orderBy('mb.created_at', 'desc').limit(limit).offset(offset);
    const total = await countQuery;

    // Get costs for these batches
    const batchIds = batches.map((b) => b.id);
    const costs = batchIds.length > 0
      ? await db('milling_costs')
          .whereIn('batch_id', batchIds)
          .select('batch_id', 'category', 'amount')
      : [];

    const costMap = {};
    for (const cost of costs) {
      if (!costMap[cost.batch_id]) costMap[cost.batch_id] = 0;
      costMap[cost.batch_id] += parseFloat(cost.amount) || 0;
    }

    const FINISHED_PRICE_PKR = 72800; // PKR per MT for finished rice
    const BROKEN_PRICE_PKR = 38000;   // PKR per MT for broken rice
    const BRAN_PRICE_PKR = 28000;     // PKR per MT for bran

    const data = batches.map((b) => {
      const finishedRevenue = (parseFloat(b.actual_finished_mt) || 0) * FINISHED_PRICE_PKR;
      const brokenRevenue = (parseFloat(b.broken_mt) || 0) * BROKEN_PRICE_PKR;
      const branRevenue = (parseFloat(b.bran_mt) || 0) * BRAN_PRICE_PKR;
      const totalRevenue = finishedRevenue + brokenRevenue + branRevenue;
      const totalCost = costMap[b.id] || 0;
      const profit = totalRevenue - totalCost;
      const margin = totalRevenue > 0 ? parseFloat(((profit / totalRevenue) * 100).toFixed(2)) : 0;

      return {
        id: b.id,
        batchNo: b.batch_no,
        supplierName: b.supplier_name,
        rawQtyMT: parseFloat(b.raw_qty_mt) || 0,
        finishedMT: parseFloat(b.actual_finished_mt) || 0,
        brokenMT: parseFloat(b.broken_mt) || 0,
        branMT: parseFloat(b.bran_mt) || 0,
        yieldPct: parseFloat(b.yield_pct) || 0,
        revenue: totalRevenue,
        costs: totalCost,
        profit,
        margin,
        currency: 'PKR',
        status: b.status,
      };
    });

    return { data, total: parseInt(total.total, 10), page, limit };
  },

  /**
   * Per-milling-batch trading margin from ACTUAL figures (not the hardcoded
   * reference prices getBatchProfitability uses): input cost = Σ milling_costs
   * (raw + processing + packaging); realised revenue/cost = the local sales of
   * the batch's output lots (finished + by-products) priced at each lot's
   * residual landed cost. So a milled/blended batch shows what it cost to make
   * vs what its outputs actually sold for, plus the value still on hand.
   */
  async getBatchMargin({ from_date, to_date, limit = 200 }) {
    const num = (v) => parseFloat(v) || 0;
    let bq = db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .select('mb.id', 'mb.batch_no', 's.name as supplier_name', 'mb.raw_qty_mt',
        'mb.actual_finished_mt', 'mb.yield_pct', 'mb.status', 'mb.created_at',
        'mb.manual_milling_cost_pkr', 'mb.manual_other_expenses_pkr');
    if (from_date) bq = bq.where('mb.created_at', '>=', from_date);
    if (to_date) bq = bq.where('mb.created_at', '<=', to_date);
    const batches = await bq.orderBy('mb.created_at', 'desc').limit(parseInt(limit, 10));
    if (!batches.length) return { batches: [] };
    const ids = batches.map((b) => b.id);

    // Input cost must use the SAME basis the residual cost engine uses
    // (computeResidualAllocation) so it reconciles with the output lots' landed
    // value: raw_rice (milling_costs) + manual milling fee + manual other (else
    // recorded processing costs) + packing. Milling fee & "other" live on the
    // BATCH columns, not as milling_costs rows — summing milling_costs alone
    // under-counts them.
    const costRows = await db('milling_costs').whereIn('batch_id', ids)
      .select('batch_id', 'category', 'amount');
    const catCost = {}; // { batchId: { raw, pack, proc } }
    for (const c of costRows) {
      const m = catCost[c.batch_id] || (catCost[c.batch_id] = { raw: 0, pack: 0, proc: 0 });
      const amt = num(c.amount);
      if (c.category === 'raw_rice') m.raw += amt;
      else if (c.category === 'packaging') m.pack += amt;
      else m.proc += amt;
    }
    const costMap = {};
    for (const b of batches) {
      const cb = catCost[b.id] || { raw: 0, pack: 0, proc: 0 };
      const millingFee = b.manual_milling_cost_pkr != null ? num(b.manual_milling_cost_pkr) : 0;
      const other = b.manual_other_expenses_pkr != null ? num(b.manual_other_expenses_pkr) : cb.proc;
      costMap[b.id] = cb.raw + millingFee + other + cb.pack;
    }

    // Output lots (finished + by-product) for these batches, keyed batch-<id>.
    const refs = ids.map((id) => `batch-${id}`);
    const outLots = await db('inventory_lots')
      .whereIn('batch_ref', refs).whereIn('type', ['finished', 'byproduct'])
      .select('id', 'batch_ref', 'type', 'lot_no', 'item_name', 'grade',
        'qty', 'net_weight_kg', 'received_net_weight_kg', 'landed_cost_per_kg');
    const lotBatch = {}; const onHand = {};
    for (const l of outLots) {
      const bid = parseInt(String(l.batch_ref).replace('batch-', ''), 10);
      lotBatch[l.id] = bid;
      const curKg = num(l.net_weight_kg) || num(l.qty) * 1000;
      onHand[bid] = (onHand[bid] || 0) + curKg * num(l.landed_cost_per_kg);
    }
    const lotIds = outLots.map((l) => l.id);
    const cpkOf = Object.fromEntries(outLots.map((l) => [l.id, num(l.landed_cost_per_kg)]));

    // Realised sales of those output lots (aggregated per batch AND per lot).
    const sales = lotIds.length
      ? await db('local_sales').whereIn('lot_id', lotIds).select('lot_id', 'quantity_kg', 'total_amount')
      : [];
    const soldVal = {}; const soldCost = {}; const soldKg = {};
    const soldValLot = {}; const soldKgLot = {};
    for (const sale of sales) {
      const bid = lotBatch[sale.lot_id]; if (!bid) continue;
      soldVal[bid] = (soldVal[bid] || 0) + num(sale.total_amount);
      soldCost[bid] = (soldCost[bid] || 0) + cpkOf[sale.lot_id] * num(sale.quantity_kg);
      soldKg[bid] = (soldKg[bid] || 0) + num(sale.quantity_kg);
      soldValLot[sale.lot_id] = (soldValLot[sale.lot_id] || 0) + num(sale.total_amount);
      soldKgLot[sale.lot_id] = (soldKgLot[sale.lot_id] || 0) + num(sale.quantity_kg);
    }

    // Per-grade by-product breakdown. By-products are valued at their assigned
    // sale price (residual costing credits that value back into the finished
    // cost), so "margin" here is the variance between what a grade ACTUALLY sold
    // for and that valuation; an unsold grade shows its recoverable value.
    const bpByBatch = {};
    for (const l of outLots) {
      if (l.type !== 'byproduct') continue;
      const bid = lotBatch[l.id];
      const cpk = num(l.landed_cost_per_kg);
      const producedKg = num(l.received_net_weight_kg) || (num(l.net_weight_kg) + (soldKgLot[l.id] || 0)) || num(l.qty) * 1000;
      const sKg = soldKgLot[l.id] || 0;
      const sVal = soldValLot[l.id] || 0;
      const curKg = num(l.net_weight_kg) || num(l.qty) * 1000;
      const entry = {
        grade: l.grade || l.item_name || String(l.lot_no || '').split('-').slice(-2, -1)[0] || 'By-product',
        lotNo: l.lot_no,
        producedKg, valuationPerKg: cpk, valuationValue: producedKg * cpk,
        soldKg: sKg, soldValue: sVal, costOfSold: sKg * cpk,
        margin: sVal - sKg * cpk, onHandValue: curKg * cpk,
      };
      (bpByBatch[bid] = bpByBatch[bid] || []).push(entry);
    }

    const data = batches.map((b) => {
      const inputCost = costMap[b.id] || 0;
      const soldValue = soldVal[b.id] || 0;
      const costOfSold = soldCost[b.id] || 0;
      const realizedMargin = soldValue - costOfSold;
      const realizedMarginPct = soldValue > 0 ? (realizedMargin / soldValue) * 100 : 0;
      const byproducts = (bpByBatch[b.id] || []).sort((x, y) => y.valuationValue - x.valuationValue);
      return {
        id: b.id, batchNo: b.batch_no, supplierName: b.supplier_name, status: b.status, createdAt: b.created_at,
        rawQtyMT: num(b.raw_qty_mt), finishedMT: num(b.actual_finished_mt), yieldPct: num(b.yield_pct),
        inputCost, soldValue, costOfSold, realizedMargin, realizedMarginPct,
        soldKg: soldKg[b.id] || 0, onHandValue: onHand[b.id] || 0,
        byproductRecovery: byproducts.reduce((s, x) => s + x.valuationValue, 0),
        byproducts,
      };
    });
    return { batches: data };
  },

  /**
   * Aggregate by customer: total orders, revenue, profit, avg margin, outstanding receivables.
   */
  async getCustomerProfitability({ dateFrom, dateTo, page = 1, limit = 50 }) {
    const offset = (page - 1) * limit;

    const query = db('export_orders as eo')
      .join('customers as c', 'eo.customer_id', 'c.id')
      .select(
        'c.id as customer_id',
        'c.name as customer_name',
        'c.country',
        db.raw('COUNT(eo.id) as total_orders'),
        db.raw('COALESCE(SUM(eo.contract_value), 0) as total_revenue'),
        db.raw('COALESCE(SUM(eo.qty_mt), 0) as total_qty_mt')
      )
      .groupBy('c.id', 'c.name', 'c.country');

    if (dateFrom) query.where('eo.created_at', '>=', dateFrom);
    if (dateTo) query.where('eo.created_at', '<=', dateTo);

    const customers = await query.orderBy('total_revenue', 'desc').limit(limit).offset(offset);

    // Get costs per customer
    const customerIds = customers.map((c) => c.customer_id);
    const costsByCustomer = customerIds.length > 0
      ? await db('export_order_costs as eoc')
          .join('export_orders as eo', 'eoc.order_id', 'eo.id')
          .whereIn('eo.customer_id', customerIds)
          .select('eo.customer_id')
          .sum('eoc.amount as total_costs')
          .groupBy('eo.customer_id')
      : [];

    const costMap = {};
    for (const c of costsByCustomer) {
      costMap[c.customer_id] = parseFloat(c.total_costs) || 0;
    }

    // Outstanding receivables per customer
    const recvByCustomer = customerIds.length > 0
      ? await db('receivables')
          .whereIn('customer_id', customerIds)
          .where('status', '!=', 'Closed')
          .select('customer_id')
          .sum('outstanding as total_outstanding')
          .groupBy('customer_id')
      : [];

    const recvMap = {};
    for (const r of recvByCustomer) {
      recvMap[r.customer_id] = parseFloat(r.total_outstanding) || 0;
    }

    const countQuery = db('export_orders as eo')
      .join('customers as c', 'eo.customer_id', 'c.id');
    if (dateFrom) countQuery.where('eo.created_at', '>=', dateFrom);
    if (dateTo) countQuery.where('eo.created_at', '<=', dateTo);
    const totalCustomers = await countQuery.countDistinct('c.id as total').first();

    const data = customers.map((c) => {
      const revenue = parseFloat(c.total_revenue) || 0;
      const costs = costMap[c.customer_id] || 0;
      const profit = revenue - costs;
      const avgMargin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

      return {
        customerId: c.customer_id,
        customerName: c.customer_name,
        country: c.country,
        totalOrders: parseInt(c.total_orders, 10),
        totalQtyMT: parseFloat(c.total_qty_mt),
        revenue,
        costs,
        profit,
        avgMargin,
        outstandingReceivables: recvMap[c.customer_id] || 0,
      };
    });

    return { data, total: parseInt(totalCustomers.total, 10), page, limit };
  },

  /**
   * By country: orders, qty MT, revenue, avg price/MT, avg margin, top products.
   */
  async getCountryAnalysis({ dateFrom, dateTo }) {
    const query = db('export_orders as eo')
      .select(
        'eo.country',
        db.raw('COUNT(eo.id) as total_orders'),
        db.raw('COALESCE(SUM(eo.qty_mt), 0) as total_qty_mt'),
        db.raw('COALESCE(SUM(eo.contract_value), 0) as total_revenue'),
        db.raw('CASE WHEN SUM(eo.qty_mt) > 0 THEN SUM(eo.contract_value) / SUM(eo.qty_mt) ELSE 0 END as avg_price_per_mt')
      )
      .whereNotNull('eo.country')
      .groupBy('eo.country')
      .orderBy('total_revenue', 'desc');

    if (dateFrom) query.where('eo.created_at', '>=', dateFrom);
    if (dateTo) query.where('eo.created_at', '<=', dateTo);

    const countries = await query;

    // Get costs by country
    const costQuery = db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotNull('eo.country')
      .select('eo.country')
      .sum('eoc.amount as total_costs')
      .groupBy('eo.country');
    if (dateFrom) costQuery.where('eo.created_at', '>=', dateFrom);
    if (dateTo) costQuery.where('eo.created_at', '<=', dateTo);

    const costRows = await costQuery;
    const costMap = {};
    for (const r of costRows) costMap[r.country] = parseFloat(r.total_costs) || 0;

    // Top products by country
    const productQuery = db('export_orders as eo')
      .whereNotNull('eo.country')
      .whereNotNull('eo.product_name')
      .select('eo.country', 'eo.product_name')
      .count('eo.id as cnt')
      .groupBy('eo.country', 'eo.product_name')
      .orderBy('cnt', 'desc');
    if (dateFrom) productQuery.where('eo.created_at', '>=', dateFrom);
    if (dateTo) productQuery.where('eo.created_at', '<=', dateTo);

    const productRows = await productQuery;
    const productMap = {};
    for (const r of productRows) {
      if (!productMap[r.country]) productMap[r.country] = [];
      if (productMap[r.country].length < 3) productMap[r.country].push(r.product_name);
    }

    return countries.map((c) => {
      const revenue = parseFloat(c.total_revenue) || 0;
      const costs = costMap[c.country] || 0;
      const profit = revenue - costs;
      const avgMargin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

      return {
        country: c.country,
        totalOrders: parseInt(c.total_orders, 10),
        totalQtyMT: parseFloat(c.total_qty_mt),
        totalRevenue: revenue,
        avgPricePerMT: parseFloat(parseFloat(c.avg_price_per_mt).toFixed(2)),
        avgMargin,
        topProducts: productMap[c.country] || [],
      };
    });
  },

  /**
   * By product: qty sold, revenue, avg price, margin.
   */
  async getProductProfitability({ entity, dateFrom, dateTo }) {
    const query = db('export_orders as eo')
      .select(
        'eo.product_name',
        'eo.product_id',
        db.raw('COUNT(eo.id) as total_orders'),
        db.raw('COALESCE(SUM(eo.qty_mt), 0) as total_qty_mt'),
        db.raw('COALESCE(SUM(eo.contract_value), 0) as total_revenue'),
        db.raw('CASE WHEN SUM(eo.qty_mt) > 0 THEN SUM(eo.contract_value) / SUM(eo.qty_mt) ELSE 0 END as avg_price')
      )
      .whereNotNull('eo.product_name')
      .groupBy('eo.product_name', 'eo.product_id')
      .orderBy('total_revenue', 'desc');

    if (dateFrom) query.where('eo.created_at', '>=', dateFrom);
    if (dateTo) query.where('eo.created_at', '<=', dateTo);

    const products = await query;

    // Get costs by product
    const costQuery = db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotNull('eo.product_name')
      .select('eo.product_name')
      .sum('eoc.amount as total_costs')
      .groupBy('eo.product_name');
    if (dateFrom) costQuery.where('eo.created_at', '>=', dateFrom);
    if (dateTo) costQuery.where('eo.created_at', '<=', dateTo);

    const costRows = await costQuery;
    const costMap = {};
    for (const r of costRows) costMap[r.product_name] = parseFloat(r.total_costs) || 0;

    return products.map((p) => {
      const revenue = parseFloat(p.total_revenue) || 0;
      const costs = costMap[p.product_name] || 0;
      const profit = revenue - costs;
      const margin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;

      return {
        productName: p.product_name,
        productId: p.product_id,
        totalOrders: parseInt(p.total_orders, 10),
        totalQtyMT: parseFloat(p.total_qty_mt),
        revenue,
        avgPrice: parseFloat(parseFloat(p.avg_price).toFixed(2)),
        costs,
        profit,
        margin,
      };
    });
  },

  /**
   * Monthly: revenue, costs, gross profit, net profit for last N months.
   */
  async getMonthlyProfitTrend({ entity, months = 12 }) {
    const query = db('export_orders as eo')
      .select(
        db.raw("TO_CHAR(eo.created_at, 'YYYY-MM') as month"),
        db.raw('COALESCE(SUM(eo.contract_value), 0) as revenue'),
        db.raw('COUNT(eo.id) as order_count')
      )
      .where('eo.created_at', '>=', db.raw(`NOW() - INTERVAL '${parseInt(months, 10)} months'`))
      .groupByRaw("TO_CHAR(eo.created_at, 'YYYY-MM')")
      .orderByRaw("TO_CHAR(eo.created_at, 'YYYY-MM')");

    const revenueRows = await query;

    // Get costs by month
    const costQuery = db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .select(
        db.raw("TO_CHAR(eo.created_at, 'YYYY-MM') as month"),
        db.raw('COALESCE(SUM(eoc.amount), 0) as costs')
      )
      .where('eo.created_at', '>=', db.raw(`NOW() - INTERVAL '${parseInt(months, 10)} months'`))
      .groupByRaw("TO_CHAR(eo.created_at, 'YYYY-MM')");

    const costRows = await costQuery;
    const costMap = {};
    for (const r of costRows) costMap[r.month] = parseFloat(r.costs) || 0;

    return revenueRows.map((r) => {
      const revenue = parseFloat(r.revenue) || 0;
      const costs = costMap[r.month] || 0;
      const grossProfit = revenue - costs;

      return {
        month: r.month,
        revenue,
        costs,
        grossProfit,
        netProfit: grossProfit, // Simplified; operational expenses would need separate tracking
        orderCount: parseInt(r.order_count, 10),
        margin: revenue > 0 ? parseFloat(((grossProfit / revenue) * 100).toFixed(2)) : 0,
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIER & QUALITY REPORTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Per supplier: total qty, avg moisture variance, avg broken variance,
   * rejection rate, avg delivery time, total value. Ranked by composite score.
   */
  async getSupplierQualityRanking({ dateFrom, dateTo }) {
    const query = db('milling_batches as mb')
      .join('suppliers as s', 'mb.supplier_id', 's.id')
      .select(
        's.id as supplier_id',
        's.name as supplier_name',
        db.raw('COUNT(mb.id) as total_batches'),
        db.raw('COALESCE(SUM(mb.raw_qty_mt), 0) as total_qty_mt'),
        db.raw('COALESCE(AVG(mb.yield_pct), 0) as avg_yield')
      )
      .groupBy('s.id', 's.name')
      .orderBy('avg_yield', 'desc');

    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);

    const suppliers = await query;
    const supplierIds = suppliers.map((s) => s.supplier_id);

    // Quality variance: compare sample vs arrival
    const qualityQuery = supplierIds.length > 0
      ? await db('milling_quality_samples as mqs')
          .join('milling_batches as mb', 'mqs.batch_id', 'mb.id')
          .whereIn('mb.supplier_id', supplierIds)
          .select(
            'mb.supplier_id',
            'mqs.analysis_type',
            db.raw('AVG(mqs.moisture) as avg_moisture'),
            db.raw('AVG(mqs.broken) as avg_broken')
          )
          .groupBy('mb.supplier_id', 'mqs.analysis_type')
      : [];

    // Build variance map
    const qualityMap = {};
    for (const q of qualityQuery) {
      if (!qualityMap[q.supplier_id]) qualityMap[q.supplier_id] = {};
      qualityMap[q.supplier_id][q.analysis_type] = {
        avgMoisture: parseFloat(q.avg_moisture) || 0,
        avgBroken: parseFloat(q.avg_broken) || 0,
      };
    }

    // GRN rejection stats
    const grnQuery = supplierIds.length > 0
      ? await db('goods_receipt_notes')
          .whereIn('supplier_id', supplierIds)
          .select(
            'supplier_id',
            db.raw('COUNT(id) as total_grn'),
            db.raw("COUNT(CASE WHEN quality_status = 'Rejected' THEN 1 END) as rejected_count"),
            db.raw('COALESCE(SUM(total_value), 0) as total_value')
          )
          .groupBy('supplier_id')
      : [];

    const grnMap = {};
    for (const g of grnQuery) grnMap[g.supplier_id] = g;

    return suppliers.map((s) => {
      const sampleData = qualityMap[s.supplier_id]?.sample || {};
      const arrivalData = qualityMap[s.supplier_id]?.arrival || {};
      const moistureVariance = Math.abs((arrivalData.avgMoisture || 0) - (sampleData.avgMoisture || 0));
      const brokenVariance = Math.abs((arrivalData.avgBroken || 0) - (sampleData.avgBroken || 0));
      // Absolute arrival quality (falls back to sample) — more useful on its own
      // than the variance when there's no second analysis to compare against.
      const avgMoisture = parseFloat((arrivalData.avgMoisture || sampleData.avgMoisture || 0).toFixed(2));
      const avgBroken = parseFloat((arrivalData.avgBroken || sampleData.avgBroken || 0).toFixed(2));

      const grn = grnMap[s.supplier_id] || { total_grn: 0, rejected_count: 0, total_value: 0 };
      const rejectionRate = parseInt(grn.total_grn, 10) > 0
        ? parseFloat(((parseInt(grn.rejected_count, 10) / parseInt(grn.total_grn, 10)) * 100).toFixed(2))
        : 0;

      // Composite quality score: higher yield + lower variance + lower rejection = better
      const avgYield = parseFloat(s.avg_yield) || 0;
      const qualityScore = parseFloat((avgYield - moistureVariance * 2 - brokenVariance * 2 - rejectionRate).toFixed(2));

      return {
        supplierId: s.supplier_id,
        supplierName: s.supplier_name,
        totalBatches: parseInt(s.total_batches, 10),
        totalQtyMT: parseFloat(s.total_qty_mt),
        avgYield,
        avgMoisture,
        avgBroken,
        avgMoistureVariance: parseFloat(moistureVariance.toFixed(2)),
        avgBrokenVariance: parseFloat(brokenVariance.toFixed(2)),
        rejectionRate,
        totalValue: parseFloat(grn.total_value) || 0,
        qualityScore,
      };
    });
  },

  /**
   * Batches ranked by yield %.
   */
  async getBatchRecoveryLeaderboard({ dateFrom, dateTo }) {
    const query = db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .leftJoin('products as p', function () {
        this.on(db.raw('1 = 1')); // Will use product_name from batch's linked order
      })
      .select(
        'mb.id',
        'mb.batch_no',
        's.name as supplier_name',
        'mb.raw_qty_mt',
        'mb.actual_finished_mt',
        'mb.broken_mt',
        'mb.bran_mt',
        'mb.husk_mt',
        'mb.wastage_mt',
        'mb.yield_pct',
        'mb.status'
      )
      .where('mb.status', 'Completed')
      .where('mb.yield_pct', '>', 0)
      .orderBy('mb.yield_pct', 'desc');

    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);

    // Remove the incorrect join and re-query properly
    const batches = await db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .leftJoin('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .select(
        'mb.id',
        'mb.batch_no',
        's.name as supplier_name',
        'eo.product_name',
        'mb.raw_qty_mt',
        'mb.actual_finished_mt',
        'mb.broken_mt',
        'mb.bran_mt',
        'mb.husk_mt',
        'mb.wastage_mt',
        'mb.yield_pct',
        'mb.status'
      )
      .where('mb.status', 'Completed')
      .where('mb.yield_pct', '>', 0)
      .modify((qb) => {
        if (dateFrom) qb.where('mb.created_at', '>=', dateFrom);
        if (dateTo) qb.where('mb.created_at', '<=', dateTo);
      })
      .orderBy('mb.yield_pct', 'desc');

    return batches.map((b) => {
      const rawQty = parseFloat(b.raw_qty_mt) || 0;
      const brokenPct = rawQty > 0 ? parseFloat((((parseFloat(b.broken_mt) || 0) / rawQty) * 100).toFixed(1)) : 0;

      return {
        id: b.id,
        batchNo: b.batch_no,
        supplierName: b.supplier_name,
        productName: b.product_name,
        rawQtyMT: rawQty,
        finishedQtyMT: parseFloat(b.actual_finished_mt) || 0,
        yieldPct: parseFloat(b.yield_pct) || 0,
        brokenPct,
      };
    });
  },

  /**
   * Avg yield per product variety. Compare against benchmarks.
   */
  async getRecoveryByVariety({ dateFrom, dateTo }) {
    const query = db('milling_batches as mb')
      .join('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .select(
        'eo.product_name as variety',
        db.raw('COUNT(mb.id) as batch_count'),
        db.raw('COALESCE(AVG(mb.yield_pct), 0) as avg_yield'),
        db.raw('COALESCE(AVG(mb.broken_mt / NULLIF(mb.raw_qty_mt, 0) * 100), 0) as avg_broken_pct')
      )
      .where('mb.status', 'Completed')
      .whereNotNull('eo.product_name')
      .groupBy('eo.product_name')
      .orderBy('avg_yield', 'desc');

    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);

    const rows = await query;

    // Get benchmarks
    const benchmarks = await db('recovery_benchmarks')
      .select('variety', 'expected_yield_pct', 'expected_broken_pct', 'expected_bran_pct');

    const benchmarkMap = {};
    for (const b of benchmarks) {
      benchmarkMap[b.variety] = b;
    }

    return rows.map((r) => {
      const benchmark = benchmarkMap[r.variety];
      const avgYield = parseFloat(parseFloat(r.avg_yield).toFixed(1));
      return {
        variety: r.variety,
        batchCount: parseInt(r.batch_count, 10),
        avgYield,
        avgBrokenPct: parseFloat(parseFloat(r.avg_broken_pct).toFixed(1)),
        benchmarkYield: benchmark ? parseFloat(benchmark.expected_yield_pct) : null,
        varianceFromBenchmark: benchmark ? parseFloat((avgYield - parseFloat(benchmark.expected_yield_pct)).toFixed(1)) : null,
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════════
  // LEDGER REPORTS (Phase 2 — assembly over existing data, read-only)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Lot Ledger — the full chronological activity for one lot, built from the
   * authoritative `lot_transactions` table (every movement type writes a row
   * here with a running balance_kg). Each event is enriched with a human
   * counterparty + a link target so the report can drill through to the
   * purchase, batch, sale, order or warehouse behind it. Read-only.
   */
  async getLotLedger(lotId) {
    const id = parseInt(lotId, 10);
    if (!id) return null;
    const num = (v) => parseFloat(v) || 0;

    const lot = await db('inventory_lots as l')
      .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
      .leftJoin('products as p', 'l.product_id', 'p.id')
      .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
      .where('l.id', id)
      .select('l.id', 'l.lot_no', 'l.type', 'l.item_name', 'l.variety', 'l.grade', 'l.entity',
        'l.net_weight_kg', 'l.received_net_weight_kg', 'l.available_qty', 'l.reserved_qty',
        'l.landed_cost_per_kg', 'l.rate_per_kg', 'l.landed_cost_total', 'l.purchase_amount', 'l.payment_status',
        'l.paid_amount', 'l.due_amount', 'l.bag_weight_kg', 'l.total_bags', 'l.moisture_pct', 'l.broken_pct',
        'l.quality_json', 'l.processing_type', 'l.purchase_date', 'l.created_at',
        'l.supplier_id', 's.name as supplier_name', 'p.name as product_name', 'w.name as warehouse_name')
      .first();
    if (!lot) return null;

    const txns = await db('lot_transactions')
      .where('lot_id', id)
      .orderBy('transaction_date', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');

    // Batch-resolve references for counterparties + links.
    const batchIds = [...new Set(txns.filter(t => t.reference_module === 'milling_batch' && t.reference_id).map(t => t.reference_id))];
    const orderIds = [...new Set(txns.filter(t => t.reference_module === 'export_order' && t.reference_id).map(t => t.reference_id))];
    const saleNos = [...new Set(txns.filter(t => String(t.transaction_type).startsWith('local_sale') && t.reference_no).map(t => t.reference_no))];
    const whIds = [...new Set(txns.flatMap(t => [t.warehouse_from_id, t.warehouse_to_id]).filter(Boolean))];

    const [batches, orders, sales, warehouses] = await Promise.all([
      batchIds.length ? db('milling_batches').whereIn('id', batchIds).select('id', 'batch_no') : [],
      orderIds.length ? db('export_orders as eo').leftJoin('customers as c', 'eo.customer_id', 'c.id').whereIn('eo.id', orderIds).select('eo.id', 'eo.order_no', db.raw("COALESCE(c.name,'—') as customer")) : [],
      saleNos.length ? db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id').whereIn('ls.sale_no', saleNos).select('ls.id', 'ls.sale_no', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer")) : [],
      whIds.length ? db('warehouses').whereIn('id', whIds).select('id', 'name') : [],
    ]);
    const batchById = Object.fromEntries(batches.map(b => [b.id, b]));
    const orderById = Object.fromEntries(orders.map(o => [o.id, o]));
    const saleByNo = Object.fromEntries(sales.map(s => [s.sale_no, s]));
    const whById = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

    const TYPE_LABELS = {
      purchase_in: 'Purchase received', warehouse_transfer_in: 'Transfer in', warehouse_transfer_out: 'Transfer out',
      milling_issue: 'Issued to milling', milling_receipt: 'Milling output', byproduct_receipt: 'By-product output',
      export_dispatch_out: 'Export dispatch', local_sale_out: 'Local sale', export_allocation: 'Reserved for export',
      export_release: 'Reservation released', stock_adjustment_plus: 'Adjustment (+)', stock_adjustment_minus: 'Adjustment (−)',
      damage_out: 'Damage write-off', shortage_out: 'Shortage write-off', return_in: 'Return', opening_balance: 'Opening balance',
      lot_split: 'Lot split', lot_merge: 'Lot merge',
    };

    const events = txns.map((t) => {
      const tt = String(t.transaction_type || '');
      let counterparty = null, href = null;
      if (tt === 'purchase_in') { counterparty = lot.supplier_name || null; href = lot.supplier_id ? `/finance/statements?type=supplier&id=${lot.supplier_id}` : null; }
      else if (t.reference_module === 'milling_batch' && t.reference_id) { const b = batchById[t.reference_id]; counterparty = b ? `Batch ${b.batch_no}` : (t.reference_no || null); href = `/milling/${t.reference_id}`; }
      else if (t.reference_module === 'export_order' && t.reference_id) { const o = orderById[t.reference_id]; counterparty = o ? o.customer : (t.reference_no || null); href = `/export/${t.reference_id}`; }
      else if (tt.startsWith('local_sale') && t.reference_no) { const s = saleByNo[t.reference_no]; counterparty = s ? s.customer : null; href = s ? `/local-sales/${s.id}` : null; }
      else if (t.warehouse_from_id || t.warehouse_to_id) { counterparty = [whById[t.warehouse_from_id], whById[t.warehouse_to_id]].filter(Boolean).join(' → ') || null; }
      const qtyKg = num(t.quantity_kg);
      return {
        id: t.id, date: t.transaction_date || t.created_at, txnNo: t.transaction_no,
        type: tt, label: TYPE_LABELS[tt] || tt.replace(/_/g, ' '),
        inKg: qtyKg > 0 ? qtyKg : 0, outKg: qtyKg < 0 ? -qtyKg : 0,
        balanceKg: num(t.balance_kg), ratePerKg: num(t.rate_per_kg), costImpact: num(t.cost_impact),
        reference: t.reference_no || null, counterparty, href, remarks: t.remarks || null,
      };
    });

    const totIn = events.reduce((s, e) => s + e.inKg, 0);
    const totOut = events.reduce((s, e) => s + e.outKg, 0);

    // ── Comprehensive Lot 360 enrichment (purchase → milling → output → sale) ──
    const lotCostPerKg = num(lot.landed_cost_per_kg) || num(lot.rate_per_kg);
    const receivedKg = num(lot.received_net_weight_kg) || num(lot.net_weight_kg);
    const remainingKg = num(lot.net_weight_kg);

    // Intake (purchase) vehicles → truck/driver.
    const vehs = await db('milling_vehicle_arrivals').where('lot_id', id)
      .select('vehicle_no', 'driver_name', 'driver_phone', 'weight_mt', 'total_bags', 'arrival_date').orderBy('id', 'asc');

    // Batches this lot fed (+ each batch's total raw input for blend share).
    const srcRows = await db('batch_source_lots as bsl').leftJoin('milling_batches as mb', 'mb.id', 'bsl.batch_id')
      .where('bsl.lot_id', id)
      .select('bsl.batch_id', 'bsl.qty_mt', 'mb.batch_no', 'mb.created_at', 'mb.actual_finished_mt', 'mb.raw_qty_mt');
    const myBatchIds = [...new Set(srcRows.map(r => r.batch_id).filter(Boolean))];
    const batchTotalQty = {};
    if (myBatchIds.length) {
      const allSrc = await db('batch_source_lots').whereIn('batch_id', myBatchIds).select('batch_id', 'qty_mt');
      for (const x of allSrc) batchTotalQty[x.batch_id] = (batchTotalQty[x.batch_id] || 0) + num(x.qty_mt);
    }
    const shareOf = (batchId, myMt) => { const tot = batchTotalQty[batchId] || myMt; return tot > 0 ? myMt / tot : 1; };

    // Output lots produced by those batches.
    const outRefs = myBatchIds.map(bid => `batch-${bid}`);
    const outLots = outRefs.length
      ? await db('inventory_lots as l').leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .whereIn('l.batch_ref', outRefs).whereIn('l.type', ['finished', 'byproduct'])
        .select('l.id', 'l.batch_ref', 'l.type', 'l.item_name', 'l.grade', 'l.variety',
          'l.net_weight_kg', 'l.received_net_weight_kg', 'l.landed_cost_per_kg', 'w.name as warehouse_name')
      : [];
    const batchOutputKg = {}; const outById = {};
    for (const o of outLots) {
      const bid = parseInt(String(o.batch_ref).replace(/^batch-/, ''), 10);
      const produced = num(o.received_net_weight_kg) || num(o.net_weight_kg);
      batchOutputKg[bid] = (batchOutputKg[bid] || 0) + produced;
      outById[o.id] = { ...o, batchId: bid, produced };
    }

    // Per-grade by-product / finished sale pricing — read each feeding batch's
    // *_price_per_mt columns (the valuation set at yield) and map per output.
    const batchPriceById = {};
    if (myBatchIds.length) {
      const bp = await db('milling_batches').whereIn('id', myBatchIds)
        .select('id', 'finished_price_per_mt', 'b1_price_per_mt', 'b2_price_per_mt', 'b3_price_per_mt',
          'csr_price_per_mt', 'short_grain_price_per_mt', 'broken_price_per_mt', 'powder_price_per_mt',
          'sweeping_price_per_mt', 'sortex_rejects_price_per_mt');
      for (const b of bp) batchPriceById[b.id] = b;
    }
    const priceForLotOutput = (o, batchId) => {
      const b = batchPriceById[batchId] || {};
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
      else if (n.includes('sortex')) perMt = num(b.sortex_rejects_price_per_mt);
      else if (n.includes('broken')) perMt = num(b.broken_price_per_mt);
      return perMt / 1000;
    };

    // Milling history + outputs (this lot's attributable share).
    const millingHistory = srcRows.map(r => {
      const share = shareOf(r.batch_id, num(r.qty_mt));
      const inputKg = num(r.qty_mt) * 1000;
      const outputKg = (batchOutputKg[r.batch_id] || num(r.actual_finished_mt) * 1000) * share;
      return {
        date: r.created_at, batchNo: r.batch_no, batchId: r.batch_id, href: `/milling/${r.batch_id}`,
        inputKg, outputKg, lossKg: Math.max(0, inputKg - outputKg), sharePct: share * 100,
      };
    }).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    const outputs = outLots.map(o => {
      const meta = outById[o.id]; const share = shareOf(meta.batchId, num((srcRows.find(s => s.batch_id === meta.batchId) || {}).qty_mt));
      const qtyKg = meta.produced * share;
      const salePerKg = priceForLotOutput(o, meta.batchId);
      const costPerKg = num(o.landed_cost_per_kg);
      return {
        batchNo: (srcRows.find(s => s.batch_id === meta.batchId) || {}).batch_no, batchId: meta.batchId, batchHref: `/milling/${meta.batchId}`,
        productGrade: o.grade || o.item_name || '—', riceType: o.variety || o.item_name || '—',
        type: o.type, qtyKg, fullQtyKg: meta.produced, sharePct: share * 100,
        costPerKg, salePricePerKg: salePerKg, recoveryValue: qtyKg * salePerKg,
        warehouse: o.warehouse_name || null, lotId: o.id, href: `/lot-inventory/${o.id}`,
      };
    });

    // Direct sales (sold without processing — this raw lot sold directly).
    const directSaleRows = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
      .where('ls.lot_id', id)
      .select('ls.id', 'ls.sale_no', 'ls.sale_date', 'ls.item_name', 'ls.quantity_kg', 'ls.rate_per_kg',
        'ls.total_amount', 'ls.paid_amount', 'ls.due_amount', 'ls.payment_status', 'ls.customer_id',
        db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
      .orderBy('ls.sale_date', 'asc');
    const directSales = directSaleRows.map(s => ({
      date: s.sale_date, invoice: s.sale_no, saleId: s.id, href: `/local-sales/${s.id}/invoice`,
      customer: s.customer, customerId: s.customer_id || null,
      product: s.item_name, kind: 'Direct', qtyKg: num(s.quantity_kg), ratePerKg: num(s.rate_per_kg),
      amount: num(s.total_amount), paid: num(s.paid_amount), due: num(s.due_amount), paymentStatus: s.payment_status,
    }));

    // Processed sales (finished/by-product from this lot's batches, split by share).
    const outIds = outLots.map(o => o.id);
    let processedSales = [];
    if (outIds.length) {
      const outSaleRows = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .whereIn('ls.lot_id', outIds)
        .select('ls.id', 'ls.sale_no', 'ls.sale_date', 'ls.item_name', 'ls.lot_id', 'ls.quantity_kg', 'ls.rate_per_kg',
          'ls.total_amount', 'ls.paid_amount', 'ls.due_amount', 'ls.payment_status', 'ls.customer_id',
          db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
        .orderBy('ls.sale_date', 'asc');
      processedSales = outSaleRows.map(s => {
        const om = outById[s.lot_id] || {}; const share = shareOf(om.batchId, num((srcRows.find(x => x.batch_id === om.batchId) || {}).qty_mt));
        const cpk = num(om.landed_cost_per_kg);
        return {
          date: s.sale_date, invoice: s.sale_no, saleId: s.id, href: `/local-sales/${s.id}/invoice`,
          customer: s.customer, customerId: s.customer_id || null,
          product: om.grade || om.item_name || s.item_name, kind: 'Processed',
          qtyKg: num(s.quantity_kg) * share, amount: num(s.total_amount) * share,
          paid: num(s.paid_amount) * share, due: num(s.due_amount) * share,
          costPerKg: cpk, cost: cpk * num(s.quantity_kg) * share, paymentStatus: s.payment_status, sharePct: share * 100,
        };
      });
    }

    // Quantity summary.
    const sentForMillingKg = srcRows.reduce((a, r) => a + num(r.qty_mt) * 1000, 0);
    const soldWithoutProcessingKg = directSales.reduce((a, s) => a + s.qtyKg, 0);
    const finishedProducedKg = outputs.reduce((a, o) => a + o.qtyKg, 0);
    const soldAfterProcessingKg = processedSales.reduce((a, s) => a + s.qtyKg, 0);
    const adjustedKg = events.filter(e => ['stock_adjustment_minus', 'damage_out', 'shortage_out'].includes(e.type)).reduce((a, e) => a + e.outKg, 0);
    const processingLossKg = Math.max(0, sentForMillingKg - finishedProducedKg);

    // Financial summary.
    const directRevenue = directSales.reduce((a, s) => a + s.amount, 0);
    const directCost = directSales.reduce((a, s) => a + s.qtyKg * lotCostPerKg, 0);
    const processedRevenue = processedSales.reduce((a, s) => a + s.amount, 0);
    const processedCost = processedSales.reduce((a, s) => a + s.cost, 0);
    const totalRevenue = directRevenue + processedRevenue;
    const costOfSold = directCost + processedCost;
    const paymentReceived = directSales.reduce((a, s) => a + s.paid, 0) + processedSales.reduce((a, s) => a + s.paid, 0);
    const outstanding = directSales.reduce((a, s) => a + s.due, 0) + processedSales.reduce((a, s) => a + s.due, 0);
    const realizedProfit = totalRevenue - costOfSold;
    // Processing cost allocated to this lot (approx: batch milling costs × share).
    let processingCostAllocated = 0;
    if (myBatchIds.length) {
      // Exclude the 'raw_rice' category — that's the input-rice cost (already the
      // purchase value); processing cost = milling fee/packaging/other only.
      const mcRows = await db('milling_costs').whereIn('batch_id', myBatchIds).whereNot('category', 'raw_rice').select('batch_id', 'amount');
      const mcByBatch = {}; for (const m of mcRows) mcByBatch[m.batch_id] = (mcByBatch[m.batch_id] || 0) + num(m.amount);
      const mb = await db('milling_batches').whereIn('id', myBatchIds).select('id', 'manual_milling_cost_pkr', 'manual_other_expenses_pkr');
      for (const b of mb) mcByBatch[b.id] = (mcByBatch[b.id] || 0) + num(b.manual_milling_cost_pkr) + num(b.manual_other_expenses_pkr);
      for (const r of srcRows) { const share = shareOf(r.batch_id, num(r.qty_mt)); processingCostAllocated += (mcByBatch[r.batch_id] || 0) * share; }
    }
    const remainingStockValue = remainingKg * lotCostPerKg;
    // Expected sale rate ≈ realised avg sale rate, else the lot's own rate (approx).
    const soldKgAll = soldWithoutProcessingKg + soldAfterProcessingKg;
    const avgSaleRate = soldKgAll > 0 ? totalRevenue / soldKgAll : num(lot.rate_per_kg) || lotCostPerKg;
    const expectedProfitRemaining = remainingKg > 0 ? (remainingKg * avgSaleRate) - remainingStockValue : 0;

    const q = lot.quality_json || {};
    return {
      lot: {
        id: lot.id, lotNo: lot.lot_no, type: lot.type, entity: lot.entity,
        riceType: lot.variety || lot.product_name || lot.item_name, variety: lot.variety, grade: lot.grade,
        supplier: lot.supplier_name, supplierId: lot.supplier_id,
        supplierHref: lot.supplier_id ? `/finance/statements?type=supplier&id=${lot.supplier_id}` : null,
        warehouse: lot.warehouse_name,
        truck: (vehs[0] && vehs[0].vehicle_no) || null, driver: (vehs[0] && vehs[0].driver_name) || null,
        vehicles: vehs.map(v => ({ vehicleNo: v.vehicle_no, driverName: v.driver_name || null, weightMt: num(v.weight_mt), totalBags: v.total_bags || null, arrivalDate: v.arrival_date || null })),
        moisturePct: lot.moisture_pct != null ? num(lot.moisture_pct) : (q.moisture != null ? num(q.moisture) : null),
        brokenPct: lot.broken_pct != null ? num(lot.broken_pct) : null,
        bags: lot.total_bags != null ? Number(lot.total_bags) : null, bagWeightKg: num(lot.bag_weight_kg) || null,
        receivedKg, currentKg: remainingKg,
        availableKg: num(lot.available_qty) * 1000, reservedKg: num(lot.reserved_qty) * 1000,
        ratePerKg: num(lot.rate_per_kg), costPerKg: lotCostPerKg, valuePkr: num(lot.landed_cost_total) || num(lot.purchase_amount),
        paymentStatus: lot.payment_status, paidAmount: num(lot.paid_amount), dueAmount: num(lot.due_amount),
        purchaseDate: lot.purchase_date || lot.created_at,
        purchaseInvoiceHref: lot.type === 'raw' ? `/lot-inventory/${lot.id}/purchase-invoice` : null,
        lotDetailHref: `/lot-inventory/${lot.id}`,
      },
      quantitySummary: {
        purchasedKg: receivedKg, sentForMillingKg, soldWithoutProcessingKg, finishedProducedKg,
        soldAfterProcessingKg, reservedKg: num(lot.reserved_qty) * 1000, adjustedKg, processingLossKg, remainingKg,
      },
      financialSummary: {
        purchaseValue: num(lot.landed_cost_total) || num(lot.purchase_amount),
        processingCostAllocated, totalCostOfSold: costOfSold,
        directRevenue, processedRevenue, totalRevenue,
        paymentReceived, outstanding, realizedProfit,
        realizedProfitPct: totalRevenue > 0 ? (realizedProfit / totalRevenue) * 100 : 0,
        remainingStockValue, expectedProfitRemaining,
        byproductRecovery: outputs.filter(o => o.type === 'byproduct').reduce((a, o) => a + (o.recoveryValue || 0), 0),
        costBasis: 'Landed cost per kg (residual costing); processing cost allocated by batch share — approximate where blended.',
      },
      millingHistory, outputs, directSales, processedSales,
      events,
      totals: { events: events.length, inKg: totIn, outKg: totOut, balanceKg: remainingKg },
    };
  },

  /**
   * Batch Processing Ledger — one batch's inputs (source lots), outputs
   * (finished + by-product lots), recorded costs and yield, assembled from
   * milling_batches / batch_source_lots / milling_costs / inventory_lots.
   */
  async getBatchLedger(batchId) {
    const num = (v) => parseFloat(v) || 0;
    const isNumeric = /^\d+$/.test(String(batchId));

    let batch = await db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .leftJoin('products as p', 'mb.product_id', 'p.id')
      .leftJoin('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .where(isNumeric ? { 'mb.id': parseInt(batchId, 10) } : { 'mb.batch_no': batchId })
      .select('mb.id', 'mb.batch_no', 'mb.status', 'mb.processing_type', 'mb.raw_qty_mt',
        'mb.actual_finished_mt', 'mb.yield_pct', 'mb.operator_name', 'mb.machine_line', 'mb.shift',
        'mb.processing_hours', 'mb.created_at', 'mb.completed_at', 'mb.manual_milling_cost_pkr',
        'mb.manual_other_expenses_pkr', 'mb.raw_cost_total', 'mb.total_cost_per_kg_finished',
        'mb.finished_price_per_mt', 'mb.b1_price_per_mt', 'mb.b2_price_per_mt', 'mb.b3_price_per_mt',
        'mb.csr_price_per_mt', 'mb.short_grain_price_per_mt', 'mb.broken_price_per_mt',
        'mb.powder_price_per_mt', 'mb.sweeping_price_per_mt', 'mb.sortex_rejects_price_per_mt',
        'mb.supplier_id', 's.name as supplier_name', 'p.name as product_name', 'eo.product_name as order_product')
      .first();
    if (!batch) return null;
    const id = batch.id;

    const [sources, costs, outputs] = await Promise.all([
      db('batch_source_lots as bsl')
        .leftJoin('inventory_lots as l', 'bsl.lot_id', 'l.id')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .where('bsl.batch_id', id)
        .select('bsl.lot_id', 'bsl.qty_mt', 'bsl.unit_cost_pkr', 'bsl.cost_total_pkr', 'bsl.ratio_pct',
          'l.lot_no', 'l.item_name', 'l.variety', 'l.supplier_id', db.raw("COALESCE(s.name,'—') as supplier")),
      db('milling_costs').where('batch_id', id).select('id', 'category', 'amount', 'notes', 'created_at').orderBy('id', 'asc'),
      db('inventory_lots as l').leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .where('l.batch_ref', `batch-${id}`).whereIn('l.type', ['finished', 'byproduct'])
        .select('l.id', 'l.lot_no', 'l.type', 'l.item_name', 'l.grade', 'l.variety', 'l.net_weight_kg',
          'l.received_net_weight_kg', 'l.sold_weight_kg', 'l.reserved_qty', 'l.landed_cost_per_kg', 'l.landed_cost_total', 'w.name as warehouse_name'),
    ]);

    // Sales of this batch's output lots.
    const outIds = outputs.map(o => o.id);
    let outSales = [];
    if (outIds.length) {
      outSales = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .whereIn('ls.lot_id', outIds)
        .select('ls.id', 'ls.sale_no', 'ls.sale_date', 'ls.lot_id', 'ls.item_name', 'ls.quantity_kg',
          'ls.total_amount', 'ls.paid_amount', 'ls.due_amount', 'ls.payment_status', 'ls.customer_id',
          db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
        .orderBy('ls.sale_date', 'asc');
    }
    const outById = Object.fromEntries(outputs.map(o => [o.id, o]));

    const inputMt = sources.reduce((s, r) => s + num(r.qty_mt), 0);
    // Prefer per-source-lot cost; fall back to the batch's raw_cost_total when
    // source rows carry no cost (older/backfilled lineage).
    const rawCostFromSources = sources.reduce((s, r) => s + num(r.cost_total_pkr), 0);
    const rawCost = rawCostFromSources > 0 ? rawCostFromSources : num(batch.raw_cost_total);
    const processingCost = num(batch.manual_milling_cost_pkr) + num(batch.manual_other_expenses_pkr)
      + costs.filter(c => c.category !== 'raw_rice').reduce((s, c) => s + num(c.amount), 0);
    const inputCostPkr = rawCost + processingCost;
    const outputKg = outputs.reduce((s, o) => s + (num(o.received_net_weight_kg) || num(o.net_weight_kg)), 0);

    // Per-grade by-product / finished valuation price (per kg) set at yield.
    const priceForOutput = (o) => {
      const g = String(o.grade || '').toUpperCase();
      const n = String(o.item_name || '').toLowerCase();
      let perMt = 0;
      if (o.type === 'finished') perMt = num(batch.finished_price_per_mt);
      else if (g === 'B1') perMt = num(batch.b1_price_per_mt);
      else if (g === 'B2') perMt = num(batch.b2_price_per_mt);
      else if (g === 'B3') perMt = num(batch.b3_price_per_mt);
      else if (g === 'CSR') perMt = num(batch.csr_price_per_mt);
      else if (g === 'SHORT GRAIN') perMt = num(batch.short_grain_price_per_mt);
      else if (n.includes('powder')) perMt = num(batch.powder_price_per_mt);
      else if (n.includes('sweep')) perMt = num(batch.sweeping_price_per_mt);
      else if (n.includes('sortex')) perMt = num(batch.sortex_rejects_price_per_mt);
      else if (n.includes('broken')) perMt = num(batch.broken_price_per_mt);
      return perMt / 1000;
    };

    const outputRows = outputs.map(o => {
      const produced = num(o.received_net_weight_kg) || num(o.net_weight_kg);
      const remaining = num(o.net_weight_kg);
      const sold = num(o.sold_weight_kg) || Math.max(0, produced - remaining);
      const cpk = num(o.landed_cost_per_kg);
      const salePerKg = priceForOutput(o);
      return {
        lotId: o.id, lotNo: o.lot_no, type: o.type, item: o.grade || o.item_name, riceType: o.variety || o.item_name,
        kg: produced, producedKg: produced, soldKg: sold, remainingKg: remaining, reservedKg: num(o.reserved_qty) * 1000,
        costPerKg: cpk, valuePkr: num(o.landed_cost_total), onHandValue: remaining * cpk,
        salePricePerKg: salePerKg, recoveryValue: produced * salePerKg,
        warehouse: o.warehouse_name || null, href: `/lot-inventory/${o.id}`,
      };
    });

    const sales = outSales.map(s => {
      const om = outById[s.lot_id] || {}; const cpk = num(om.landed_cost_per_kg); const kg = num(s.quantity_kg);
      return {
        date: s.sale_date, invoice: s.sale_no, saleId: s.id, href: `/local-sales/${s.id}/invoice`,
        customer: s.customer, customerId: s.customer_id || null,
        product: om.grade || om.item_name || s.item_name, qtyKg: kg, amount: num(s.total_amount),
        paid: num(s.paid_amount), due: num(s.due_amount), cost: cpk * kg, paymentStatus: s.payment_status,
      };
    });

    // Yield summary.
    const finishedMt = outputRows.filter(o => o.type === 'finished').reduce((s, o) => s + o.producedKg, 0) / 1000;
    const byproductMt = outputRows.filter(o => o.type === 'byproduct').reduce((s, o) => s + o.producedKg, 0) / 1000;
    const totalOutputMt = outputKg / 1000;
    const lossMt = Math.max(0, inputMt - totalOutputMt);

    // Financial summary.
    const revenue = sales.reduce((s, x) => s + x.amount, 0);
    const cogsOfSold = sales.reduce((s, x) => s + x.cost, 0);
    const paymentReceived = sales.reduce((s, x) => s + x.paid, 0);
    const outstanding = sales.reduce((s, x) => s + x.due, 0);
    const realizedProfit = revenue - cogsOfSold;
    const onHandValue = outputRows.reduce((s, o) => s + o.onHandValue, 0);
    const remainingKg = outputRows.reduce((s, o) => s + o.remainingKg, 0);
    const soldKg = sales.reduce((s, x) => s + x.qtyKg, 0);
    const avgSaleRate = soldKg > 0 ? revenue / soldKg : 0;
    const expectedProfitRemaining = remainingKg > 0 && avgSaleRate > 0 ? (remainingKg * avgSaleRate) - onHandValue : 0;

    const suppliers = [];
    const seenSup = new Set();
    for (const r of sources) { if (r.supplier_id && !seenSup.has(r.supplier_id)) { seenSup.add(r.supplier_id); suppliers.push({ id: r.supplier_id, name: r.supplier, href: `/finance/statements?type=supplier&id=${r.supplier_id}` }); } }

    return {
      batch: {
        id: batch.id, batchNo: batch.batch_no, status: batch.status, processingType: batch.processing_type,
        isBlend: batch.processing_type === 'blended',
        product: batch.product_name || batch.order_product, supplier: batch.supplier_name, supplierId: batch.supplier_id,
        suppliers,
        rawQtyMt: num(batch.raw_qty_mt), finishedMt: num(batch.actual_finished_mt), yieldPct: num(batch.yield_pct),
        operator: batch.operator_name, machineLine: batch.machine_line, shift: batch.shift,
        processingHours: num(batch.processing_hours), createdAt: batch.created_at, completedAt: batch.completed_at,
        totalCostPerKgFinished: num(batch.total_cost_per_kg_finished),
        href: `/milling/${batch.id}`,
      },
      inputs: sources.map(r => ({ lotId: r.lot_id, lotNo: r.lot_no, item: r.item_name, variety: r.variety, supplier: r.supplier, supplierId: r.supplier_id || null, qtyMt: num(r.qty_mt), unitCostPkr: num(r.unit_cost_pkr), costTotalPkr: num(r.cost_total_pkr), ratioPct: num(r.ratio_pct), href: r.lot_id ? `/lot-inventory/${r.lot_id}` : null, supplierHref: r.supplier_id ? `/finance/statements?type=supplier&id=${r.supplier_id}` : null })),
      costs: costs.map(c => ({ id: c.id, category: c.category, amount: num(c.amount), notes: c.notes })),
      manualCosts: { milling: num(batch.manual_milling_cost_pkr), other: num(batch.manual_other_expenses_pkr) },
      outputs: outputRows,
      sales,
      yieldSummary: { inputMt, finishedMt, byproductMt, totalOutputMt, lossMt, yieldPct: inputMt > 0 ? (finishedMt / inputMt) * 100 : num(batch.yield_pct) },
      financialSummary: {
        rawCost, processingCost, totalInputCost: inputCostPkr,
        outputValue: outputRows.reduce((s, o) => s + o.valuePkr, 0),
        revenue, cogsOfSold, realizedProfit, realizedProfitPct: revenue > 0 ? (realizedProfit / revenue) * 100 : 0,
        paymentReceived, outstanding, onHandValue, remainingKg, expectedProfitRemaining,
        byproductRecovery: outputRows.filter(o => o.type === 'byproduct').reduce((s, o) => s + o.recoveryValue, 0),
        costBasis: 'Residual costing: output cost/kg distributes net purchase (raw + processing) less by-product credit (by-products valued at the per-grade sale price below). Processing cost excludes the input-rice cost.',
      },
      totals: { inputMt, inputCostPkr, outputKg, outputMt: totalOutputMt, lossMt },
    };
  },

  /**
   * Sale detail (Sale 360) — full picture of one local sale: header, all line
   * items (rows sharing sale_group_no), the payment trail (payments linked to
   * those item ids) and dispatch info. Read-only.
   */
  /**
   * Invoice Ledger — one row per local-sale invoice (multi-line sales grouped
   * by sale_group_no), searchable by invoice no / customer / rice type / lot /
   * batch / truck / payment reference, filterable by date, payment status and
   * outstanding-only. Each row links to the Invoice 360 + customer ledger.
   * Read-only. Commercial figures only (no COGS/margin).
   */
  async getInvoiceLedger({ q, from, to, status, outstanding, entity, kind, limit = 500 } = {}) {
    const num = (v) => parseFloat(v) || 0;
    const cap = Math.min(parseInt(limit, 10) || 500, 2000);
    const term = String(q || '').trim();
    const wantOutstanding = (outstanding === '1' || outstanding === true || outstanding === 'true');
    let saleInvoices = []; let purchaseInvoices = [];

    // ── SALES invoices (local_sales) ──
    if (kind !== 'purchase') {
    // Resolve batch numbers matching the search term → their lot batch_ref tags.
    let batchRefs = [];
    if (term) {
      const bms = await db('milling_batches').where('batch_no', 'ilike', `%${term}%`).select('id');
      batchRefs = bms.map(b => `batch-${b.id}`);
    }

    let qb = db('local_sales as ls')
      .leftJoin('customers as c', 'ls.customer_id', 'c.id')
      .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id');
    if (entity) qb = qb.where('ls.entity', entity);
    if (from) qb = qb.where('ls.sale_date', '>=', from);
    if (to) qb = qb.where('ls.sale_date', '<=', to);
    if (wantOutstanding) qb = qb.where('ls.due_amount', '>', 0);
    if (term) {
      const like = `%${term}%`;
      qb = qb.where(function () {
        this.where('ls.sale_no', 'ilike', like)
          .orWhere('ls.sale_group_no', 'ilike', like)
          .orWhere('c.name', 'ilike', like)
          .orWhere('ls.buyer_name', 'ilike', like)
          .orWhere('ls.item_name', 'ilike', like)
          .orWhere('ls.lot_no', 'ilike', like)
          .orWhere('il.lot_no', 'ilike', like)
          .orWhere('ls.vehicle_no', 'ilike', like)
          .orWhere('ls.payment_reference', 'ilike', like);
        if (batchRefs.length) this.orWhereIn('il.batch_ref', batchRefs);
      });
    }
    const rows = await qb.select(
      'ls.id', 'ls.sale_no', 'ls.sale_group_no', 'ls.sale_date', 'ls.item_name',
      'ls.quantity_kg', 'ls.total_amount', 'ls.paid_amount', 'ls.due_amount',
      'ls.vehicle_no', 'ls.dispatched', 'ls.customer_id', 'ls.lot_no',
      db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"),
      'il.lot_no as lot_ref', 'il.batch_ref', 'w.name as warehouse_name',
    ).orderBy('ls.id', 'desc').limit(cap * 4);

    // Group lines into one row per invoice (sale_group_no, else sale_no).
    const groups = {}; const allRefs = new Set();
    for (const r of rows) {
      const key = r.sale_group_no || r.sale_no;
      const g = groups[key] || (groups[key] = {
        key, minId: r.id, date: r.sale_date, customer: r.customer, customerId: r.customer_id || null,
        total: 0, received: 0, outstanding: 0, qtyKg: 0,
        items: new Set(), lots: new Set(), refs: new Set(), warehouses: new Set(),
        vehicle: r.vehicle_no || null, dispatched: false,
      });
      g.minId = Math.min(g.minId, r.id);
      g.total += num(r.total_amount); g.received += num(r.paid_amount); g.outstanding += num(r.due_amount);
      g.qtyKg += num(r.quantity_kg);
      if (r.item_name) g.items.add(r.item_name);
      const lot = r.lot_no || r.lot_ref; if (lot) g.lots.add(lot);
      if (r.batch_ref) { g.refs.add(r.batch_ref); allRefs.add(r.batch_ref); }
      if (r.warehouse_name) g.warehouses.add(r.warehouse_name);
      if (r.vehicle_no && !g.vehicle) g.vehicle = r.vehicle_no;
      if (r.dispatched) g.dispatched = true;
    }

    const batchIds = [...allRefs].map(ref => parseInt(String(ref).replace(/^batch-/, ''), 10)).filter(Boolean);
    const batchNoByRef = {};
    if (batchIds.length) {
      const bs = await db('milling_batches').whereIn('id', batchIds).select('id', 'batch_no');
      const byId = Object.fromEntries(bs.map(b => [b.id, b.batch_no]));
      for (const ref of allRefs) { const id = parseInt(String(ref).replace(/^batch-/, ''), 10); if (byId[id]) batchNoByRef[ref] = byId[id]; }
    }

    saleInvoices = Object.values(groups).map(g => ({
      id: g.minId, kind: 'sale', invoiceNo: g.key, isGroup: [...g.lots].length + g.items.size > 1 || g.refs.size > 1 || false,
      date: g.date, party: g.customer, partyType: 'Customer', customer: g.customer, customerId: g.customerId,
      items: [...g.items], lots: [...g.lots],
      batches: [...g.refs].map(ref => batchNoByRef[ref]).filter(Boolean),
      warehouses: [...g.warehouses], vehicle: g.vehicle, dispatched: g.dispatched,
      qtyKg: g.qtyKg, total: g.total, received: g.received, outstanding: g.outstanding,
      paymentStatus: g.outstanding > 0.01 ? (g.received > 0.01 ? 'Partial' : 'Unpaid') : 'Paid',
      href: `/local-sales/${g.minId}/invoice`,
      partyHref: g.customerId ? `/finance/statements?type=customer&id=${g.customerId}` : null,
      customerHref: g.customerId ? `/finance/statements?type=customer&id=${g.customerId}` : null,
    }));
    if (status) saleInvoices = saleInvoices.filter(i => i.paymentStatus === status);
    } // end sales block

    // ── PURCHASE invoices (purchased rice lots) ──
    if (kind !== 'sale') {
      let vehLotIds = [];
      if (term) {
        const vs = await db('milling_vehicle_arrivals').where('vehicle_no', 'ilike', `%${term}%`).whereNotNull('lot_id').select('lot_id');
        vehLotIds = vs.map(v => v.lot_id);
      }
      let pq = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .where('l.type', 'raw');
      if (entity) pq = pq.where('l.entity', entity);
      if (from) pq = pq.where('l.purchase_date', '>=', from);
      if (to) pq = pq.where('l.purchase_date', '<=', to);
      if (term) {
        const like = `%${term}%`;
        pq = pq.where(function () {
          this.where('l.lot_no', 'ilike', like)
            .orWhere('s.name', 'ilike', like)
            .orWhere('l.variety', 'ilike', like)
            .orWhere('l.item_name', 'ilike', like);
          if (vehLotIds.length) this.orWhereIn('l.id', vehLotIds);
        });
      }
      const lots = await pq.select(
        'l.id', 'l.lot_no', 'l.purchase_date', 'l.variety', 'l.item_name', 'l.grade',
        'l.net_weight_kg', 'l.received_net_weight_kg', 'l.total_bags', 'l.purchase_amount',
        'l.landed_cost_total', 'l.paid_amount', 'l.due_amount', 'l.payment_status',
        'l.supplier_id', 's.name as supplier_name', 'w.name as warehouse_name',
      ).orderBy('l.id', 'desc').limit(cap);

      // Payable (source of truth for paid/outstanding) keyed by lot_no.
      const lotNos = lots.map(l => l.lot_no);
      const payByRef = {};
      if (lotNos.length) {
        const pbs = await db('payables').whereIn('linked_ref', lotNos).andWhere('category', 'Raw Material')
          .select('linked_ref', 'original_amount', 'paid_amount', 'outstanding', 'status');
        for (const pb of pbs) payByRef[pb.linked_ref] = pb;
      }
      purchaseInvoices = lots.map(l => {
        const pb = payByRef[l.lot_no];
        const landed = pb ? (num(pb.original_amount) || num(l.landed_cost_total)) : (num(l.landed_cost_total) || num(l.purchase_amount));
        const paid = pb ? num(pb.paid_amount) : num(l.paid_amount);
        const out = pb ? num(pb.outstanding) : num(l.due_amount);
        return {
          id: l.id, kind: 'purchase', invoiceNo: l.lot_no, isGroup: false,
          date: l.purchase_date, party: l.supplier_name || '—', partyType: 'Supplier',
          customer: l.supplier_name || '—', customerId: null,
          items: [l.variety || l.item_name || '—'], lots: [l.lot_no], batches: [],
          warehouses: l.warehouse_name ? [l.warehouse_name] : [], vehicle: null, dispatched: false,
          qtyKg: num(l.received_net_weight_kg) || num(l.net_weight_kg),
          total: landed, received: paid, outstanding: out,
          paymentStatus: pb ? pb.status : (out > 0.01 ? (paid > 0.01 ? 'Partial' : 'Unpaid') : 'Paid'),
          href: `/lot-inventory/${l.id}/purchase-invoice`,
          partyHref: l.supplier_id ? `/finance/statements?type=supplier&id=${l.supplier_id}` : null,
          customerHref: l.supplier_id ? `/finance/statements?type=supplier&id=${l.supplier_id}` : null,
        };
      });
      if (wantOutstanding) purchaseInvoices = purchaseInvoices.filter(i => i.outstanding > 0.01);
      if (status) purchaseInvoices = purchaseInvoices.filter(i => i.paymentStatus === status);
    }

    // ── Combine, sort newest-first, cap ──
    let invoices = [...saleInvoices, ...purchaseInvoices].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const dbb = b.date ? new Date(b.date).getTime() : 0;
      if (da !== dbb) return dbb - da;
      return b.id - a.id;
    }).slice(0, cap);

    return {
      rows: invoices,
      totals: {
        count: invoices.length,
        sales: invoices.filter(i => i.kind === 'sale').length,
        purchases: invoices.filter(i => i.kind === 'purchase').length,
        total: invoices.reduce((s, i) => s + i.total, 0),
        received: invoices.reduce((s, i) => s + i.received, 0),
        outstanding: invoices.reduce((s, i) => s + i.outstanding, 0),
      },
    };
  },

  async getSaleDetail(saleId) {
    const id = parseInt(saleId, 10);
    if (!id) return null;
    const num = (v) => parseFloat(v) || 0;

    const base = await db('local_sales as ls')
      .leftJoin('customers as c', 'ls.customer_id', 'c.id')
      .where('ls.id', id)
      .select('ls.*', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer_resolved"))
      .first();
    if (!base) return null;

    // All line items of this sale (multi-item sales share sale_group_no).
    const itemQuery = db('local_sales as ls')
      .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
      .leftJoin('customers as c', 'ls.customer_id', 'c.id');
    if (base.sale_group_no) itemQuery.where('ls.sale_group_no', base.sale_group_no);
    else itemQuery.where('ls.id', id);
    const itemRows = await itemQuery.select(
      'ls.id', 'ls.sale_no', 'ls.item_name', 'ls.item_type', 'ls.quantity_kg', 'ls.quantity_bags',
      'ls.rate_per_kg', 'ls.total_amount', 'ls.cogs_total_pkr', 'ls.cost_per_kg', 'ls.gross_profit_pkr',
      'ls.lot_id', 'il.lot_no', 'il.type as lot_type',
    ).orderBy('ls.id', 'asc');

    const itemIds = itemRows.map(r => r.id);
    const payments = await db('payments')
      .whereIn('local_sale_id', itemIds.length ? itemIds : [id])
      .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'notes', 'type')
      .orderBy('payment_date', 'asc').orderBy('id', 'asc');

    const items = itemRows.map(r => {
      const kg = num(r.quantity_kg); const total = num(r.total_amount);
      const cost = num(r.cogs_total_pkr) || num(r.cost_per_kg) * kg;
      return {
        id: r.id, saleNo: r.sale_no, item: r.item_name, itemType: r.item_type,
        lotId: r.lot_id, lotNo: r.lot_no, lotType: r.lot_type, href: r.lot_id ? `/lot-inventory/${r.lot_id}` : null,
        quantityKg: kg, quantityBags: r.quantity_bags, ratePerKg: num(r.rate_per_kg),
        totalAmount: total, cost, margin: total - cost,
      };
    });
    const totals = {
      quantityKg: items.reduce((s, i) => s + i.quantityKg, 0),
      totalAmount: items.reduce((s, i) => s + i.totalAmount, 0),
      cost: items.reduce((s, i) => s + i.cost, 0),
      margin: items.reduce((s, i) => s + i.margin, 0),
      paid: payments.reduce((s, p) => s + num(p.amount), 0),
    };

    return {
      sale: {
        id: base.id, saleNo: base.sale_no, saleGroupNo: base.sale_group_no, date: base.sale_date,
        customer: base.customer_resolved, customerId: base.customer_id || null,
        paymentStatus: base.payment_status, paymentMode: base.payment_mode,
        collectionLocation: base.collection_location, dueDate: base.due_date,
        totalAmount: num(base.total_amount), paidAmount: num(base.paid_amount), dueAmount: num(base.due_amount),
      },
      items,
      payments: payments.map(p => ({ id: p.id, paymentNo: p.payment_no, date: p.payment_date, method: p.payment_method, amount: num(p.amount), reference: p.bank_reference, notes: p.notes })),
      dispatch: {
        dispatched: !!base.dispatched, dispatchDate: base.dispatch_date,
        vehicleNo: base.vehicle_no, driverName: base.driver_name, collectionLocation: base.collection_location,
      },
      totals,
    };
  },

  /**
   * Inventory Movement Ledger — a filterable chronological feed of every
   * stock movement (inventory_movements), enriched with lot / warehouse /
   * reference context + a link target. Read-only.
   * Filters: dateFrom, dateTo, movementType, entity, lotId.
   */
  async getInventoryLedger({ dateFrom, dateTo, movementType, entity, lotId, warehouseId, limit = 300 } = {}) {
    const num = (v) => parseFloat(v) || 0;
    const cap = Math.min(parseInt(limit, 10) || 300, 1000);
    let q = db('inventory_movements as m')
      .leftJoin('inventory_lots as l', 'm.lot_id', 'l.id')
      .leftJoin('warehouses as wf', 'm.from_warehouse_id', 'wf.id')
      .leftJoin('warehouses as wt', 'm.to_warehouse_id', 'wt.id')
      .leftJoin('milling_batches as mb', 'm.batch_id', 'mb.id');
    if (dateFrom) q = q.where('m.created_at', '>=', dateFrom);
    if (dateTo) q = q.where('m.created_at', '<=', dateTo);
    if (movementType) q = q.where('m.movement_type', movementType);
    if (entity) q = q.where(function () { this.where('m.source_entity', entity).orWhere('m.dest_entity', entity).orWhere('l.entity', entity); });
    if (lotId) q = q.where('m.lot_id', parseInt(lotId, 10));
    if (warehouseId) { const w = parseInt(warehouseId, 10); q = q.where(function () { this.where('m.from_warehouse_id', w).orWhere('m.to_warehouse_id', w).orWhere('l.warehouse_id', w); }); }
    const rows = await q.select(
      'm.id', 'm.created_at', 'm.movement_type', 'm.qty', 'm.total_cost', 'm.cost_per_unit',
      'm.lot_id', 'm.batch_id', 'm.order_id', 'm.linked_ref', 'm.source_entity', 'm.dest_entity', 'm.notes',
      'l.lot_no', 'l.item_name', 'l.type as lot_type', 'mb.batch_no',
      'wf.name as from_wh', 'wt.name as to_wh',
    ).orderBy('m.created_at', 'desc').orderBy('m.id', 'desc').limit(cap);

    const LABELS = {
      purchase_receipt: 'Purchase received', internal_receipt: 'Internal receipt', production_issue: 'Issued to milling',
      production_output: 'Milling output', byproduct_output: 'By-product output', transfer_out: 'Transfer out',
      transfer_in: 'Transfer in', export_dispatch: 'Export dispatch', local_sale: 'Local sale',
      reservation_hold: 'Reserved', reservation_release: 'Reservation released', adjustment_plus: 'Adjustment (+)',
      adjustment_minus: 'Adjustment (−)', damage_writeoff: 'Damage write-off', shortage_writeoff: 'Shortage write-off',
      return: 'Return', opening_balance: 'Opening balance',
    };
    const OUTBOUND = new Set(['production_issue', 'transfer_out', 'export_dispatch', 'local_sale', 'adjustment_minus', 'damage_writeoff', 'shortage_writeoff']);

    const out = rows.map((r) => {
      const mt = String(r.movement_type || '');
      const kg = num(r.qty) * 1000;
      let href = null;
      if (r.batch_id) href = `/milling/${r.batch_id}`;
      else if (r.order_id) href = `/export/${r.order_id}`;
      else if (r.lot_id) href = `/lot-inventory/${r.lot_id}`;
      return {
        id: r.id, date: r.created_at, type: mt, label: LABELS[mt] || mt.replace(/_/g, ' '),
        lotId: r.lot_id, lotNo: r.lot_no, item: r.item_name, lotType: r.lot_type,
        batchNo: r.batch_no, reference: r.linked_ref || null,
        qtyKg: kg, direction: OUTBOUND.has(mt) ? 'out' : 'in', costPkr: num(r.total_cost),
        fromWh: r.from_wh, toWh: r.to_wh, entity: r.dest_entity || r.source_entity || null, href,
      };
    });
    return { rows: out, totals: { count: out.length, inKg: out.filter(r => r.direction === 'in').reduce((s, r) => s + r.qtyKg, 0), outKg: out.filter(r => r.direction === 'out').reduce((s, r) => s + r.qtyKg, 0) } };
  },

  /**
   * Finished Goods Ledger — the finished + by-product stock register grouped
   * by grade/output, with produced (original intake), sold, on-hand,
   * reserved and on-hand value. Read-only.
   */
  async getFinishedGoodsLedger({ entity, type } = {}) {
    const num = (v) => parseFloat(v) || 0;
    let q = db('inventory_lots as l')
      .leftJoin('products as p', 'l.product_id', 'p.id')
      .whereIn('l.type', (type === 'finished' || type === 'byproduct') ? [type] : ['finished', 'byproduct']);
    if (entity) q = q.where('l.entity', entity);
    const lots = await q.select(
      'l.id', 'l.lot_no', 'l.type', 'l.item_name', 'l.grade', 'l.variety', 'l.processing_type',
      'l.net_weight_kg', 'l.received_net_weight_kg', 'l.available_qty', 'l.reserved_qty', 'l.sold_weight_kg',
      'l.landed_cost_per_kg', 'p.name as product_name',
    );

    // Group key: by grade for by-products, by product/item for finished.
    const groups = {};
    for (const l of lots) {
      const isBy = l.type === 'byproduct';
      const key = isBy ? (l.grade || l.item_name || 'By-product') : (l.product_name || l.item_name || 'Finished Rice');
      const g = groups[key] || (groups[key] = { key, type: l.type, producedKg: 0, onHandKg: 0, reservedKg: 0, soldKg: 0, valuePkr: 0, lots: [] });
      const produced = num(l.received_net_weight_kg) || num(l.net_weight_kg);
      const onHand = num(l.net_weight_kg);
      const reserved = num(l.reserved_qty) * 1000;
      const sold = num(l.sold_weight_kg) || Math.max(0, produced - onHand);
      g.producedKg += produced; g.onHandKg += onHand; g.reservedKg += reserved; g.soldKg += sold;
      g.valuePkr += onHand * num(l.landed_cost_per_kg);
      g.lots.push({ lotId: l.id, lotNo: l.lot_no, item: l.grade || l.item_name, variety: l.variety, isBlend: l.processing_type === 'blended', producedKg: produced, onHandKg: onHand, reservedKg: reserved, soldKg: sold, costPerKg: num(l.landed_cost_per_kg), valuePkr: onHand * num(l.landed_cost_per_kg), href: `/lot-inventory/${l.id}` });
    }
    const rows = Object.values(groups).sort((a, b) => b.onHandKg - a.onHandKg);
    const grand = rows.reduce((s, g) => ({ producedKg: s.producedKg + g.producedKg, onHandKg: s.onHandKg + g.onHandKg, reservedKg: s.reservedKg + g.reservedKg, soldKg: s.soldKg + g.soldKg, valuePkr: s.valuePkr + g.valuePkr }), { producedKg: 0, onHandKg: 0, reservedKg: 0, soldKg: 0, valuePkr: 0 });
    return { rows, grand };
  },

  // ═══════════════════════════════════════════════════════════════════
  // SCHEDULED REPORT EMAILS (Phase 5 — reuses the existing scheduler + mailer)
  // ═══════════════════════════════════════════════════════════════════

  // The report types that can be emailed on a schedule, each resolved from an
  // existing read-only service method into a { title, columns, rows } shape.
  SCHEDULED_REPORT_TYPES: {
    finished_goods: 'Finished Goods Ledger',
    inventory_movement: 'Inventory Movement Ledger',
    stock_aging: 'Stock Aging',
    recovery_by_variety: 'Recovery by Variety',
  },

  async buildScheduledReport(reportType, filters = {}) {
    const num = (v) => parseFloat(v) || 0;
    const fmtKg = (v) => `${Math.round(num(v)).toLocaleString()} kg`;
    const fmtPkr = (v) => `Rs ${Math.round(num(v)).toLocaleString()}`;
    if (reportType === 'finished_goods') {
      const d = await this.getFinishedGoodsLedger(filters);
      return {
        title: 'Finished Goods Ledger',
        columns: ['Output', 'Type', 'Produced', 'Sold', 'On hand', 'Reserved', 'Value'],
        rows: d.rows.map(r => [r.key, r.type === 'byproduct' ? 'by-product' : 'finished', fmtKg(r.producedKg), fmtKg(r.soldKg), fmtKg(r.onHandKg), fmtKg(r.reservedKg), fmtPkr(r.valuePkr)]),
        footer: ['TOTAL', '', fmtKg(d.grand.producedKg), fmtKg(d.grand.soldKg), fmtKg(d.grand.onHandKg), fmtKg(d.grand.reservedKg), fmtPkr(d.grand.valuePkr)],
      };
    }
    if (reportType === 'inventory_movement') {
      const d = await this.getInventoryLedger({ ...filters, limit: 500 });
      return {
        title: 'Inventory Movement Ledger',
        columns: ['Date', 'Movement', 'Lot', 'Where', 'Qty (kg)', 'Cost'],
        rows: d.rows.map(r => [r.date ? new Date(r.date).toLocaleDateString('en-GB') : '', r.label, r.lotNo || r.batchNo || '', [r.fromWh, r.toWh].filter(Boolean).join(' → ') || r.reference || '', `${r.direction === 'out' ? '−' : '+'}${Math.round(r.qtyKg).toLocaleString()}`, r.costPkr > 0 ? fmtPkr(r.costPkr) : '—']),
      };
    }
    if (reportType === 'stock_aging') {
      const lots = await this.getStockAgingReport();
      const arr = Array.isArray(lots) ? lots : (lots?.data || []);
      return {
        title: 'Stock Aging',
        columns: ['Lot', 'Item', 'Type', 'Qty', 'Value', 'Days held'],
        rows: arr.map(l => [l.lotNo || '—', l.itemName || '—', l.type || '—', `${num(l.qty).toLocaleString()} ${l.unit || 'MT'}`, fmtPkr(l.totalValue), String(l.daysInStock || 0)]),
      };
    }
    if (reportType === 'recovery_by_variety') {
      const d = await this.getRecoveryByVariety(filters);
      return {
        title: 'Recovery by Variety',
        columns: ['Variety', 'Batches', 'Avg Yield', 'Broken %', 'Benchmark', 'Variance'],
        rows: d.map(r => [r.variety, String(r.batchCount), `${r.avgYield}%`, `${r.avgBrokenPct}%`, r.benchmarkYield != null ? `${r.benchmarkYield}%` : '—', r.varianceFromBenchmark != null ? `${r.varianceFromBenchmark}%` : '—']),
      };
    }
    return null;
  },

  // Render a { title, columns, rows } report into a standalone HTML email body.
  renderReportEmailHtml({ title, columns, rows, footer }, { companyName = 'AGRI COMMODITIES', periodLabel } = {}) {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const now = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const thead = columns.map(c => `<th style="text-align:left;background:#f3f4f6;padding:6px 8px;border-bottom:1px solid #d1d5db;font-size:11px;text-transform:uppercase;color:#374151">${esc(c)}</th>`).join('');
    const tbody = (rows || []).map(r => `<tr>${r.map(c => `<td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;font-size:12px">${esc(c)}</td>`).join('')}</tr>`).join('');
    const tfoot = footer ? `<tr>${footer.map(c => `<td style="padding:6px 8px;border-top:2px solid #d1d5db;font-size:12px;font-weight:700">${esc(c)}</td>`).join('')}</tr>` : '';
    return `<div style="font-family:Arial,sans-serif;color:#111827">
      <div style="border-bottom:2px solid #111827;padding-bottom:8px;margin-bottom:6px">
        <div style="font-size:18px;font-weight:800">${esc(companyName)}</div>
        <div style="font-size:14px;font-weight:700">${esc(title)}</div>
        ${periodLabel ? `<div style="font-size:12px;color:#6b7280">${esc(periodLabel)}</div>` : ''}
      </div>
      <div style="font-size:11px;color:#6b7280;margin:6px 0 12px">Auto-generated report · ${esc(now)}</div>
      <table style="width:100%;border-collapse:collapse"><thead><tr>${thead}</tr></thead><tbody>${tbody || `<tr><td colspan="${columns.length}" style="padding:8px;color:#9ca3af">No rows.</td></tr>`}${tfoot}</tbody></table>
    </div>`;
  },

  // CRUD for scheduled report emails — stored as scheduled_tasks rows with
  // task_type='report_email' and a JSON config { reportType, recipients,
  // frequency, filters }.
  async listScheduledReportEmails() {
    const rows = await db('scheduled_tasks').where('task_type', 'report_email').orderBy('id', 'desc');
    return rows.map(t => {
      let cfg = {}; try { cfg = typeof t.config === 'string' ? JSON.parse(t.config) : (t.config || {}); } catch (e) { cfg = {}; }
      return { id: t.id, name: t.name, reportType: cfg.reportType, reportLabel: this.SCHEDULED_REPORT_TYPES[cfg.reportType] || cfg.reportType, frequency: cfg.frequency, recipients: cfg.recipients || [], isActive: !!t.is_active, lastRun: t.last_run, lastStatus: t.last_status, nextRun: t.next_run };
    });
  },

  async createScheduledReportEmail({ reportType, frequency, recipients, filters }) {
    if (!this.SCHEDULED_REPORT_TYPES[reportType]) throw new Error('Unknown report type');
    const freq = ['daily', 'weekly', 'monthly'].includes(frequency) ? frequency : 'weekly';
    const list = (Array.isArray(recipients) ? recipients : String(recipients || '').split(','))
      .map(s => String(s).trim()).filter(Boolean);
    if (!list.length) throw new Error('At least one recipient email is required');
    const label = this.SCHEDULED_REPORT_TYPES[reportType];
    const next = new Date(); next.setDate(next.getDate() + (freq === 'daily' ? 1 : freq === 'weekly' ? 7 : 30));
    const [row] = await db('scheduled_tasks').insert({
      name: `Email: ${label} (${freq})`,
      task_type: 'report_email',
      cron_expression: freq,
      config: JSON.stringify({ reportType, frequency: freq, recipients: list, filters: filters || {} }),
      is_active: true,
      next_run: next.toISOString(),
    }).returning(['id']);
    return { id: typeof row === 'object' ? row.id : row };
  },

  async deleteScheduledReportEmail(id) {
    const taskId = parseInt(id, 10);
    return db.transaction(async (trx) => {
      const task = await trx('scheduled_tasks').where({ id: taskId, task_type: 'report_email' }).first();
      if (!task) return 0;
      // task_execution_log has an FK on task_id — clear run history first.
      await trx('task_execution_log').where({ task_id: taskId }).del();
      return trx('scheduled_tasks').where({ id: taskId }).del();
    });
  },

  // ═══════════════════════════════════════════════════════════════════
  // GLOBAL SEARCH (reports nav helper)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Cross-entity quick search for the Reports global search box. Looks up
   * lots, milling batches, sales, export orders, suppliers and customers by
   * their reference number / name and returns lightweight rows with a link
   * target, so the user can jump straight to the matching record.
   * `entity === 'mill'` hides export orders (mill role has no export view).
   * Read-only; no flow/permission changes.
   */
  async globalSearch({ q, entity, limit = 8 }) {
    const term = String(q || '').trim();
    if (term.length < 2) return { query: term, groups: [] };
    const like = `%${term}%`;
    const cap = Math.min(parseInt(limit, 10) || 8, 20);
    const isMill = entity === 'mill';

    const [lots, batches, sales, orders, suppliers, customers] = await Promise.all([
      db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .where(function () { this.where('l.lot_no', 'ilike', like).orWhere('l.item_name', 'ilike', like); })
        .select('l.id', 'l.lot_no', 'l.item_name', 'l.type', db.raw("COALESCE(s.name,'—') as supplier"))
        .orderBy('l.id', 'desc').limit(cap),
      db('milling_batches as mb')
        .leftJoin('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
        .where('mb.batch_no', 'ilike', like)
        .select('mb.id', 'mb.batch_no', 'mb.status', 'eo.product_name')
        .orderBy('mb.id', 'desc').limit(cap),
      db('local_sales as ls')
        .where(function () { this.where('ls.sale_no', 'ilike', like).orWhere('ls.item_name', 'ilike', like).orWhere('ls.buyer_name', 'ilike', like); })
        .select('ls.id', 'ls.sale_no', 'ls.item_name', 'ls.buyer_name')
        .orderBy('ls.id', 'desc').limit(cap),
      isMill ? Promise.resolve([]) : db('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .where(function () { this.where('eo.order_no', 'ilike', like).orWhere('eo.product_name', 'ilike', like).orWhere('c.name', 'ilike', like); })
        .select('eo.id', 'eo.order_no', 'eo.product_name', db.raw("COALESCE(c.name,'—') as customer"))
        .orderBy('eo.id', 'desc').limit(cap),
      db('suppliers').where('name', 'ilike', like).select('id', 'name').orderBy('name').limit(cap),
      db('customers').where('name', 'ilike', like).select('id', 'name').orderBy('name').limit(cap),
    ]);

    const groups = [];
    if (lots.length) groups.push({ key: 'lots', label: 'Lots', items: lots.map(l => ({ id: l.id, title: l.lot_no, subtitle: `${l.item_name || '—'}${l.supplier && l.supplier !== '—' ? ' · ' + l.supplier : ''}`, href: `/lot-inventory/${l.id}` })) });
    if (batches.length) groups.push({ key: 'batches', label: 'Milling batches', items: batches.map(b => ({ id: b.id, title: b.batch_no, subtitle: `${b.product_name || 'Batch'}${b.status ? ' · ' + b.status : ''}`, href: `/milling/${b.id}` })) });
    if (sales.length) groups.push({ key: 'sales', label: 'Local sales', items: sales.map(s => ({ id: s.id, title: s.sale_no || `Sale #${s.id}`, subtitle: `${s.item_name || '—'}${s.buyer_name ? ' · ' + s.buyer_name : ''}`, href: `/local-sales/${s.id}` })) });
    if (orders.length) groups.push({ key: 'orders', label: 'Export orders', items: orders.map(o => ({ id: o.id, title: o.order_no || `Order #${o.id}`, subtitle: `${o.product_name || '—'}${o.customer && o.customer !== '—' ? ' · ' + o.customer : ''}`, href: `/export/${o.id}` })) });
    if (suppliers.length) groups.push({ key: 'suppliers', label: 'Suppliers', items: suppliers.map(s => ({ id: s.id, title: s.name, subtitle: 'Supplier statement', href: `${isMill ? '/milling/statements' : '/finance/statements'}?type=supplier&id=${s.id}` })) });
    if (customers.length) groups.push({ key: 'customers', label: 'Customers', items: customers.map(c => ({ id: c.id, title: c.name, subtitle: 'Customer statement', href: `${isMill ? '/milling/statements' : '/finance/statements'}?type=customer&id=${c.id}` })) });

    return { query: term, groups };
  },

  // ═══════════════════════════════════════════════════════════════════
  // FINANCIAL REPORTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Receivable recovery efficiency: avg days to collect, aging breakdown, overdue.
   */
  async getReceivableRecoveryEfficiency({ dateFrom, dateTo }) {
    // Aging breakdown
    const agingRows = await db('receivables')
      .select(
        db.raw(`
          CASE
            WHEN aging BETWEEN 0 AND 30 THEN '0-30'
            WHEN aging BETWEEN 31 AND 60 THEN '31-60'
            WHEN aging BETWEEN 61 AND 90 THEN '61-90'
            WHEN aging > 90 THEN '90+'
            ELSE '0-30'
          END as bucket
        `),
        db.raw('COUNT(id) as count'),
        db.raw('COALESCE(SUM(outstanding), 0) as total_outstanding'),
        db.raw('COALESCE(SUM(expected_amount), 0) as total_expected')
      )
      .where('status', '!=', 'Closed')
      .groupByRaw(`
        CASE
          WHEN aging BETWEEN 0 AND 30 THEN '0-30'
          WHEN aging BETWEEN 31 AND 60 THEN '31-60'
          WHEN aging BETWEEN 61 AND 90 THEN '61-90'
          WHEN aging > 90 THEN '90+'
          ELSE '0-30'
        END
      `);

    // Avg days to collect advance
    const advanceAvg = await db('receivables')
      .where('type', 'like', '%advance%')
      .where('received_amount', '>', 0)
      .select(db.raw('COALESCE(AVG(aging), 0) as avg_days'))
      .first();

    // Avg days to collect balance
    const balanceAvg = await db('receivables')
      .where('type', 'like', '%balance%')
      .where('received_amount', '>', 0)
      .select(db.raw('COALESCE(AVG(aging), 0) as avg_days'))
      .first();

    // By customer
    const byCustomer = await db('receivables as r')
      .join('customers as c', 'r.customer_id', 'c.id')
      .where('r.status', '!=', 'Closed')
      .select(
        'c.name as customer_name',
        'c.country',
        db.raw('COUNT(r.id) as count'),
        db.raw('COALESCE(SUM(r.outstanding), 0) as outstanding'),
        db.raw('COALESCE(AVG(r.aging), 0) as avg_days')
      )
      .groupBy('c.id', 'c.name', 'c.country')
      .orderBy('outstanding', 'desc');

    // Overdue
    const overdue = await db('receivables')
      .where('status', '!=', 'Closed')
      .where('due_date', '<', db.fn.now())
      .where('outstanding', '>', 0)
      .select(
        db.raw('COUNT(id) as count'),
        db.raw('COALESCE(SUM(outstanding), 0) as overdue_amount')
      )
      .first();

    const totalOutstanding = await db('receivables')
      .where('status', '!=', 'Closed')
      .sum('outstanding as total')
      .first();

    const overdueAmt = parseFloat(overdue.overdue_amount) || 0;
    const totalAmt = parseFloat(totalOutstanding.total) || 0;
    const overdueRatio = totalAmt > 0 ? parseFloat(((overdueAmt / totalAmt) * 100).toFixed(2)) : 0;

    return {
      avgDaysAdvance: parseFloat(parseFloat(advanceAvg.avg_days).toFixed(1)),
      avgDaysBalance: parseFloat(parseFloat(balanceAvg.avg_days).toFixed(1)),
      aging: agingRows.map((r) => ({
        bucket: r.bucket,
        count: parseInt(r.count, 10),
        outstanding: parseFloat(r.total_outstanding),
        expected: parseFloat(r.total_expected),
      })),
      byCustomer: byCustomer.map((c) => ({
        customerName: c.customer_name,
        country: c.country,
        count: parseInt(c.count, 10),
        outstanding: parseFloat(c.outstanding),
        avgDays: parseFloat(parseFloat(c.avg_days).toFixed(1)),
      })),
      overdue: {
        count: parseInt(overdue.count, 10),
        amount: overdueAmt,
        overdueRatio,
      },
    };
  },

  /**
   * Payable analysis: by category, by supplier, aging, overdue, total outstanding.
   */
  async getPayableAnalysis({ dateFrom, dateTo }) {
    // By category
    const byCategory = await db('payables')
      .where('status', '!=', 'Closed')
      .select(
        'category',
        db.raw('COUNT(id) as count'),
        db.raw('COALESCE(SUM(original_amount), 0) as total_amount'),
        db.raw('COALESCE(SUM(paid_amount), 0) as paid'),
        db.raw('COALESCE(SUM(outstanding), 0) as outstanding')
      )
      .groupBy('category')
      .orderBy('outstanding', 'desc');

    // By supplier
    const bySupplier = await db('payables as p')
      .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
      .where('p.status', '!=', 'Closed')
      .select(
        's.name as supplier_name',
        db.raw('COUNT(p.id) as count'),
        db.raw('COALESCE(SUM(p.outstanding), 0) as outstanding'),
        db.raw('COALESCE(AVG(p.aging), 0) as avg_aging')
      )
      .groupBy('s.id', 's.name')
      .orderBy('outstanding', 'desc');

    // Aging
    const aging = await db('payables')
      .where('status', '!=', 'Closed')
      .select(
        db.raw(`
          CASE
            WHEN aging BETWEEN 0 AND 30 THEN '0-30'
            WHEN aging BETWEEN 31 AND 60 THEN '31-60'
            WHEN aging BETWEEN 61 AND 90 THEN '61-90'
            WHEN aging > 90 THEN '90+'
            ELSE '0-30'
          END as bucket
        `),
        db.raw('COUNT(id) as count'),
        db.raw('COALESCE(SUM(outstanding), 0) as outstanding')
      )
      .groupByRaw(`
        CASE
          WHEN aging BETWEEN 0 AND 30 THEN '0-30'
          WHEN aging BETWEEN 31 AND 60 THEN '31-60'
          WHEN aging BETWEEN 61 AND 90 THEN '61-90'
          WHEN aging > 90 THEN '90+'
          ELSE '0-30'
        END
      `);

    // Overdue
    const overdue = await db('payables')
      .where('status', '!=', 'Closed')
      .where('due_date', '<', db.fn.now())
      .where('outstanding', '>', 0)
      .select(
        db.raw('COUNT(id) as count'),
        db.raw('COALESCE(SUM(outstanding), 0) as overdue_amount')
      )
      .first();

    const totalOutstanding = await db('payables')
      .where('status', '!=', 'Closed')
      .sum('outstanding as total')
      .first();

    return {
      byCategory: byCategory.map((c) => ({
        category: c.category,
        count: parseInt(c.count, 10),
        totalAmount: parseFloat(c.total_amount),
        paid: parseFloat(c.paid),
        outstanding: parseFloat(c.outstanding),
      })),
      bySupplier: bySupplier.map((s) => ({
        supplierName: s.supplier_name,
        count: parseInt(s.count, 10),
        outstanding: parseFloat(s.outstanding),
        avgAging: parseFloat(parseFloat(s.avg_aging).toFixed(1)),
      })),
      aging: aging.map((a) => ({
        bucket: a.bucket,
        count: parseInt(a.count, 10),
        outstanding: parseFloat(a.outstanding),
      })),
      overdue: {
        count: parseInt(overdue.count, 10),
        amount: parseFloat(overdue.overdue_amount) || 0,
      },
      totalOutstanding: parseFloat(totalOutstanding.total) || 0,
    };
  },

  /**
   * Cash forecast vs commitments: expected receipts, expected payments, net projection.
   */
  async getCashForecastVsCommitments({ daysAhead = 30 }) {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    // Expected receipts from receivables due within range
    const receipts = await db('receivables')
      .where('status', '!=', 'Closed')
      .where('outstanding', '>', 0)
      .whereBetween('due_date', [today.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)])
      .select(
        'due_date',
        db.raw('COALESCE(SUM(outstanding), 0) as expected_receipt')
      )
      .groupBy('due_date')
      .orderBy('due_date');

    // Expected payments from payables due within range
    const payments = await db('payables')
      .where('status', '!=', 'Closed')
      .where('outstanding', '>', 0)
      .whereBetween('due_date', [today.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)])
      .select(
        'due_date',
        db.raw('COALESCE(SUM(outstanding), 0) as expected_payment')
      )
      .groupBy('due_date')
      .orderBy('due_date');

    // Current cash
    const cashPosition = await db('bank_accounts')
      .where('is_active', true)
      .sum('current_balance as total')
      .first();

    // Build daily projection
    const receiptMap = {};
    for (const r of receipts) {
      const d = new Date(r.due_date).toISOString().slice(0, 10);
      receiptMap[d] = parseFloat(r.expected_receipt) || 0;
    }
    const paymentMap = {};
    for (const p of payments) {
      const d = new Date(p.due_date).toISOString().slice(0, 10);
      paymentMap[d] = parseFloat(p.expected_payment) || 0;
    }

    let runningBalance = parseFloat(cashPosition.total) || 0;
    const projection = [];
    for (let i = 0; i <= daysAhead; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const inflow = receiptMap[dateStr] || 0;
      const outflow = paymentMap[dateStr] || 0;
      runningBalance += inflow - outflow;

      projection.push({
        date: dateStr,
        expectedReceipts: inflow,
        expectedPayments: outflow,
        netCashFlow: inflow - outflow,
        projectedBalance: parseFloat(runningBalance.toFixed(2)),
      });
    }

    return {
      currentCash: parseFloat(cashPosition.total) || 0,
      totalExpectedReceipts: receipts.reduce((sum, r) => sum + (parseFloat(r.expected_receipt) || 0), 0),
      totalExpectedPayments: payments.reduce((sum, p) => sum + (parseFloat(p.expected_payment) || 0), 0),
      projection,
    };
  },

  /**
   * FX exposure dashboard: USD receivables vs PKR costs, unrealized FX impact.
   */
  async getFxExposureDashboard() {
    // Get latest FX rate
    const latestRate = await db('fx_rates')
      .where('from_currency', 'USD')
      .where('to_currency', 'PKR')
      .orderBy('effective_date', 'desc')
      .first();

    const currentRate = latestRate ? parseFloat(latestRate.rate) : 280;

    // USD receivables
    const usdReceivables = await db('receivables')
      .where('currency', 'USD')
      .where('status', '!=', 'Closed')
      .select(
        db.raw('COALESCE(SUM(outstanding), 0) as total_outstanding_usd'),
        db.raw('COUNT(id) as count')
      )
      .first();

    // Per-order FX exposure
    const orderExposure = await db('export_orders as eo')
      .leftJoin('receivables as r', 'r.order_id', 'eo.id')
      .where('eo.currency', 'USD')
      .where('r.status', '!=', 'Closed')
      .where('r.outstanding', '>', 0)
      .select(
        'eo.order_no',
        'eo.contract_value',
        'r.outstanding as outstanding_usd',
        'eo.currency'
      )
      .orderBy('r.outstanding', 'desc')
      .limit(50);

    // PKR costs (from payables in PKR)
    const pkrCosts = await db('payables')
      .where('currency', 'PKR')
      .where('status', '!=', 'Closed')
      .sum('outstanding as total')
      .first();

    const totalUSD = parseFloat(usdReceivables.total_outstanding_usd) || 0;
    const totalPKRCosts = parseFloat(pkrCosts.total) || 0;

    return {
      currentRate,
      usdReceivables: {
        totalOutstandingUSD: totalUSD,
        totalOutstandingPKR: parseFloat((totalUSD * currentRate).toFixed(2)),
        count: parseInt(usdReceivables.count, 10),
      },
      pkrCostsOutstanding: totalPKRCosts,
      netExposure: parseFloat((totalUSD * currentRate - totalPKRCosts).toFixed(2)),
      orderExposure: orderExposure.map((o) => ({
        orderNo: o.order_no,
        contractValue: parseFloat(o.contract_value),
        outstandingUSD: parseFloat(o.outstanding_usd),
        outstandingPKR: parseFloat((parseFloat(o.outstanding_usd) * currentRate).toFixed(2)),
      })),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // INVENTORY & STOCK REPORTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Stock aging: per lot, days since created, flag dead stock (>90 days).
   */
  async getStockAgingReport() {
    const lots = await db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .where('il.qty', '>', 0)
      .select(
        'il.id',
        'il.lot_no',
        'il.item_name',
        'il.type',
        'il.entity',
        'il.qty',
        'il.unit',
        'il.cost_per_unit',
        'il.total_value',
        'w.name as warehouse_name',
        'il.created_at',
        db.raw("EXTRACT(DAY FROM NOW() - il.created_at)::int as days_in_stock")
      )
      .orderByRaw("EXTRACT(DAY FROM NOW() - il.created_at) DESC");

    // Group by type
    const grouped = { raw: [], finished: [], byproduct: [], packaging: [] };
    const deadStockThreshold = 90;

    const data = lots.map((l) => {
      const item = {
        id: l.id,
        lotNo: l.lot_no,
        itemName: l.item_name,
        type: l.type,
        entity: l.entity,
        qty: parseFloat(l.qty),
        unit: l.unit,
        costPerUnit: parseFloat(l.cost_per_unit) || 0,
        totalValue: parseFloat(l.total_value) || 0,
        warehouseName: l.warehouse_name,
        daysInStock: l.days_in_stock || 0,
        isDeadStock: (l.days_in_stock || 0) > deadStockThreshold,
      };

      if (grouped[l.type]) grouped[l.type].push(item);
      return item;
    });

    const deadStockCount = data.filter((d) => d.isDeadStock).length;
    const totalValue = data.reduce((sum, d) => sum + d.totalValue, 0);

    return {
      data,
      grouped,
      summary: {
        totalLots: data.length,
        deadStockCount,
        totalValue: parseFloat(totalValue.toFixed(2)),
      },
    };
  },

  /**
   * Avg days inventory sits before being consumed/sold. By product type.
   */
  async getStockTurnoverDays({ entity }) {
    const query = db('inventory_lots')
      .where('qty', '>', 0)
      .select(
        'type',
        db.raw("AVG(EXTRACT(DAY FROM NOW() - created_at))::numeric(10,1) as avg_days"),
        db.raw('COUNT(id) as lot_count'),
        db.raw('COALESCE(SUM(qty), 0) as total_qty')
      )
      .groupBy('type')
      .orderBy('avg_days', 'desc');

    if (entity) query.where('entity', entity);

    const rows = await query;

    // Overall average
    const overall = await db('inventory_lots')
      .where('qty', '>', 0)
      .modify((qb) => { if (entity) qb.where('entity', entity); })
      .select(db.raw("AVG(EXTRACT(DAY FROM NOW() - created_at))::numeric(10,1) as avg_days"))
      .first();

    return {
      byType: rows.map((r) => ({
        type: r.type,
        avgDays: parseFloat(r.avg_days) || 0,
        lotCount: parseInt(r.lot_count, 10),
        totalQty: parseFloat(r.total_qty),
      })),
      overallAvgDays: parseFloat(overall.avg_days) || 0,
    };
  },

  /**
   * Total value of all inventory by type and warehouse.
   */
  async getStockValuation({ entity, asOfDate }) {
    const query = db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .where('il.qty', '>', 0);

    if (entity) query.where('il.entity', entity);
    if (asOfDate) query.where('il.created_at', '<=', asOfDate);

    // By type
    const byType = await query.clone()
      .select(
        'il.type',
        db.raw('COALESCE(SUM(il.qty * il.cost_per_unit), 0) as total_value'),
        db.raw('COALESCE(SUM(il.qty), 0) as total_qty'),
        db.raw('COUNT(il.id) as lot_count')
      )
      .groupBy('il.type')
      .orderBy('total_value', 'desc');

    // By warehouse
    const byWarehouse = await query.clone()
      .select(
        'w.name as warehouse_name',
        'il.entity',
        db.raw('COALESCE(SUM(il.qty * il.cost_per_unit), 0) as total_value'),
        db.raw('COALESCE(SUM(il.qty), 0) as total_qty'),
        db.raw('COUNT(il.id) as lot_count')
      )
      .groupBy('w.name', 'il.entity')
      .orderBy('total_value', 'desc');

    const grandTotal = await query.clone()
      .select(db.raw('COALESCE(SUM(il.qty * il.cost_per_unit), 0) as grand_total'))
      .first();

    return {
      byType: byType.map((r) => ({
        type: r.type,
        totalValue: parseFloat(r.total_value),
        totalQty: parseFloat(r.total_qty),
        lotCount: parseInt(r.lot_count, 10),
      })),
      byWarehouse: byWarehouse.map((r) => ({
        warehouseName: r.warehouse_name,
        entity: r.entity,
        totalValue: parseFloat(r.total_value),
        totalQty: parseFloat(r.total_qty),
        lotCount: parseInt(r.lot_count, 10),
      })),
      grandTotal: parseFloat(grandTotal.grand_total),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // PRODUCTION REPORTS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Per mill: batches processed, total input, total output, avg yield,
   * utilization %, downtime hours, downtime impact.
   */
  async getProductionEfficiencyByMill({ dateFrom, dateTo }) {
    const query = db('milling_batches as mb')
      .join('mills as m', 'mb.mill_id', 'm.id')
      .select(
        'm.id as mill_id',
        'm.name as mill_name',
        'm.capacity_mt_per_day',
        db.raw('COUNT(mb.id) as batches_processed'),
        db.raw('COALESCE(SUM(mb.raw_qty_mt), 0) as total_input_mt'),
        db.raw('COALESCE(SUM(mb.actual_finished_mt), 0) as total_output_mt'),
        db.raw('COALESCE(AVG(mb.yield_pct), 0) as avg_yield'),
        db.raw('COALESCE(SUM(mb.processing_hours), 0) as total_processing_hours')
      )
      .groupBy('m.id', 'm.name', 'm.capacity_mt_per_day');

    if (dateFrom) query.where('mb.created_at', '>=', dateFrom);
    if (dateTo) query.where('mb.created_at', '<=', dateTo);

    const mills = await query;
    const millIds = mills.map((m) => m.mill_id);

    // Downtime per mill
    const downtimeQuery = millIds.length > 0
      ? await db('machine_downtime')
          .whereIn('mill_id', millIds)
          .modify((qb) => {
            if (dateFrom) qb.where('start_time', '>=', dateFrom);
            if (dateTo) qb.where('start_time', '<=', dateTo);
          })
          .select(
            'mill_id',
            db.raw('COALESCE(SUM(duration_minutes), 0) as total_downtime_minutes'),
            db.raw('COALESCE(SUM(impact_mt), 0) as downtime_impact_mt')
          )
          .groupBy('mill_id')
      : [];

    const downtimeMap = {};
    for (const d of downtimeQuery) {
      downtimeMap[d.mill_id] = {
        minutes: parseInt(d.total_downtime_minutes, 10),
        impactMT: parseFloat(d.downtime_impact_mt),
      };
    }

    // Calculate date range days for utilization
    let rangeDays = 30;
    if (dateFrom && dateTo) {
      rangeDays = Math.max(1, Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24)));
    }

    return mills.map((m) => {
      const capacity = parseFloat(m.capacity_mt_per_day) || 0;
      const totalCapacity = capacity * rangeDays;
      const totalInput = parseFloat(m.total_input_mt);
      const utilization = totalCapacity > 0 ? parseFloat(((totalInput / totalCapacity) * 100).toFixed(1)) : 0;
      const downtime = downtimeMap[m.mill_id] || { minutes: 0, impactMT: 0 };

      return {
        millId: m.mill_id,
        millName: m.mill_name,
        capacityMTPerDay: capacity,
        batchesProcessed: parseInt(m.batches_processed, 10),
        totalInputMT: totalInput,
        totalOutputMT: parseFloat(m.total_output_mt),
        avgYield: parseFloat(parseFloat(m.avg_yield).toFixed(1)),
        totalProcessingHours: parseFloat(m.total_processing_hours),
        utilization,
        downtimeHours: parseFloat((downtime.minutes / 60).toFixed(1)),
        downtimeImpactMT: downtime.impactMT,
      };
    });
  },

  /**
   * Per operator: batches, total output, avg yield, processing hours.
   */
  async getOperatorProductivityReport({ dateFrom, dateTo }) {
    const query = db('milling_batches')
      .whereNotNull('operator_name')
      .select(
        'operator_name',
        db.raw('COUNT(id) as batches'),
        db.raw('COALESCE(SUM(actual_finished_mt), 0) as total_output_mt'),
        db.raw('COALESCE(AVG(yield_pct), 0) as avg_yield'),
        db.raw('COALESCE(SUM(processing_hours), 0) as total_hours')
      )
      .groupBy('operator_name')
      .orderBy('total_output_mt', 'desc');

    if (dateFrom) query.where('created_at', '>=', dateFrom);
    if (dateTo) query.where('created_at', '<=', dateTo);

    const rows = await query;

    return rows.map((r) => ({
      operatorName: r.operator_name,
      batches: parseInt(r.batches, 10),
      totalOutputMT: parseFloat(r.total_output_mt),
      avgYield: parseFloat(parseFloat(r.avg_yield).toFixed(1)),
      totalHours: parseFloat(r.total_hours),
      outputPerHour: parseFloat(r.total_hours) > 0
        ? parseFloat((parseFloat(r.total_output_mt) / parseFloat(r.total_hours)).toFixed(2))
        : 0,
    }));
  },

  /**
   * Utility consumption by type: total consumption, cost, cost per MT processed.
   */
  async getUtilityConsumptionReport({ millId, dateFrom, dateTo }) {
    const query = db('utility_consumption as uc')
      .select(
        'uc.utility_type',
        'uc.unit',
        db.raw('COALESCE(SUM(uc.consumption), 0) as total_consumption'),
        db.raw('COALESCE(SUM(uc.total_cost), 0) as total_cost'),
        db.raw('COUNT(uc.id) as records')
      )
      .groupBy('uc.utility_type', 'uc.unit')
      .orderBy('total_cost', 'desc');

    if (millId) query.where('uc.mill_id', millId);
    if (dateFrom) query.where('uc.period_start', '>=', dateFrom);
    if (dateTo) query.where('uc.period_end', '<=', dateTo);

    const rows = await query;

    // Total MT processed for cost/MT calculation
    const processedQuery = db('milling_batches')
      .where('status', 'Completed')
      .select(db.raw('COALESCE(SUM(raw_qty_mt), 0) as total_processed'));
    if (millId) processedQuery.where('mill_id', millId);
    if (dateFrom) processedQuery.where('created_at', '>=', dateFrom);
    if (dateTo) processedQuery.where('created_at', '<=', dateTo);

    const processed = await processedQuery.first();
    const totalProcessed = parseFloat(processed.total_processed) || 0;

    // Monthly trend
    const trendQuery = db('utility_consumption')
      .select(
        db.raw("TO_CHAR(period_start, 'YYYY-MM') as month"),
        'utility_type',
        db.raw('COALESCE(SUM(total_cost), 0) as cost')
      )
      .groupByRaw("TO_CHAR(period_start, 'YYYY-MM'), utility_type")
      .orderByRaw("TO_CHAR(period_start, 'YYYY-MM')");
    if (millId) trendQuery.where('mill_id', millId);

    const trend = await trendQuery;

    return {
      byType: rows.map((r) => ({
        utilityType: r.utility_type,
        unit: r.unit,
        totalConsumption: parseFloat(r.total_consumption),
        totalCost: parseFloat(r.total_cost),
        costPerMT: totalProcessed > 0 ? parseFloat((parseFloat(r.total_cost) / totalProcessed).toFixed(2)) : 0,
        records: parseInt(r.records, 10),
      })),
      totalProcessedMT: totalProcessed,
      monthlyTrend: trend.map((t) => ({
        month: t.month,
        utilityType: t.utility_type,
        cost: parseFloat(t.cost),
      })),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // KPI BENCHMARKS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * For each benchmark: calculate actual value from live data, compare to target.
   */
  async getKpiBenchmarkComparison({ entity, periodStart, periodEnd }) {
    const benchmarks = await db('kpi_benchmarks')
      .modify((qb) => {
        if (entity) qb.where(function () { this.where('entity', entity).orWhereNull('entity'); });
      })
      .orderBy('id');

    const results = [];

    for (const bm of benchmarks) {
      let actual = null;

      try {
        switch (bm.kpi_name) {
          case 'Export Margin': {
            const orders = await db('export_orders')
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .select(db.raw('COALESCE(SUM(contract_value), 0) as revenue'))
              .first();
            const costs = await db('export_order_costs as eoc')
              .join('export_orders as eo', 'eoc.order_id', 'eo.id')
              .modify((qb) => {
                if (periodStart) qb.where('eo.created_at', '>=', periodStart);
                if (periodEnd) qb.where('eo.created_at', '<=', periodEnd);
              })
              .sum('eoc.amount as total')
              .first();
            const rev = parseFloat(orders.revenue) || 0;
            const cost = parseFloat(costs.total) || 0;
            actual = rev > 0 ? parseFloat((((rev - cost) / rev) * 100).toFixed(2)) : 0;
            break;
          }

          case 'Mill Yield': {
            const yieldData = await db('milling_batches')
              .where('status', 'Completed')
              .where('yield_pct', '>', 0)
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .avg('yield_pct as avg')
              .first();
            actual = parseFloat(parseFloat(yieldData.avg || 0).toFixed(2));
            break;
          }

          case 'Collection Rate': {
            const recv = await db('receivables')
              .select(
                db.raw('COALESCE(SUM(expected_amount), 0) as expected'),
                db.raw('COALESCE(SUM(received_amount), 0) as received')
              )
              .first();
            const expected = parseFloat(recv.expected) || 0;
            actual = expected > 0 ? parseFloat(((parseFloat(recv.received) / expected) * 100).toFixed(2)) : 0;
            break;
          }

          case 'Advance Collection Days': {
            const advDays = await db('receivables')
              .where('type', 'like', '%advance%')
              .where('received_amount', '>', 0)
              .avg('aging as avg')
              .first();
            actual = parseFloat(parseFloat(advDays.avg || 0).toFixed(1));
            break;
          }

          case 'Balance Collection Days': {
            const balDays = await db('receivables')
              .where('type', 'like', '%balance%')
              .where('received_amount', '>', 0)
              .avg('aging as avg')
              .first();
            actual = parseFloat(parseFloat(balDays.avg || 0).toFixed(1));
            break;
          }

          case 'Broken Rice Max': {
            const brokenData = await db('milling_batches')
              .where('status', 'Completed')
              .where('raw_qty_mt', '>', 0)
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .select(db.raw('AVG(broken_mt / NULLIF(raw_qty_mt, 0) * 100) as avg_broken_pct'))
              .first();
            actual = parseFloat(parseFloat(brokenData.avg_broken_pct || 0).toFixed(2));
            break;
          }

          case 'On-Time Shipment Rate': {
            const shipped = await db('export_orders')
              .whereIn('status', ['Shipped', 'Arrived', 'Closed'])
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .select(
                db.raw('COUNT(id) as total'),
                db.raw("COUNT(CASE WHEN (atd IS NULL OR etd IS NULL OR atd <= etd) THEN 1 END) as on_time")
              )
              .first();
            const total = parseInt(shipped.total, 10);
            actual = total > 0 ? parseFloat(((parseInt(shipped.on_time, 10) / total) * 100).toFixed(2)) : 100;
            break;
          }

          case 'Document Completion Rate': {
            const docs = await db('document_checklists')
              .select(
                db.raw('COUNT(id) as total'),
                db.raw("COUNT(CASE WHEN is_fulfilled = true THEN 1 END) as fulfilled")
              )
              .first();
            const total = parseInt(docs.total, 10);
            actual = total > 0 ? parseFloat(((parseInt(docs.fulfilled, 10) / total) * 100).toFixed(2)) : 100;
            break;
          }

          case 'Receivable Overdue Ratio': {
            const overdue = await db('receivables')
              .where('status', '!=', 'Closed')
              .select(
                db.raw('COALESCE(SUM(outstanding), 0) as total_outstanding'),
                db.raw("COALESCE(SUM(CASE WHEN due_date < NOW() AND outstanding > 0 THEN outstanding ELSE 0 END), 0) as overdue")
              )
              .first();
            const totalOut = parseFloat(overdue.total_outstanding) || 0;
            actual = totalOut > 0 ? parseFloat(((parseFloat(overdue.overdue) / totalOut) * 100).toFixed(2)) : 0;
            break;
          }

          case 'Cost Per MT Export': {
            const costData = await db('export_order_costs as eoc')
              .join('export_orders as eo', 'eoc.order_id', 'eo.id')
              .modify((qb) => {
                if (periodStart) qb.where('eo.created_at', '>=', periodStart);
                if (periodEnd) qb.where('eo.created_at', '<=', periodEnd);
              })
              .select(db.raw('COALESCE(SUM(eoc.amount), 0) as total_costs'))
              .first();
            const qtyData = await db('export_orders')
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .sum('qty_mt as total_qty')
              .first();
            const totalQty = parseFloat(qtyData.total_qty) || 0;
            actual = totalQty > 0 ? parseFloat((parseFloat(costData.total_costs) / totalQty).toFixed(2)) : 0;
            break;
          }

          case 'Mill Cost Per MT': {
            const millCostData = await db('milling_costs as mc')
              .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
              .modify((qb) => {
                if (periodStart) qb.where('mb.created_at', '>=', periodStart);
                if (periodEnd) qb.where('mb.created_at', '<=', periodEnd);
              })
              .sum('mc.amount as total')
              .first();
            const millQty = await db('milling_batches')
              .where('status', 'Completed')
              .modify((qb) => {
                if (periodStart) qb.where('created_at', '>=', periodStart);
                if (periodEnd) qb.where('created_at', '<=', periodEnd);
              })
              .sum('raw_qty_mt as total')
              .first();
            const totalMT = parseFloat(millQty.total) || 0;
            actual = totalMT > 0 ? parseFloat((parseFloat(millCostData.total) / totalMT).toFixed(2)) : 0;
            break;
          }

          case 'Stock Turnover Days': {
            const avgDays = await db('inventory_lots')
              .where('qty', '>', 0)
              .select(db.raw("AVG(EXTRACT(DAY FROM NOW() - created_at))::numeric(10,1) as avg"))
              .first();
            actual = parseFloat(avgDays.avg || 0);
            break;
          }

          default:
            actual = null;
        }
      } catch (err) {
        actual = null;
      }

      // Determine status
      let status = 'Unknown';
      if (actual !== null) {
        const target = parseFloat(bm.target_value);
        switch (bm.comparison) {
          case 'gte':
            status = actual >= target ? 'Met' : 'Missed';
            break;
          case 'lte':
            status = actual <= target ? 'Met' : 'Missed';
            break;
          case 'eq':
            status = Math.abs(actual - target) < 0.01 ? 'Met' : 'Missed';
            break;
        }
      }

      const target = parseFloat(bm.target_value);
      results.push({
        kpiName: bm.kpi_name,
        entity: bm.entity,
        target,
        actual,
        unit: bm.unit,
        comparison: bm.comparison,
        status,
        variance: actual !== null ? parseFloat((actual - target).toFixed(2)) : null,
        period: bm.period,
      });
    }

    return results;
  },

  // ═══════════════════════════════════════════════════════════════════
  // SAVED REPORTS
  // ═══════════════════════════════════════════════════════════════════

  async saveReport({ name, reportType, entity, filters, columns, sortBy, createdBy, isShared }) {
    const [report] = await db('saved_reports')
      .insert({
        name,
        report_type: reportType,
        entity: entity || null,
        filters: filters ? JSON.stringify(filters) : null,
        columns: columns ? JSON.stringify(columns) : null,
        sort_by: sortBy || null,
        created_by: createdBy,
        is_shared: isShared || false,
      })
      .returning('*');

    return report;
  },

  async getSavedReports(userId) {
    return db('saved_reports')
      .where(function () {
        this.where('created_by', userId).orWhere('is_shared', true);
      })
      .orderBy('updated_at', 'desc');
  },

  async deleteSavedReport(reportId) {
    return db('saved_reports').where('id', reportId).del();
  },

  /**
   * Load saved filters + type, execute the appropriate report method, return results.
   */
  async runSavedReport(reportId) {
    const report = await db('saved_reports').where('id', reportId).first();
    if (!report) throw new Error('Saved report not found');

    const filters = report.filters || {};
    let result;

    const methodMap = {
      order_pipeline: () => this.getOrderPipeline(filters),
      profitability: () => this.getOrderProfitability(filters),
      receivable_aging: () => this.getReceivableRecoveryEfficiency(filters),
      supplier_quality: () => this.getSupplierQualityRanking(filters),
      customer_ranking: () => this.getCustomerProfitability(filters),
      stock_aging: () => this.getStockAgingReport(),
      cash_forecast: () => this.getCashForecastVsCommitments(filters),
      production_efficiency: () => this.getProductionEfficiencyByMill(filters),
      country_analysis: () => this.getCountryAnalysis(filters),
    };

    const fn = methodMap[report.report_type];
    if (fn) {
      result = await fn();
    } else {
      throw new Error(`Unknown report type: ${report.report_type}`);
    }

    // Update last_run
    await db('saved_reports').where('id', reportId).update({ last_run: db.fn.now() });

    return { report, result };
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Convert data array to CSV string.
   */
  async exportToCSV(data, columns) {
    if (!data || data.length === 0) return '';

    const cols = columns || Object.keys(data[0]);
    const header = cols.join(',');
    const rows = data.map((row) =>
      cols.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape quotes and wrap in quotes if contains comma or quote
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    );

    return [header, ...rows].join('\n');
  },

  /**
   * Return formatted JSON.
   */
  async exportToJSON(data) {
    return JSON.stringify(data, null, 2);
  },

  /**
   * Log an export operation.
   */
  async logExport({ reportType, format, filePath, fileSize, userId, filters }) {
    const [record] = await db('report_exports')
      .insert({
        report_type: reportType,
        format,
        file_path: filePath || null,
        file_size: fileSize || null,
        generated_by: userId,
        filters_used: filters ? JSON.stringify(filters) : null,
      })
      .returning('*');

    return record;
  },

  // ── Payroll Ledger — one row per employee per payroll run, with filters. ──
  // Read-only over mill_payroll_lines/runs/workers. Reuses existing payroll data;
  // creates none. (Finance/Reports surface; gated reports.view, no Mill Operator.)
  async getPayrollLedger({ from, to, month, employee, role, department, payMethod, status } = {}) {
    const num = (v) => parseFloat(v) || 0;
    let q = db('mill_payroll_lines as l')
      .join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .leftJoin('mill_workers as w', 'w.id', 'l.worker_id')
      .leftJoin('bank_accounts as b', 'b.id', 'r.bank_account_id')
      // A line counts as paid when it has paid_at (partial or normal pay) OR its
      // run is fully paid/posted (legacy runs whose lines predate paid_at).
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); });
    if (month) q = q.where('r.period', month);
    if (from) q = q.where('r.period', '>=', from);
    if (to) q = q.where('r.period', '<=', to);
    if (employee) q = q.where('l.worker_id', parseInt(employee, 10));
    if (role) q = q.where('l.role', role);
    if (department) q = q.where('l.department', department);
    if (payMethod) q = q.where('r.pay_method', payMethod);
    const rows = await q
      .select('l.id', 'r.id as run_id', 'r.period', 'r.pay_date', 'r.pay_method', 'b.name as account_name',
        'l.worker_id', 'l.worker_name', 'l.role', 'l.department', 'l.pay_type', 'l.effective_days', 'l.ot_hours',
        'l.gross_pay', 'l.advance_deducted', 'l.net_pay')
      .orderBy('r.pay_date', 'desc').orderBy('l.id', 'desc');
    const out = rows.map((r) => ({
      id: r.id, runId: r.run_id, period: r.period, date: r.pay_date,
      employee: r.worker_name, workerId: r.worker_id || null, role: r.role || '—', department: r.department || '—', payType: r.pay_type || '—',
      effectiveDays: num(r.effective_days), otHours: num(r.ot_hours),
      gross: Math.round(num(r.gross_pay)), advanceDeducted: Math.round(num(r.advance_deducted)), net: Math.round(num(r.net_pay)),
      payMethod: r.pay_method || 'cash', account: r.account_name || (r.pay_method === 'bank' ? '—' : 'Mill Cash'),
      status: 'Paid',
      employeeHref: r.worker_id ? `/milling/finance` : null,
    }));
    const totals = {
      count: out.length,
      gross: out.reduce((s, r) => s + r.gross, 0),
      advance: out.reduce((s, r) => s + r.advanceDeducted, 0),
      net: out.reduce((s, r) => s + r.net, 0),
    };
    // Distinct roles for the filter dropdown.
    const roles = [...new Set(out.map((r) => r.role).filter((x) => x && x !== '—'))];
    const departments = [...new Set(out.map((r) => r.department).filter((x) => x && x !== '—'))];
    return { rows: out, totals, roles, departments };
  },

  // ── Payroll overview KPIs for the Head-Office Finance dashboard. ──
  // Consolidated from existing mill payroll data + salary expenses; no new data.
  async getPayrollOverview({ month } = {}) {
    const num = (v) => parseFloat(v) || 0;
    const period = /^\d{4}-\d{2}$/.test(month || '') ? month : new Date().toISOString().slice(0, 7);
    // Paid-line level so a partially_paid run contributes its paid portion.
    const runAgg = await db('mill_payroll_lines as l').join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where('r.period', period)
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .select(db.raw('COALESCE(SUM(l.net_pay),0) as net'), db.raw('COALESCE(SUM(l.gross_pay),0) as gross'), db.raw('COALESCE(SUM(l.advance_deducted),0) as advance'), db.raw('COUNT(DISTINCT l.run_id) as runs')).first();
    const advOut = await db('mill_worker_advances').where('status', 'outstanding')
      .select(db.raw('COALESCE(SUM(amount - recovered_amount),0) as outstanding')).first();
    const activeWorkers = await db('mill_workers').where('is_active', true).count('* as c').first();
    // Salary expense vs all business expenses this month (for % of expenses).
    const salaryExp = await db('business_expenses').where('category', 'salaries')
      .whereRaw("TO_CHAR(expense_date, 'YYYY-MM') = ?", [period])
      .select(db.raw('COALESCE(SUM(COALESCE(amount_pkr, amount)),0) as total')).first();
    const allExp = await db('business_expenses')
      .whereRaw("TO_CHAR(expense_date, 'YYYY-MM') = ?", [period])
      .select(db.raw('COALESCE(SUM(COALESCE(amount_pkr, amount)),0) as total')).first();
    // 6-month net payroll trend.
    const trendRows = await db('mill_payroll_lines as l').join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .select('r.period as period', db.raw('COALESCE(SUM(l.net_pay),0) as net'))
      .groupBy('r.period').orderBy('r.period', 'desc').limit(6);
    const salaryTotal = num(salaryExp.total); const allTotal = num(allExp.total);
    return {
      period,
      paidThisMonth: Math.round(num(runAgg.net)),
      grossThisMonth: Math.round(num(runAgg.gross)),
      advanceRecoveredThisMonth: Math.round(num(runAgg.advance)),
      runsThisMonth: parseInt(runAgg.runs, 10) || 0,
      advancesOutstanding: Math.round(num(advOut.outstanding)),
      activeWorkers: parseInt(activeWorkers.c, 10) || 0,
      salaryExpenseThisMonth: Math.round(salaryTotal),
      payrollPctOfExpenses: allTotal > 0 ? Math.round((salaryTotal / allTotal) * 1000) / 10 : 0,
      trend: trendRows.map((t) => ({ period: t.period, net: Math.round(num(t.net)) })).reverse(),
    };
  },

  // ── Payroll runs awaiting approval/payment (for the Finance approval card). ──
  // Read-only; returns Prepared + Approved runs so Finance/Owner can act on them.
  async getPayrollPending() {
    const num = (v) => parseFloat(v) || 0;
    const runs = await db('mill_payroll_runs as r')
      .leftJoin('users as up', 'up.id', 'r.created_by')
      .leftJoin('users as ua', 'ua.id', 'r.approved_by')
      .whereIn('r.status', ['prepared', 'approved', 'partially_paid'])
      .orderBy('r.created_at', 'asc')
      .select('r.id', 'r.period', 'r.pay_date', 'r.pay_method', 'r.status', 'r.gross_total', 'r.advance_total', 'r.net_total', 'r.employee_count', 'r.created_at', 'up.full_name as prepared_by_name', 'ua.full_name as approved_by_name');
    // Remaining (unpaid) net + headcount per run — for prepared/approved this is
    // the whole run; for partially_paid it's only what's still owed.
    const ids = runs.map((r) => r.id);
    const unpaid = ids.length ? await db('mill_payroll_lines').whereIn('run_id', ids).whereNull('paid_at')
      .groupBy('run_id').select('run_id', db.raw('COALESCE(SUM(net_pay),0) as net'), db.raw('COUNT(*) as cnt')) : [];
    const uMap = new Map(unpaid.map((u) => [u.run_id, u]));
    const mapped = runs.map((r) => {
      const u = uMap.get(r.id);
      const net = u ? num(u.net) : num(r.net_total);
      const cnt = u ? parseInt(u.cnt, 10) : r.employee_count;
      return {
        id: r.id, period: r.period, payDate: r.pay_date, payMethod: r.pay_method, status: r.status,
        gross: Math.round(num(r.gross_total)), advance: Math.round(num(r.advance_total)), net: Math.round(net),
        employeeCount: cnt, preparedBy: r.prepared_by_name || null, approvedBy: r.approved_by_name || null, preparedAt: r.created_at,
      };
    });
    return {
      runs: mapped,
      count: mapped.length,
      netPending: mapped.reduce((s, r) => s + r.net, 0),
    };
  },

  // ── Payroll analytics (dashboard): trend, cost-by-role, advances, headcount,
  // top earners — over a YYYY-MM range (default last 12 months). Paid/posted
  // runs only. Read-only over the mill payroll tables.
  async getPayrollAnalytics({ from, to } = {}) {
    const num = (v) => parseFloat(v) || 0;
    const addMonth = (p, n) => { const y = +p.slice(0, 4); const m = +p.slice(5, 7); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
    const toM = /^\d{4}-\d{2}$/.test(to || '') ? to : new Date().toISOString().slice(0, 7);
    const fromM = /^\d{4}-\d{2}$/.test(from || '') ? from : addMonth(toM, -11);
    // List of periods in range (cap 36).
    const periods = []; let p = fromM; for (let i = 0; i < 36 && p <= toM; i += 1) { periods.push(p); p = addMonth(p, 1); }

    // Paid lines in range (paid_at set, or legacy fully-paid/posted run) — so a
    // partially_paid run contributes the employees it has actually paid.
    const lines = await db('mill_payroll_lines as l').join('mill_payroll_runs as r', 'r.id', 'l.run_id')
      .where('r.period', '>=', fromM).where('r.period', '<=', toM)
      .where(function () { this.whereNotNull('l.paid_at').orWhereIn('r.status', ['paid', 'posted']); })
      .select('l.run_id', 'l.worker_id', 'l.worker_name', 'l.role', 'l.department', 'l.pay_type', 'l.gross_pay', 'l.net_pay', 'l.advance_deducted', 'l.ot_hours', 'r.period');

    // Monthly trend (fill zeros for empty months) — from paid lines.
    const byPeriod = {}; for (const l of lines) { const b = byPeriod[l.period] || (byPeriod[l.period] = { gross: 0, net: 0, advance: 0, workers: new Set() }); b.gross += num(l.gross_pay); b.net += num(l.net_pay); b.advance += num(l.advance_deducted); b.workers.add(l.worker_id); }
    const trend = periods.map((per) => ({ period: per, gross: Math.round((byPeriod[per] || {}).gross || 0), net: Math.round((byPeriod[per] || {}).net || 0), advance: Math.round((byPeriod[per] || {}).advance || 0), employees: byPeriod[per] ? byPeriod[per].workers.size : 0 }));

    // Cost by role (range).
    const roleMap = {};
    for (const l of lines) { const k = l.role || '—'; const b = roleMap[k] || (roleMap[k] = { role: k, gross: 0, net: 0, advance: 0, ot: 0, workers: new Set() }); b.gross += num(l.gross_pay); b.net += num(l.net_pay); b.advance += num(l.advance_deducted); b.ot += num(l.ot_hours); b.workers.add(l.worker_id); }
    const byRole = Object.values(roleMap).map((b) => ({ role: b.role, employees: b.workers.size, gross: Math.round(b.gross), net: Math.round(b.net), advance: Math.round(b.advance), otHours: Math.round(b.ot) })).sort((a, b) => b.net - a.net);

    // Cost by department / cost-center (range).
    const deptMap = {};
    for (const l of lines) { const k = l.department || 'Unassigned'; const b = deptMap[k] || (deptMap[k] = { department: k, gross: 0, net: 0, advance: 0, workers: new Set() }); b.gross += num(l.gross_pay); b.net += num(l.net_pay); b.advance += num(l.advance_deducted); b.workers.add(l.worker_id); }
    const byDepartment = Object.values(deptMap).map((b) => ({ department: b.department, employees: b.workers.size, gross: Math.round(b.gross), net: Math.round(b.net), advance: Math.round(b.advance) })).sort((a, b) => b.net - a.net);

    // Top earners (range).
    const earnMap = {};
    for (const l of lines) { const k = `${l.worker_id || l.worker_name}`; const b = earnMap[k] || (earnMap[k] = { name: l.worker_name, role: l.role, workerId: l.worker_id, net: 0, runs: 0 }); b.net += num(l.net_pay); b.runs += 1; }
    const topEarners = Object.values(earnMap).map((e) => ({ ...e, net: Math.round(e.net) })).sort((a, b) => b.net - a.net).slice(0, 8);

    // Headcount (current) + advances.
    const workers = await db('mill_workers').select('is_active', 'pay_type');
    const activeWorkers = workers.filter((w) => w.is_active).length;
    const byPayType = { daily: workers.filter((w) => w.is_active && w.pay_type !== 'monthly').length, monthly: workers.filter((w) => w.is_active && w.pay_type === 'monthly').length };
    const advGivenRow = await db('mill_worker_advances').whereRaw("TO_CHAR(advance_date,'YYYY-MM') >= ?", [fromM]).whereRaw("TO_CHAR(advance_date,'YYYY-MM') <= ?", [toM]).select(db.raw('COALESCE(SUM(amount),0) as given')).first();
    const advOutRow = await db('mill_worker_advances').where('status', 'outstanding').select(db.raw('COALESCE(SUM(amount - recovered_amount),0) as outstanding')).first();

    const totalGross = lines.reduce((s, l) => s + num(l.gross_pay), 0);
    const totalNet = lines.reduce((s, l) => s + num(l.net_pay), 0);
    const totalAdvanceRecovered = lines.reduce((s, l) => s + num(l.advance_deducted), 0);
    const runCount = new Set(lines.map((l) => l.run_id)).size;
    const paidEmployees = new Set(lines.map((l) => l.worker_id)).size;
    const given = num(advGivenRow.given);

    return {
      range: { from: fromM, to: toM },
      summary: {
        totalGross: Math.round(totalGross), totalNet: Math.round(totalNet), totalAdvanceRecovered: Math.round(totalAdvanceRecovered),
        runs: runCount, paidEmployees, activeWorkers, byPayType,
        avgNetPerEmployee: paidEmployees ? Math.round(totalNet / paidEmployees) : 0,
        avgNetPerMonth: periods.length ? Math.round(totalNet / periods.length) : 0,
        advancesGiven: Math.round(given), advancesOutstanding: Math.round(num(advOutRow.outstanding)),
        advanceRecoveryRate: given > 0 ? Math.round((totalAdvanceRecovered / given) * 1000) / 10 : 0,
      },
      trend, byRole, byDepartment, topEarners,
    };
  },
};

module.exports = reportingService;
