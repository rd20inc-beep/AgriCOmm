/**
 * Wire inventory_lots.broker_id to the suppliers table.
 *
 * The column has existed since the original lot schema and is accepted by
 * the lot-create controller (lotInventory.controller.js) + Joi schema, but
 * was never given a foreign-key constraint and never populated. No
 * `brokers` table was ever created — in rice trade brokers are typically
 * stored in `suppliers` with a distinguishing `type` value.
 *
 * Adding the FK now (with ON DELETE SET NULL so a deleted broker doesn't
 * cascade-orphan a lot) plus a supporting index. Data risk is zero —
 * 100% of inventory_lots.broker_id rows are currently NULL.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'broker_id'))) return;
  if (!(await knex.schema.hasTable('suppliers'))) return;

  // Defensive: skip if any non-null broker_id already points at a missing supplier.
  const orphan = await knex.raw(`
    SELECT COUNT(*)::int AS n FROM inventory_lots l
    WHERE l.broker_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = l.broker_id)
  `);
  if (orphan.rows[0].n > 0) {
    console.warn(`[078] Skipping FK on inventory_lots.broker_id — ${orphan.rows[0].n} orphan rows present.`);
    return;
  }

  await knex.raw(`ALTER TABLE "inventory_lots" DROP CONSTRAINT IF EXISTS "inventory_lots_broker_id_foreign"`);
  await knex.raw(`
    ALTER TABLE "inventory_lots"
      ADD CONSTRAINT "inventory_lots_broker_id_foreign"
      FOREIGN KEY ("broker_id")
      REFERENCES "suppliers" ("id")
      ON DELETE SET NULL
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_inventory_lots_broker_id" ON "inventory_lots" ("broker_id")`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "idx_inventory_lots_broker_id"`);
  await knex.raw(`ALTER TABLE "inventory_lots" DROP CONSTRAINT IF EXISTS "inventory_lots_broker_id_foreign"`);
};
