/**
 * Round-14 schema refinement.
 *
 * Three independent cleanups:
 *
 * 1. Drop two redundant indexes — single-column indexes that are
 *    fully covered by a wider compound added in earlier rounds.
 *    These cost write IO and disk for no read benefit.
 *      - export_order_documents.idx_eod_order_id is covered by
 *        idx_export_order_documents_order_status (round 13).
 *      - milling_quality_samples.idx_milling_quality_batch_id is
 *        covered by uniq_milling_quality_batch_type (round 12).
 *
 * 2. Convert historical_cost_repair_log.{old,new}_value_json from
 *    plain `json` to `jsonb`. Every other JSON-bearing column in the
 *    schema is jsonb (35/37) — these two are the holdouts. jsonb
 *    deduplicates keys, supports GIN indexes, and is faster for
 *    membership tests. Only 2 rows in the table; risk is trivial.
 *
 * 3. Add created_by FK on three hot user-driven tables:
 *      - export_order_costs   (who logged this expense?)
 *      - milling_costs        (who logged this milling cost?)
 *      - milling_vehicle_arrivals (who recorded this arrival?)
 *    Nullable, ON DELETE SET NULL so user removal doesn't cascade.
 *    Indexed for "show me everything user X created" lookups.
 *
 * All idempotent.
 */

const CREATED_BY_TABLES = [
  'export_order_costs',
  'milling_costs',
  'milling_vehicle_arrivals',
];

exports.up = async function (knex) {
  // 1. Redundant indexes
  await knex.raw(`DROP INDEX IF EXISTS idx_eod_order_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_milling_quality_batch_id`);

  // 2. JSON → JSONB on historical_cost_repair_log
  if (await knex.schema.hasTable('historical_cost_repair_log')) {
    for (const col of ['old_value_json', 'new_value_json']) {
      if (await knex.schema.hasColumn('historical_cost_repair_log', col)) {
        const meta = await knex.raw(
          `SELECT data_type FROM information_schema.columns
            WHERE table_name='historical_cost_repair_log' AND column_name=?`,
          [col]
        );
        if (meta.rows[0] && meta.rows[0].data_type === 'json') {
          await knex.raw(
            `ALTER TABLE historical_cost_repair_log ALTER COLUMN ${col} TYPE jsonb USING ${col}::jsonb`
          );
        }
      }
    }
  }

  // 3. created_by FK on hot user-driven tables
  for (const table of CREATED_BY_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'created_by'))) {
      await knex.schema.alterTable(table, (t) => {
        t.integer('created_by').nullable();
      });
    }
    // Add the FK if missing.
    const fkName = `${table}_created_by_fk`;
    const exists = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = ?`,
      [fkName]
    );
    if (exists.rows.length === 0) {
      await knex.raw(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${fkName}"
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    }
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS "idx_${table}_created_by" ON "${table}" (created_by)`
    );
  }
};

exports.down = async function (knex) {
  // Restore the dropped indexes (best-effort).
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_eod_order_id ON export_order_documents (order_id)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_milling_quality_batch_id ON milling_quality_samples (batch_id)`
  );

  // Revert jsonb → json (lossy; can't restore key duplicates but the
  // value tree is preserved).
  if (await knex.schema.hasTable('historical_cost_repair_log')) {
    for (const col of ['old_value_json', 'new_value_json']) {
      if (await knex.schema.hasColumn('historical_cost_repair_log', col)) {
        await knex.raw(
          `ALTER TABLE historical_cost_repair_log ALTER COLUMN ${col} TYPE json USING ${col}::json`
        );
      }
    }
  }

  // Drop the new FKs / indexes / columns.
  for (const table of CREATED_BY_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`DROP INDEX IF EXISTS "idx_${table}_created_by"`);
    await knex.raw(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_created_by_fk"`);
    if (await knex.schema.hasColumn(table, 'created_by')) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('created_by'));
    }
  }
};
