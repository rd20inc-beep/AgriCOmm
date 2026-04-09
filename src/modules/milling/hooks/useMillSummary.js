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

      // Use batch-confirmed prices first, then commodity rates
      const fp = parseFloat(b.finishedPricePerMT) || prices.finished;
      const bp = parseFloat(b.brokenPricePerMT) || prices.broken;
      const np = parseFloat(b.branPricePerMT) || prices.bran;
      const hp = parseFloat(b.huskPricePerMT) || prices.husk;

      const finishedRev = (parseFloat(b.actualFinishedMT) || 0) * fp;
      const brokenRev = (parseFloat(b.brokenMT) || 0) * bp;
      const branRev = (parseFloat(b.branMT) || 0) * np;
      const huskRev = (parseFloat(b.huskMT) || 0) * hp;
      const batchRevenue = finishedRev + brokenRev + branRev + huskRev;

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
        profit: batchRevenue - totalCost,
        costPerKG,
        pricesConfirmed: !!b.pricesConfirmed,
      };
    });

    // Aggregates
    const totalFinishedRevenue = batchBreakdown.reduce((s, b) => s + b.revenue, 0);
    const totalByproductRevenue = batchBreakdown.reduce((s, b) => {
      return s + ((b.brokenMT * (prices.broken)) + (b.branMT * (prices.bran)) + (b.huskMT * (prices.husk)));
    }, 0);
    const totalRawCost = batchBreakdown.reduce((s, b) => s + b.rawCost, 0);
    const totalOtherCosts = batchBreakdown.reduce((s, b) => s + b.otherCosts, 0);
    const totalDirectCosts = totalRawCost + totalOtherCosts;

    // Overheads from mill_expenses
    const expenseSummary = expenseData?.summary || [];
    const overheads = expenseSummary.reduce((s, cat) => s + (parseFloat(cat.total) || 0), 0);

    const totalRevenue = totalFinishedRevenue;
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
