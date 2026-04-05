/**
 * Centralized Finance Service — Single source of truth for all financial metrics.
 * No frontend page should compute profit/revenue/COGS independently.
 */
const db = require('../config/database');

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

    // Export metrics
    let orderQuery = db('export_orders').whereNotIn('status', ['Cancelled']);
    if (startDate || endDate) orderQuery = dateFilter(orderQuery, 'created_at');

    const exportStats = await orderQuery.clone().select(
      db.raw("COUNT(*) as total_orders"),
      db.raw("COUNT(CASE WHEN status NOT IN ('Closed','Cancelled') THEN 1 END) as active_orders"),
      db.raw("COALESCE(SUM(CASE WHEN status = 'Closed' THEN contract_value END), 0) as closed_revenue"),
      db.raw("COALESCE(SUM(contract_value), 0) as total_contract_value"),
      db.raw("COALESCE(SUM(advance_received), 0) as total_advance_received"),
      db.raw("COALESCE(SUM(balance_received), 0) as total_balance_received"),
      db.raw("COALESCE(SUM(inventory_cogs_total_pkr), 0) as total_cogs_pkr"),
    ).first();

    // Export costs
    const exportCosts = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Cancelled'])
      .sum('eoc.amount as total')
      .first();

    // Mill metrics — use batch-confirmed prices only
    let batchQuery = db('milling_batches').where('status', 'Completed');
    if (startDate || endDate) batchQuery = dateFilter(batchQuery, 'completed_at');

    const batches = await batchQuery.select('*');
    const batchIds = batches.map(b => b.id);

    // Batch costs from milling_costs table
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

    const payStats = await db('payables').whereNot('status', 'Paid').select(
      db.raw("COUNT(*) as count"),
      db.raw("COALESCE(SUM(outstanding), 0) as total_outstanding"),
      db.raw("COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count"),
      db.raw("COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount"),
    ).first();

    // Bank position
    const bankTotal = await db('bank_accounts').sum('current_balance as total').first();

    // Settings
    const pkrRateSetting = await db('system_settings').where('key', 'pkr_rate').first();
    const pkrRate = parseFloat(pkrRateSetting?.value) || 280;

    // Compute
    const exportRevenue = parseFloat(exportStats.closed_revenue) || 0;
    const exportOpCosts = parseFloat(exportCosts?.total) || 0;
    const exportCOGSPkr = parseFloat(exportStats.total_cogs_pkr) || 0;
    const exportCOGSUsd = exportCOGSPkr / pkrRate;
    const exportGrossProfit = exportRevenue - exportOpCosts - exportCOGSUsd;
    const exportMargin = exportRevenue > 0 ? (exportGrossProfit / exportRevenue * 100) : 0;

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
        inventoryCOGS: exportCOGSUsd,
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
        totalOutstanding: parseFloat(payStats.total_outstanding),
        overdueCount: parseInt(payStats.overdue_count),
        overdueAmount: parseFloat(payStats.overdue_amount),
      },
      cashPosition: {
        bankBalance: parseFloat(bankTotal?.total) || 0,
      },
      collectionRate: parseFloat(collectionRate.toFixed(1)),
      warnings: [
        ...(millPricesConfirmed < millBatchCount ? [`${millBatchCount - millPricesConfirmed} batch(es) have unconfirmed prices — mill revenue may be understated`] : []),
        ...(exportCOGSPkr === 0 && parseInt(exportStats.active_orders) > 0 ? ['Export COGS not yet locked — profit shows operational margin only'] : []),
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
      const opCosts = allCosts.filter(c => c.order_id === o.id).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      const cogsUsd = (parseFloat(o.inventory_cogs_total_pkr) || 0) / pkrRate;
      const totalCost = opCosts + cogsUsd;
      const profit = (parseFloat(o.contract_value) || 0) - totalCost;
      const margin = parseFloat(o.contract_value) > 0 ? (profit / parseFloat(o.contract_value) * 100) : 0;
      return {
        id: o.id, orderNo: o.order_no, status: o.status,
        contractValue: parseFloat(o.contract_value) || 0,
        operationalCosts: opCosts, inventoryCOGS: cogsUsd, totalCost,
        grossProfit: profit, marginPct: parseFloat(margin.toFixed(1)),
        hasCOGS: cogsUsd > 0,
        calculationStatus: cogsUsd > 0 ? 'exact' : 'operational_margin_only',
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
