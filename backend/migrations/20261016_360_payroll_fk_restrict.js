/**
 * Financial payroll history can no longer be removed by deleting an employee
 * or an advance (P2-10 / D-23).
 *
 * These foreign keys CASCADEd or SET NULL, so DELETE /workers/:id silently
 * took the worker's advances, final settlements and recovery schedule with it
 * and cut their payroll lines and salary expenses loose (worker_id NULL — gone
 * from tax statements and the employee ledger). They are now RESTRICT: a worker
 * with any of that history can only be deactivated.
 *
 * Non-financial children (attendance, leave, adjustments, self-service
 * requests, salary revisions) keep CASCADE — the route refuses to delete a
 * worker with financial activity before the database is asked.
 * The Danger Zone reset TRUNCATEs these tables together, so it is unaffected.
 */

const FKS = [
  // [table, column, referenced table, old ON DELETE]
  ['mill_payroll_lines', 'worker_id', 'mill_workers', 'SET NULL'],
  ['mill_worker_advances', 'worker_id', 'mill_workers', 'CASCADE'],
  ['mill_final_settlements', 'worker_id', 'mill_workers', 'CASCADE'],
  ['mill_worker_advance_recovery_schedule', 'worker_id', 'mill_workers', 'CASCADE'],
  ['mill_worker_advance_recovery_schedule', 'advance_id', 'mill_worker_advances', 'CASCADE'],
  ['business_expenses', 'employee_id', 'mill_workers', 'SET NULL'],
];

async function setFk(knex, table, column, ref, onDelete) {
  const name = `${table}_${column}_foreign`;
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${ref}(id) ON DELETE ${onDelete}`);
}

exports.up = async (knex) => {
  for (const [table, column, ref] of FKS) await setFk(knex, table, column, ref, 'RESTRICT');
};

exports.down = async (knex) => {
  for (const [table, column, ref, old] of FKS) await setFk(knex, table, column, ref, old);
};
