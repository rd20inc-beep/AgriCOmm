/**
 * Schema refinement (round 2). Closes the FK/index gaps introduced this cycle:
 *
 *  - Index the two fund_transfers FK columns that were left without a covering
 *    index (accepted_by, created_by) — PostgreSQL only auto-indexes the referenced
 *    PK side, so an un-indexed referencing column forces a seq scan on cascade.
 *  - Add the missing FK constraints (+ indexes) for the two expense_id columns that
 *    always reference business_expenses but were never constrained: mill_payroll_
 *    runs.expense_id and mill_worker_advances.expense_id. ON DELETE SET NULL so the
 *    existing expense-unwind / reset flows still work (verified 0 orphan rows on
 *    prod before adding). The remaining *_id columns without FKs (linked_id,
 *    entity_id, reference_id, source_id, …) are POLYMORPHIC by design and are left
 *    unconstrained on purpose.
 */
const FK_CONSTRAINTS = [
  ['mill_payroll_runs', 'expense_id', 'business_expenses'],
  ['mill_worker_advances', 'expense_id', 'business_expenses'],
];
const FK_INDEX_COLUMNS = [
  ['fund_transfers', 'accepted_by'],
  ['fund_transfers', 'created_by'],
  ['mill_payroll_runs', 'expense_id'],
  ['mill_worker_advances', 'expense_id'],
];

exports.up = async function (knex) {
  for (const [table, col, ref] of FK_CONSTRAINTS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;
    const name = `${table}_${col}_foreign`;
    const has = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
    if (!has.rows.length) {
      await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ??(id) ON DELETE SET NULL`,
        [table, name, col, ref]);
    }
  }
  for (const [table, col] of FK_INDEX_COLUMNS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_${col}_index ON ?? (??)`, [table, col]);
  }
};

exports.down = async function (knex) {
  for (const [table, col] of FK_INDEX_COLUMNS) {
    await knex.raw(`DROP INDEX IF EXISTS ${table}_${col}_index`);
  }
  for (const [table, col] of FK_CONSTRAINTS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [table, `${table}_${col}_foreign`]);
  }
};
