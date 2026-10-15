/**
 * When an export order's contract (customer, currency, quantity, price,
 * advance %, separately-charged freight) may still change, and what the
 * balance is once it does (P2-01 / EXP-01).
 *
 * The contract is COMMITTED once anything has happened to the money:
 *   - an advance or balance confirmed on the order, or on its receivables
 *     (a Money-In receipt settles the receivable without touching the order);
 *   - a receipt recorded and still waiting for Finance to confirm — it was
 *     taken against today's figures, and confirming it later must not find a
 *     different advance;
 *   - revenue posted, or the order shipped / arrived / closed / cancelled.
 * Read it under the order's FOR UPDATE lock: receipt confirmation takes the
 * same lock, so a contract edit and a confirmation cannot interleave.
 *
 * The balance the buyer owes includes every debit note still Issued: each one
 * is its own Dr 1110 / Cr 4070 journal, so a recompute that left them out
 * would erase AR the GL still carries.
 */
const PENDING = 'Pending Finance Confirmation';
const COMMITTED_STATUSES = ['Shipped', 'Arrived', 'Closed', 'Cancelled'];
const EPS = 0.01;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// Receipts against the order still waiting for Finance: linked through one of
// its receivables, or (an older row) through the order itself.
async function pendingReceiptCount(conn, orderId) {
  const recvIds = (await conn('receivables').where({ order_id: orderId }).select('id')).map((r) => r.id);
  const rows = await conn('payments').where({ status: PENDING, type: 'receipt' }).select('id', 'linked_receivable_id', 'source_table', 'source_id');
  return (rows || []).filter((p) => (p.linked_receivable_id && recvIds.includes(p.linked_receivable_id))
    || (p.source_table === 'export_orders' && String(p.source_id) === String(orderId))).length;
}

/** Why the order's contract is locked, or null when it may still change. */
async function contractCommittedReason(conn, order) {
  if (!order) return null;
  if (num(order.advance_received) > EPS || num(order.balance_received) > EPS) return 'a payment has been received';
  if (order.revenue_posted === true) return 'revenue has been posted';
  if (COMMITTED_STATUSES.includes(order.status)) return `the order is ${order.status}`;
  const recv = await conn('receivables').where({ order_id: order.id }).select('received_amount');
  if ((recv || []).some((r) => num(r.received_amount) > EPS)) return 'a payment has been received';
  if (await pendingReceiptCount(conn, order.id) > 0) return 'a receipt is waiting for Finance confirmation';
  return null;
}

/** Σ of the order's debit notes still Issued, in the order's currency. */
async function issuedDebitNotesTotal(conn, orderId) {
  const rows = await conn('export_debit_notes').where({ order_id: orderId, status: 'Issued' }).select('amount');
  return round2((rows || []).reduce((s, r) => s + num(r.amount), 0));
}

module.exports = {
  contractCommittedReason, issuedDebitNotesTotal, pendingReceiptCount, COMMITTED_STATUSES,
};
