/**
 * Lot-level vehicles + multi-pass milling lineage.
 *
 * Two changes to support the rice-purchase → mill flow:
 *
 * 1. `milling_vehicle_arrivals.lot_id`
 *    Vehicles can now be attached to an inventory lot before any
 *    milling batch exists. When the operator clicks Start Milling on
 *    the lot, the lot's vehicles get their batch_id back-filled so the
 *    batch picks them up. batch_id stays nullable so a vehicle can
 *    exist for a lot that hasn't been milled yet.
 *
 * 2. `milling_batches.parent_batch_id` + `pass_number`
 *    The mill often re-processes the same rice 2–3 times to hit the
 *    finished spec the buyer needs. Each pass is its own milling
 *    batch — `parent_batch_id` points back at the previous pass so we
 *    can chart yield per pass, and `pass_number` defaults to 1 (first
 *    pass) and increments when a finished lot is milled again.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  // ─── 1. lot_id on milling_vehicle_arrivals ───
  if (await knex.schema.hasTable('milling_vehicle_arrivals')) {
    if (!(await knex.schema.hasColumn('milling_vehicle_arrivals', 'lot_id'))) {
      await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
        t.integer('lot_id').nullable().references('id').inTable('inventory_lots').onDelete('SET NULL');
      });
    }
    // batch_id is currently NOT NULL (from migration 004). Loosen it so
    // a vehicle can exist for a lot that hasn't been milled yet.
    const colInfo = await knex('milling_vehicle_arrivals').columnInfo();
    if (colInfo.batch_id && colInfo.batch_id.nullable === false) {
      await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
        t.integer('batch_id').nullable().alter();
      });
    }
    // Guard against orphans: at least one of (lot_id, batch_id) must be set.
    const chk = await knex.raw(
      `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'chk_mva_lot_or_batch'`
    );
    if (!chk.rows.length) {
      await knex.raw(`
        ALTER TABLE milling_vehicle_arrivals
        ADD CONSTRAINT chk_mva_lot_or_batch
        CHECK (lot_id IS NOT NULL OR batch_id IS NOT NULL)
      `);
    }
    // Index for lot lookups (mirrors the existing idx on batch_id from 052)
    const idx = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_milling_vehicle_arrivals_lot_id'`
    );
    if (!idx.rows.length) {
      await knex.raw(`CREATE INDEX idx_milling_vehicle_arrivals_lot_id ON milling_vehicle_arrivals (lot_id)`);
    }
  }

  // ─── 2. parent_batch_id + pass_number on milling_batches ───
  if (await knex.schema.hasTable('milling_batches')) {
    if (!(await knex.schema.hasColumn('milling_batches', 'parent_batch_id'))) {
      await knex.schema.alterTable('milling_batches', (t) => {
        t.integer('parent_batch_id').nullable().references('id').inTable('milling_batches').onDelete('SET NULL');
      });
    }
    if (!(await knex.schema.hasColumn('milling_batches', 'pass_number'))) {
      await knex.schema.alterTable('milling_batches', (t) => {
        t.integer('pass_number').notNullable().defaultTo(1);
      });
      const chk = await knex.raw(
        `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'chk_mb_pass_number_positive'`
      );
      if (!chk.rows.length) {
        await knex.raw(`ALTER TABLE milling_batches ADD CONSTRAINT chk_mb_pass_number_positive CHECK (pass_number >= 1)`);
      }
    }
    const idx = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_milling_batches_parent_batch_id'`
    );
    if (!idx.rows.length) {
      await knex.raw(`CREATE INDEX idx_milling_batches_parent_batch_id ON milling_batches (parent_batch_id)`);
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('milling_batches')) {
    await knex.raw('DROP INDEX IF EXISTS idx_milling_batches_parent_batch_id');
    await knex.raw('ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS chk_mb_pass_number_positive');
    for (const col of ['pass_number', 'parent_batch_id']) {
      if (await knex.schema.hasColumn('milling_batches', col)) {
        await knex.schema.alterTable('milling_batches', (t) => { t.dropColumn(col); });
      }
    }
  }
  if (await knex.schema.hasTable('milling_vehicle_arrivals')) {
    await knex.raw('DROP INDEX IF EXISTS idx_milling_vehicle_arrivals_lot_id');
    await knex.raw('ALTER TABLE milling_vehicle_arrivals DROP CONSTRAINT IF EXISTS chk_mva_lot_or_batch');
    if (await knex.schema.hasColumn('milling_vehicle_arrivals', 'lot_id')) {
      await knex.schema.alterTable('milling_vehicle_arrivals', (t) => { t.dropColumn('lot_id'); });
    }
    // We deliberately do NOT re-tighten batch_id back to NOT NULL on
    // rollback — that would fail if any lot-attached vehicles exist.
  }
};
