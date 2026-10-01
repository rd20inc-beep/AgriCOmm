/**
 * Packaging recorded ON the milling batch, line by line.
 *
 * A batch could only ever state ONE bag size — milling_vehicle_arrivals carries
 * a single total_bags + bag_size_kg — so "300 katta and 500 P.P. bags" could not
 * be said at all, and the katta reconciler had to infer everything from the raw
 * lots' own bag counts. That inference is what filed 25 kg P.P. bags as katta.
 *
 * Now a batch carries a LIST: a real mill_item, how many, and which way it went.
 *
 *   received  the empty bags that come free as the rice is milled out of them,
 *             which go INTO store stock.
 *   consumed  bags taken out of store to pack this batch's output, including
 *             the katta used on by-products.
 *
 * Each line points at an actual packaging item, so its pack_type (migration 305)
 * decides which stock it lands in and its own price decides what it costs — a
 * 25 kg P.P. bag can no longer be mistaken for a 25 kg katta because the line
 * names the item, not the size.
 *
 * unit_cost_pkr is SNAPSHOT at entry. Mill Store prices change; what this batch
 * cost must not change with them, or last month's costing moves when someone
 * corrects a price today.
 *
 * Additive: a batch with no lines behaves exactly as before, deriving its katta
 * from the source lots. Lines are the truth only when they exist.
 */
exports.up = async (knex) => {
  await knex.schema.createTable('milling_batch_packaging', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').notNullable().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.integer('mill_item_id').notNullable().references('id').inTable('mill_items');
    t.string('direction', 10).notNullable();
    t.decimal('quantity', 14, 3).notNullable();
    // Snapshot of the item's price when the line was entered.
    t.decimal('unit_cost_pkr', 14, 4).nullable();
    t.decimal('total_cost_pkr', 16, 2).nullable();
    // Which output the bags went on, for a consumed line — 'finished',
    // 'byproduct', or null when it is not split out. The costing formula needs
    // the by-product katta specifically, and nothing else records it.
    t.string('output_type', 20).nullable();
    t.text('notes').nullable();
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);

    t.index(['batch_id']);
    t.index(['mill_item_id']);
    // One line per item per direction per output, so editing a batch updates a
    // line instead of stacking duplicates that would each post their own stock.
    t.unique(['batch_id', 'mill_item_id', 'direction', 'output_type'], 'uq_batch_packaging_line');
  });

  await knex.raw(`
    ALTER TABLE milling_batch_packaging
      ADD CONSTRAINT chk_batch_packaging_direction_valid
      CHECK (direction IN ('received', 'consumed'))
  `);
  await knex.raw(`
    ALTER TABLE milling_batch_packaging
      ADD CONSTRAINT chk_batch_packaging_output_type_valid
      CHECK (output_type IS NULL OR output_type IN ('finished', 'byproduct'))
  `);
  // A line of zero bags is not a line; a negative one would be the other
  // direction, which the direction column is for.
  await knex.raw(`
    ALTER TABLE milling_batch_packaging
      ADD CONSTRAINT chk_batch_packaging_quantity_positive
      CHECK (quantity > 0)
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('milling_batch_packaging');
};
