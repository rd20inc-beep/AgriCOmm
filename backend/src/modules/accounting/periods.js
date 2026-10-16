/**
 * Accounting periods (owner decision D-1, 2026-10-16).
 *
 *   - The fiscal year is the Pakistani tax year, 1 July – 30 June, in monthly
 *     periods (shared/fiscalYear.js). A period row is one calendar month.
 *   - A period exists for every date anything posts on: a journal or a money
 *     movement dated in a month with no period creates that month's period,
 *     Open (ensurePeriodForDate). Whole fiscal years can be created ahead of
 *     time (ensureFiscalYear) — the server keeps the current and the next one
 *     in place.
 *   - The Finance Manager closes a month; only the Owner reopens it, with a
 *     reason (accounting.routes.js). Nothing dated in a Closed / Locked period
 *     may post — a journal, a reversal, or a bank / cash movement
 *     (assertDateOpen) — so a closed month's books never change. Closing never
 *     alters a posted journal.
 *   - A period is resolved from a DATE, never from journal_entries.period_id
 *     (older rows may carry a stale or empty period_id).
 */
const { LedgerPostingError } = require('../../shared/errors');
const { dayOf, fiscalYearOf, fiscalYearStarting, fyLabelOf, monthOf, monthsOfFiscalYear } = require('../../shared/fiscalYear');

const OPEN = 'Open';

/** The period row covering `date` ('YYYY-MM-DD'), or undefined. */
function periodForDate(knex, date) {
  const d = dayOf(date);
  return knex('accounting_periods')
    .where('period_start', '<=', d)
    .where('period_end', '>=', d)
    .first();
}

/** Insert the month period for `month` (from monthOf) unless one already starts there. */
async function insertMonth(knex, month) {
  await knex('accounting_periods')
    .insert({
      name: month.name,
      period_start: month.start,
      period_end: month.end,
      fiscal_year: month.year,
      fy_label: fyLabelOf(fiscalYearOf(month.start).startYear),
      status: OPEN,
    })
    .onConflict()
    .ignore();
}

/**
 * The period covering `date`, created (Open) when the month has none. Safe
 * under concurrency: the insert ignores a conflict on the unique start date
 * (or name) and the row is read back.
 */
async function ensurePeriodForDate(knex, date) {
  // A value that is not a date (e.g. knex.fn.now()) means "today".
  const d = dayOf(date) || dayOf(new Date());
  const found = await periodForDate(knex, d);
  if (found) return found;
  await insertMonth(knex, monthOf(d));
  return periodForDate(knex, d);
}

/**
 * Create the twelve monthly periods of the fiscal year starting in July
 * `startYear` (each Open). Months that already have a period are left as they
 * are. Returns { fiscalYear, created, periods }.
 */
async function ensureFiscalYear(knex, startYear) {
  const fy = fiscalYearStarting(startYear);
  let created = 0;
  for (const month of monthsOfFiscalYear(fy.startYear)) {
    if (await periodForDate(knex, month.start)) continue;
    await insertMonth(knex, month);
    created += 1;
  }
  const periods = await knex('accounting_periods')
    .where('period_start', '>=', fy.start)
    .andWhere('period_end', '<=', fy.end)
    .orderBy('period_start');
  return { fiscalYear: fy, created, periods };
}

/** Keep the current and the next fiscal year's periods in place. */
async function ensureCurrentAndNextFiscalYear(knex, today = new Date()) {
  const fy = fiscalYearOf(today);
  const current = await ensureFiscalYear(knex, fy.startYear);
  const next = await ensureFiscalYear(knex, fy.startYear + 1);
  return { created: current.created + next.created };
}

/**
 * Refuse anything dated in a period that is not Open. `what` names the thing
 * being refused ("post this journal", "record this payment"). Creates the
 * month's period first when it has none, so every posting date has one.
 * Returns the (Open) period.
 */
async function assertDateOpen(knex, date, what = 'post') {
  const period = await ensurePeriodForDate(knex, date);
  if (period && period.status !== OPEN) {
    throw new LedgerPostingError(
      `Accounting period '${period.name}' is ${period.status}. Cannot ${what} dated ${dayOf(date) || 'today'}; the Owner must reopen the period, or date it in an open period.`,
      'period_closed',
      { period_id: period.id, period: period.name, status: period.status },
    );
  }
  return period;
}

/**
 * Where a report's as-at date sits in the period calendar: the period, its
 * status, and whether its figures are FINAL (the period is closed — nothing
 * more can post inside it) or provisional (still open). `period` is null when
 * no period covers the date.
 */
async function periodStatusAsOf(knex, date) {
  const d = dayOf(date || new Date());
  const p = await periodForDate(knex, d);
  if (!p) return { asOf: d, period: null, status: null, final: false, fiscalYear: fiscalYearOf(d).label };
  return {
    asOf: d,
    period: { id: p.id, name: p.name, start: dayOf(p.period_start), end: dayOf(p.period_end) },
    status: p.status,
    final: p.status !== OPEN,
    fiscalYear: fiscalYearOf(d).label,
  };
}

module.exports = {
  periodForDate,
  ensurePeriodForDate,
  ensureFiscalYear,
  ensureCurrentAndNextFiscalYear,
  assertDateOpen,
  periodStatusAsOf,
};
