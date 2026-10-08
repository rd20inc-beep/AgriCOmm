// Money In / Money Out tile figures — every one per currency, never added
// across currencies (owner decision: USD and PKR are shown separately).
import { ageDays, ageBucket, BUCKET_KEYS } from './aging';
import { totalsByCurrency } from '../drawers/drawerLogic';

// The currency a receivable row is owed in: local sales are PKR, receivables
// carry their own (USD by default).
export const curOf = (row) => (row?.kind === 'local_sale' ? 'PKR' : (row?.currency || 'USD'));
const eqStatus = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * Money In tiles — every figure per currency, never added across currencies
 * (owner decision: USD and PKR shown separately). Pure, for the tests.
 */
export function moneyInTiles(receivables = []) {
  const withCur = receivables.map((r) => ({ ...r, currency: curOf(r) }));
  const open = withCur.filter((r) => !eqStatus(r.status, 'Paid'));
  return {
    outstanding: totalsByCurrency(open, 'outstanding'),
    overdue: totalsByCurrency(open.filter((r) => eqStatus(r.status, 'Overdue')), 'outstanding'),
    collected: totalsByCurrency(withCur, 'receivedAmount'),
    openCount: open.length,
    pendingCount: withCur.filter((r) => eqStatus(r.status, 'Pending')).length,
  };
}

/** Aging buckets, one row per currency (open items by days past due). */
export function agingByCurrency(receivables = []) {
  const out = {};
  for (const r of receivables) {
    if (eqStatus(r.status, 'Paid') || !(parseFloat(r.outstanding) > 0)) continue;
    const b = ageBucket(ageDays(r.dueDate || r.due_date));
    if (!b) continue;
    const c = curOf(r).toUpperCase();
    out[c] ||= Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0]));
    out[c][b] = Math.round((out[c][b] + (parseFloat(r.outstanding) || 0)) * 100) / 100;
  }
  return out;
}

/** Money Out tiles: outstanding / overdue / paid per currency, and the number of payees. */
export function moneyOutTiles(payables = [], today = new Date()) {
  const withCur = payables.map((p) => ({ ...p, currency: p.currency || 'PKR' }));
  const open = withCur.filter((p) => !eqStatus(p.status, 'Paid'));
  const overdue = open.filter((p) => eqStatus(p.status, 'Overdue') || (p.dueDate && new Date(p.dueDate) < today));
  return {
    outstanding: totalsByCurrency(open, 'outstanding'),
    overdue: totalsByCurrency(overdue, 'outstanding'),
    paid: totalsByCurrency(withCur, 'paidAmount'),
    openCount: open.length,
    payeeCount: new Set(withCur.map((p) => p.supplierName || p.haulerName).filter(Boolean)).size,
  };
}
