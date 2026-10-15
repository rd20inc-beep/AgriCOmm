// Export revenue date (owner decision D-16, 2026-10-16): an export order's
// revenue belongs to the day on its BILL OF LADING; when the BL date is not
// recorded, to the day the order moved to Shipped (its status history — the
// day COGS locked and the shipment journal is dated). An order with neither
// has not been shipped and has no revenue date.
//
// Contract: export_revenue_date.v1 — docs/AGRIRICE_KPI_CONTRACTS.md.
//
// NOTE for integration: the p4/export-currency branch (P4-03) owns wiring
// this rule into export profit / revenue reports. This module states the same
// rule so the KPI contracts have one place to point at; if that branch ships
// its own function, keep one and re-export it from here.

/** SQL date: the revenue date of the export order aliased `eo`. */
const exportRevenueDateSql = (eo = 'eo') => `COALESCE(
    ${eo}.bl_date::date,
    (SELECT MIN(h.created_at) FROM export_order_status_history h
      WHERE h.order_id = ${eo}.id AND h.to_status = 'Shipped')::date)`;

// 'YYYY-MM-DD' from a Date (local) / date string, else null.
function dayOf(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * JS twin. order { bl_date }, shippedTransitionAt = the first status-history
 * row moving the order to Shipped (or null). Returns 'YYYY-MM-DD' or null.
 */
function exportRevenueDate(order = {}, shippedTransitionAt = null) {
  return dayOf(order.bl_date) || dayOf(shippedTransitionAt) || null;
}

module.exports = { exportRevenueDateSql, exportRevenueDate };
