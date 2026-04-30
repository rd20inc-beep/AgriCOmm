/**
 * Round-3 backfill: audit-trail columns (created_by, performed_by) that
 * are 100% NULL on seed data.
 *
 * Same pattern as 067's `export_orders.created_by` fix. The seed scripts
 * never populated these fields; production code paths (controllers reading
 * from JWT) always do. Attribute existing rows to user 1 (admin / Super
 * Admin) since that's the system owner of seed data, then lock the columns.
 *
 * Targets:
 *   milling_batches.created_by      (8/8 NULL)
 *   lot_transactions.created_by     (24/24 NULL)
 *   lot_transactions.performed_by   (24/24 NULL)
 *   mill_items.created_by           (30/30 NULL)
 *
 * Each step is guarded: only updates NULL rows, only ALTERs to NOT NULL if
 * the post-backfill null count is zero.
 */

const TARGETS = [
  ['milling_batches', 'created_by'],
  ['lot_transactions', 'created_by'],
  ['lot_transactions', 'performed_by'],
  ['mill_items', 'created_by'],
];

exports.up = async function (knex) {
  // Use user 1 if it exists; if the install has a different admin, fall back to
  // the lowest-id active user so we don't crash a fresh environment.
  let backfillUser = await knex('users').where({ id: 1 }).first();
  if (!backfillUser) {
    backfillUser = await knex('users').orderBy('id', 'asc').first();
  }
  if (!backfillUser) {
    console.warn('No users in the database — skipping audit-trail backfill.');
    return;
  }
  const userId = backfillUser.id;

  for (const [tbl, col] of TARGETS) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    const hasCol = await knex.schema.hasColumn(tbl, col);
    if (!hasCol) continue;
    await knex(tbl).whereNull(col).update({ [col]: userId });
  }

  for (const [tbl, col] of TARGETS) {
    const meta = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [tbl, col]
    );
    if (meta.rows.length === 0 || meta.rows[0].is_nullable === 'NO') continue;
    const nullCount = await knex(tbl).whereNull(col).count('* as n');
    if (parseInt(nullCount[0].n, 10) > 0) {
      console.warn(`Skipping NOT NULL on ${tbl}.${col} — ${nullCount[0].n} NULL rows remain.`);
      continue;
    }
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
};

exports.down = async function (knex) {
  for (const [tbl, col] of TARGETS) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" DROP NOT NULL`);
  }
};
