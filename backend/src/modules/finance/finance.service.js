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
const { collectionRate: computeCollectionRate } = require('./collectionRate');
const { dayOf } = require('../exportOrders/balanceDueDate');

// PKR equivalent of an open receivable's OUTSTANDING at its own booked rate
// (C5): the booked base_amount_pkr scaled by the share still outstanding, else
// outstanding × the row's booked fx_rate. A PKR row is itself.
const RECV_PKR_EQUIV_SQL = `CASE
  WHEN COALESCE(currency, 'PKR') = 'PKR' THEN outstanding
  WHEN base_amount_pkr > 0 AND expected_amount > 0 THEN base_amount_pkr * outstanding / expected_amount
  WHEN fx_rate > 0 THEN outstanding * fx_rate
  ELSE NULL END`;

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
    const confirmedRevenuePkr = defs.exportRows.filter((r) => r.inBookedPeriod)
      .reduce((s, r) => s + (r.revenuePkr || 0), 0);

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
        db.raw(`COALESCE(SUM(${RECV_PKR_EQUIV_SQL}), 0) as pkr_equiv`),
        db.raw(`COUNT(*) FILTER (WHERE (${RECV_PKR_EQUIV_SQL}) IS NULL) as pkr_equiv_missing`),
      )
      .groupByRaw("COALESCE(currency, 'PKR')");
    const recvByCurrency = {};
    let recvCount = 0; let recvOverdueCount = 0;
    let recvPkrEquiv = 0; let recvPkrEquivMissing = 0;
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
      recvPkrEquiv += parseFloat(r.pkr_equiv) || 0;
      recvPkrEquivMissing += parseInt(r.pkr_equiv_missing, 10) || 0;
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
    // C5: a foreign balance carries no booked PKR figure (bank_accounts holds
    // only the native balance), so its equivalent is at TODAY's rate, dated —
    // a secondary line, never added into the PKR balance.
    let cashForeignPkr = 0; let cashUnconverted = 0;
    for (const [cur, bal] of Object.entries(bankByCurrency)) {
      if (String(cur).toUpperCase() === 'PKR' || !bal) continue;
      if (String(cur).toUpperCase() === 'USD' && pkrRate > 0) cashForeignPkr += bal * pkrRate;
      else cashUnconverted += 1;
    }

    // ── Collection rate (C6) ──
    // Received ÷ amounts DUE (due date passed; a balance is due a term after
    // sailing), per currency — dollars and rupees are never summed. The single
    // `collectionRate` is only given when one currency is present; with more
    // than one it is null and the per-currency rates stand.
    const collection = await computeCollectionRate(db);
    const collectionRateByCurrency = {};
    for (const [cur, c] of Object.entries(collection.byCurrency)) collectionRateByCurrency[cur] = c.ratePct;
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
        // C4: Realised by SHIPMENT date; Pipeline = booked orders not yet realised.
        realisedProfitPkr: et.realisedPkr,
        realisedBasis: et.realisedBasis,
        pipelineProfitPkr: et.pipelinePkr,
        pipelineCount: et.pipelineCount,
        rateMasterCount: et.rateMasterCount,
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
        marginPct: defs.mill.marginPct,
        saleCount: defs.mill.saleCount,
        soldKg: defs.mill.soldKg,
        transferCount: defs.mill.transferCount,
        transferRevenuePkr: defs.mill.transferRevenuePkr,
        uncostedCount: defs.mill.uncostedCount,
        uncostedRevenuePkr: defs.mill.uncostedRevenuePkr,
        unsoldStockAtCostPkr: parseFloat(millStock?.value) || 0,
        // C3: gross (sales − COGS) − the period's mill overheads = net, the
        // mill's realised profit (the figure consolidated uses).
        grossProfit: defs.mill.grossProfitPkr,
        grossMarginPct: defs.mill.grossMarginPct,
        overheads: defs.mill.overheadsPkr,
        overheadCount: defs.mill.overheadCount,
        overheadsUnconvertedCount: defs.mill.overheadsUnconvertedCount,
        netProfit: defs.mill.profitPkr,
        overheadsDeducted: true,
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
      // C1: the books — GL P&L net profit, Posted journals, company-wide.
      books: defs.books,
      consolidated: {
        // OPERATIONAL: export Booked + mill realised (net of overheads) + local
        // other (each sale counted once). Not the books — see `books`.
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
        // C5: ≈ PKR equivalent of everything outstanding, each row at its OWN
        // booked rate. A secondary figure — never cash, never the headline.
        pkrEquiv: { pkr: Math.round(recvPkrEquiv * 100) / 100, basis: 'booked', missingCount: recvPkrEquivMissing },
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
        // C5: PKR balance + foreign balances at TODAY's rate (no booked PKR is
        // kept for a bank balance). Labelled with the rate's date.
        pkrEquiv: {
          pkr: Math.round((bankBalancePKR + cashForeignPkr) * 100) / 100,
          basis: 'today',
          rate: pkrRate,
          rateDate: dayOf(currentFx.effectiveDate),
          unconvertedCount: cashUnconverted,
        },
      },
      collectionRate,
      collectionRateByCurrency,
      // C6 detail: per currency { ratePct, targetPct, onTarget, dueAmount,
      // receivedAmount, overdueAmount, overdueCount }, plus notYetDue.
      collection,
      warnings: (() => {
        const out = [];
        const shippedMissing = parseInt(exportStats.shipped_missing_cogs);

        if (et.unpricedCount > 0) {
          out.push(`${et.unpricedCount} confirmed export order${et.unpricedCount === 1 ? '' : 's'} have no rice cost yet (nothing locked, reserved or allocated, no stock of that product to estimate from, and no Finished Rice rate in Finance → Rates) — left out of Booked Profit until costed.`);
        }
        if (et.estimatedCount > 0) {
          const viaMaster = et.rateMasterCount > 0 ? ` (${et.rateMasterCount} priced from the commodity rate master)` : '';
          out.push(`${et.estimatedCount} export order${et.estimatedCount === 1 ? '' : 's'} in Booked Profit use an ESTIMATED rice cost (current stock cost of the product, or the commodity rate master)${viaMaster} — reserve stock for an exact figure.`);
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
