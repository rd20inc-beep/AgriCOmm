/**
 * Backfill: copy doc-generation fields from `export_orders` into the
 * matching first-line `export_order_items` row when the item field is NULL
 * but the order has a value.
 *
 * Why this is needed:
 *   - Migration 062 created export_order_items and copied per-line data,
 *     but at the time `hs_code`, `quality_description`, `broken_pct_target`
 *     might not have existed yet (migration 063 added them).
 *   - On installs where 003's later columns were added by hand or by import,
 *     the backfill in 062 also skipped them.
 *
 * Idempotent: only updates rows whose item.<field> IS NULL AND order has a
 * non-null value, so re-running is a no-op.
 */

exports.up = async function (knex) {
  // Skip cleanly if either table is missing — keeps the migration safe to run
  // on minimal/test schemas.
  const hasOrders = await knex.schema.hasTable('export_orders');
  const hasItems = await knex.schema.hasTable('export_order_items');
  if (!hasOrders || !hasItems) return;

  const updates = [
    { col: 'hs_code',
      sql: `UPDATE export_order_items i
              SET hs_code = o.hs_code
            FROM export_orders o
            WHERE i.order_id = o.id
              AND i.line_no = 1
              AND i.hs_code IS NULL
              AND o.hs_code IS NOT NULL` },
    { col: 'quality_description',
      sql: `UPDATE export_order_items i
              SET quality_description = o.quality_description
            FROM export_orders o
            WHERE i.order_id = o.id
              AND i.line_no = 1
              AND i.quality_description IS NULL
              AND o.quality_description IS NOT NULL` },
    { col: 'broken_pct_target',
      sql: `UPDATE export_order_items i
              SET broken_pct_target = o.broken_pct_target
            FROM export_orders o
            WHERE i.order_id = o.id
              AND i.line_no = 1
              AND i.broken_pct_target IS NULL
              AND o.broken_pct_target IS NOT NULL` },
  ];

  for (const u of updates) {
    await knex.raw(u.sql);
  }
};

exports.down = async function () {
  // No rollback — this migration only fills NULLs from the source of truth.
};
