/**
 * Drop indexes that are provably redundant — covered by another index that
 * already starts with the same column(s). Postgres B-tree can serve any
 * query on a leading-column prefix of a composite index, so a single-column
 * index on a column that's the leading column of a composite is dead weight.
 *
 * Each drop reduces write overhead (one less index to maintain on every
 * INSERT/UPDATE/DELETE) without losing any read performance.
 *
 * Then run ANALYZE on hot tables that have never been analyzed (newly
 * created via 062, or freshly modified by 067/068/069) so the planner has
 * up-to-date statistics for join/filter cardinality estimates.
 *
 * Idempotent: DROP INDEX IF EXISTS, ANALYZE is always safe to re-run.
 *
 * NOT DOING in this migration:
 *   - Dropping "unused" indexes based on pg_stat_user_indexes scan counts.
 *     Production stats were reset by a recent container restart, so a
 *     "scans = 0" reading right now means "stats wiped", not "never used".
 *     Worth revisiting in a few weeks once stats accumulate.
 */

const REDUNDANT = [
  // Exact duplicates on audit_logs (added by separate migrations under
  // different naming conventions). Keep the shorter idx_audit_* name.
  'idx_audit_logs_created_at',  // dup of idx_audit_created
  'idx_audit_logs_user_id',     // dup of idx_audit_user

  // Prefix-redundant — fully covered by a composite added later.
  'idx_audit_logs_entity_type', // (entity_type) — covered by idx_audit_entity (entity_type, entity_id)
  'idx_export_orders_status',   // (status)      — covered by idx_eo_status_created (status, created_at)
];

const ANALYZE_TABLES = [
  'export_orders',
  'export_order_items',
  'export_order_costs',
  'export_order_status_history',
  'milling_batches',
  'milling_costs',
  'inventory_lots',
  'lot_transactions',
  'receivables',
  'payables',
  'payments',
  'mill_items',
  'shipment_containers',
];

exports.up = async function (knex) {
  for (const idx of REDUNDANT) {
    await knex.raw(`DROP INDEX IF EXISTS "${idx}"`);
  }
  for (const tbl of ANALYZE_TABLES) {
    const exists = await knex.schema.hasTable(tbl);
    if (!exists) continue;
    await knex.raw(`ANALYZE "${tbl}"`);
  }
};

exports.down = async function (knex) {
  // Re-create the dropped indexes so a rollback restores the previous
  // (sub-optimal) state exactly.
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" ("created_at")`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" ("user_id")`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity_type" ON "audit_logs" ("entity_type")`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_export_orders_status" ON "export_orders" ("status")`);
};
