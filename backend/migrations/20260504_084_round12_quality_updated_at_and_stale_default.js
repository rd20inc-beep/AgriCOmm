/**
 * Round-12 schema refinement.
 *
 * 1. Real bug fix: add updated_at to milling_quality_samples.
 *    Migration 080 switched saveQuality to upsert and the controller
 *    sets `updated_at: trx.fn.now()` on the UPDATE branch — but the
 *    column has never existed on this table. Every Edit Sample /
 *    Edit Arrival call would 500 the moment a row already exists.
 *    The dev DB hasn't been hit yet (sample data was all fresh
 *    inserts) which is why the 080 work appeared to pass.
 *
 * 2. Mirror it on milling_quality_post for consistency — same shape
 *    (per-batch quality measurement) and the controller will
 *    eventually want the same upsert pattern.
 *
 * 3. Stale default cleanup: internal_transfers.pkr_rate defaults to
 *    280, baked in pre-FX-locking. Migrations 044/045 centralised FX
 *    in fx_rates; relying on a hardcoded 280 silently drifts. Drop
 *    the default — callers must pass a real rate.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  // 1. milling_quality_samples.updated_at
  if (await knex.schema.hasTable('milling_quality_samples')
      && !(await knex.schema.hasColumn('milling_quality_samples', 'updated_at'))) {
    await knex.schema.alterTable('milling_quality_samples', (t) => {
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    // Backfill from created_at so the timestamp is meaningful for old rows.
    await knex.raw(`UPDATE milling_quality_samples SET updated_at = created_at WHERE updated_at IS NULL`);
  }

  // 2. milling_quality_post.updated_at
  if (await knex.schema.hasTable('milling_quality_post')
      && !(await knex.schema.hasColumn('milling_quality_post', 'updated_at'))) {
    await knex.schema.alterTable('milling_quality_post', (t) => {
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.raw(`UPDATE milling_quality_post SET updated_at = created_at WHERE updated_at IS NULL`);
  }

  // 3. Drop stale 280 default on internal_transfers.pkr_rate.
  if (await knex.schema.hasTable('internal_transfers')
      && (await knex.schema.hasColumn('internal_transfers', 'pkr_rate'))) {
    await knex.raw(`ALTER TABLE internal_transfers ALTER COLUMN pkr_rate DROP DEFAULT`);
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('milling_quality_samples', 'updated_at')) {
    await knex.schema.alterTable('milling_quality_samples', (t) => t.dropColumn('updated_at'));
  }
  if (await knex.schema.hasColumn('milling_quality_post', 'updated_at')) {
    await knex.schema.alterTable('milling_quality_post', (t) => t.dropColumn('updated_at'));
  }
  if (await knex.schema.hasTable('internal_transfers')
      && (await knex.schema.hasColumn('internal_transfers', 'pkr_rate'))) {
    await knex.raw(`ALTER TABLE internal_transfers ALTER COLUMN pkr_rate SET DEFAULT 280`);
  }
};
