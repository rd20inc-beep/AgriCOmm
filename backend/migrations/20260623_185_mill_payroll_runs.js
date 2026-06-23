/**
 * Mill payroll runs — a posted run is the integrated "Post Payroll Run":
 * it pays out the month's net salaries (cash/bank + GL), snapshots each
 * employee's pay as a payslip line, and recovers their advances.
 *
 * - mill_payroll_runs: one per period (YYYY-MM, unique → idempotent), linked to
 *   the business_expense it created (expense_id) so a run can be fully unwound.
 * - mill_payroll_lines: per-employee snapshot at post time (the payslip). worker_id
 *   is SET NULL on employee delete so payroll history survives.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('mill_payroll_runs', (t) => {
    t.increments('id').primary();
    t.string('period', 7).notNullable().unique(); // YYYY-MM
    t.date('pay_date').notNullable();
    t.string('pay_method', 20).notNullable().defaultTo('cash'); // cash | bank
    t.integer('bank_account_id').unsigned().nullable();
    t.decimal('gross_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('advance_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_total', 14, 2).notNullable().defaultTo(0);
    t.integer('employee_count').notNullable().defaultTo(0);
    t.integer('expense_id').unsigned().nullable();
    t.string('status', 20).notNullable().defaultTo('posted');
    t.text('notes').nullable();
    t.integer('created_by').unsigned().nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('mill_payroll_lines', (t) => {
    t.increments('id').primary();
    t.integer('run_id').unsigned().notNullable()
      .references('id').inTable('mill_payroll_runs').onDelete('CASCADE');
    t.integer('worker_id').unsigned().nullable()
      .references('id').inTable('mill_workers').onDelete('SET NULL');
    t.string('worker_name', 255).notNullable();
    t.string('role', 50).nullable();
    t.string('pay_type', 20).nullable();
    t.decimal('effective_days', 6, 2).notNullable().defaultTo(0);
    t.decimal('ot_hours', 6, 2).notNullable().defaultTo(0);
    t.decimal('basic_pay', 14, 2).notNullable().defaultTo(0);
    t.decimal('ot_pay', 14, 2).notNullable().defaultTo(0);
    t.decimal('gross_pay', 14, 2).notNullable().defaultTo(0);
    t.decimal('advance_deducted', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_pay', 14, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('run_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mill_payroll_lines');
  await knex.schema.dropTableIfExists('mill_payroll_runs');
};
