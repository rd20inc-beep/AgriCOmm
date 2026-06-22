/**
 * Buyer's default destination/discharge port — selectable on the customer and
 * optionally printed on documents (via export_orders.doc_address_mode).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('customers', (t) => {
    t.string('port');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('customers', (t) => { t.dropColumn('port'); });
};
