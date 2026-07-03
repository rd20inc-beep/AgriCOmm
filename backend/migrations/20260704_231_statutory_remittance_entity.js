/**
 * Entity on statutory remittances — Head Office vs Mill (follows #147/mig 230).
 *
 * Payroll statutory liabilities (2050 Tax / 2055 EOBI) now accrue per entity, so
 * remittances to the authority are scoped/paid per entity too. Add `entity` so a
 * remittance records which books it settled ('general' = Head Office, 'mill' =
 * Mill). Existing rows backfill to 'mill' via the default. Idempotent.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_statutory_remittances')
    && !(await knex.schema.hasColumn('mill_statutory_remittances', 'entity'))) {
    await knex.schema.alterTable('mill_statutory_remittances', (t) => t.string('entity', 20).notNullable().defaultTo('mill'));
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('mill_statutory_remittances')
    && await knex.schema.hasColumn('mill_statutory_remittances', 'entity')) {
    await knex.schema.alterTable('mill_statutory_remittances', (t) => t.dropColumn('entity'));
  }
};
