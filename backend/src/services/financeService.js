/**
 * Centralized Finance Service — Single source of truth for all financial metrics.
 *
 * ACCOUNTING MODEL:
 * - Base currency: PKR
 * - Export orders: foreign currency (USD/GBP/EUR) converted to PKR using locked FX rate
 * - All profit computed in PKR first, then optionally converted to foreign for display
 * - FX gain/loss = (currentRate - lockedRate) × foreignAmount, shown separately
 * - No hardcoded rates — all from fxRateService or order's booked_fx_rate
 */
const db = require('../config/database');
const fxRateService = require('./fxRateService');
const commodityRateService = require('./commodityRateService');

// Categories in export_order_costs that are INTERNAL ALLOCATIONS (COGS), not vendor costs
const INTERNAL_COST_CATS = ['rice', 'raw_rice', 'milling'];

const financeService = {

  /**
   * Overview Summary — all key finance KPIs in one call.
   * Returns PKR-base values + foreign equivalents.
   */
  async getOverviewSummary({ startDate, endDate, entity } = {}) {
    const dateFilter = (query, dateCol) => {
      if (startDate) query = query.where(dateCol, '>=', startDate);
      if (endDate) query = query.where(dateCol, '<=', endDate);
      return query;
    };

    const currentFx = await fxRateService.getLatestRate('USD');
    const pkrRate = currentFx.rate;

    // ── Export metrics (all non-cancelled orders) ──
    let orderQuery = db('export_orders').whereNotIn('status', ['Cancelled']);
    if (startDate || endDate) orderQuery = dateFilter(orderQuery, 'created_at');

    // Check if new PKR columns exist (safe for pre-migration DBs)
    const hasPkrLocked = await db.schema.hasColumn('export_orders', 'contract_value_pkr_locked');

    const exportStats = await orderQuery.clone().select(
      db.raw("COUNT(*) as total_orders"),
      db.raw("COUNT(CASE WHEN status NOT IN ('Closed','Cancelled') THEN 1 END) as active_orders"),
      db.raw("COALESCE(SUM(contract_value), 0) as total_revenue_foreign"),
      db.raw(hasPkrLocked
        ? "COALESCE(SUM(contract_value_pkr_locked), 0) as total_revenue_pkr_booked"
        : "0 as total_revenue_pkr_booked"),
      db.raw("COALESCE(SUM(contract_value * COALESCE(booked_fx_rate, ?)), 0) as total_revenue_pkr_calc", [pkrRate]),
      db.raw("COALESCE(SUM(advance_received), 0) as total_advance_received"),
      db.raw("COALESCE(SUM(balance_received), 0) as total_balance_received"),
      db.raw("COALESCE(SUM(inventory_cogs_total_pkr), 0) as total_cogs_pkr"),
    ).first();

    // Revenue PKR: use stored locked value, fall back to calculated
    const revenuePkrBooked = parseFloat(exportStats.total_revenue_pkr_booked) || parseFloat(exportStats.total_revenue_pkr_calc) || 0;
    const revenueForeign = parseFloat(exportStats.total_revenue_foreign) || 0;
    const revenuePkrCurrent = revenueForeign * pkrRate;
    const fxGainLossTotal = revenuePkrCurrent - revenuePkrBooked;

    // Check if export_order_costs has the new currency columns
    const hasEocBasePkr = await db.schema.hasColumn('export_order_costs', 'base_amount_pkr');

    // Export operational costs (PKR) — exclude internal allocations
    const exportOpResult = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Cancelled'])
      .whereNotIn('eoc.category', INTERNAL_COST_CATS)
      .select(
        db.raw(hasEocBasePkr
          ? "COALESCE(SUM(CASE WHEN eoc.currency = 'PKR' THEN eoc.amount ELSE eoc.base_amount_pkr END), 0) as total_pkr"
          : "COALESCE(SUM(eoc.amount * ?), 0) as total_pkr", hasEocBasePkr ? [] : [pkrRate]),
        db.raw("COALESCE(SUM(eoc.amount), 0) as total_raw"),
      ).first();
    const exportOpCostsPkr = parseFloat(exportOpResult?.total_pkr) || (parseFloat(exportOpResult?.total_raw) || 0) * pkrRate;

    // Export COGS (PKR) — from rice allocation or locked COGS
    const cogsResult = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Cancelled'])
      .whereIn('eoc.category', INTERNAL_COST_CATS)
      .select(
        db.raw(hasEocBasePkr
          ? "COALESCE(SUM(CASE WHEN eoc.base_amount_pkr > 0 THEN eoc.base_amount_pkr ELSE eoc.amount * COALESCE(eoc.fx_rate, ?) END), 0) as total_pkr"
          : "COALESCE(SUM(eoc.amount * ?), 0) as total_pkr", [pkrRate]),
      ).first();
    const lockedCogsPkr = parseFloat(exportStats.total_cogs_pkr) || 0;
    const allocCogsPkr = parseFloat(cogsResult?.total_pkr) || 0;
    const exportCogsPkr = lockedCogsPkr > 0 ? lockedCogsPkr : allocCogsPkr;

    // Total export cost and profit — all in PKR
    const exportTotalCostPkr = exportOpCostsPkr + exportCogsPkr;
    const exportBookedProfitPkr = revenuePkrBooked - exportTotalCostPkr;
    const exportCurrentProfitPkr = revenuePkrCurrent - exportTotalCostPkr;
    const exportMarginPct = revenuePkrBooked > 0 ? (exportBookedProfitPkr / revenuePkrBooked * 100) : 0;

    // ── Mill metrics ──
    let batchQuery = db('milling_batches').where('status', 'Completed');
    if (startDate || endDate) batchQuery = dateFilter(batchQuery, 'completed_at');
    const batches = await batchQuery.select('*');
    const batchIds = batches.map(b => b.id);
    const batchCosts = batchIds.length > 0 ? await db('milling_costs').whereIn('batch_id', batchIds) : [];

    // Get commodity rates for mill revenue when prices not confirmed
    const millRates = await commodityRateService.getMillProductRates();

    let millRevenue = 0, millCost = 0, millPricesConfirmed = 0;
    for (const b of batches) {
      // Use batch-confirmed prices first, then commodity rate master, then 0
      const fp = parseFloat(b.finished_price_per_mt) || millRates.finished_rice || 0;
      const bp = parseFloat(b.broken_price_per_mt) || millRates.broken_rice || 0;
      const np = parseFloat(b.bran_price_per_mt) || millRates.bran || 0;
      const hp = parseFloat(b.husk_price_per_mt) || millRates.husk || 0;
      const usedConfirmed = !!b.prices_confirmed;
      const usedFallback = !usedConfirmed && (fp > 0 || bp > 0);

      millRevenue += (parseFloat(b.actual_finished_mt) || 0) * fp
        + (parseFloat(b.broken_mt) || 0) * bp
        + (parseFloat(b.bran_mt) || 0) * np
        + (parseFloat(b.husk_mt) || 0) * hp;
      if (usedConfirmed) millPricesConfirmed++;

      const bCosts = batchCosts.filter(c => c.batch_id === b.id);
      millCost += bCosts.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    }

    let ohQuery = db('mill_expenses');
    if (startDate || endDate) ohQuery = dateFilter(ohQuery, 'expense_date');
    const overheads = await ohQuery.sum('amount as total').first();
    const overheadTotal = parseFloat(overheads?.total) || 0;

    const millGrossProfit = millRevenue - millCost - overheadTotal;
    const millMargin = millRevenue > 0 ? (millGrossProfit / millRevenue * 100) : 0;

    // ── Receivables ──
    const hasRecvBasePkr = await db.schema.hasColumn('receivables', 'base_amount_pkr');
    const recvStats = await db('receivables').whereNot('status', 'Paid').select(
      db.raw("COUNT(*) as count"),
      db.raw("COALESCE(SUM(outstanding), 0) as total_outstanding"),
      db.raw(hasRecvBasePkr
        ? "COALESCE(SUM(base_amount_pkr), 0) as total_outstanding_pkr"
        : "COALESCE(SUM(outstanding * ?), 0) as total_outstanding_pkr", hasRecvBasePkr ? [] : [pkrRate]),
      db.raw("COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count"),
      db.raw("COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount"),
    ).first();

    // ── Payables ──
    const payStats = await db('payables').whereNot('status', 'Paid')
      .where(function () { this.where('payable_type', 'vendor').orWhereNull('payable_type'); })
      .select(
        db.raw("COUNT(*) as count"),
        db.raw("COALESCE(SUM(outstanding), 0) as total_outstanding"),
        db.raw("COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count"),
        db.raw("COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount"),
      ).first();

    const totalPayPKR = parseFloat(payStats?.total_outstanding) || 0;

    // ── Bank ──
    const bankTotal = await db('bank_accounts').sum('current_balance as total').first();
    const bankBalancePKR = parseFloat(bankTotal?.total) || 0;

    // ── Collection rate ──
    const totalExpected = await db('receivables').sum('expected_amount as total').first();
    const totalReceived = await db('receivables').sum('received_amount as total').first();
    const collectionRate = parseFloat(totalExpected?.total) > 0
      ? (parseFloat(totalReceived?.total) / parseFloat(totalExpected?.total) * 100) : 0;

    // ── Consolidated profit (PKR) ──
    const consolidatedProfitPkr = exportBookedProfitPkr + millGrossProfit;

    return {
      asOfTimestamp: new Date().toISOString(),
      baseCurrency: 'PKR',
      currentFxRate: pkrRate,
      fxRateSource: currentFx.source,
      export: {
        totalOrders: parseInt(exportStats.total_orders),
        activeOrders: parseInt(exportStats.active_orders),
        revenueForeign: revenueForeign,
        revenueForeignCurrency: 'USD',
        revenuePkrBooked: revenuePkrBooked,
        revenuePkrCurrent: revenuePkrCurrent,
        operationalCostsPkr: exportOpCostsPkr,
        cogsPkr: exportCogsPkr,
        totalCostPkr: exportTotalCostPkr,
        bookedProfitPkr: exportBookedProfitPkr,
        currentProfitPkr: exportCurrentProfitPkr,
        fxGainLossPkr: fxGainLossTotal,
        marginPct: parseFloat(exportMarginPct.toFixed(1)),
        // Foreign equivalents for display
        bookedProfitForeign: revenuePkrBooked > 0 ? exportBookedProfitPkr / (revenuePkrBooked / revenueForeign) : 0,
        calculationStatus: exportCogsPkr > 0 ? 'exact' : (exportOpCostsPkr > 0 ? 'operational_margin_only' : 'no_costs'),
      },
      mill: {
        batchCount: batches.length,
        pricesConfirmed: millPricesConfirmed,
        priceSource: millPricesConfirmed === batches.length ? 'confirmed' : (millRates.finished_rice ? 'commodity_rate_master' : 'none'),
        revenue: millRevenue,
        directCosts: millCost,
        overheads: overheadTotal,
        grossProfit: millGrossProfit,
        marginPct: parseFloat(millMargin.toFixed(1)),
        currency: 'PKR',
      },
      consolidated: {
        profitPkr: consolidatedProfitPkr,
        profitForeign: consolidatedProfitPkr / pkrRate,
        fxGainLossPkr: fxGainLossTotal,
      },
      receivables: {
        count: parseInt(recvStats.count),
        totalOutstandingForeign: parseFloat(recvStats.total_outstanding),
        totalOutstandingPkr: parseFloat(recvStats.total_outstanding_pkr) || (parseFloat(recvStats.total_outstanding) * pkrRate),
        overdueCount: parseInt(recvStats.overdue_count),
        overdueAmountForeign: parseFloat(recvStats.overdue_amount),
      },
      payables: {
        count: parseInt(payStats.count),
        totalOutstandingPkr: totalPayPKR,
        overdueCount: parseInt(payStats.overdue_count),
        overdueAmountPkr: parseFloat(payStats.overdue_amount),
      },
      cashPosition: {
        bankBalancePkr: bankBalancePKR,
        currency: 'PKR',
      },
      collectionRate: parseFloat(collectionRate.toFixed(1)),
      warnings: [
        ...(millPricesConfirmed < batches.length && !millRates.finished_rice ? [`${batches.length - millPricesConfirmed} batch(es) have unconfirmed prices and no commodity rates — mill revenue may be zero`] : []),
        ...(millPricesConfirmed < batches.length && millRates.finished_rice ? [`${batches.length - millPricesConfirmed} batch(es) using commodity rate master prices (not confirmed batch prices)`] : []),
        ...(exportCogsPkr === 0 && parseInt(exportStats.active_orders) > 0 ? ['Export COGS not yet locked — profit shows operational margin only'] : []),
        ...(currentFx.source === 'system_settings_fallback' ? ['FX rate from system default — no current rate in fx_rates table'] : []),
      ],
    };
  },

  /**
   * Profitability Summary — per-order and per-batch breakdown, all in PKR.
   */
  async getProfitabilitySummary({ startDate, endDate } = {}) {
    const currentFx = await fxRateService.getLatestRate('USD');
    const pkrRate = currentFx.rate;

    const orders = await db('export_orders').whereNotIn('status', ['Cancelled']).select('*');
    const orderIds = orders.map(o => o.id);
    const allCosts = orderIds.length > 0 ? await db('export_order_costs').whereIn('order_id', orderIds) : [];

    const exportRows = orders.map(o => {
      const orderCosts = allCosts.filter(c => c.order_id === o.id);
      const lockedRate = parseFloat(o.booked_fx_rate) || pkrRate;
      const revenue = parseFloat(o.contract_value) || 0;
      const revenuePkrBooked = parseFloat(o.contract_value_pkr_locked) || (revenue * lockedRate);
      const revenuePkrCurrent = revenue * pkrRate;

      // Op costs in PKR
      const opCostsPkr = orderCosts
        .filter(c => !INTERNAL_COST_CATS.includes(c.category))
        .reduce((s, c) => {
          const pkr = parseFloat(c.base_amount_pkr) || (parseFloat(c.amount) || 0) * (parseFloat(c.fx_rate) || lockedRate);
          return s + pkr;
        }, 0);

      // COGS in PKR
      const lockedCogsPkr = parseFloat(o.inventory_cogs_total_pkr) || 0;
      const allocCogsPkr = orderCosts
        .filter(c => INTERNAL_COST_CATS.includes(c.category))
        .reduce((s, c) => {
          const pkr = parseFloat(c.base_amount_pkr) || (parseFloat(c.amount) || 0) * (parseFloat(c.fx_rate) || lockedRate);
          return s + pkr;
        }, 0);
      const cogsPkr = lockedCogsPkr > 0 ? lockedCogsPkr : allocCogsPkr;

      const totalCostPkr = opCostsPkr + cogsPkr;
      const bookedProfitPkr = revenuePkrBooked - totalCostPkr;
      const currentProfitPkr = revenuePkrCurrent - totalCostPkr;
      const fxGainLoss = revenuePkrCurrent - revenuePkrBooked;
      const marginPct = revenuePkrBooked > 0 ? (bookedProfitPkr / revenuePkrBooked * 100) : 0;

      return {
        id: o.id, orderNo: o.order_no, status: o.status,
        currency: o.currency || 'USD',
        contractValueForeign: revenue,
        bookedFxRate: lockedRate,
        currentFxRate: pkrRate,
        revenuePkrBooked,
        revenuePkrCurrent,
        opCostsPkr,
        cogsPkr,
        totalCostPkr,
        bookedProfitPkr,
        currentProfitPkr,
        fxGainLossPkr: fxGainLoss,
        marginPct: parseFloat(marginPct.toFixed(1)),
        hasCOGS: cogsPkr > 0,
        calculationStatus: cogsPkr > 0 ? 'exact' : (opCostsPkr > 0 ? 'operational_margin_only' : 'no_costs'),
      };
    });

    // Mill batches (all PKR)
    const millRates = await commodityRateService.getMillProductRates();
    const batches = await db('milling_batches').where('status', 'Completed').select('*');
    const batchIds = batches.map(b => b.id);
    const batchCosts = batchIds.length > 0 ? await db('milling_costs').whereIn('batch_id', batchIds) : [];

    const millRows = batches.map(b => {
      const costs = batchCosts.filter(c => c.batch_id === b.id).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      const fp = parseFloat(b.finished_price_per_mt) || millRates.finished_rice || 0;
      const bp = parseFloat(b.broken_price_per_mt) || millRates.broken_rice || 0;
      const np = parseFloat(b.bran_price_per_mt) || millRates.bran || 0;
      const hp = parseFloat(b.husk_price_per_mt) || millRates.husk || 0;
      const revenue = (parseFloat(b.actual_finished_mt) || 0) * fp + (parseFloat(b.broken_mt) || 0) * bp
        + (parseFloat(b.bran_mt) || 0) * np + (parseFloat(b.husk_mt) || 0) * hp;
      const profit = revenue - costs;
      return {
        id: b.id, batchNo: b.batch_no, status: b.status,
        rawQtyMT: parseFloat(b.raw_qty_mt), finishedMT: parseFloat(b.actual_finished_mt),
        yieldPct: parseFloat(b.yield_pct), revenue, costs, grossProfit: profit,
        marginPct: revenue > 0 ? parseFloat((profit / revenue * 100).toFixed(1)) : 0,
        pricesConfirmed: !!b.prices_confirmed,
        priceSource: b.prices_confirmed ? 'confirmed' : (millRates.finished_rice ? 'commodity_rates' : 'none'),
        calculationStatus: b.prices_confirmed ? 'exact' : (millRates.finished_rice ? 'estimated' : 'missing_prices'),
        currency: 'PKR',
      };
    });

    return {
      asOfTimestamp: new Date().toISOString(),
      baseCurrency: 'PKR',
      currentFxRate: pkrRate,
      export: {
        rows: exportRows,
        totalBookedProfitPkr: exportRows.reduce((s, r) => s + r.bookedProfitPkr, 0),
        totalFxGainLossPkr: exportRows.reduce((s, r) => s + r.fxGainLossPkr, 0),
      },
      mill: {
        rows: millRows,
        totalProfitPkr: millRows.reduce((s, r) => s + r.grossProfit, 0),
      },
    };
  },
};

module.exports = financeService;
