/**
 * Payroll approval workflow.
 *
 * Adds the state-machine bookkeeping columns to mill_payroll_runs so a run moves
 * Prepared → Approved → Paid (or Voided), with cash/GL posting deferred to the
 * Pay step. created_by/created_at already serve as prepared_by/prepared_at.
 *
 * Additive + back-compatible: existing runs keep status='posted', which the app
 * treats as already-paid (legacy). No data is rewritten.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mill_payroll_runs', (t) => {
    t.integer('approved_by').unsigned();
    t.timestamp('approved_at');
    t.integer('paid_by').unsigned();
    t.timestamp('paid_at');
    t.integer('voided_by').unsigned();
    t.timestamp('voided_at');
    t.text('void_reason');
  });
  // Persist the per-line skip/changed-deduction reason so it can be applied when
  // the run is actually PAID (recovery now happens at pay, not at prepare).
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.text('skip_reason');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.dropColumn('skip_reason');
  });
  await knex.schema.alterTable('mill_payroll_runs', (t) => {
    t.dropColumn('approved_by');
    t.dropColumn('approved_at');
    t.dropColumn('paid_by');
    t.dropColumn('paid_at');
    t.dropColumn('voided_by');
    t.dropColumn('voided_at');
    t.dropColumn('void_reason');
  });
};
