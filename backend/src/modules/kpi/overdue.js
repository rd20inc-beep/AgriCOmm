// "Overdue" (owner decision D-15, 2026-10-16): a receivable is overdue when it
// is past its EFFECTIVE due date AND something is still outstanding on it.
//
//   effective due = for an export order's BALANCE: the sailing date + the
//                   balance term — COALESCE(bl_date, atd) + the order's
//                   balance_term_days, else the system setting
//                   export_balance_term_days (C6, 2026-10-09). A balance whose
//                   order has not sailed has NO due date yet, whatever
//                   placeholder due_date the row carries — it is never overdue.
//                   every other receivable: its own due_date.
//   overdue       = effective due < as-of day AND outstanding > 0, on a row
//                   that is not Written Off, of an order that is not Draft /
//                   Cancelled.
//
// Four definitions were in use (a status word never written to export rows,
// raw due_date < today, due-date aging, and the collection rate's effective
// due), so Money In, the Finance overview and the collection tile disagreed.
// Every overdue figure now reads these expressions.
//
// Contract: overdue.v1 — docs/AGRIRICE_KPI_CONTRACTS.md.

const DEFAULT_BALANCE_TERM_DAYS = 30;

/** The system balance term (setting export_balance_term_days), else 30. */
async function balanceTermDays(conn) {
  const row = await conn('system_settings').where({ key: 'export_balance_term_days' }).first();
  const n = parseFloat(row && row.value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BALANCE_TERM_DAYS;
}

const termInt = (termDays) => {
  const n = parseInt(termDays, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BALANCE_TERM_DAYS;
};

/**
 * SQL date: a receivable's effective due date. `r` is the receivables alias,
 * `o` the export_orders alias LEFT JOINed on o.id = r.order_id. The term is a
 * validated integer, so it is inlined.
 */
function effectiveDueSql({ r = 'r', o = 'o', termDays = DEFAULT_BALANCE_TERM_DAYS } = {}) {
  const term = termInt(termDays);
  return `(CASE
      WHEN ${r}.type = 'Balance' AND ${r}.order_id IS NOT NULL THEN
        CASE WHEN COALESCE(${o}.bl_date, ${o}.atd) IS NULL THEN NULL
             ELSE (COALESCE(${o}.bl_date, ${o}.atd) + COALESCE(${o}.balance_term_days, ${term})::int)::date END
      ELSE ${r}.due_date::date
    END)`;
}

/**
 * SQL boolean: the receivable is overdue as of CURRENT_DATE (or `asOfSql`).
 * Needs export_orders `o` LEFT JOINed on o.id = r.order_id.
 */
function overdueSql({ r = 'r', o = 'o', termDays, asOfSql = 'CURRENT_DATE' } = {}) {
  return `(COALESCE(${r}.outstanding, 0) > 0.004
      AND COALESCE(${r}.status, '') NOT IN ('Paid', 'Written Off')
      AND (${r}.order_id IS NULL OR COALESCE(${o}.status, '') NOT IN ('Draft', 'Cancelled'))
      AND COALESCE(${effectiveDueSql({ r, o, termDays })} < ${asOfSql}, FALSE))`;
}

// The same rule for a payable (money we owe): past its due_date with
// something outstanding, and neither Paid, Written Off nor Reversed.
const CLOSED_PAYABLE_STATUSES = ['Paid', 'Written Off', 'Reversed'];
function payableOverdueSql({ p = 'payables', asOfSql = 'CURRENT_DATE' } = {}) {
  return `(COALESCE(${p}.outstanding, 0) > 0.004
      AND COALESCE(${p}.status, '') NOT IN (${CLOSED_PAYABLE_STATUSES.map((s) => `'${s}'`).join(', ')})
      AND ${p}.due_date IS NOT NULL AND ${p}.due_date::date < ${asOfSql})`;
}

// 'YYYY-MM-DD' from a Date (local) / date string, else null.
function dayOf(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * JS twin of effectiveDueSql. receivable { type, order_id, due_date },
 * order { bl_date, atd, balance_term_days } (may be null).
 */
function effectiveDue(receivable = {}, order = null, termDays = DEFAULT_BALANCE_TERM_DAYS) {
  if (receivable.type === 'Balance' && receivable.order_id != null) {
    const sailed = order ? (dayOf(order.bl_date) || dayOf(order.atd)) : null;
    if (!sailed) return null;
    const raw = order.balance_term_days;
    const days = raw === null || raw === undefined || raw === '' ? termInt(termDays) : termInt(raw);
    const d = new Date(`${sailed}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  return dayOf(receivable.due_date);
}

/** JS twin of payableOverdueSql. payable { outstanding, status, due_date }. */
function isPayableOverdue(payable = {}, { asOf } = {}) {
  const today = dayOf(asOf || new Date());
  if (!(parseFloat(payable.outstanding) > 0.004)) return false;
  if (CLOSED_PAYABLE_STATUSES.includes(payable.status)) return false;
  const due = dayOf(payable.due_date);
  return !!due && due < today;
}

/** JS twin of overdueSql. */
function isOverdue(receivable = {}, order = null, { termDays, asOf } = {}) {
  const today = dayOf(asOf || new Date());
  if (!(parseFloat(receivable.outstanding) > 0.004)) return false;
  if (['Paid', 'Written Off'].includes(receivable.status)) return false;
  if (receivable.order_id != null && order && ['Draft', 'Cancelled'].includes(order.status)) return false;
  const due = effectiveDue(receivable, order, termDays);
  return !!due && due < today;
}

module.exports = {
  DEFAULT_BALANCE_TERM_DAYS, CLOSED_PAYABLE_STATUSES, balanceTermDays,
  effectiveDueSql, overdueSql, payableOverdueSql, effectiveDue, isOverdue, isPayableOverdue, dayOf,
};
