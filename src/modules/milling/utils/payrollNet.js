// "Paying now" on a payroll line (owner decision B3): it may be lowered below
// the computed net, never raised, and a lowered figure needs a reason. The
// server (payroll.service resolvePrepareLine) treats anything within Rs 1 of
// the computed net as the net itself, so the screen does the same.

/** True when `paying` is a real reduction of the computed net (more than Rs 1 below it). */
export function isNetLowered(paying, computedNet) {
  const p = Number(paying);
  const c = Math.round(Number(computedNet) || 0);
  return Number.isFinite(p) && p < c - 1;
}

/** The included rows still missing the reason a lowered amount needs. */
export function rowsMissingNetReason(rows, netOf) {
  return (rows || []).filter((r) => isNetLowered(r.net, netOf(r, r.advance)) && !String(r.netReason || '').trim());
}

/** The prepare-line field the server reads: the reason, only when lowered. */
export function netOverrideReasonFor(row, computedNet) {
  return isNetLowered(row.net, computedNet) ? (String(row.netReason || '').trim() || null) : null;
}
