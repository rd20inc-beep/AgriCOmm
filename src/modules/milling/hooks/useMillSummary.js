import { useMemo } from 'react';
import { useMillingBatches, useMillExpenses, useCommodityRates } from '../../../api/queries';

/**
 * Canonical mill financial summary — single source of truth for all mill P&L metrics.
 * Replaces hardcoded MILL_PRICES_PKR with live commodity_rate_master data.
 * Used by BOTH Operations and Finance tabs.
 */

// Fallback prices if commodity_rate_master has no data
const FALLBACK_PRICES = {
  finished_rice: 72800,
  broken_rice: 42000,
  bran: 22400,
  husk: 8400,
};

function getRateValue(rates, rateType, fallback) {
  if (!Array.isArray(rates)) return fallback;
  const found = rates.find(r => r.rate_type === rateType || r.rateType === rateType);
  return found ? parseFloat(found.rate_value || found.rateValue) || fallback : fallback;
}

export function useMillSummary(opts = {}) {
  const { data: batches = [], isLoading: batchesLoading } = useMillingBatches({}, opts);
  const { data: rates = [] } = useCommodityRates();
  const { data: expenseData } = useMillExpenses();

  const summary = useMemo(() => {
    // Prices from commodity_rate_master (live, not hardcoded)
    const prices = {
      finished: getRateValue(rates, 'finished_rice', FALLBACK_PRICES.finished_rice),
      broken: getRateValue(rates, 'broken_rice', FALLBACK_PRICES.broken_rice),
      bran: getRateValue(rates, 'bran', FALLBACK_PRICES.bran),
      husk: getRateValue(rates, 'husk', FALLBACK_PRICES.husk),
    };

    const completed = batches.filter(b => b.status === 'Completed');
    const active = batches.filter(b => ['In Progress', 'Queued', 'Pending', 'Pending Approval'].includes(b.status));

    // Per-batch calculations
    const batchBreakdown = completed.map(b => {
      const costs = (b.costs && typeof b.costs === 'object' && !Array.isArray(b.costs)) ? b.costs : {};
      const rawCost = parseFloat(costs.rawRice) || 0;
      const otherCosts = Object.entries(costs)
        .filter(([k]) => k !== 'rawRice')
        .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
      const totalCost = rawCost + otherCosts;

      // Value the sellable outputs at batch-confirmed prices first, then commodity
      // rates. Broken is stored BOTH as an aggregate and per-grade split
      // (broken_kg == b1+b2+b3+csr+short_grain) — value the per-grade split when it
      // exists, else the aggregate, so it isn't double-counted. Powder / S.W / Choba
      // / Sortex are also sellable (priced only when a sale price was recorded).
      // Bran/husk are no longer sold, so they carry NO revenue.
      const num = (v) => parseFloat(v) || 0;
      const finishedRev = num(b.actualFinishedMT) * (num(b.finishedPricePerMT) || prices.finished);
      const gradeQty = num(b.b1MT) + num(b.b2MT) + num(b.b3MT) + num(b.csrMT) + num(b.shortGrainMT);
      const brokenRev = gradeQty > 0
        ? num(b.b1MT) * (num(b.b1PricePerMT) || prices.broken)
          + num(b.b2MT) * (num(b.b2PricePerMT) || prices.broken)
          + num(b.b3MT) * (num(b.b3PricePerMT) || prices.broken)
          + num(b.csrMT) * (num(b.csrPricePerMT) || prices.broken)
          + num(b.shortGrainMT) * (num(b.shortGrainPricePerMT) || prices.broken)
        : num(b.brokenMT) * (num(b.brokenPricePerMT) || prices.broken);
      const otherByproductRev = num(b.powderMT) * num(b.powderPricePerMT)
        + num(b.sweepingMT) * num(b.sweepingPricePerMT)
        + num(b.chobaMT) * num(b.chobaPricePerMT)
        + num(b.sortexRejectsMT) * num(b.sortexRejectsPricePerMT);
      const byproductRev = brokenRev + otherByproductRev;
      const batchRevenue = finishedRev + byproductRev;

      const finishedKG = (parseFloat(b.actualFinishedMT) || 0) * 1000;
      const costPerKG = finishedKG > 0 ? totalCost / finishedKG : 0;

      return {
        id: b.id,
        batchNo: b.id,
        rawQtyMT: parseFloat(b.rawQtyMT) || 0,
        finishedMT: parseFloat(b.actualFinishedMT) || 0,
        brokenMT: parseFloat(b.brokenMT) || 0,
        branMT: parseFloat(b.branMT) || 0,
        huskMT: parseFloat(b.huskMT) || 0,
        yieldPct: parseFloat(b.yieldPct) || 0,
        rawCost,
        otherCosts,
        totalCost,
        revenue: batchRevenue,
        finishedRev,
        byproductRev,
        profit: batchRevenue - totalCost,
        costPerKG,
        pricesConfirmed: !!b.pricesConfirmed,
      };
    });

    // Aggregates
    const totalFinishedRevenue = batchBreakdown.reduce((s, b) => s + b.finishedRev, 0);
    const totalByproductRevenue = batchBreakdown.reduce((s, b) => s + b.byproductRev, 0);
    const totalRawCost = batchBreakdown.reduce((s, b) => s + b.rawCost, 0);
    const totalOtherCosts = batchBreakdown.reduce((s, b) => s + b.otherCosts, 0);
    const totalDirectCosts = totalRawCost + totalOtherCosts;

    // Overheads from mill_expenses
    const expenseSummary = expenseData?.summary || [];
    const overheads = expenseSummary.reduce((s, cat) => s + (parseFloat(cat.total) || 0), 0);

    const totalRevenue = totalFinishedRevenue + totalByproductRevenue;
    const totalCost = totalDirectCosts + overheads;
    const grossProfit = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const totalFinishedKG = batchBreakdown.reduce((s, b) => s + b.finishedMT * 1000, 0);
    const avgCostPerKG = totalFinishedKG > 0 ? totalCost / totalFinishedKG : 0;

    const avgYield = completed.length > 0
      ? completed.reduce((s, b) => s + (parseFloat(b.yieldPct) || 0), 0) / completed.length
      : 0;

    // Variance alerts
    const varianceAlerts = batches.filter(b => b.variancePct != null && Math.abs(b.variancePct) > 1).length;

    return {
      prices,
      priceSource: rates.length > 0 ? 'commodity_rate_master' : 'fallback',

      // Counts
      totalBatches: batches.length,
      completedBatches: completed.length,
      activeBatches: active.length,
      varianceAlerts,

      // Yield
      avgYield,

      // Revenue
      revenue: {
        finished: totalFinishedRevenue,
        byproduct: totalByproductRevenue,
        total: totalRevenue,
      },

      // Costs
      costs: {
        rawMaterial: totalRawCost,
        otherDirect: totalOtherCosts,
        directTotal: totalDirectCosts,
        overheads,
        total: totalCost,
      },

      // Profit
      profit: {
        gross: grossProfit,
        margin: marginPct,
      },

      // Unit economics
      avgCostPerKG,

      // Expense category breakdown
      expenseBreakdown: expenseSummary,

      // Per-batch detail
      batchBreakdown,
    };
  }, [batches, rates, expenseData]);

  return { summary, isLoading: batchesLoading, batches, rates };
}
