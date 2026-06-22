/**
 * Let a payment reference its source row directly (lot / mill_purchase /
 * export_cost / business_expense). Needed so a post-dated cheque on a purchase
 * can be settled on clearance even when the source has no stored payable to
 * link through.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('payments', (t) => {
    t.string('source_table').nullable();
    t.integer('source_id').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('payments', (t) => {
    t.dropColumn('source_table');
    t.dropColumn('source_id');
  });
};
