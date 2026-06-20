/**
 * Capture WHERE a local-sale payment was collected. For cash / credit sales the
 * operator records the collection point (Mill or Head Office); bank transfers
 * and cheques attach a bank_account_id / cheque number on the payment row
 * (those columns already exist on `payments`). Nullable for back-compat.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'collection_location');
  if (!has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.string('collection_location').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('local_sales', 'collection_location');
  if (has) {
    await knex.schema.alterTable('local_sales', (t) => {
      t.dropColumn('collection_location');
    });
  }
};
