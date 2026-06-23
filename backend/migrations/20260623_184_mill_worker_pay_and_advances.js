/**
 * Mill workers: support salaried staff (not just daily wage) + salary advances.
 *
 * - mill_workers.pay_type: 'daily' (effectiveDays × daily_wage) or 'monthly'
 *   (flat monthly_salary). daily_wage stays as the per-day rate used for daily
 *   workers and for overtime math.
 * - mill_worker_advances: money paid to a worker against future wages/salary.
 *   Each advance posts a real cash-out business_expense (linked via expense_id)
 *   so it shows in Money Out / GL, and reduces the worker's net payroll until
 *   recovered.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('mill_workers', (t) => {
    t.string('pay_type', 20).notNullable().defaultTo('daily'); // 'daily' | 'monthly'
    t.decimal('monthly_salary', 12, 2).nullable();
  });

  await knex.schema.createTable('mill_worker_advances', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').unsigned().notNullable()
      .references('id').inTable('mill_workers').onDelete('CASCADE');
    t.date('advance_date').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.decimal('recovered_amount', 12, 2).notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('outstanding'); // outstanding | recovered
    // The linked cash-out (business_expenses.id) so delete can unwind it.
    t.integer('expense_id').unsigned().nullable();
    t.text('notes').nullable();
    t.integer('created_by').unsigned().nullable();
    t.timestamps(true, true);
    t.index(['worker_id', 'status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mill_worker_advances');
  await knex.schema.alterTable('mill_workers', (t) => {
    t.dropColumn('pay_type');
    t.dropColumn('monthly_salary');
  });
};
