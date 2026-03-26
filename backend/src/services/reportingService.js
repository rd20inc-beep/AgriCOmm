const db = require('../config/database');

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
          WHEN 'In Milling' THEN 4
          WHEN 'Docs In Prep' THEN 5
          WHEN 'Awaiting Balance' THEN 6
          WHEN 'Ready to Ship' THEN 7
          WHEN 'Shipped' THEN 8
          WHEN 'Arrived' THEN 9
          WHEN 'Closed' THEN 10
          ELSE 11
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
          .orWhereIn('status', ['In Milling', 'Docs In Prep', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed']);
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
      const revenue = parseFloat(o.contract_value) || 0;
      const orderCosts = costMap[o.id] || { total: 0, breakdown: {} };
      const grossProfit = revenue - orderCosts.total;
      const margin = revenue > 0 ? parseFloat(((grossProfit / revenue) * 100).toFixed(2)) : 0;
      const costPerMT = parseFloat(o.qty_mt) > 0 ? parseFloat((orderCosts.total / parseFloat(o.qty_mt)).toFixed(2)) : 0;

      return {
        id: o.id,
        orderNo: o.order_no,
        customerName: o.customer_name,
        country: o.country,
        productName: o.product_name,
        qtyMT: parseFloat(o.qty_mt),
        pricePerMT: parseFloat(o.price_per_mt),
        currency: o.currency,
        revenue,
        costs: orderCosts.total,
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
      const branPct = rawQty > 0 ? parseFloat((((parseFloat(b.bran_mt) || 0) / rawQty) * 100).toFixed(1)) : 0;

      return {
        id: b.id,
        batchNo: b.batch_no,
        supplierName: b.supplier_name,
        productName: b.product_name,
        rawQtyMT: rawQty,
        finishedQtyMT: parseFloat(b.actual_finished_mt) || 0,
        yieldPct: parseFloat(b.yield_pct) || 0,
        brokenPct,
        branPct,
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
        db.raw('COALESCE(AVG(mb.broken_mt / NULLIF(mb.raw_qty_mt, 0) * 100), 0) as avg_broken_pct'),
        db.raw('COALESCE(AVG(mb.bran_mt / NULLIF(mb.raw_qty_mt, 0) * 100), 0) as avg_bran_pct')
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
        avgBranPct: parseFloat(parseFloat(r.avg_bran_pct).toFixed(1)),
        benchmarkYield: benchmark ? parseFloat(benchmark.expected_yield_pct) : null,
        varianceFromBenchmark: benchmark ? parseFloat((avgYield - parseFloat(benchmark.expected_yield_pct)).toFixed(1)) : null,
      };
    });
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
};

module.exports = reportingService;
