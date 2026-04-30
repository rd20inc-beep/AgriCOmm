/**
 * Round-4: fix the last two remaining NULL pockets identified by the audit.
 *
 *   1. inventory_lots.product_id (1 lot — LOT-F-0013)
 *      The lot's batch (id 6) has no linked_export_order_id and no
 *      product_id of its own, so we can't trace the original product.
 *      Default to product 14 (IRRI-6 Long Grain White Rice) — the most
 *      common product across the existing finished-rice lots (3 of 5).
 *
 *   2. payables.supplier_id (25 export aggregate cost payables)
 *      These are line-items for Bags / Loading / Clearing / Freight / Misc
 *      logged against export orders without a vendor assigned. Rather than
 *      losing the FK, create one placeholder supplier
 *      "Unallocated Vendor (Pending Assignment)" and point all NULL
 *      payables at it. That preserves data integrity and makes them
 *      trivially queryable later (`WHERE suppliers.name LIKE 'Unallocated%'`)
 *      so the user can reassign them to real vendors.
 *
 * After backfill, both columns are tightened to NOT NULL.
 *
 * Idempotent: only updates NULL rows; only ALTERs to NOT NULL when zero
 * NULLs remain; only creates the placeholder supplier if it doesn't exist.
 */

const PLACEHOLDER_NAME = 'Unallocated Vendor (Pending Assignment)';

exports.up = async function (knex) {
  // ─── 1. Orphan finished-rice lot ───────────────────────────────
  const defaultProduct = await knex('products').where({ id: 14 }).first();
  if (defaultProduct) {
    await knex('inventory_lots')
      .whereNull('product_id')
      .where('item_name', 'Finished Rice')
      .update({ product_id: 14 });
  } else {
    // Fallback: any product whose name starts with "Long Grain" or "IRRI"
    const anyRice = await knex('products')
      .where('name', 'ilike', '%Long Grain%')
      .orWhere('name', 'ilike', '%IRRI%')
      .first();
    if (anyRice) {
      await knex('inventory_lots')
        .whereNull('product_id')
        .where('item_name', 'Finished Rice')
        .update({ product_id: anyRice.id });
    }
  }

  // ─── 2. Placeholder supplier for unassigned export costs ───────
  let placeholder = await knex('suppliers').where({ name: PLACEHOLDER_NAME }).first();
  if (!placeholder) {
    const [created] = await knex('suppliers')
      .insert({
        name: PLACEHOLDER_NAME,
        type: 'Cost Center',
        is_active: true,
        contact_person: 'TBD',
        country: 'Pakistan',
      })
      .returning('*');
    placeholder = created;
  }

  if (placeholder && placeholder.id) {
    await knex('payables').whereNull('supplier_id').update({ supplier_id: placeholder.id });
  }

  // ─── 3. Tighten to NOT NULL where the backfill left zero NULLs ──
  const TIGHTEN = [
    ['inventory_lots', 'product_id'],
    ['payables', 'supplier_id'],
  ];
  for (const [tbl, col] of TIGHTEN) {
    const meta = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [tbl, col]
    );
    if (meta.rows.length === 0 || meta.rows[0].is_nullable === 'NO') continue;
    const nullCount = await knex(tbl).whereNull(col).count('* as n');
    if (parseInt(nullCount[0].n, 10) > 0) {
      console.warn(`Skipping NOT NULL on ${tbl}.${col} — ${nullCount[0].n} NULL rows remain.`);
      continue;
    }
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
};

exports.down = async function (knex) {
  for (const [tbl, col] of [
    ['inventory_lots', 'product_id'],
    ['payables', 'supplier_id'],
  ]) {
    const has = await knex.schema.hasTable(tbl);
    if (!has) continue;
    await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" DROP NOT NULL`);
  }
  // Don't delete the placeholder supplier on rollback — payables may still
  // reference it and dropping it would cascade-violate.
};
