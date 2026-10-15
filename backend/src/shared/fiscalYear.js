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

module.exports = {
  FY_START_MONTH,
  dayOf,
  fiscalYearOf,
  fiscalYearStarting,
  fyLabelOf,
  monthOf,
  monthsOfFiscalYear,
};
