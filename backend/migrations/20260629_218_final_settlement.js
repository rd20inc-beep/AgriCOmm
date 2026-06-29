/**
 * End-of-service final settlement (Phase 25).
 *
 * When a worker leaves: one payout = final (prorated) salary + leave encashment
 * + gratuity − outstanding advances − other deductions. The components are
 * COMPUTED as suggestions and admin-editable; finalizing posts the net as a paid
 * salaries expense (reuses the 6135/cash GL), clears outstanding advances,
 * stamps left_date + deactivates the worker, and stores the settlement record
 * (for the printable voucher + history). No new GL accounts.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_final_settlements')) return;
  await knex.schema.createTable('mill_final_settlements', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
    t.date('settlement_date').notNullable();
    t.date('left_date').nullable();
    t.decimal('service_years', 6, 2).nullable();
    t.decimal('final_salary', 14, 2).notNullable().defaultTo(0);
    t.decimal('leave_encashment', 14, 2).notNullable().defaultTo(0);
    t.decimal('gratuity', 14, 2).notNullable().defaultTo(0);
    t.decimal('advances_deducted', 14, 2).notNullable().defaultTo(0);
    t.decimal('other_deductions', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_amount', 14, 2).notNullable().defaultTo(0);
    t.string('pay_method', 20).notNullable().defaultTo('cash');
    t.integer('bank_account_id').nullable();
    t.text('notes').nullable();
    t.integer('expense_id').nullable();
    t.jsonb('breakdown').nullable(); // snapshot of leave-encashment lines etc.
    t.integer('created_by').nullable();
    t.timestamps(true, true);
    t.index(['worker_id'], 'idx_final_settle_worker');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_final_settlements');
};
