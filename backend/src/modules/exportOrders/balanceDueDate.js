// An export order's BALANCE is due a number of days after it sails (owner
// decision C6, 2026-10-09): due = sailing date + balance_term_days, where the
// sailing date is the BL date, else the actual departure (atd). Until the order
// has either, the balance is not due — the receivable keeps the placeholder
// due date it was created with, and the collection rate ignores it.
//
// syncBalanceDueDate() is called wherever bl_date / atd / balance_term_days
// can change (shipment update, order edit). Paid / received / written-off rows are left
// alone. Kept dependency-free apart from the settings read.

// Receivable statuses that are still owed (receivables CHECK: Pending,
// Partial, Paid, Received, Overdue, Written Off).
const OPEN_STATUSES = ['Pending', 'Partial', 'Overdue'];

const { DEFAULT_BALANCE_TERM_DAYS, balanceTermDaysSetting } = require('../finance/collectionRate');

// 'YYYY-MM-DD' from a date / date string, else null.
function dayOf(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // A DATE column arrives as local midnight — read it back in local time.
    const y = v.getFullYear(); const m = String(v.getMonth() + 1).padStart(2, '0'); const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** The balance due day for an order, or null when it has not sailed. Pure. */
function balanceDueDate(order = {}, fallbackTermDays = DEFAULT_BALANCE_TERM_DAYS) {
  const sailed = dayOf(order.bl_date) || dayOf(order.atd);
  if (!sailed) return null;
  const raw = order.balance_term_days;
  const term = raw === null || raw === undefined || raw === '' ? fallbackTermDays : parseInt(raw, 10);
  const days = Number.isFinite(term) && term >= 0 ? term : fallbackTermDays;
  const d = new Date(`${sailed}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Re-date the order's open Balance receivable(s). Returns the due day or null. */
async function syncBalanceDueDate(trx, orderId) {
  const order = await trx('export_orders').where({ id: orderId })
    .first('id', 'bl_date', 'atd', 'balance_term_days');
  if (!order) return null;
  const due = balanceDueDate(order, await balanceTermDaysSetting(trx));
  if (!due) return null;
  await trx('receivables')
    .where({ order_id: orderId, type: 'Balance' })
    .whereIn('status', OPEN_STATUSES)
    .update({ due_date: due, updated_at: trx.fn.now() });
  return due;
}

module.exports = { balanceDueDate, syncBalanceDueDate, dayOf, OPEN_STATUSES };
