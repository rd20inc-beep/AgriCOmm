/**
 * P4-13 / FIN-06 — accounting periods for the prior, current and next fiscal
 * years (owner decision D-1: Pakistani tax year, 1 July – 30 June, monthly).
 *
 * Periods existed only for January – December 2026, so from 1 January 2027 a
 * journal got no period and could never be locked. This creates every missing
 * month of FY 2025-26, FY 2026-27 and FY 2027-28 (July 2025 – June 2028), all
 * OPEN — nothing is closed by a migration. Months that already have a period
 * keep it untouched. Later years are created on demand (a posting in a month
 * with no period creates it) and ahead of time by the server, which keeps the
 * current and the next fiscal year in place, or from Accounting ▸ Periods.
 *
 * Additive; no journal changes. down() removes only the periods this created
 * that no journal references and that are still Open.
 */
const { fiscalYearStarting, fyLabelOf, monthsOfFiscalYear } = require('../src/shared/fiscalYear');

const START_YEARS = [2025, 2026, 2027];

exports.up = async function up(knex) {
  let created = 0;
  for (const y of START_YEARS) {
    for (const month of monthsOfFiscalYear(y)) {
      const covered = await knex('accounting_periods')
        .where('period_start', '<=', month.start).andWhere('period_end', '>=', month.start).first();
      if (covered) continue;
      await knex('accounting_periods').insert({
        name: month.name,
        period_start: month.start,
        period_end: month.end,
        fiscal_year: month.year,
        fy_label: fyLabelOf(y),
        status: 'Open',
      }).onConflict().ignore();
      created += 1;
    }
  }
  if (created) console.log(`[412] Created ${created} open month period(s) for FY 2025-26 – FY 2027-28.`);
};

exports.down = async function down(knex) {
  const first = fiscalYearStarting(START_YEARS[0]).start;
  const last = fiscalYearStarting(START_YEARS[START_YEARS.length - 1]).end;
  await knex('accounting_periods')
    .where('period_start', '>=', first).andWhere('period_end', '<=', last)
    .where('status', 'Open')
    .whereNot('fiscal_year', 2026) // the 2026 months predate this migration (012)
    .whereNotExists(knex('journal_entries').whereRaw('journal_entries.period_id = accounting_periods.id'))
    .del();
};
