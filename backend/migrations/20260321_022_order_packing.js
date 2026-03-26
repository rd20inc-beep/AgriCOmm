/**
 * Migration: Add receiving_mode to export_orders + order_packing_lines table
 *
 * Supports: loose, bags, mixed, custom packing modes.
 * Existing orders without receiving_mode continue to work (nullable).
 */

exports.up = function (knex) {
  return knex.schema
    .alterTable('export_orders', (table) => {
      table.string('receiving_mode', 20).nullable(); // loose, bags, mixed, custom
      table.string('quantity_unit', 20).nullable();   // kg, katta, maund, ton — unit user entered qty in
      table.decimal('quantity_input_value', 15, 3).nullable(); // original entered qty
      table.integer('total_bags').nullable();          // calculated total bags (when in bags mode)
      table.decimal('total_loose_weight_kg', 15, 3).nullable(); // loose portion weight
      table.text('packing_notes').nullable();          // general packing instructions
    })
    .createTable('order_packing_lines', (table) => {
      table.increments('id').primary();
      table.integer('order_id').unsigned().notNullable().references('id').inTable('export_orders').onDelete('CASCADE');
      table.integer('line_no').notNullable().defaultTo(1);
      table.string('bag_type', 100).nullable();
      table.string('bag_quality', 100).nullable();
      table.decimal('fill_weight_kg', 10, 3).notNullable(); // weight per bag
      table.integer('bag_count').notNullable();
      table.decimal('total_weight_kg', 15, 3).notNullable(); // fill_weight_kg * bag_count
      table.string('bag_printing', 255).nullable();
      table.string('bag_color', 100).nullable();
      table.string('bag_brand', 255).nullable();
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('order_packing_lines')
    .alterTable('export_orders', (table) => {
      table.dropColumn('receiving_mode');
      table.dropColumn('quantity_unit');
      table.dropColumn('quantity_input_value');
      table.dropColumn('total_bags');
      table.dropColumn('total_loose_weight_kg');
      table.dropColumn('packing_notes');
    });
};
