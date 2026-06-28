/**
 * Employee salary-advance recovery schedule.
 *
 * Lets a salary advance be recovered over MULTIPLE payroll runs instead of the
 * full outstanding amount being deducted from the next salary.
 *
 * Additive + back-compatible: every existing advance defaults to
 * `recovery_method = 'full_next_salary'`, which reproduces the current
 * "deduct as much as possible next payroll" behaviour, so old records keep
 * working unchanged.
 */
exports.up = async function up(knex) {
  // 1) Recovery-plan fields on the existing advance row.
  await knex.schema.alterTable('mill_worker_advances', (t) => {
    // full_next_salary | fixed_installment | salary_percentage | manual
    t.string('recovery_method', 20).notNullable().defaultTo('full_next_salary');
    t.string('recovery_start_period', 7);       // YYYY-MM (fixed_installment / salary_percentage)
    t.decimal('installment_amount', 12, 2);      // fixed_installment
    t.integer('installment_count');              // fixed_installment
    t.decimal('deduction_percent', 5, 2);        // salary_percentage (0-100)
    t.boolean('auto_deduct').notNullable().defaultTo(true);
  });

  // 2) Planned + actual recovery rows (one per period for fixed_installment;
  //    actual-recovery rows are linked to the payroll run that recovered them).
  await knex.schema.createTable('mill_worker_advance_recovery_schedule', (t) => {
    t.increments('id').primary();
    t.integer('advance_id').unsigned().notNullable()
      .references('id').inTable('mill_worker_advances').onDelete('CASCADE');
    t.integer('worker_id').unsigned()
      .references('id').inTable('mill_workers').onDelete('CASCADE');
    t.string('period', 7).notNullable();         // YYYY-MM
    t.decimal('scheduled_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('recovered_amount', 12, 2).notNullable().defaultTo(0);
    // pending | partially_recovered | recovered | skipped | cancelled
    t.string('status', 20).notNullable().defaultTo('pending');
    t.integer('payroll_run_id').unsigned()
      .references('id').inTable('mill_payroll_runs').onDelete('SET NULL');
    t.integer('payroll_line_id').unsigned()
      .references('id').inTable('mill_payroll_lines').onDelete('SET NULL');
    t.text('skip_reason');
    t.timestamp('recovered_at');
    t.timestamps(true, true);
    t.index(['advance_id']);
    t.index(['worker_id', 'period']);
    t.index(['payroll_run_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_worker_advance_recovery_schedule');
  await knex.schema.alterTable('mill_worker_advances', (t) => {
    t.dropColumn('recovery_method');
    t.dropColumn('recovery_start_period');
    t.dropColumn('installment_amount');
    t.dropColumn('installment_count');
    t.dropColumn('deduction_percent');
    t.dropColumn('auto_deduct');
  });
};
