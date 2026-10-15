// What a payslip line IS, in money terms — ONE rule for every payroll report
// (P4-08 / PAY-19, PAY-20, PAY-21). The employee ledger counted prepared and
// approved lines as "Salary paid", /payroll/report summed runs of every status
// (voided and reversed included) and the analytics counted advance requests
// that were never paid out.
//
//   paid    the line was paid: it has paid_at (normal or partial pay), or its
//           run is fully paid / posted (legacy runs predate paid_at, and an
//           accrued run settled later is 'paid' with paid_at on the RUN) —
//           the rule the tax statement already used;
//   earned  the salary is on the books: paid, or the run is accrued
//           (Dr 6135 / Cr 2040 — earned but not yet paid out);
//   pending prepared / approved, or an unpaid line of a partially-paid run —
//           nothing has been booked or paid yet;
// and a voided or reversed run is none of these (a reversal also clears the
// lines' paid_at).
//
// SQL fragments use the aliases `l` (mill_payroll_lines) and `r`
// (mill_payroll_runs).

const DEAD_RUN_STATUSES = ['voided', 'reversed'];

const LIVE_SQL = `r.status NOT IN ('voided', 'reversed')`;
const PAID_SQL = `(${LIVE_SQL} AND (l.paid_at IS NOT NULL OR r.status IN ('paid', 'posted')))`;
const EARNED_SQL = `(${PAID_SQL} OR r.status = 'accrued')`;
const PENDING_SQL = `(${LIVE_SQL} AND NOT ${EARNED_SQL})`;

/** JS twin for a joined line row carrying paid_at and run_status. */
function lineState(row) {
  const st = String(row.run_status || row.status || '');
  if (DEAD_RUN_STATUSES.includes(st)) return st;
  if (row.paid_at || st === 'paid' || st === 'posted') return 'paid';
  if (st === 'accrued') return 'accrued';
  return 'pending';
}

// The ledger's `status` filter → SQL. Default: paid lines only.
const STATUS_FILTERS = {
  paid: PAID_SQL,
  accrued: `(${LIVE_SQL} AND r.status = 'accrued' AND l.paid_at IS NULL)`,
  unpaid: `(${LIVE_SQL} AND NOT ${PAID_SQL})`,
  pending: PENDING_SQL,
  voided: `r.status IN ('voided', 'reversed')`,
  all: 'TRUE',
};
function statusFilterSql(status) {
  const k = String(status || 'paid').toLowerCase();
  return STATUS_FILTERS[k] || STATUS_FILTERS.paid;
}

const ENTITIES = new Set(['mill', 'general']);
const normaliseEntity = (e) => (ENTITIES.has(String(e || '').toLowerCase()) ? String(e).toLowerCase() : null);

module.exports = {
  DEAD_RUN_STATUSES, LIVE_SQL, PAID_SQL, EARNED_SQL, PENDING_SQL,
  lineState, statusFilterSql, normaliseEntity,
};
