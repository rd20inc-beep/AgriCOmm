/**
 * Separate local-sales customers from export buyers. 'local' | 'export'.
 * Backfill: payment_terms 'Advance' = export buyers; everything else = local.
 * The Mill only ever shows 'local' customers; the export Buyers page shows
 * 'export'.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('customers', (t) => {
    t.string('customer_type').notNullable().defaultTo('local');
  });
  await knex('customers').where('payment_terms', 'Advance').update({ customer_type: 'export' });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('customers', (t) => { t.dropColumn('customer_type'); });
};
