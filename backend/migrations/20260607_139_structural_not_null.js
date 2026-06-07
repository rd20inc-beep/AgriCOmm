/**
 * Schema refinement round 38 — tighten structural parent/join FK columns to
 * NOT NULL. Each column here is one where a row is meaningless without its
 * parent (join tables, double-entry accounting lines, lot lineage, an order's
 * own status history, a stock movement's lot, a task's execution log). All
 * already carry an FK and were verified to have 0 null rows on production.
 *
 * Deliberately NOT included: actor/workflow columns (created_by, approved_by,
 * changed_by, confirmed_by, period_id, …). Those can legitimately be null for
 * system/automated/not-yet-actioned rows, so a current "0 nulls" reading on a
 * small dataset is coincidental, not structural.
 *
 * Also excluded: lot_source_mapping.parent_lot_id and .source_batch_id — these
 * are *alternative* sources (a lineage row derives from either a parent lot or
 * a source batch), so each is legitimately null. Confirmed in practice: a real
 * dataset has parent_lot_id null on every row (all derived from batches). Only
 * child_lot_id (the resulting lot) is structurally always present.
 *
 * Idempotent: only flips columns still marked nullable.
 */

const COLS = [
  ['role_permissions', 'role_id'],
  ['role_permissions', 'permission_id'],
  ['journal_lines', 'journal_id'],
  ['journal_lines', 'account_id'],
  ['export_order_status_history', 'order_id'],
  ['inventory_movements', 'lot_id'],
  ['lot_source_mapping', 'child_lot_id'],
  ['task_execution_log', 'task_id'],
];

async function isNullable(knex, table, col) {
  const { rows } = await knex.raw(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name=? AND column_name=?`,
    [table, col]
  );
  return rows[0] && rows[0].is_nullable === 'YES';
}

exports.up = async function (knex) {
  for (const [table, col] of COLS) {
    if (!(await knex.schema.hasColumn(table, col))) continue;
    if (await isNullable(knex, table, col)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [table, col]);
    }
  }
};

exports.down = async function (knex) {
  for (const [table, col] of COLS) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [table, col]);
    }
  }
};
