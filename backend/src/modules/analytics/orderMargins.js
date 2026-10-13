/**
 * Export-order margins for alerts (Intelligence ▸ exceptions, Admin ▸
 * automation low-margin scan, the dashboard drill-down) — in ONE currency.
 *
 * The scanners used to take SUM(export_order_costs.amount) — rupees — off
 * contract_value — dollars — so every USD order looked like a huge loss
 * ("critical negative margin"). Margin is now the Booked margin of the one
 * profit definition (finance/profitDefinitions.js, owner decision G-2), all in
 * PKR: revenue at the order's locked / booked rate, minus its operating costs
 * and rice cost in PKR. An order with no booked rate, or no rice cost yet, is
 * unpriced — SKIPPED, never alarmed on.
 */
const { exportProfit, orderRevenuePkr } = require('../finance/profitDefinitions');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const fmt = (n) => num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Pure: an exportProfit row → its margin finding against `lowPct`, or null
 * when the order is fine or cannot be priced (no booked rate / no rice cost).
 * Returns { negative, marginPct, revenuePkr, costPkr, profitPkr, atRiskPkr,
 *           estimated, description }.
 */
function marginFinding(row, { lowPct = 10 } = {}) {
  if (!row || !row.priced || !(num(row.revenuePkr) > 0)) return null;
  const revenuePkr = num(row.revenuePkr);
  const profitPkr = num(row.bookedProfitPkr);
  const costPkr = num(row.totalCostPkr);
  const marginPct = (profitPkr / revenuePkr) * 100;
  if (marginPct >= num(lowPct)) return null;
  const negative = marginPct < 0;
  const contract = row.currency === 'PKR'
    ? `Rs ${fmt(revenuePkr)}`
    : `${row.currency} ${fmt(row.contractValueForeign)} = Rs ${fmt(revenuePkr)} at the booked rate${row.bookedFxRate ? ` ${fmt(row.bookedFxRate)}` : ''}`;
  const description = [
    `Contract value: ${contract}.`,
    `Costs: Rs ${fmt(costPkr)} (operating Rs ${fmt(row.opCostsPkr)} + rice Rs ${fmt(row.riceCostPkr)}${row.estimated ? ', rice cost ESTIMATED' : ''}).`,
    negative ? `Loss of Rs ${fmt(-profitPkr)}.` : `Margin is below the ${num(lowPct)}% threshold.`,
  ].join(' ');
  return {
    negative,
    marginPct: r2(marginPct),
    revenuePkr: r2(revenuePkr),
    costPkr: r2(costPkr),
    profitPkr: r2(profitPkr),
    // Loss when negative; otherwise the shortfall to the threshold. PKR.
    atRiskPkr: r2(negative ? -profitPkr : (revenuePkr * num(lowPct)) / 100 - profitPkr),
    estimated: !!row.estimated,
    description,
  };
}

/**
 * Every booked export order (not Draft / Cancelled) with its PKR margin
 * figures, optionally by order date. `excludeStatuses` drops e.g. Closed.
 */
async function orderMarginRows(conn, { startDate, endDate, excludeStatuses = [] } = {}) {
  const { rows } = await exportProfit(conn, { startDate, endDate });
  return (rows || []).filter((r) => r.inBookedPeriod !== false && !excludeStatuses.includes(r.status));
}

/**
 * An order's contract value in PKR at its booked rate (no live rate), or null
 * when a foreign order has none. For alert amounts, which carry no currency.
 */
function orderValuePkr(order) {
  const { revenuePkr } = orderRevenuePkr(order || {});
  return revenuePkr == null ? null : r2(revenuePkr);
}

module.exports = { marginFinding, orderMarginRows, orderValuePkr };
