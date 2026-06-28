/**
 * Payroll bonuses & deductions (Phase 8).
 *
 * Adds per-employee adjustments beyond advance recovery: BONUS (adds to gross —
 * e.g. Eid bonus, performance, travel allowance) and DEDUCTION (subtracts from
 * net — e.g. fine, loan, tax). An adjustment is either one-off (a specific
 * `period` YYYY-MM) or `recurring` (applies every month). Snapshotted onto the
 * payroll line at prepare time so payslips/reports show it.
 *
 * Additive + back-compatible: existing payroll keeps working (no adjustments →
 * bonus/deduction totals are 0).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mill_worker_adjustments', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').unsigned().notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
    t.string('type', 20).notNullable();        // 'bonus' | 'deduction'
    t.string('label', 120).notNullable();      // e.g. "Eid bonus", "Late fine"
    t.decimal('amount', 12, 2).notNullable();
    t.string('period', 7);                     // YYYY-MM for a one-off; null when recurring
    t.boolean('recurring').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes');
    t.integer('created_by').unsigned();
    t.timestamps(true, true);
    t.index(['worker_id', 'is_active']);
    t.index(['period']);
  });

  // Snapshot the applied bonus/deduction totals on each payslip line.
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.decimal('bonus_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('deduction_total', 14, 2).notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.dropColumn('bonus_total');
    t.dropColumn('deduction_total');
  });
  await knex.schema.dropTableIfExists('mill_worker_adjustments');
};
