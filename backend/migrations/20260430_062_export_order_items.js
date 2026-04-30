/**
 * Migration: Multi-line items per export order.
 *
 * Adds an `export_order_items` child table so a single P.I. can carry multiple
 * products, each with its own qty, price, HS code, and packing.
 *
 * Existing summary fields on `export_orders` (product_id, qty_mt, price_per_mt,
 * hs_code, ...) remain in place. They continue to act as the rolled-up summary
 * so older code paths (milling, document renderers, dashboards) keep working
 * until they are migrated line-by-line. For multi-line orders the summary
 * values are derived from items on save.
 *
 * Backfill: every existing order gets one item row mirroring its current
 * single-product fields.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('export_order_items', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().notNullable()
      .references('id').inTable('export_orders').onDelete('CASCADE');
    t.integer('line_no').notNullable().defaultTo(1);
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('product_name', 255);
    t.decimal('qty_mt', 12, 3).notNullable().defaultTo(0);
    t.decimal('price_per_mt', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 15, 2).notNullable().defaultTo(0);
    t.string('hs_code', 20);
    t.string('packing', 100);          // free-text packing description (e.g. "5 KG PP BAG")
    t.decimal('bag_size_kg', 8, 3);
    t.integer('bag_count');
    t.string('bag_type', 100);
    t.string('bag_quality', 100);
    t.string('bag_brand', 255);
    t.string('bag_color', 100);
    t.string('bag_printing', 255);
    t.text('quality_description');
    t.decimal('broken_pct_target', 5, 2);
    t.text('notes');
    t.timestamps(true, true);
    t.index(['order_id', 'line_no']);
  });

  // Backfill: one item per existing order, derived from summary fields.
  // Some optional doc-generation columns (hs_code, quality_description, ...)
  // may or may not exist depending on how this DB was migrated, so we read
  // each row as JSONB and pick only what's actually there.
  const colsResult = await knex.raw(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'export_orders'"
  );
  const presentCols = new Set((colsResult.rows || []).map((r) => r.column_name));
  const optional = (name) => (presentCols.has(name) ? name : null);
  const selectCols = [
    'id', 'product_id', 'product_name', 'qty_mt', 'price_per_mt',
    'contract_value', 'bag_size_kg', 'bag_type', 'bag_quality',
    'bag_brand', 'bag_color', 'bag_printing', 'total_bags', 'packing_notes',
    optional('hs_code'),
    optional('quality_description'),
    optional('broken_pct_target'),
  ].filter(Boolean);
  const existing = await knex('export_orders').select(...selectCols);

  if (existing.length > 0) {
    const rows = existing.map((o) => {
      const qty = parseFloat(o.qty_mt) || 0;
      const price = parseFloat(o.price_per_mt) || 0;
      const lineTotal = parseFloat(o.contract_value) || qty * price;
      const packingFromBag = o.bag_size_kg
        ? `Packed in ${parseFloat(o.bag_size_kg)} KG ${o.bag_type || 'PP'} BAG`
        : null;
      return {
        order_id: o.id,
        line_no: 1,
        product_id: o.product_id || null,
        product_name: o.product_name || null,
        qty_mt: qty,
        price_per_mt: price,
        line_total: lineTotal,
        hs_code: o.hs_code || null,
        packing: packingFromBag,
        bag_size_kg: o.bag_size_kg || null,
        bag_count: o.total_bags || null,
        bag_type: o.bag_type || null,
        bag_quality: o.bag_quality || null,
        bag_brand: o.bag_brand || null,
        bag_color: o.bag_color || null,
        bag_printing: o.bag_printing || null,
        quality_description: o.quality_description || null,
        broken_pct_target: o.broken_pct_target || null,
        notes: o.packing_notes || null,
      };
    });
    // chunk inserts to be safe across DB drivers
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await knex('export_order_items').insert(rows.slice(i, i + chunkSize));
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('export_order_items');
};
