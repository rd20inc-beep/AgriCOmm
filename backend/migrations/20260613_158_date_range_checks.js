/**
 * Schema refinement round 50.
 *
 * Cross-column date-range sanity: every table that stores a start/end (or
 * period) pair should never have end < start. Add
 * CHECK (start IS NULL OR end IS NULL OR end >= start) — a row with the two
 * dates inverted is always an error, while either side being NULL (an
 * open-ended range, e.g. an in-progress downtime with no end_time yet) stays
 * valid.
 *
 *   accounting_periods   (period_start, period_end)
 *   customer_scores      (period_start, period_end)
 *   export_orders        (shipment_window_start, shipment_window_end)
 *   machine_downtime     (start_time, end_time)
 *   mill_performance     (period_start, period_end)
 *   production_plans     (start_time, end_time)
 *   supplier_scores      (period_start, period_end)
 *   utility_consumption  (period_start, period_end)
 *
 * Verified 0 violating rows on prod AND dev. Idempotent (guarded by
 * pg_constraint); reversible.
 */

const RANGES = [
  ['accounting_periods', 'period_start', 'period_end'],
  ['customer_scores', 'period_start', 'period_end'],
  ['export_orders', 'shipment_window_start', 'shipment_window_end'],
  ['machine_downtime', 'start_time', 'end_time'],
  ['mill_performance', 'period_start', 'period_end'],
  ['production_plans', 'start_time', 'end_time'],
  ['supplier_scores', 'period_start', 'period_end'],
  ['utility_consumption', 'period_start', 'period_end'],
];

const cname = (t) => `chk_${t}_daterange`;

exports.up = async function (knex) {
  for (const [t, s, e] of RANGES) {
    if (!(await knex.schema.hasColumn(t, s)) || !(await knex.schema.hasColumn(t, e))) continue;
    const name = cname(t);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR ?? IS NULL OR ?? >= ??)`, [t, s, e, e, s]);
  }
};

exports.down = async function (knex) {
  for (const [t] of RANGES) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${cname(t)}`, [t]);
  }
};
