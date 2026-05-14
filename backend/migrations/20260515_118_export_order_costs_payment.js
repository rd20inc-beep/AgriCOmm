/**
 * Add payment-tracking columns to export_order_costs so the unified
 * /finance/purchases view can mark export-side costs as paid the same
 * way it does for lots, mill purchases and business expenses.
 *
 * Until this migration, listPurchases hardcoded payment_status='Pending'
 * for export_cost rows, leaving the user no way to settle a recorded
 * rice procurement or transport cost from the finance dashboard.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('export_order_costs', (t) => {
    t.string('payment_status', 20).notNullable().defaultTo('Pending');
    t.decimal('paid_amount', 15, 2).notNullable().defaultTo(0);
    t.timestamp('paid_at').nullable();
    t.integer('bank_account_id').unsigned().nullable().references('id').inTable('bank_accounts').onDelete('SET NULL');
    t.string('payment_method', 20).nullable();
    t.string('payment_reference', 100).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('export_order_costs', (t) => {
    t.dropColumn('payment_status');
    t.dropColumn('paid_amount');
    t.dropColumn('paid_at');
    t.dropColumn('bank_account_id');
    t.dropColumn('payment_method');
    t.dropColumn('payment_reference');
  });
};
