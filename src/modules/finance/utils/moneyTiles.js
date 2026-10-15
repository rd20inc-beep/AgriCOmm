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

// The server's aging buckets (finance/receivablesAsAt.js): 'current' is not
// yet due; the rest are days past the effective due date.
export const AS_AT_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
export const AS_AT_BUCKET_LABEL = { current: 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' };

/**
 * Money In tiles from GET /api/finance/receivables/summary (P4-04): every
 * figure is computed on the server, per currency, as at the summary's date —
 * this only reshapes it for the tiles. Pure, for the tests.
 */
export function moneyInTilesFromSummary(summary = {}) {
  const by = summary.byCurrency || {};
  const pick = (k) => Object.fromEntries(Object.entries(by).map(([c, v]) => [c, Number(v[k]) || 0]).filter(([, v]) => v));
  return {
    asOf: summary.asOf || null,
    outstanding: pick('outstanding'),
    overdue: pick('overdueAmount'),
    collected: Object.fromEntries(Object.entries(summary.collected || {})
      .map(([c, v]) => [c, Number(v?.amount) || 0]).filter(([, v]) => v)),
    openCount: Number(summary.openCount) || 0,
    overdueCount: Object.values(by).reduce((s, v) => s + (Number(v.overdueCount) || 0), 0),
    aging: Object.fromEntries(Object.entries(by).map(([c, v]) => [c, v.buckets || {}])),
    buckets: summary.buckets || AS_AT_BUCKETS,
  };
}
