/**
 * Cost-center / department tagging (Phase 22).
 *
 * Adds `department` to mill_workers (a reporting cost-center) and snapshots it on
 * mill_payroll_lines (like role) so payroll cost can be broken down by department
 * in analytics + the ledger, and history stays correct when a worker moves. GL
 * stays single-account (6135) — department is a reporting dimension, not a
 * separate GL account. Additive + nullable.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('mill_workers', 'department'))) {
    await knex.schema.alterTable('mill_workers', (t) => { t.string('department', 80).nullable(); });
  }
  if (!(await knex.schema.hasColumn('mill_payroll_lines', 'department'))) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => { t.string('department', 80).nullable(); });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('mill_payroll_lines', 'department')) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => { t.dropColumn('department'); });
  }
  if (await knex.schema.hasColumn('mill_workers', 'department')) {
    await knex.schema.alterTable('mill_workers', (t) => { t.dropColumn('department'); });
  }
};
