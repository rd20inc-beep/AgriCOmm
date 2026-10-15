// Mill cash flow (contract mill_cash_flow.v1, P4-02 / MIL-27): money that
// actually moved, by the SAME status rule as the finance payments feed
// (finance/paymentsFeedTotals.js):
//
//   - never money: Pending Finance Confirmation / Rejected / Superseded
//     receipts — left out of the ledger altogether;
//   - Reversed or Bounced: listed, but neither in nor out (the reversal moved
//     it back; a bounced cheque never moved it);
//   - an uncleared cheque (cleared = false): listed as a pending cheque, not
//     yet money.
//
// The Mill Finance Money In/Out tab used to add all of these to its cash
// totals and running balance.

const NEVER_MONEY = ['Pending Finance Confirmation', 'Rejected', 'Superseded'];
const NOT_MONEY = ['Reversed', 'Bounced'];

/** SQL predicate (null-safe): the payment row `p` is in the cash ledger at all. */
const inLedgerSql = (p = 'p') => `COALESCE(${p}.status, '') NOT IN (${NEVER_MONEY.map((s) => `'${s}'`).join(', ')})`;

/** Does a ledger row count as money in / out? (JS twin of paymentsFeedTotals SETTLED.) */
function isSettled(row) {
  if (!row) return false;
  if (row.isTransfer) return true; // fund transfers are filtered in their query
  if (NOT_MONEY.includes(row.status)) return false;
  return row.cleared !== false;
}

const isPendingCheque = (row) => !!row && !row.isTransfer && !NOT_MONEY.includes(row.status) && row.cleared === false;

/**
 * Pure fold (unit-tested): ledger rows { direction 'in'|'out', amount_pkr,
 * status, cleared, isTransfer } → rows marked `counted` + the summary.
 */
function foldMillCash(rows = []) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  let cashIn = 0; let cashOut = 0; let counted = 0;
  const pending = { in: 0, out: 0, count: 0 };
  let notMoneyCount = 0;
  const marked = rows.map((r) => {
    const amt = parseFloat(r.amount_pkr) || 0;
    const ok = isSettled(r);
    if (ok) {
      counted += 1;
      if (r.direction === 'in') cashIn += amt; else cashOut += amt;
    } else if (isPendingCheque(r)) {
      pending.count += 1;
      pending[r.direction === 'in' ? 'in' : 'out'] += amt;
    } else {
      notMoneyCount += 1;
    }
    return { ...r, amount_pkr: amt, counted: ok };
  });
  return {
    ledger: marked,
    summary: {
      cashIn: r2(cashIn), cashOut: r2(cashOut), net: r2(cashIn - cashOut), count: counted,
      pendingChequesIn: r2(pending.in), pendingChequesOut: r2(pending.out), pendingChequeCount: pending.count,
      notMoneyCount,
      basis: 'settled_only',
    },
  };
}

module.exports = { NEVER_MONEY, NOT_MONEY, inLedgerSql, isSettled, isPendingCheque, foldMillCash };
