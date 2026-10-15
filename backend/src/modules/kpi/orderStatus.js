// "Active order" (owner decision D-15, 2026-10-16): an export order whose
// status is NOT Draft, Cancelled or Closed. A Draft is not yet an order, a
// Cancelled one never will be, a Closed one is finished. Three definitions were
// in use (some counted Drafts, some did not), so the Home, Finance and Export
// screens showed different "active" counts for the same book.
//
// Contract: active_order.v1 — docs/AGRIRICE_KPI_CONTRACTS.md.

const INACTIVE_ORDER_STATUSES = Object.freeze(['Draft', 'Cancelled', 'Closed']);

/** Is an order with this status active? */
function isActiveOrder(status) {
  return !!status && !INACTIVE_ORDER_STATUSES.includes(String(status));
}

/** Restrict a knex export_orders query to active orders. */
function whereActiveOrder(q, col = 'status') {
  return q.whereNotIn(col, INACTIVE_ORDER_STATUSES);
}

/** SQL boolean: the order's status column `col` is active. */
const activeOrderSql = (col = 'status') =>
  `(${col} NOT IN (${INACTIVE_ORDER_STATUSES.map((s) => `'${s}'`).join(', ')}))`;

module.exports = { INACTIVE_ORDER_STATUSES, isActiveOrder, whereActiveOrder, activeOrderSql };
