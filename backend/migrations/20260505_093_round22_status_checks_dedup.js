/**
 * Round-22 schema refinement.
 *
 * Two latent CHECK-constraint bugs.
 *
 * 1. milling_batches.status CHECK is missing 'Rejected'. The
 *    milling.controller's reject endpoint sets status='Rejected'
 *    on the batch row — every reject from the dashboard "Reject"
 *    button would 23514. Add 'Rejected' (and 'On Hold' for
 *    consistency with how export_orders handles holds).
 *
 * 2. inventory_lots has duplicate CHECK constraints on both `type`
 *    and `entity`. The narrow chk_inventory_lots_type_valid allows
 *    only {raw, finished, byproduct}, while the parallel
 *    inventory_lots_type_check allows {raw, finished, byproduct,
 *    packaging}. Both are enforced (CHECKs AND together), so any
 *    attempt to create a packaging lot would silently fail the
 *    narrower one. Drop the redundant narrow constraints; keep the
 *    wider knex-defined ones.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  // 1. milling_batches.status — extend allowed set.
  if (await knex.schema.hasTable('milling_batches')) {
    await knex.raw(`ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS chk_milling_batches_status_valid`);
    await knex.raw(`
      ALTER TABLE milling_batches
        ADD CONSTRAINT chk_milling_batches_status_valid
        CHECK (status IN (
          'Queued', 'In Progress', 'Pending Approval',
          'Completed', 'Cancelled', 'Rejected', 'On Hold'
        ))
    `);
  }

  // 2. Drop the redundant narrower CHECKs on inventory_lots.
  //    The wider knex-named ones (inventory_lots_type_check,
  //    inventory_lots_entity_check) stay and remain authoritative.
  if (await knex.schema.hasTable('inventory_lots')) {
    await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS chk_inventory_lots_type_valid`);
    await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS chk_inventory_lots_entity_valid`);
  }

  // 3. Drop the redundant warehouses.entity duplicate too. The
  //    knex-named warehouses_entity_check covers the same set; the
  //    chk_warehouses_entity is identical and only adds noise.
  if (await knex.schema.hasTable('warehouses')) {
    await knex.raw(`ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS chk_warehouses_entity`);
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('milling_batches')) {
    await knex.raw(`ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS chk_milling_batches_status_valid`);
    await knex.raw(`
      ALTER TABLE milling_batches
        ADD CONSTRAINT chk_milling_batches_status_valid
        CHECK (status IN ('Queued', 'In Progress', 'Pending Approval', 'Completed', 'Cancelled'))
    `);
  }
  if (await knex.schema.hasTable('inventory_lots')) {
    await knex.raw(`
      ALTER TABLE inventory_lots
        ADD CONSTRAINT chk_inventory_lots_type_valid
        CHECK (type IN ('raw', 'finished', 'byproduct'))
    `);
    await knex.raw(`
      ALTER TABLE inventory_lots
        ADD CONSTRAINT chk_inventory_lots_entity_valid
        CHECK (entity IN ('mill', 'export'))
    `);
  }
  if (await knex.schema.hasTable('warehouses')) {
    await knex.raw(`
      ALTER TABLE warehouses
        ADD CONSTRAINT chk_warehouses_entity
        CHECK (entity IS NULL OR entity IN ('mill', 'export'))
    `);
  }
};
