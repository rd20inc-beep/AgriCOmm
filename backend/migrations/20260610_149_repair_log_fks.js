/**
 * Schema refinement round 43 — the last genuine missing-FK gap.
 *
 * historical_cost_repair_log records cost-repair events against a batch / lot /
 * order, but those *_id columns had no foreign key, so an entry could reference
 * a non-existent parent. Add FKs with ON DELETE SET NULL: integrity is enforced
 * at insert time, yet the audit row survives if its parent is later deleted
 * (the reference just becomes NULL — appropriate for a log). Each FK column is
 * indexed to keep the "every FK is indexed" invariant.
 *
 * All three columns are nullable and prod has 0 orphans; the migration also
 * nulls any stragglers defensively so ADD CONSTRAINT can't fail. Idempotent;
 * reversible.
 *
 * Deliberately NOT touched: suppliers.type (free-form master-data category),
 * bank_reconciliation_items.matched_with_id (ambiguous match target). Those are
 * the only other unconstrained columns and are intentionally left flexible.
 */

const FKS = [
  ['batch_id', 'milling_batches'],
  ['lot_id', 'inventory_lots'],
  ['order_id', 'export_orders'],
];
const fkName = (col) => `historical_cost_repair_log_${col}_foreign`;
const idxName = (col) => `idx_hcrl_${col}`;

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('historical_cost_repair_log'))) return;
  for (const [col, parent] of FKS) {
    if (!(await knex.schema.hasColumn('historical_cost_repair_log', col))) continue;
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [fkName(col)]);
    if (exists.rows.length) continue;
    // Null out orphans so the FK can be created cleanly.
    await knex.raw(
      `UPDATE historical_cost_repair_log h SET ?? = NULL
       WHERE h.?? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ?? p WHERE p.id = h.??)`,
      [col, col, parent, col]
    );
    await knex.raw(
      `ALTER TABLE historical_cost_repair_log ADD CONSTRAINT ${fkName(col)}
       FOREIGN KEY (??) REFERENCES ??(id) ON DELETE SET NULL`,
      [col, parent]
    );
    await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON historical_cost_repair_log (??)`, [idxName(col), col]);
  }
};

exports.down = async function (knex) {
  for (const [col] of FKS) {
    await knex.raw(`ALTER TABLE historical_cost_repair_log DROP CONSTRAINT IF EXISTS ${fkName(col)}`);
    await knex.raw(`DROP INDEX IF EXISTS ??`, [idxName(col)]);
  }
};
