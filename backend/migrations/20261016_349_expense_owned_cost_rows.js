/**
 * P2-21 — a cost row created by a business expense belongs to that expense.
 *
 * A mill expense booked against a batch, or an export expense against an
 * order, writes its own payable (PAY-EXP…) AND a cost row (milling_costs /
 * export_order_costs) so the batch / order costing sees it. The payables feed
 * then re-derived that cost row as a second bill (MC-… / EC-…), and Purchases
 * listed it as an export cost payable on its own — paying one left the other
 * outstanding, or both got paid.
 *
 * `business_expense_id` marks the cost rows an expense owns: they still count
 * in the batch / order costing, but are never a bill of their own (the
 * expense's payable is). Nullable; ON DELETE SET NULL. Rows written before
 * this are linked by scripts/linkExpenseCostRows.js (dry-run by default).
 */
exports.up = async function up(knex) {
  for (const table of ['milling_costs', 'export_order_costs']) {
    if (!(await knex.schema.hasColumn(table, 'business_expense_id'))) {
      await knex.schema.alterTable(table, (t) => {
        t.integer('business_expense_id').nullable()
          .references('id').inTable('business_expenses').onDelete('SET NULL');
        t.index(['business_expense_id'], `idx_${table}_business_expense_id`);
      });
    }
  }
};

exports.down = async function down(knex) {
  for (const table of ['milling_costs', 'export_order_costs']) {
    if (await knex.schema.hasColumn(table, 'business_expense_id')) {
      await knex.schema.alterTable(table, (t) => {
        t.dropIndex(['business_expense_id'], `idx_${table}_business_expense_id`);
        t.dropColumn('business_expense_id');
      });
    }
  }
};
