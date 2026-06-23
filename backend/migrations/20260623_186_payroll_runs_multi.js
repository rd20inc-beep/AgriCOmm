/**
 * Allow more than one payroll run per month, so employees can be paid separately
 * (each run covers whichever employees you select, with per-employee amounts).
 * Idempotency moves from "one run per period" to "an employee can't be paid
 * twice in the same period" (enforced in the route via mill_payroll_lines).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('mill_payroll_runs', (t) => {
    t.dropUnique(['period'], 'mill_payroll_runs_period_unique');
    t.index('period', 'mill_payroll_runs_period_index');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('mill_payroll_runs', (t) => {
    t.dropIndex('period', 'mill_payroll_runs_period_index');
    t.unique(['period'], 'mill_payroll_runs_period_unique');
  });
};
