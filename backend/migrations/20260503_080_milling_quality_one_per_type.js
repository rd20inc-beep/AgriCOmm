/**
 * One canonical quality row per (batch, analysis_type).
 *
 * The saveQuality controller has been inserting a NEW row every time the
 * UI submits — including when the user clicks "Edit Sample" / "Edit
 * Arrival" — so the table accumulates duplicates. The frontend then
 * reads quality.arrival[0] (oldest), so price revisions are silently
 * discarded from the user's view.
 *
 * Sample and arrival are conceptually one-of-each per batch in the rice
 * trade workflow. Enforcing that at the DB level lets the controller use
 * a clean upsert.
 *
 * This migration:
 *   1. Deduplicates existing rows: for each (batch_id, analysis_type)
 *      group with > 1 row, keep the most recent and delete the rest.
 *   2. Adds a UNIQUE constraint on (batch_id, analysis_type).
 *
 * Idempotent: dedupe is keyed on actual duplicates only; constraint
 * uses IF NOT EXISTS check via information_schema.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_quality_samples'))) return;

  // 1. Dedupe — keep the row with the latest created_at for each pair.
  const dupes = await knex.raw(`
    SELECT batch_id, analysis_type, COUNT(*)::int AS n
    FROM milling_quality_samples
    WHERE batch_id IS NOT NULL AND analysis_type IS NOT NULL
    GROUP BY batch_id, analysis_type
    HAVING COUNT(*) > 1
  `);

  let deletedTotal = 0;
  for (const row of dupes.rows) {
    const survivors = await knex('milling_quality_samples')
      .where({ batch_id: row.batch_id, analysis_type: row.analysis_type })
      .orderBy('created_at', 'desc')
      .select('id');
    const keepId = survivors[0].id;
    const deleteIds = survivors.slice(1).map((r) => r.id);
    if (deleteIds.length > 0) {
      const deleted = await knex('milling_quality_samples').whereIn('id', deleteIds).del();
      deletedTotal += deleted;
    }
  }
  if (deletedTotal > 0) {
    console.log(`[080] Deleted ${deletedTotal} duplicate milling_quality_samples rows (kept latest per batch/type)`);
  }

  // 2. Add the unique constraint, if not already present.
  const existing = await knex.raw(`
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uniq_milling_quality_batch_type'
  `);
  if (existing.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE milling_quality_samples
        ADD CONSTRAINT uniq_milling_quality_batch_type
        UNIQUE (batch_id, analysis_type)
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE milling_quality_samples DROP CONSTRAINT IF EXISTS uniq_milling_quality_batch_type`);
};
