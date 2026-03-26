/**
 * Migration: Add bag specification fields to export_orders
 *
 * Adds packing/bag detail columns directly on the order header.
 * All columns are nullable so existing orders are unaffected.
 */

exports.up = function (knex) {
  return knex.schema.alterTable('export_orders', (table) => {
    // Required bag fields
    table.string('bag_type', 100).nullable();        // e.g. "PP Bag", "BOPP Bag", "Jute Bag"
    table.string('bag_quality', 100).nullable();      // e.g. "New", "A-Grade", "Standard"

    // Optional specification fields
    table.decimal('bag_size_kg', 8, 2).nullable();    // e.g. 25, 50, 5
    table.decimal('bag_weight_gm', 8, 2).nullable();  // weight of empty bag in grams
    table.string('bag_printing', 255).nullable();     // e.g. "Buyer Logo + Text", "Plain", "Custom"
    table.string('bag_color', 100).nullable();        // e.g. "White", "Transparent", "Blue Stripe"
    table.string('bag_brand', 255).nullable();        // brand/mark printed on bag
    table.integer('units_per_bag').nullable();         // e.g. 1 (for 25kg bags with 25kg rice)
    table.text('bag_notes').nullable();               // free-text packing instructions
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('export_orders', (table) => {
    table.dropColumn('bag_type');
    table.dropColumn('bag_quality');
    table.dropColumn('bag_size_kg');
    table.dropColumn('bag_weight_gm');
    table.dropColumn('bag_printing');
    table.dropColumn('bag_color');
    table.dropColumn('bag_brand');
    table.dropColumn('units_per_bag');
    table.dropColumn('bag_notes');
  });
};
