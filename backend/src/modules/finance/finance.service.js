/**
 * Centralized Finance Service — Single source of truth for all financial metrics.
 *
 * ACCOUNTING MODEL:
 * - Base currency: PKR
 * - Export orders: foreign currency (USD/GBP/EUR) converted to PKR using locked FX rate
 * - All profit computed in PKR first, then optionally converted to foreign for display
 * - Profit (export Booked / Realised / Pipeline / FX, mill, local, consolidated)
 *   comes from ONE place: ./profitDefinitions.js (owner decisions G-2 / G-3).
 * - FX gain/loss = PKR actually received − the same foreign amount at the
 *   booked rate (realised), shown beside profit, never inside it.
 */
const db = require('../../config/database');
const fxRateService = require('./fxRate.service');
const { profitDefinitions, millBatchRows } = require('./profitDefinitions');

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

    // ── Profit: one definition for every tile (profitDefinitions.js) ──
    const defs = await profitDefinitions(db, { startDate, endDate, currentFxRate: pkrRate });
    const et = defs.export;

    // ── Export counts (not profit) — all non-cancelled orders in the period ──
    let orderQuery = db('export_orders').whereNotIn('status', ['Cancelled']);
    if (startDate || endDate) orderQuery = dateFilter(orderQuery, 'created_at');
    const exportStats = await orderQuery.clone().select(
      db.raw("COUNT(*) as total_orders"),
      db.raw("COUNT(CASE WHEN status NOT IN ('Closed','Cancelled') THEN 1 END) as active_orders"),
      // Pre-shipment = workflow stages before COGS gets locked at dispatch
      db.raw("COUNT(CASE WHEN status IN ('Draft','Awaiting Advance','Advance Received','Procurement Pending','In Milling','Docs In Preparation','Awaiting Balance','Ready to Ship') THEN 1 END) as pre_shipment_orders"),
      db.raw("COUNT(CASE WHEN status IN ('Shipped','Arrived','Closed') THEN 1 END) as shipped_orders"),
      db.raw("COUNT(CASE WHEN status IN ('Shipped','Arrived','Closed') AND (inventory_cogs_total_pkr IS NULL OR inventory_cogs_total_pkr = 0) THEN 1 END) as shipped_missing_cogs"),
      db.raw("COALESCE(SUM(contract_value), 0) as total_revenue_foreign"),
    ).first();
    const revenueForeign = parseFloat(exportStats.total_revenue_foreign) || 0;
    const confirmedRevenuePkr = defs.exportRows.reduce((s, r) => s + (r.revenuePkr || 0), 0);

    // ── Mill: completed batches in the period (count only — mill PROFIT is
    // sales of mill output − their COGS, from profitDefinitions) ──
    let batchQuery = db('milling_batches').where('status', 'Completed');
    if (startDate || endDate) batchQuery = dateFilter(batchQuery, 'completed_at');
    const batchCountRow = await batchQuery.count('id as count').first();
    const batchCount = parseInt(batchCountRow?.count, 10) || 0;

    // Unsold mill output is stock, carried at cost — shown beside the profit,
    // never in it. Point-in-time (today), company-owned only.
    const millStock = await db('inventory_lots')
      .where('entity', 'mill').whereIn('type', ['finished', 'byproduct'])
      .where('qty', '>', 0).whereNot('status', 'Closed')
      .whereRaw("COALESCE(ownership, 'company') <> 'client'")
      .select(db.raw('COALESCE(SUM(qty * COALESCE(NULLIF(landed_cost_per_kg, 0), cost_per_unit, 0)), 0) as value'))
      .first();

    // Mill overheads (mill_expenses) in the period — a period expense the GL
    // P&L carries; reported here for reference, NOT deducted from mill profit.
    let ohQuery = db('mill_expenses');
    if (startDate || endDate) ohQuery = dateFilter(ohQuery, 'expense_date');
    const overheads = await ohQuery.sum('amount as total').first();
    const overheadTotal = parseFloat(overheads?.total) || 0;

    // ── Local sales: collection figures over ALL local sales; profit over the
    // sales that are not mill output (those are in the mill segment). ──
    let localQuery = db('local_sales').whereNotIn('status', ['Cancelled', 'Voided', 'Returned', 'Pending']);
    if (startDate || endDate) localQuery = dateFilter(localQuery, 'sale_date');
    const localStats = await localQuery.clone().select(
      db.raw("COUNT(*) AS sale_count"),
      db.raw("COUNT(CASE WHEN status = 'Completed' THEN 1 END) AS completed_count"),
      db.raw("COALESCE(SUM(total_amount), 0) AS revenue_pkr"),
      db.raw("COALESCE(SUM(paid_amount), 0) AS collected_pkr"),
      db.raw("COALESCE(SUM(due_amount), 0) AS outstanding_pkr"),
    ).first();

    // ── Receivables ──
    // Exclude local-sale receivables (local_sale_id set): those are already
    // captured in the `local` KPI above from local_sales.due_amount, so counting
    // them here too would double the same debt across the two KPIs.
    // Per currency, in each receivable's OWN currency, from what is still
    // OUTSTANDING (not the full booked base_amount_pkr). A rupee receivable
    // (e.g. a PKR opening balance) is never added into the dollar figure.
    const recvRows = await db('receivables').whereNot('status', 'Paid').whereNull('local_sale_id')
      .select(
        db.raw("COALESCE(currency, 'PKR') as currency"),
        db.raw('COUNT(*) as count'),
        db.raw('COALESCE(SUM(outstanding), 0) as outstanding'),
        db.raw('COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) as overdue_count'),
        db.raw('COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN outstanding END), 0) as overdue_amount'),
      )
      .groupByRaw("COALESCE(currency, 'PKR')");
    const recvByCurrency = {};
    let recvCount = 0; let recvOverdueCount = 0;
    for (const r of Array.isArray(recvRows) ? recvRows : []) {
      const cur = String(r.currency || 'PKR').toUpperCase();
      recvByCurrency[cur] = {
        count: parseInt(r.count, 10) || 0,
        outstanding: parseFloat(r.outstanding) || 0,
        overdueCount: parseInt(r.overdue_count, 10) || 0,
        overdueAmount: parseFloat(r.overdue_amount) || 0,
      };
      recvCount += recvByCurrency[cur].count;
      recvOverdueCount += recvByCurrency[cur].overdueCount;
    }
    const recvCur = (c) => recvByCurrency[c] || { count: 0, outstanding: 0, overdueCount: 0, overdueAmount: 0 };

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
    // Per-currency totals — a USD balance is not a rupee figure, so the two are
    // never added together (no FX conversion here). Inactive accounts are
    // still counted, matching Finance ▸ Cash, since they can hold money.
    const bankRows = await db('bank_accounts')
      .select(db.raw("COALESCE(currency, 'PKR') as currency"))
      .sum('current_balance as total')
      .count('id as count')
      .groupByRaw("COALESCE(currency, 'PKR')");
    const bankByCurrency = {};
    let bankAccountCount = 0;
    for (const r of bankRows || []) {
      bankByCurrency[r.currency] = parseFloat(r.total) || 0;
      bankAccountCount += parseInt(r.count, 10) || 0;
    }
    const bankBalancePKR = bankByCurrency.PKR || 0;
    const bankBalanceUSD = bankByCurrency.USD || 0;

    // ── Collection rate ──
    // Received ÷ expected, per currency — dollars and rupees are never summed.
    // The single `collectionRate` is only given when one currency is present;
    // with more than one it is null and the per-currency rates stand.
    const collRows = await db('receivables')
      .select(db.raw("COALESCE(currency, 'PKR') as currency"))
      .sum('expected_amount as expected')
      .sum('received_amount as received')
      .groupByRaw("COALESCE(currency, 'PKR')");
    const collectionRateByCurrency = {};
    for (const r of Array.isArray(collRows) ? collRows : []) {
      const exp = parseFloat(r.expected) || 0;
      if (exp <= 0) continue;
      collectionRateByCurrency[String(r.currency || 'PKR').toUpperCase()] = parseFloat(((parseFloat(r.received) || 0) / exp * 100).toFixed(1));
    }
    const collCurrencies = Object.keys(collectionRateByCurrency);
    const collectionRate = collCurrencies.length === 1 ? collectionRateByCurrency[collCurrencies[0]]
      : collCurrencies.length === 0 ? 0 : null;

    const exportCalc = et.unpricedCount > 0 ? 'incomplete' : (et.estimatedCount > 0 ? 'estimated' : 'exact');

    return {
      asOfTimestamp: new Date().toISOString(),
      baseCurrency: 'PKR',
      currentFxRate: pkrRate,
      fxRateSource: currentFx.source,
      period: defs.period,
      export: {
        totalOrders: parseInt(exportStats.total_orders),
        activeOrders: parseInt(exportStats.active_orders),
        // Confirmed orders (not Draft / Cancelled) the profit figures cover.
        confirmedOrders: et.orderCount,
        revenueForeign: revenueForeign,
        revenueForeignCurrency: 'USD',
        // Booked PKR contract value of the confirmed orders (locked / booked rate).
        revenuePkrBooked: confirmedRevenuePkr,
        operationalCostsPkr: et.opCostsPkr,
        cogsPkr: et.riceCostPkr,
        totalCostPkr: et.opCostsPkr + et.riceCostPkr,
        // G-2: Booked / Realised / Pipeline / FX — see profitDefinitions.js.
        bookedProfitPkr: et.bookedPkr,
        realisedProfitPkr: et.realisedPkr,
        pipelineProfitPkr: et.pipelinePkr,
        fxGainLossPkr: et.fxRealisedPkr,
        fxOpenRevaluationPkr: et.fxOpenRevaluationPkr,
        unpricedCount: et.unpricedCount,
        unpricedRevenuePkr: et.unpricedRevenuePkr,
        estimatedCount: et.estimatedCount,
        realisedCount: et.realisedCount,
        realisedUnpricedCount: et.realisedUnpricedCount,
        marginPct: et.bookedMarginPct,
        calculationStatus: exportCalc,
        // COGS lifecycle breakdown — see warnings for explanation.
        cogsStatus: {
          preShipment: parseInt(exportStats.pre_shipment_orders),
          shipped: parseInt(exportStats.shipped_orders),
          shippedMissingCogs: parseInt(exportStats.shipped_missing_cogs),
        },
      },
      mill: {
        // G-3: realised mill profit = sales of mill output (local sales of mill
        // lots + transfers to export at the transfer price) − their COGS.
        basis: 'sales_of_mill_output',
        batchCount,
        revenue: defs.mill.revenuePkr,
        cogs: defs.mill.cogsPkr,
        grossProfit: defs.mill.profitPkr,
        marginPct: defs.mill.marginPct,
        saleCount: defs.mill.saleCount,
        soldKg: defs.mill.soldKg,
        transferCount: defs.mill.transferCount,
        transferRevenuePkr: defs.mill.transferRevenuePkr,
        uncostedCount: defs.mill.uncostedCount,
        uncostedRevenuePkr: defs.mill.uncostedRevenuePkr,
        unsoldStockAtCostPkr: parseFloat(millStock?.value) || 0,
        overheads: overheadTotal,
        overheadsDeducted: false,
        currency: 'PKR',
      },
      local: {
        // Profit: local sales that are NOT mill output (raw-rice lots, services,
        // packaging). Counts / collection: every local sale.
        basis: 'non_mill_output_sales',
        saleCount: parseInt(localStats.sale_count) || 0,
        completedCount: parseInt(localStats.completed_count) || 0,
        allSalesRevenue: parseFloat(localStats.revenue_pkr) || 0,
        otherSaleCount: defs.local.saleCount,
        revenue: defs.local.revenuePkr,
        cogs: defs.local.cogsPkr,
        grossProfit: defs.local.profitPkr,
        marginPct: defs.local.marginPct,
        uncostedCount: defs.local.uncostedCount,
        collected: parseFloat(localStats.collected_pkr) || 0,
        outstanding: parseFloat(localStats.outstanding_pkr) || 0,
        currency: 'PKR',
      },
      consolidated: {
        // export Booked + mill realised + local other (each sale counted once).
        profitPkr: defs.consolidated.bookedPkr,
        bookedPkr: defs.consolidated.bookedPkr,
        realisedPkr: defs.consolidated.realisedPkr,
        profitForeign: defs.consolidated.bookedPkr / pkrRate,
        fxGainLossPkr: et.fxRealisedPkr,
      },
      receivables: {
        count: recvCount,
        overdueCount: recvOverdueCount,
        // Each currency on its own: { USD: { count, outstanding, overdueCount, overdueAmount }, PKR: {...} }.
        byCurrency: recvByCurrency,
        // USD receivables only, in USD (the field name is kept for callers).
        totalOutstandingForeign: recvCur('USD').outstanding,
        overdueAmountForeign: recvCur('USD').overdueAmount,
        // PKR receivables only, in rupees — outstanding, not the booked total.
        totalOutstandingPkr: recvCur('PKR').outstanding,
        overdueAmountPkr: recvCur('PKR').overdueAmount,
      },
      payables: {
        count: parseInt(payStats.count),
        totalOutstandingPkr: totalPayPKR,
        overdueCount: parseInt(payStats.overdue_count),
        overdueAmountPkr: parseFloat(payStats.overdue_amount),
      },
      cashPosition: {
        bankBalancePkr: bankBalancePKR,
        bankBalanceUsd: bankBalanceUSD,
        // Every currency's own total (PKR, USD, any other) — never summed.
        byCurrency: bankByCurrency,
        accountCount: bankAccountCount,
        currency: 'PKR',
      },
      collectionRate,
      collectionRateByCurrency,
      warnings: (() => {
        const out = [];
        const shippedMissing = parseInt(exportStats.shipped_missing_cogs);

        if (et.unpricedCount > 0) {
          out.push(`${et.unpricedCount} confirmed export order${et.unpricedCount === 1 ? '' : 's'} have no rice cost yet (nothing locked, reserved or allocated, and no stock of that product to estimate from) — left out of Booked Profit until costed.`);
        }
        if (et.estimatedCount > 0) {
          out.push(`${et.estimatedCount} export order${et.estimatedCount === 1 ? '' : 's'} in Booked Profit use an ESTIMATED rice cost (current stock cost of the product) — reserve stock for an exact figure.`);
        }
        const uncosted = (defs.mill.uncostedCount || 0) + (defs.local.uncostedCount || 0);
        if (uncosted > 0) {
          out.push(`${uncosted} sale${uncosted === 1 ? '' : 's'} drawn from stock have no COGS recorded — left out of profit until costed.`);
        }

        // Genuine red flag: an order has shipped but COGS never locked.
        if (shippedMissing > 0) {
          out.push(`${shippedMissing} shipped order${shippedMissing === 1 ? '' : 's'} missing COGS — run the COGS lock job or check inventory_reservations for those orders.`);
        }

        if (currentFx.source === 'system_settings_fallback') {
          out.push("FX rate from system default — no current rate in fx_rates table. Add today's rate in Finance → Rates.");
        }
        return out;
      })(),
    };
  },

  /**
   * Profitability Summary — per order and per batch, all PKR, in the period.
   * Export rows and totals and the mill / local totals come from
   * profitDefinitions (G-2 / G-3); the batch rows are information (output at
   * cost, sold so far, unsold stock), not the period's mill profit.
   */
  async getProfitabilitySummary({ startDate, endDate } = {}) {
    const currentFx = await fxRateService.getLatestRate('USD');
    const pkrRate = currentFx.rate;

    const [defs, batchRows] = await Promise.all([
      profitDefinitions(db, { startDate, endDate, currentFxRate: pkrRate }),
      millBatchRows(db, { startDate, endDate }),
    ]);
    const et = defs.export;

    const exportRows = defs.exportRows.map((r) => ({
      ...r,
      revenuePkrBooked: r.revenuePkr,
      cogsPkr: r.riceCostPkr,
      fxGainLossPkr: r.fxRealisedPkr,
      calculationStatus: !r.priced ? 'unpriced' : (r.estimated ? 'estimated' : 'exact'),
    }));

    return {
      asOfTimestamp: new Date().toISOString(),
      baseCurrency: 'PKR',
      currentFxRate: pkrRate,
      period: defs.period,
      export: {
        rows: exportRows,
        ...et,
        // Names the Profit page has always read.
        totalBookedProfitPkr: et.bookedPkr,
        totalRevenuePkr: et.bookedRevenuePkr,
        totalFxGainLossPkr: et.fxRealisedPkr,
      },
      mill: {
        basis: 'sales_of_mill_output',
        rows: batchRows,
        ...defs.mill,
        totalProfitPkr: defs.mill.profitPkr,
      },
      local: {
        basis: 'non_mill_output_sales',
        ...defs.local,
      },
      consolidated: defs.consolidated,
    };
  },
};

module.exports = financeService;
