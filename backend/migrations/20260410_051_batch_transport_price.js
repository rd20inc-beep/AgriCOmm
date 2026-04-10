/**
 * Migration 051 — Add transport mode and purchase price to milling_batches
 *
 * Stores whether transport was included in purchase and the agreed price per KG,
 * so downstream forms (vehicle arrival, analysis) can auto-populate.
 */
exports.up = async function (knex) {
  const hasNotes = await knex.schema.hasColumn('milling_batches', 'notes');
  await knex.schema.alterTable('milling_batches', (t) => {
    t.string('transport_mode', 20).defaultTo('with').after('supplier_name'); // 'with' or 'without'
    t.decimal('purchase_price_per_kg', 10, 2).nullable().after('transport_mode');
    t.integer('product_id').nullable().after('purchase_price_per_kg');
    if (!hasNotes) t.text('notes').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('transport_mode');
    t.dropColumn('purchase_price_per_kg');
    t.dropColumn('product_id');
  });
};
