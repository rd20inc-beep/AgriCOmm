/**
 * Schema refinement round 37 — five integrity/hygiene fixes, each verified
 * against live production data before writing:
 *
 * 1. milling_costs.batch_id  -> NOT NULL. A cost row is meaningless without a
 *    batch; the FK already exists and prod has 0 null rows.
 * 2. milling_quality_samples.batch_id -> NOT NULL. Same reasoning; FK exists,
 *    0 nulls on prod.
 * 3. inventory_lots.milling_status -> CHECK in ('In Milling','Consumed').
 *    NULL stays allowed (a lot not in/through milling). The backend only ever
 *    writes those two literals (grep-verified), and prod holds only those two
 *    values + NULL, so the whitelist breaks nothing.
 * 4/5. mill_stock and mill_consumption_ratios were the only mutable tables
 *    missing created_at/updated_at. Add them with a now() default so existing
 *    rows backfill and the tables match the rest of the schema.
 *
 * Idempotent: hasColumn / is_nullable / pg_constraint guards throughout.
 */

const NOT_NULL = [
  ['milling_costs', 'batch_id'],
  ['milling_quality_samples', 'batch_id'],
];

const MILLING_STATUS_CHECK = 'inventory_lots_milling_status_check';

const TIMESTAMP_TABLES = ['mill_stock', 'mill_consumption_ratios'];

exports.up = async function (knex) {
  // 1 & 2 — tighten required FK columns to NOT NULL (only if still nullable)
  for (const [table, col] of NOT_NULL) {
    if (!(await knex.schema.hasColumn(table, col))) continue;
    const { rows } = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=? AND column_name=?`,
      [table, col]
    );
    if (rows[0] && rows[0].is_nullable === 'YES') {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [table, col]);
    }
  }

  // 3 — whitelist milling_status (NULL still allowed)
  if (await knex.schema.hasColumn('inventory_lots', 'milling_status')) {
    const exists = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = ?`,
      [MILLING_STATUS_CHECK]
    );
    if (!exists.rows.length) {
      await knex.raw(
        `ALTER TABLE inventory_lots ADD CONSTRAINT ${MILLING_STATUS_CHECK}
         CHECK (milling_status IS NULL OR milling_status IN ('In Milling','Consumed'))`
      );
    }
  }

  // 4 & 5 — add created_at/updated_at to the two mutable tables that lacked them
  for (const table of TIMESTAMP_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    const hasCreated = await knex.schema.hasColumn(table, 'created_at');
    const hasUpdated = await knex.schema.hasColumn(table, 'updated_at');
    if (!hasCreated || !hasUpdated) {
      await knex.schema.alterTable(table, (t) => {
        if (!hasCreated) t.timestamp('created_at').defaultTo(knex.fn.now());
        if (!hasUpdated) t.timestamp('updated_at').defaultTo(knex.fn.now());
      });
    }
  }
};

exports.down = async function (knex) {
  for (const table of TIMESTAMP_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    const hasCreated = await knex.schema.hasColumn(table, 'created_at');
    const hasUpdated = await knex.schema.hasColumn(table, 'updated_at');
    await knex.schema.alterTable(table, (t) => {
      if (hasCreated) t.dropColumn('created_at');
      if (hasUpdated) t.dropColumn('updated_at');
    });
  }

  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${MILLING_STATUS_CHECK}`);

  for (const [table, col] of NOT_NULL) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [table, col]);
    }
  }
};
