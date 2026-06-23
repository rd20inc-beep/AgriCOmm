/**
 * Schema refinement: index every foreign-key column that lacks one, and add the
 * one missing FK constraint (mill_payroll_runs.bank_account_id → bank_accounts).
 *
 * FK columns without a covering index force a sequential scan whenever the parent
 * row is deleted/updated (PostgreSQL indexes the referenced PK side, not the
 * referencing side). These 12 accumulated as FKs were added after the last
 * FK-index sweep (migration 081). All idempotent; verified no orphan rows on prod
 * before adding the FK.
 */
const FK_INDEX_COLUMNS = [
  ['business_expenses', 'employee_id'],
  ['customers', 'reviewed_by'],
  ['customers', 'submitted_by'],
  ['inventory_lots', 'transport_vendor_id'],
  ['local_sales', 'mill_item_id'],
  ['mill_packing_logs', 'master_bag_item_id'],
  ['mill_packing_logs', 'poly_item_id'],
  ['mill_packing_logs', 'bag_item_id'],
  ['mill_packing_logs', 'packed_by'],
  ['mill_packing_logs', 'warehouse_id'],
  ['mill_payroll_lines', 'worker_id'],
  ['mill_purchases', 'bank_account_id'],
  ['mill_payroll_runs', 'bank_account_id'],
];

exports.up = async function (knex) {
  // Missing FK: a payroll run's bank account must reference a real account.
  const has = await knex.raw("SELECT 1 FROM pg_constraint WHERE conname = 'mill_payroll_runs_bank_account_id_foreign'");
  if (!has.rows.length) {
    await knex.raw('ALTER TABLE mill_payroll_runs ADD CONSTRAINT mill_payroll_runs_bank_account_id_foreign '
      + 'FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL');
  }
  for (const [table, col] of FK_INDEX_COLUMNS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_${col}_index ON ?? (??)`, [table, col]);
  }
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE mill_payroll_runs DROP CONSTRAINT IF EXISTS mill_payroll_runs_bank_account_id_foreign');
  for (const [table, col] of FK_INDEX_COLUMNS) {
    await knex.raw(`DROP INDEX IF EXISTS ${table}_${col}_index`);
  }
};
