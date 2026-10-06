// Where an export order's owed balance is collected. Under ship-on-advance
// (owner decision 2026-10-07) the balance is collected AFTER sailing, so it is
// owed on Shipped / Arrived orders, plus the legacy pre-shipment 'Awaiting
// Balance' stage for orders still parked there. Reports and reminders that look
// for balances to chase filter on these statuses AND an outstanding amount,
// never on status = 'Awaiting Balance' alone.
//
// Kept dependency-free so services the workflow itself requires (automation)
// can use it without a require cycle.

const BALANCE_COLLECTION_STATUSES = ['Awaiting Balance', 'Shipped', 'Arrived'];
const BALANCE_OUTSTANDING_SQL = 'COALESCE(balance_expected, 0) - COALESCE(balance_received, 0) > 0.01';

module.exports = { BALANCE_COLLECTION_STATUSES, BALANCE_OUTSTANDING_SQL };
