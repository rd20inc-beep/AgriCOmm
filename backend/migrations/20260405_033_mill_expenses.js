/**
 * Mill overhead expenses: salaries, rent, utilities, maintenance, etc.
 * These are NOT batch-specific — they're monthly/periodic mill-wide costs.
 */
exports.up = function (knex) {
  return knex.schema.createTable('mill_expenses', (table) => {
    table.increments('id').primary();
    table.integer('mill_id').unsigned().nullable().references('id').inTable('mills');
    table.string('category', 50).notNullable(); // salaries, utilities, rent, maintenance, insurance, transport, misc
    table.string('description', 255).nullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('currency', 10).defaultTo('PKR');
    table.date('expense_date').notNullable();
    table.string('period', 20).nullable(); // e.g. "2026-04", "2026-Q1"
    table.string('payment_method', 30).nullable(); // cash, bank, cheque
    table.string('reference', 100).nullable(); // receipt/invoice ref
    table.text('notes').nullable();
    table.integer('created_by').unsigned().nullable().references('id').inTable('users');
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('mill_expenses');
};
