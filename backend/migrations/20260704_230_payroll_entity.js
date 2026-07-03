/**
 * Payroll entity split — Head Office vs Mill.
 *
 * Workers and payroll runs were implicitly all "mill". Add an `entity` column so
 * payroll can be scoped/managed per entity (a toggle in the UI), employees added
 * to either, and Head Office payroll posted to the Head Office (general) books +
 * Office Petty Cash while Mill payroll stays on the mill books / Mill Cash.
 *
 * Values mirror the system-wide convention: 'general' = Head Office, 'mill' = Mill.
 * Existing rows backfill to 'mill' via the default. Idempotent.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_workers')) {
    if (!(await knex.schema.hasColumn('mill_workers', 'entity'))) {
      await knex.schema.alterTable('mill_workers', (t) => t.string('entity', 20).notNullable().defaultTo('mill'));
    }
  }
  if (await knex.schema.hasTable('mill_payroll_runs')) {
    if (!(await knex.schema.hasColumn('mill_payroll_runs', 'entity'))) {
      await knex.schema.alterTable('mill_payroll_runs', (t) => t.string('entity', 20).notNullable().defaultTo('mill'));
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('mill_payroll_runs') && await knex.schema.hasColumn('mill_payroll_runs', 'entity')) {
    await knex.schema.alterTable('mill_payroll_runs', (t) => t.dropColumn('entity'));
  }
  if (await knex.schema.hasTable('mill_workers') && await knex.schema.hasColumn('mill_workers', 'entity')) {
    await knex.schema.alterTable('mill_workers', (t) => t.dropColumn('entity'));
  }
};
