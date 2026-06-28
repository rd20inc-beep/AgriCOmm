/**
 * Optional per-worker overtime rate (Phase 7).
 *
 * Adds `ot_rate_per_hour` to mill_workers. When set, payroll values overtime at
 * this PKR/hour rate; when null it falls back to the default (daily hourly rate
 * × 1.5). Additive + back-compatible — existing workers keep the default OT
 * calculation. (Revives the previously-unused overtime concept with a real,
 * configurable rate.)
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mill_workers', (t) => {
    t.decimal('ot_rate_per_hour', 10, 2); // nullable → default 1.5× hourly
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mill_workers', (t) => {
    t.dropColumn('ot_rate_per_hour');
  });
};
