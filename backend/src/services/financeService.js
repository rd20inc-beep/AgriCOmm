/**
 * Centralized Finance Service — Single source of truth for all financial metrics.
 * No frontend page should compute profit/revenue/COGS independently.
 *
 * CURRENCY RULES:
 * - export_orders.contract_value = USD
 * - export_order_costs.amount = USD (pre-converted from PKR at booking)
 * - export_order_costs.rice = internal allocation (COGS), NOT operational expense
 * - milling_costs = PKR
 * - mill_expenses = PKR
 * - inventory_cogs_total_pkr = PKR (if populated)
 * - All mill P&L in PKR, all export P&L in USD
 * - Combined profit converts mill PKR→USD using pkrRate
 *
 * PROFIT FORMULA:
 *   Export: revenue(USD) - opCosts(USD, excl rice) - COGS(USD)
 *   where COGS = max(rice allocation, inventory_cogs_total_pkr/rate)
 *   Mill: batchRevenue(PKR) - batchCosts(PKR) - overheads(PKR)
 */
const db = require('../config/database');

// Categories in export_order_costs that are INTERNAL ALLOCATIONS, not vendor costs
const INTERNAL_COST_CATS = ['rice', 'raw_rice', 'milling'];

const financeService = {

  /**
   * Overview Summary — all key finance KPIs in one call
   */
  async getOverviewSummary({ startDate, endDate, entity } = {}) {
    const dateFilter = (query, dateCol) => {
      if (startDate) query = query.where(dateCol, '>=', startDate);
      if (endDate) query = query.where(dateCol, '<=', endDate);
      return query;
    };

    // Settings
    const pkrRateSetting = await db('system_settings').where('key', 'pkr_rate').first();
    const pkrRate = parseFloat(pkrRateSetting?.value) || 280;

    // Export metrics — ALL non-cancelled orders (revenue and costs must use same scope)
    let orderQuery = db('export_orders').whereNotIn('status', ['Cancelled']);
    if (startDate || endDate) orderQuery = dateFilter(orderQuery, 'created_at');

    const exportStats = await orderQuery.clone().select(
      db.raw("COUNT(*) as total_orders"),
      db.raw("COUNT(CASE WHEN status NOT IN ('Closed','Cancelled') THEN 1 END) as active_orders"),
      db.raw("COALESCE(SUM(contract_value), 0) as total_revenue"),
      db.raw("COALESCE(SUM(advance_received), 0) as total_advance_received"),
      db.raw("COALESCE(SUM(balance_received), 0) as total_balance_received"),
      db.raw("COALESCE(SUM(inventory_cogs_total_pkr), 0) as total_cogs_pkr"),
    ).first();

    // Export operational costs (USD) — EXCLUDE internal allocations (rice/raw_rice/milling)
    const exportOpCostsResult = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Cancelled'])
      .whereNotIn('eoc.category', INTERNAL_COST_CATS)
      .sum('eoc.amount as total')
      .first();
    const exportOpCosts = parseFloat(exportOpCostsResult?.total) || 0;

    // Export COGS — from rice allocation in export_order_costs (USD-equivalent)
    const exportCOGSResult = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Cancelled'])
      .whereIn('eoc.category', INTERNAL_COST_CATS)
      .sum('eoc.amount as total')
      .first();
    const exportCOGSFromAlloc = parseFloat(exportCOGSResult?.total) || 0;

    // If inventory_cogs_total_pkr is populated, prefer it; otherwise use allocation
    const exportCOGSPkr = parseFloat(exportStats.total_cogs_pkr) || 0;
    const exportCOGSUsd = exportCOGSPkr > 0 ? (exportCOGSPkr / pkrRate) : exportCOGSFromAlloc;

    // Mill metrics — use batch-confirmed prices only
    let batchQuery = db('milling_batches').where('status', 'Completed');
    if (startDate || endDate) batchQuery = dateFilter(batchQuery, 'completed_at');

    const batches = await batchQuery.select('*');
    const batchIds = batches.map(b => b.id);

    const batchCosts = batchIds.length > 0
      ? await db('milling_costs').whereIn('batch_id', batchIds)
      : [];

    let millRevenue = 0, millCost = 0, millPricesConfirmed = 0, millBatchCount = batches.length;
    for (const b of batches) {
      const fp = parseFloat(b.finished_price_per_mt) || 0;
      const bp = parseFloat(b.broken_price_per_mt) || 0;
      const np = parseFloat(b.bran_price_per_mt) || 0;
      const hp = parseFloat(b.husk_price_per_mt) || 0;
      millRevenue += (parseFloat(b.actual_finished_mt) || 0) * fp
        + (parseFloat(b.broken_mt) || 0) * bp
        + (parseFloat(b.bran_mt) || 0) * np
        + (parseFloat(b.husk_mt) || 0) * hp;
      if (b.prices_confirmed) millPricesConfirmed++;
      const bCosts = batchCosts.filter(c => c.batch_id === b.id);
      millCost += bCosts.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    }

    // Overheads
    let ohQuery = db('mill_expenses');
    if (startDate || endDate) ohQuery = dateFilter(ohQuery, 'expense_date');
    const overheads = await ohQuery.sum('amount as total').first();
    const overheadTotal = parseFloat(overheads?.total) || 0;

    // Receivables & Payables
    const recvStats = await db('receivables').whereNot('status', 'Paid').select(
      db.raw("COUNT(*) as count"),
      db.raw("COALESCE(SUM(outstanding), 0) as total_outstanding"),
      db.raw("COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count"),
      db.raw("COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount"),
    ).first();

    const payStats = await db('payables').whereNot('status', 'Paid')
      .where(function () { this.where('payable_type', 'vendor').orWhereNull('payable_type'); })
      .select(
        db.raw("COUNT(*) as count"),
        db.raw("COALESCE(SUM(outstanding), 0) as total_outstanding"),
        db.raw("COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count"),
        db.raw("COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount"),
      ).first();

    const millPay = await db('payables').whereNot('status', 'Paid').where('entity', 'mill').sum('outstanding as total').first();
    const exportOpsPay = await db('payables').whereNot('status', 'Paid').where('entity', 'export').sum('outstanding as total').first();
    const totalMillPayPKR = parseFloat(millPay?.total) || 0;
    const totalExportOpsPayPKR = parseFloat(exportOpsPay?.total) || 0;
    const totalPayPKR = totalMillPayPKR + totalExportOpsPayPKR;

    // Bank position
    const bankTotal = await db('bank_accounts').sum('current_balance as total').first();

    // Compute export profit (all USD)
    const exportRevenue = parseFloat(exportStats.total_revenue) || 0;
    const exportGrossProfit = exportRevenue - exportOpCosts - exportCOGSUsd;
    const exportMargin = exportRevenue > 0 ? (exportGrossProfit / exportRevenue * 100) : 0;

    // Mill profit (all PKR)
    const millGrossProfit = millRevenue - millCost - overheadTotal;
    const millMargin = millRevenue > 0 ? (millGrossProfit / millRevenue * 100) : 0;

    // Collection rate
    const totalExpected = await db('receivables').sum('expected_amount as total').first();
    const totalReceived = await db('receivables').sum('received_amount as total').first();
    const collectionRate = parseFloat(totalExpected?.total) > 0
      ? (parseFloat(totalReceived?.total) / parseFloat(totalExpected?.total) * 100) : 0;

    return {
      asOfTimestamp: new Date().toISOString(),
      pkrRate,
      export: {
        totalOrders: parseInt(exportStats.total_orders),
        activeOrders: parseInt(exportStats.active_orders),
        revenue: exportRevenue,
        operationalCosts: exportOpCosts,
        cogs: exportCOGSUsd,
        grossProfit: exportGrossProfit,
        marginPct: parseFloat(exportMargin.toFixed(1)),
        calculationStatus: exportCOGSUsd > 0 ? 'exact' : 'operational_margin_only',
      },
      mill: {
        batchCount: millBatchCount,
        pricesConfirmed: millPricesConfirmed,
        revenue: millRevenue,
        directCosts: millCost,
        overheads: overheadTotal,
        grossProfit: millGrossProfit,
        marginPct: parseFloat(millMargin.toFixed(1)),
        calculationStatus: millPricesConfirmed === millBatchCount ? 'exact' : (millPricesConfirmed > 0 ? 'partial' : 'missing_prices'),
      },
      receivables: {
        count: parseInt(recvStats.count),
        totalOutstanding: parseFloat(recvStats.total_outstanding),
        overdueCount: parseInt(recvStats.overdue_count),
        overdueAmount: parseFloat(recvStats.overdue_amount),
      },
      payables: {
        count: parseInt(payStats.count),
        totalOutstandingPKR: totalPayPKR,
        millPayablesPKR: totalMillPayPKR,
        exportOpsPayablesPKR: totalExportOpsPayPKR,
        totalOutstandingUSD: totalPayPKR / pkrRate,
        overdueCount: parseInt(payStats.overdue_count),
        overdueAmount: parseFloat(payStats.overdue_amount),
      },
      cashPosition: {
        bankBalance: parseFloat(bankTotal?.total) || 0,
        bankBalanceCurrency: 'PKR',
      },
      collectionRate: parseFloat(collectionRate.toFixed(1)),
      warnings: [
        ...(millPricesConfirmed < millBatchCount ? [`${millBatchCount - millPricesConfirmed} batch(es) have unconfirmed prices — mill revenue may be understated`] : []),
        ...(exportCOGSUsd === 0 && parseInt(exportStats.active_orders) > 0 ? ['Export COGS not yet locked — profit shows operational margin only'] : []),
      ],
    };
  },

  /**
   * Profitability Summary — per-order and per-batch breakdown
   */
  async getProfitabilitySummary({ startDate, endDate } = {}) {
    const pkrRateSetting = await db('system_settings').where('key', 'pkr_rate').first();
    const pkrRate = parseFloat(pkrRateSetting?.value) || 280;

    // Export orders
    const orders = await db('export_orders').whereNotIn('status', ['Cancelled']).select('*');
    const orderIds = orders.map(o => o.id);
    const allCosts = orderIds.length > 0 ? await db('export_order_costs').whereIn('order_id', orderIds) : [];

    const exportRows = orders.map(o => {
      const orderCosts = allCosts.filter(c => c.order_id === o.id);
      // Operational costs = exclude internal allocations (rice/milling)
      const opCosts = orderCosts
        .filter(c => !INTERNAL_COST_CATS.includes(c.category))
        .reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      // COGS = rice allocation (already USD-equivalent) OR locked COGS
      const lockedCogsPkr = parseFloat(o.inventory_cogs_total_pkr) || 0;
      const allocCogs = orderCosts
        .filter(c => INTERNAL_COST_CATS.includes(c.category))
        .reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      const cogs = lockedCogsPkr > 0 ? (lockedCogsPkr / (parseFloat(o.booked_fx_rate) || pkrRate)) : allocCogs;

      const totalCost = opCosts + cogs;
      const revenue = parseFloat(o.contract_value) || 0;
      const profit = revenue - totalCost;
      const margin = revenue > 0 ? (profit / revenue * 100) : 0;

      return {
        id: o.id, orderNo: o.order_no, status: o.status,
        contractValue: revenue,
        operationalCosts: opCosts,
        cogs,
        totalCost,
        grossProfit: profit,
        marginPct: parseFloat(margin.toFixed(1)),
        hasCOGS: cogs > 0,
        bookedFxRate: parseFloat(o.booked_fx_rate) || null,
        calculationStatus: cogs > 0 ? 'exact' : (opCosts > 0 ? 'operational_margin_only' : 'no_costs'),
      };
    });

    // Mill batches
    const batches = await db('milling_batches').where('status', 'Completed').select('*');
    const batchIds = batches.map(b => b.id);
    const batchCosts = batchIds.length > 0 ? await db('milling_costs').whereIn('batch_id', batchIds) : [];

    const millRows = batches.map(b => {
      const costs = batchCosts.filter(c => c.batch_id === b.id).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      const fp = parseFloat(b.finished_price_per_mt) || 0;
      const bp = parseFloat(b.broken_price_per_mt) || 0;
      const np = parseFloat(b.bran_price_per_mt) || 0;
      const hp = parseFloat(b.husk_price_per_mt) || 0;
      const revenue = (parseFloat(b.actual_finished_mt) || 0) * fp + (parseFloat(b.broken_mt) || 0) * bp
        + (parseFloat(b.bran_mt) || 0) * np + (parseFloat(b.husk_mt) || 0) * hp;
      const profit = revenue - costs;
      return {
        id: b.id, batchNo: b.batch_no, status: b.status,
        rawQtyMT: parseFloat(b.raw_qty_mt), finishedMT: parseFloat(b.actual_finished_mt),
        yieldPct: parseFloat(b.yield_pct), revenue, costs, grossProfit: profit,
        marginPct: revenue > 0 ? parseFloat((profit / revenue * 100).toFixed(1)) : 0,
        pricesConfirmed: !!b.prices_confirmed,
        calculationStatus: b.prices_confirmed ? 'exact' : 'missing_prices',
      };
    });

    return {
      asOfTimestamp: new Date().toISOString(),
      pkrRate,
      export: { rows: exportRows, totalProfit: exportRows.reduce((s, r) => s + r.grossProfit, 0) },
      mill: { rows: millRows, totalProfit: millRows.reduce((s, r) => s + r.grossProfit, 0) },
    };
  },
};

module.exports = financeService;
