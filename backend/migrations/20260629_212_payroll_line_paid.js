/**
 * Partially-Paid payroll runs (Phase 16).
 *
 * Lets a run pay some employees now and the rest later. Each payslip line gets
 * its own payment state (paid_at / paid_by / expense_id = the salaries expense
 * that paid it), so a run can be 'partially_paid' until every line is paid, then
 * 'paid'. Additive + nullable — existing paid runs (lines with null paid_at)
 * still reverse via run.expense_id. status stays a free varchar (no enum), so
 * 'partially_paid' needs no constraint change.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('mill_payroll_lines', 'paid_at')) return;
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.timestamp('paid_at').nullable();
    t.integer('paid_by').nullable();
    t.integer('expense_id').nullable(); // the business_expense that paid THIS line
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('mill_payroll_lines', 'paid_at'))) return;
  await knex.schema.alterTable('mill_payroll_lines', (t) => {
    t.dropColumn('paid_at');
    t.dropColumn('paid_by');
    t.dropColumn('expense_id');
  });
};
