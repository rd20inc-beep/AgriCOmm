/**
 * Per-order control of how much buyer address shows on generated documents:
 * 'country' = buyer name + country only; 'full' = full address + country.
 * Defaults to 'country'.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('export_orders', (t) => {
    t.string('doc_address_mode').notNullable().defaultTo('country');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('doc_address_mode'); });
};
