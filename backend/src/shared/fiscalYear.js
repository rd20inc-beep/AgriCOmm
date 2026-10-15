// The fiscal year (owner decision D-1, 2026-10-16): the Pakistani tax year,
// 1 July – 30 June, in monthly periods. "FY 2026-27" runs 2026-07-01 to
// 2027-06-30. Its quarters are Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun, which are
// also calendar quarters.
//
// One small module so every KPI, report and the period-management work
// resolve the same bounds. Days are 'YYYY-MM-DD' strings throughout, read in
// the server's local time (the business runs in one time zone), so no
// UTC shift can move a day across a month or year boundary.

const FY_START_MONTH = 7; // July

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' from a Date (local time) or a date string, else null. */
function isoDay(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const parts = (day) => {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
};

/** Last day of a month as 'YYYY-MM-DD'. */
function monthEnd(y, m) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(last)}`;
}

/** The fiscal year containing `day`: { startYear, label, start, end }. */
function fiscalYearOf(day) {
  const iso = isoDay(day);
  if (!iso) throw new Error(`fiscalYearOf: not a date: ${day}`);
  const { y, m } = parts(iso);
  const startYear = m >= FY_START_MONTH ? y : y - 1;
  return {
    startYear,
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: `${startYear}-${pad(FY_START_MONTH)}-01`,
    end: monthEnd(startYear + 1, FY_START_MONTH - 1),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PERIOD_KEYS = ['month', 'quarter', 'fytd', 'fy', 'all', 'custom'];

/**
 * A period key → inclusive day bounds.
 *   month   the calendar month containing `today`
 *   quarter the fiscal quarter containing `today` (Q1 = Jul–Sep)
 *   fytd    the fiscal year's first day → today
 *   fy      the whole fiscal year containing `today`
 *   all     no bounds (from / to null)
 *   custom  the given from / to (either may be open)
 * Returns { key, from, to, label, fiscalYear }. An unknown key is an error
 * (status 400) — a typo must not silently become "all time".
 */
function resolvePeriod({ period = 'month', from = null, to = null, today = new Date() } = {}) {
  const key = String(period || 'month').toLowerCase();
  if (!PERIOD_KEYS.includes(key)) {
    const e = new Error(`Unknown period '${period}'. Use one of: ${PERIOD_KEYS.join(', ')}.`);
    e.status = 400;
    throw e;
  }
  const t = isoDay(today);
  const { y, m } = parts(t);
  const fy = fiscalYearOf(t);
  if (key === 'month') {
    return { key, from: `${y}-${pad(m)}-01`, to: monthEnd(y, m), label: `${MONTHS[m - 1]} ${y}`, fiscalYear: fy.label };
  }
  if (key === 'quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const fq = ((Math.floor((m - FY_START_MONTH + 12) % 12 / 3)) + 1);
    return {
      key, from: `${y}-${pad(qStart)}-01`, to: monthEnd(y, qStart + 2),
      label: `Q${fq} ${fy.label}`, fiscalYear: fy.label,
    };
  }
  if (key === 'fytd') return { key, from: fy.start, to: t, label: `${fy.label} to date`, fiscalYear: fy.label };
  if (key === 'fy') return { key, from: fy.start, to: fy.end, label: fy.label, fiscalYear: fy.label };
  if (key === 'all') return { key, from: null, to: null, label: 'All time', fiscalYear: null };
  const f = from ? isoDay(from) : null;
  const tt = to ? isoDay(to) : null;
  if ((from && !f) || (to && !tt)) {
    const e = new Error('from / to must be dates (YYYY-MM-DD).');
    e.status = 400;
    throw e;
  }
  if (f && tt && f > tt) {
    const e = new Error('from must not be after to.');
    e.status = 400;
    throw e;
  }
  return { key, from: f, to: tt, label: `${f || '…'} – ${tt || '…'}`, fiscalYear: null };
}

module.exports = { FY_START_MONTH, PERIOD_KEYS, isoDay, fiscalYearOf, resolvePeriod, monthEnd };
