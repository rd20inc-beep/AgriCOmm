// Pure helpers for the unified mill transaction history (unit-tested).

export const HISTORY_PAGE_SIZE = 25;

function statusLabel(r) {
  if (r.isTransfer) {
    if (r.status === 'pending') return 'Awaiting acceptance';
    if (r.status === 'completed') return 'Accepted';
    return r.status ? String(r.status) : 'Transfer';
  }
  if (r.status === 'Reversed' || r.status === 'Bounced') return r.status;
  if (r.cleared === false) return 'Uncleared cheque';
  return r.status || 'Settled';
}

/**
 * Ledger rows (oldest first, as the server sends them) → display rows, newest
 * first, each with the running balance AFTER it. Only counted rows move the
 * balance (the server's mill_cash_flow.v1 `counted` flag) — nothing is
 * re-decided here.
 */
export function historyRows(ledger = []) {
  let bal = 0;
  const withBal = ledger.map((r) => {
    const amt = parseFloat(r.amount_pkr) || 0;
    if (r.counted !== false) bal += r.direction === 'in' ? amt : -amt;
    const transferLabel = r.direction === 'in' ? 'Head Office → Mill' : 'Mill → Head Office';
    return {
      ...r,
      amount_pkr: amt,
      counted: r.counted !== false,
      balance: bal,
      currency: r.currency || 'PKR',
      amountOriginal: r.amount_original != null ? parseFloat(r.amount_original) || 0 : amt,
      entityLabel: r.isTransfer ? transferLabel : 'Mill',
      statusLabel: statusLabel(r),
    };
  });
  return withBal.reverse();
}

/** dir: all|in|out|transfers · status: all|settled|pending|not_counted · q: free text. */
export function filterHistory(rows, { dir = 'all', status = 'all', q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (dir === 'in' && r.direction !== 'in') return false;
    if (dir === 'out' && r.direction !== 'out') return false;
    if (dir === 'transfers' && !r.isTransfer) return false;
    if (status === 'settled' && !r.counted) return false;
    if (status === 'pending' && !(r.cleared === false || (r.isTransfer && r.status === 'pending'))) return false;
    if (status === 'not_counted' && r.counted) return false;
    if (needle) {
      const hay = [r.counterparty, r.ref, r.payment_no, r.category, r.recorded_by, r.approved_by, r.payment_method]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
