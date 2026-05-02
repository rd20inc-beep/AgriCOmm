/**
 * Round-9 follow-up: tighten the last hot-table NULL gap and index the
 * two FKs added in migration 076.
 *
 * 1. NOT NULL on export_order_items.product_id
 *    The audit (after migration 076 landed) found this column still
 *    nullable even though every existing row has a value. Items always
 *    point at a real product post-multi-line refactor, so make it
 *    enforced at the DB level.
 *
 * 2. Indexes on the FK columns added by 076
 *    Migration 076 added FK constraints on:
 *      export_orders.milling_order_id
 *      inventory_lots.purchase_invoice_id
 *    but didn't add the supporting B-tree index that makes JOIN /
 *    cascade-lookup queries fast. Adding now.
 *
 * Idempotent: NOT NULL skipped if any nulls present; CREATE INDEX uses
 * IF NOT EXISTS.
 */

exports.up = async function (knex) {
  // 1. NOT NULL on items.product_id
  const has = await knex.schema.hasColumn('export_order_items', 'product_id');
  if (has) {
    const meta = await knex.raw(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='export_order_items' AND column_name='product_id'"
    );
    if (meta.rows[0] && meta.rows[0].is_nullable === 'YES') {
      const nul = await knex('export_order_items').whereNull('product_id').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE "export_order_items" ALTER COLUMN "product_id" SET NOT NULL`);
      } else {
        console.warn(`[077] Skipping NOT NULL on export_order_items.product_id — ${nul[0].n} NULL rows present.`);
      }
    }
  }

  // 2. Indexes on FKs added in 076
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_export_orders_milling_order_id" ON "export_orders" ("milling_order_id")`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS "idx_inventory_lots_purchase_invoice_id" ON "inventory_lots" ("purchase_invoice_id")`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS "idx_export_orders_milling_order_id"`);
  await knex.raw(`DROP INDEX IF EXISTS "idx_inventory_lots_purchase_invoice_id"`);
  const has = await knex.schema.hasColumn('export_order_items', 'product_id');
  if (has) {
    await knex.raw(`ALTER TABLE "export_order_items" ALTER COLUMN "product_id" DROP NOT NULL`);
  }
};
