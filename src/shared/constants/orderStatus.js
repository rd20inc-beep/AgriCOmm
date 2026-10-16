// "Active order" (owner decision D-15, contract active_order.v1 in
// docs/AGRIRICE_KPI_CONTRACTS.md): an export order whose status is NOT Draft,
// Cancelled or Closed. The backend's kpi/orderStatus.js is the source; this is
// its status list for screens that count orders they already hold, and a test
// (orderStatus.test.js) fails if the two lists ever differ.

export const INACTIVE_ORDER_STATUSES = Object.freeze(['Draft', 'Cancelled', 'Closed']);

export const isActiveOrder = (order) =>
  !!order && !!order.status && !INACTIVE_ORDER_STATUSES.includes(String(order.status));
