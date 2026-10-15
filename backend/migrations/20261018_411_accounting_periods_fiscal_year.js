/**
 * P4-13 / FIN-06 — accounting periods on the Pakistani fiscal year (owner
 * decision D-1, 2026-10-16: 1 July – 30 June, monthly periods).
 *
 *   1. accounting_periods.fy_label  — the fiscal year a period belongs to,
 *      "2026-27" for July 2026 – June 2027. Additive: `fiscal_year` keeps its
 *      existing meaning (the CALENDAR year of the month, part of the unique
 *      (fiscal_year, name) key) and is not rewritten.
 *
 *   2. Month boundaries. Migration 012 seeded the 2026 months with
 *      new Date(2026, m, 1).toISOString(), which shifts every boundary back a
 *      day when the database host runs east of UTC (Pakistan, UTC+5): "Jan
 *      2026" became 31 Dec 2025 – 30 Jan 2026, and 31 Dec 2026 fell in no
 *      period at all. A seeded period whose dates are not its month's 1st and
 *      last day is realigned to them — but only while it is OPEN (an open
 *      period has never locked anything, so moving its edge changes no
 *      report that was signed off). A Closed / Locked misaligned period is left
 *      exactly as it is and logged; scripts/detectPeriodIntegrity.js lists it
 *      and docs/runbooks/accounting-periods.md says what to do. Journals are
 *      never touched: their period_id is left as it was posted (period logic
 *      now resolves a journal's period from its DATE).
 *
 *   3. UNIQUE (period_start) — so a period created on demand (a journal dated
 *      in a month that has none) can never be created twice by two postings at
 *      once. Skipped with a warning if duplicates exist.
 *
 * down() drops the column and the index (the realigned dates stay — they are
 * the correct month boundaries).
 */
const { fiscalYearOf, monthOf, fyLabelOf } = require('../src/shared/fiscalYear');

const MONTH_NAME = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10));

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('accounting_periods', 'fy_label'))) {
    await knex.schema.alterTable('accounting_periods', (t) => {
      t.string('fy_label', 9).nullable();
    });
  }

  // ── Realign month periods whose boundaries are off ──
  const periods = await knex('accounting_periods').select('id', 'name', 'period_start', 'period_end', 'status');
  let realigned = 0; let leftAlone = 0;
  for (const p of periods) {
    const m = String(p.name || '').match(MONTH_NAME);
    if (!m) continue;
    const month = monthOf(`${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-01`);
    if (day(p.period_start) === month.start && day(p.period_end) === month.end) continue;
    if (p.status !== 'Open') { leftAlone += 1; continue; }
    await knex('accounting_periods').where({ id: p.id })
      .update({ period_start: month.start, period_end: month.end, updated_at: knex.fn.now() });
    realigned += 1;
  }
  if (realigned) console.log(`[411] Realigned ${realigned} open month period(s) to their calendar month.`);
  if (leftAlone) console.warn(`[411] ${leftAlone} misaligned period(s) are not Open — left unchanged; see scripts/detectPeriodIntegrity.js.`);

  // ── fy_label from each period's start ──
  for (const p of await knex('accounting_periods').select('id', 'period_start')) {
    await knex('accounting_periods').where({ id: p.id })
      .update({ fy_label: fyLabelOf(fiscalYearOf(day(p.period_start)).startYear) });
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_accounting_periods_fy_label ON accounting_periods (fy_label)');

  // ── One period per start date ──
  const dup = await knex.raw('SELECT 1 FROM accounting_periods GROUP BY period_start HAVING COUNT(*) > 1 LIMIT 1');
  if (dup.rows.length) {
    console.warn('[411] Skipping UNIQUE (period_start) — duplicate periods present; see scripts/detectPeriodIntegrity.js.');
  } else {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_periods_start ON accounting_periods (period_start)');
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_accounting_periods_start');
  await knex.raw('DROP INDEX IF EXISTS idx_accounting_periods_fy_label');
  if (await knex.schema.hasColumn('accounting_periods', 'fy_label')) {
    await knex.schema.alterTable('accounting_periods', (t) => { t.dropColumn('fy_label'); });
  }
};
