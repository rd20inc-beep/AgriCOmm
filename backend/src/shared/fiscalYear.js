/**
 * The company's fiscal year (owner decision D-1, 2026-10-16): the Pakistani
 * tax year, 1 July – 30 June, in monthly accounting periods.
 *
 * A fiscal year is named by the two calendar years it spans — "FY 2026-27" is
 * 1 July 2026 – 30 June 2027 — the same "2026-27" form payroll's tax
 * statements already use. `startYear` is the calendar year it starts in.
 *
 * Pure date arithmetic on 'YYYY-MM-DD' strings (no time zones): a DATE column
 * or a Date at local midnight both resolve to the day they name.
 */

const FY_START_MONTH = 7; // July

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' from a Date / date string, else null. */
function dayOf(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Last day of a calendar month (month 1–12). */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-27" for the fiscal year starting in July 2026. */
function fyLabelOf(startYear) {
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

/** The fiscal year starting in July of `startYear`: { start, end, label, startYear }. */
function fiscalYearStarting(startYear) {
  const y = parseInt(startYear, 10);
  if (!Number.isFinite(y)) throw new Error(`Not a fiscal year: ${startYear}`);
  return {
    start: `${y}-${pad(FY_START_MONTH)}-01`,
    end: `${y + 1}-${pad(FY_START_MONTH - 1)}-${lastDayOfMonth(y + 1, FY_START_MONTH - 1)}`,
    label: `FY ${fyLabelOf(y)}`,
    startYear: y,
  };
}

/** The fiscal year a date falls in: { start, end, label, startYear }. */
function fiscalYearOf(date = new Date()) {
  const d = dayOf(date);
  if (!d) throw new Error(`Not a date: ${date}`);
  const y = parseInt(d.slice(0, 4), 10);
  const m = parseInt(d.slice(5, 7), 10);
  return fiscalYearStarting(m >= FY_START_MONTH ? y : y - 1);
}

/** The calendar month a date falls in: { start, end, name, year, month }. */
function monthOf(date) {
  const d = dayOf(date);
  if (!d) throw new Error(`Not a date: ${date}`);
  const year = parseInt(d.slice(0, 4), 10);
  const month = parseInt(d.slice(5, 7), 10);
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
    name: `${MONTHS[month - 1]} ${year}`,
    year,
    month,
  };
}

/** The twelve monthly periods of the fiscal year starting in July `startYear`. */
function monthsOfFiscalYear(startYear) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((FY_START_MONTH - 1 + i) % 12) + 1;
    const y = m >= FY_START_MONTH ? startYear : startYear + 1;
    out.push(monthOf(`${y}-${pad(m)}-01`));
  }
  return out;
}

/** Last day of a month as 'YYYY-MM-DD'. */
function monthEnd(y, m) {
  return `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`;
}

const PERIOD_KEYS = ['month', 'quarter', 'fytd', 'fy', 'all', 'custom'];

const periodError = (message) => {
  const e = new Error(message);
  e.status = 400;
  return e;
};

/**
 * A period key → inclusive day bounds (the KPI period picker).
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
  if (!PERIOD_KEYS.includes(key)) throw periodError(`Unknown period '${period}'. Use one of: ${PERIOD_KEYS.join(', ')}.`);
  const t = dayOf(today);
  const y = parseInt(t.slice(0, 4), 10);
  const m = parseInt(t.slice(5, 7), 10);
  const fy = fiscalYearOf(t);
  if (key === 'month') {
    return { key, from: `${y}-${pad(m)}-01`, to: monthEnd(y, m), label: `${MONTHS[m - 1]} ${y}`, fiscalYear: fy.label };
  }
  if (key === 'quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const fq = Math.floor(((m - FY_START_MONTH + 12) % 12) / 3) + 1;
    return { key, from: `${y}-${pad(qStart)}-01`, to: monthEnd(y, qStart + 2), label: `Q${fq} ${fy.label}`, fiscalYear: fy.label };
  }
  if (key === 'fytd') return { key, from: fy.start, to: t, label: `${fy.label} to date`, fiscalYear: fy.label };
  if (key === 'fy') return { key, from: fy.start, to: fy.end, label: fy.label, fiscalYear: fy.label };
  if (key === 'all') return { key, from: null, to: null, label: 'All time', fiscalYear: null };
  const f = from ? dayOf(from) : null;
  const tt = to ? dayOf(to) : null;
  if ((from && !f) || (to && !tt)) throw periodError('from / to must be dates (YYYY-MM-DD).');
  if (f && tt && f > tt) throw periodError('from must not be after to.');
  return { key, from: f, to: tt, label: `${f || '…'} – ${tt || '…'}`, fiscalYear: null };
}

module.exports = {
  FY_START_MONTH,
  PERIOD_KEYS,
  dayOf,
  isoDay: dayOf,
  fiscalYearOf,
  fiscalYearStarting,
  fyLabelOf,
  monthOf,
  monthEnd,
  monthsOfFiscalYear,
  resolvePeriod,
};
