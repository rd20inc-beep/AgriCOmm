/**
 * Blended Milling segregation — Phase 1: schema + flags.
 *
 * Distinguishes a blended-milling run (multiple rice varieties mixed) from a
 * single-variety run, so blended output can be kept 100% separate from pure
 * B1/B2 stock — and, because every blend is a different recipe, isolated
 * per-batch from other blends.
 *
 *   milling_batches.processing_type   'single_variety' | 'blended'
 *   inventory_lots.processing_type    propagated to every lot
 *   inventory_lots.blend_batch_no      a blended output traces back to its batch
 *   batch_source_lots.variety/ratio_pct  immutable per-input recipe snapshot
 *
 * Backfills the recipe snapshot for existing blends and flags any historical
 * batch whose source lots span >1 distinct variety. Existing OUTPUT stock keeps
 * its current identity — re-identifying historical finished/byproduct lots is a
 * separate, opt-in data migration (those lots may be reserved/sold). Idempotent.
 */

const guardedConstraint = async (knex, name, ddl) => {
  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  if (!exists.rows.length) await knex.raw(ddl);
};

exports.up = async function (knex) {
  // ── milling_batches.processing_type ──
  await knex.raw(`ALTER TABLE milling_batches ADD COLUMN IF NOT EXISTS processing_type varchar(20) NOT NULL DEFAULT 'single_variety'`);
  await guardedConstraint(knex, 'chk_milling_batches_processing_type',
    `ALTER TABLE milling_batches ADD CONSTRAINT chk_milling_batches_processing_type CHECK (processing_type IN ('single_variety','blended'))`);

  // ── inventory_lots.processing_type + blend_batch_no ──
  await knex.raw(`ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS processing_type varchar(20) NOT NULL DEFAULT 'single_variety'`);
  await guardedConstraint(knex, 'chk_inventory_lots_processing_type',
    `ALTER TABLE inventory_lots ADD CONSTRAINT chk_inventory_lots_processing_type CHECK (processing_type IN ('single_variety','blended'))`);
  await knex.raw(`ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS blend_batch_no varchar(50)`);

  // ── batch_source_lots recipe snapshot ──
  await knex.raw(`ALTER TABLE batch_source_lots ADD COLUMN IF NOT EXISTS variety varchar(255)`);
  await knex.raw(`ALTER TABLE batch_source_lots ADD COLUMN IF NOT EXISTS ratio_pct numeric`);
  await guardedConstraint(knex, 'chk_batch_source_lots_ratio_pct',
    `ALTER TABLE batch_source_lots ADD CONSTRAINT chk_batch_source_lots_ratio_pct CHECK (ratio_pct IS NULL OR (ratio_pct >= 0 AND ratio_pct <= 100))`);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_inventory_lots_processing_type ON inventory_lots(processing_type)`);

  // ── Backfill the recipe snapshot from existing source lots ──
  await knex.raw(`UPDATE batch_source_lots bsl SET variety = il.variety
                  FROM inventory_lots il WHERE il.id = bsl.lot_id AND bsl.variety IS NULL AND il.variety IS NOT NULL`);
  await knex.raw(`UPDATE batch_source_lots bsl SET ratio_pct = ROUND((bsl.qty_mt / t.total) * 100, 2)
                  FROM (SELECT batch_id, SUM(qty_mt) AS total FROM batch_source_lots GROUP BY batch_id) t
                  WHERE t.batch_id = bsl.batch_id AND t.total > 0 AND bsl.ratio_pct IS NULL`);

  // ── Flag historical batches whose source lots span >1 distinct variety ──
  await knex.raw(`UPDATE milling_batches mb SET processing_type = 'blended'
                  WHERE (SELECT COUNT(DISTINCT il.variety) FROM batch_source_lots bsl
                         JOIN inventory_lots il ON il.id = bsl.lot_id
                         WHERE bsl.batch_id = mb.id AND il.variety IS NOT NULL) > 1`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_inventory_lots_processing_type`);
  await knex.raw(`ALTER TABLE batch_source_lots DROP CONSTRAINT IF EXISTS chk_batch_source_lots_ratio_pct`);
  await knex.raw(`ALTER TABLE batch_source_lots DROP COLUMN IF EXISTS ratio_pct`);
  await knex.raw(`ALTER TABLE batch_source_lots DROP COLUMN IF EXISTS variety`);
  await knex.raw(`ALTER TABLE inventory_lots DROP COLUMN IF EXISTS blend_batch_no`);
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS chk_inventory_lots_processing_type`);
  await knex.raw(`ALTER TABLE inventory_lots DROP COLUMN IF EXISTS processing_type`);
  await knex.raw(`ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS chk_milling_batches_processing_type`);
  await knex.raw(`ALTER TABLE milling_batches DROP COLUMN IF EXISTS processing_type`);
};
