/**
 * Capture HOW a mill-store purchase was paid (method + account + reference +
 * date) on the row, so the Finance payment-trail can show it. The canonical
 * record is a `payments` row linked to the purchase's payable; these columns
 * mirror the most-recent payment for quick display on the purchase itself.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mill_purchases', (t) => {
    t.integer('bank_account_id').nullable();
    t.string('payment_method').nullable();
    t.string('payment_reference').nullable();
    t.date('paid_date').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mill_purchases', (t) => {
    t.dropColumn('bank_account_id');
    t.dropColumn('payment_method');
    t.dropColumn('payment_reference');
    t.dropColumn('paid_date');
  });
};
