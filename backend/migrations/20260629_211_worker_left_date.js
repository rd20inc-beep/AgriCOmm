/**
 * Monthly-salary proration support (refinement before Phase 16).
 *
 * Adds left_date (last working day) to mill_workers so a salaried employee who
 * JOINS or LEAVES partway through a month is paid only for the days employed —
 * computePayrollSummary prorates the flat monthly salary by employed-days /
 * days-in-month. Nullable + additive; existing workers (no left_date, joined
 * before the month) are unaffected (full salary as before).
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('mill_workers', 'left_date'))) {
    await knex.schema.alterTable('mill_workers', (t) => { t.date('left_date').nullable(); });
  }
  // Snapshot the proration on each payslip line (so the payslip can show
  // "X / Y days" without re-deriving). employed_days < days_in_month ⇒ prorated.
  if (!(await knex.schema.hasColumn('mill_payroll_lines', 'employed_days'))) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => {
      t.integer('employed_days').nullable();
      t.integer('days_in_month').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('mill_payroll_lines', 'employed_days')) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => { t.dropColumn('employed_days'); t.dropColumn('days_in_month'); });
  }
  if (await knex.schema.hasColumn('mill_workers', 'left_date')) {
    await knex.schema.alterTable('mill_workers', (t) => { t.dropColumn('left_date'); });
  }
};
