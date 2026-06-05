/**
 * Tighten batch_source_lots (the milling-blend input table).
 *
 * Every source-lot row must point at a batch and a lot and carry a positive
 * quantity — these were nullable. Existing rows already satisfy this (verified
 * on prod: 10 rows, no nulls, all qty_mt > 0), so the constraints add no risk.
 * The cost-snapshot columns (lot_type / unit_cost_pkr / cost_total_pkr) stay
 * nullable — legacy single-lot links predating the blend feature don't have them.
 *
 * Idempotent.
 */

const COLS = ['batch_id', 'lot_id', 'qty_mt'];
const CHECK = 'batch_source_lots_qty_mt_positive';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('batch_source_lots'))) return;

  for (const col of COLS) {
    if (await knex.schema.hasColumn('batch_source_lots', col)) {
      await knex.raw(`ALTER TABLE batch_source_lots ALTER COLUMN ?? SET NOT NULL`, [col]);
    }
  }

  const exists = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'batch_source_lots'::regclass`,
    [CHECK]
  );
  if (!exists.rows.length) {
    await knex.raw(`ALTER TABLE batch_source_lots ADD CONSTRAINT ${CHECK} CHECK (qty_mt > 0)`);
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('batch_source_lots'))) return;
  await knex.raw(`ALTER TABLE batch_source_lots DROP CONSTRAINT IF EXISTS ${CHECK}`);
  for (const col of COLS) {
    if (await knex.schema.hasColumn('batch_source_lots', col)) {
      await knex.raw(`ALTER TABLE batch_source_lots ALTER COLUMN ?? DROP NOT NULL`, [col]);
    }
  }
};
