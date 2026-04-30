/**
 * Backfill orphan NULLs identified by migration 066's audit, then apply
 * NOT NULL where every row now has a value.
 *
 * Inference rules (idempotent — only updates NULL rows; safe to re-run):
 *
 *   export_orders.created_by  -> user 2 (Akmal Amin / Export Manager)
 *     The owner of every existing seed export order. Future orders set
 *     created_by from the JWT, so this only touches historical seed data.
 *
 *   milling_batches.mill_id   -> mill 1 (Agri Rice Mill - Karachi)
 *     The two non-null seed batches both reference mill 1; production runs
 *     all happen at this site by default.
 *
 *   inventory_lots.warehouse_id (by type)
 *     finished  -> warehouse 2 (Mill Finished Goods)
 *     byproduct -> warehouse 3 (Mill By-Products)
 *     raw       -> warehouse 1 (Mill Raw Stock)
 *
 *   inventory_lots.product_id
 *     Byproducts inferred from item_name:
 *       'Broken Rice' -> product 33
 *       'Rice Bran'   -> product 34
 *       'Rice Husk'   -> product 35
 *     Finished lots inferred via batch_ref -> milling_batches.linked_export_order_id -> export_orders.product_id.
 *     Lots with no traceable order survive NULL (so this column does not
 *     get a NOT NULL constraint here).
 *
 * Notes on what is NOT touched:
 *   - payables.supplier_id stays nullable. The 25 NULL rows are export
 *     aggregate cost categories (Bags, Loading, Clearing, Freight, Misc)
 *     logged before a vendor is assigned — supplier=NULL is semantically
 *     correct, not a data error.
 */

exports.up = async function (knex) {
  // 1. export_orders.created_by — set NULLs to user 2 if user 2 exists.
  const u2 = await knex('users').where({ id: 2 }).first();
  if (u2) {
    await knex('export_orders').whereNull('created_by').update({ created_by: 2 });
  }

  // 2. milling_batches.mill_id — set NULLs to mill 1 if mill 1 exists.
  const m1 = await knex('mills').where({ id: 1 }).first();
  if (m1) {
    await knex('milling_batches').whereNull('mill_id').update({ mill_id: 1 });
  }

  // 3. inventory_lots.warehouse_id — by type, only when target warehouse exists.
  const TYPE_TO_WAREHOUSE = { finished: 2, byproduct: 3, raw: 1 };
  for (const [type, whId] of Object.entries(TYPE_TO_WAREHOUSE)) {
    const wh = await knex('warehouses').where({ id: whId }).first();
    if (!wh) continue;
    await knex('inventory_lots')
      .whereNull('warehouse_id')
      .where('type', type)
      .update({ warehouse_id: whId });
  }

  // 4. inventory_lots.product_id — byproducts by name.
  const NAME_TO_PRODUCT = { 'Broken Rice': 33, 'Rice Bran': 34, 'Rice Husk': 35 };
  for (const [itemName, productId] of Object.entries(NAME_TO_PRODUCT)) {
    const p = await knex('products').where({ id: productId }).first();
    if (!p) continue;
    await knex('inventory_lots')
      .whereNull('product_id')
      .where('item_name', itemName)
      .update({ product_id: productId });
  }

  // 5. inventory_lots.product_id — finished lots via batch -> order -> product trace.
  const finishedNull = await knex('inventory_lots')
    .whereNull('product_id')
    .where('item_name', 'Finished Rice')
    .select('id', 'batch_ref');

  for (const lot of finishedNull) {
    if (!lot.batch_ref) continue;
    const batchId = parseInt(String(lot.batch_ref).replace('batch-', ''), 10);
    if (!batchId || Number.isNaN(batchId)) continue;
    const batch = await knex('milling_batches').where({ id: batchId }).first();
    if (!batch || !batch.linked_export_order_id) continue;
    const ord = await knex('export_orders').where({ id: batch.linked_export_order_id }).first();
    if (!ord || !ord.product_id) continue;
    await knex('inventory_lots').where({ id: lot.id }).update({ product_id: ord.product_id });
  }

  // 6. Apply NOT NULL where the backfill leaves zero NULLs.
  const TIGHTEN = [
    ['export_orders', 'created_by'],
    ['milling_batches', 'mill_id'],
    ['inventory_lots', 'warehouse_id'],
    // inventory_lots.product_id intentionally NOT here — see header.
  ];
  for (const [tbl, col] of TIGHTEN) {
    const meta = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [tbl, col]
    );
    if (meta.rows.length === 0 || meta.rows[0].is_nullable === 'NO') continue;
    const nullCount = await knex(tbl).whereNull(col).count('* as n');
    if (parseInt(nullCount[0].n, 10) > 0) {
      console.warn(`Skipping NOT NULL on ${tbl}.${col} — ${nullCount[0].n} NULL rows remain after backfill.`);
      continue;
    }
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
};

exports.down = async function (knex) {
  // Reverse only the NOT NULL additions; do NOT clear the backfilled values
  // (they're inferred from real domain rules, not arbitrary).
  for (const [tbl, col] of [
    ['export_orders', 'created_by'],
    ['milling_batches', 'mill_id'],
    ['inventory_lots', 'warehouse_id'],
  ]) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" DROP NOT NULL`);
  }
};
