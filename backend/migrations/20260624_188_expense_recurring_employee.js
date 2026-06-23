/**
 * Make business expenses richer: flag recurring ones (with a cadence) and link a
 * salary expense to the employee it pays. Drives the dynamic Mill "Add Expense"
 * drawer (employee picker for salaries; recurring toggle for any category).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('business_expenses', (t) => {
    t.boolean('is_recurring').notNullable().defaultTo(false);
    t.string('recurrence', 20).nullable(); // monthly | weekly | quarterly | yearly
    t.integer('employee_id').unsigned().nullable()
      .references('id').inTable('mill_workers').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('business_expenses', (t) => {
    t.dropColumn('is_recurring');
    t.dropColumn('recurrence');
    t.dropColumn('employee_id');
  });
};
