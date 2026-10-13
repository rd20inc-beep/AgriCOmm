/**
 * Intelligence ▸ Profitability / Customer Scoring — per-order profit in ONE
 * currency. The tab used to take the order's USD contract value minus its PKR
 * costs in the browser. It now reads the Booked rows of the one profit
 * definition (GET /finance/profitability-summary → export.rows, backend
 * finance/profitDefinitions.js): revenue at the order's booked rate, minus
 * operating and rice cost, all PKR. Unpriced orders (no booked rate / no rice
 * cost) are left out of profit, never guessed.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Booked export rows + the AppContext orders (for customer / country) → priced rows. */
export function orderProfitRows(exportRows = [], exportOrders = []) {
  const byId = new Map(exportOrders.map((o) => [String(o.id), o]));
  return exportRows
    .filter((r) => r && r.priced && num(r.revenuePkr) > 0)
    .map((r) => {
      const o = byId.get(String(r.id)) || {};
      const revenuePkr = num(r.revenuePkr);
      const profitPkr = num(r.bookedProfitPkr);
      return {
        id: r.id,
        orderNo: r.orderNo || o.id,
        customer: o.customerName || 'Unknown',
        country: o.country || 'Unknown',
        revenuePkr,
        costPkr: num(r.totalCostPkr),
        profitPkr,
        marginPct: (profitPkr / revenuePkr) * 100,
        estimated: !!r.estimated,
      };
    });
}

/** Priced rows → per-customer totals, best profit first. */
export function customerProfit(rows = [], limit = 10) {
  const map = {};
  rows.forEach((r) => {
    const key = r.customer || 'Unknown';
    if (!map[key]) map[key] = { name: key, orders: 0, revenue: 0, costs: 0, profit: 0 };
    map[key].orders += 1;
    map[key].revenue += r.revenuePkr;
    map[key].costs += r.costPkr;
    map[key].profit += r.profitPkr;
  });
  return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, limit);
}

/** Priced rows → booked revenue (PKR) by country, largest first. */
export function countryRevenue(rows = [], limit = 8) {
  const map = {};
  rows.forEach((r) => {
    const key = r.country || 'Unknown';
    if (!map[key]) map[key] = { name: key, revenue: 0, orders: 0 };
    map[key].revenue += r.revenuePkr;
    map[key].orders += 1;
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/** Priced rows → { [customerName]: { revenuePkr, profitPkr } } for scoring. */
export function profitByCustomer(rows = []) {
  const map = {};
  rows.forEach((r) => {
    const key = r.customer || 'Unknown';
    if (!map[key]) map[key] = { revenuePkr: 0, profitPkr: 0 };
    map[key].revenuePkr += r.revenuePkr;
    map[key].profitPkr += r.profitPkr;
  });
  return map;
}
