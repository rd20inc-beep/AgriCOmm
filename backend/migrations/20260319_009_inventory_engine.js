/**
 * Migration: Inventory Engine Enhancement
 * Adds cost tracking, reservations, and richer movement data.
 */

exports.up = async function (knex) {
  // --- Enhance inventory_lots ---
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('batch_ref', 50);
    t.decimal('cost_per_unit', 15, 2).defaultTo(0);
    t.string('cost_currency', 10).defaultTo('PKR');
    t.decimal('total_value', 15, 2).defaultTo(0);
    t.decimal('reserved_qty', 15, 2).defaultTo(0);
    t.decimal('available_qty', 15, 2).defaultTo(0);
    t.date('expiry_date');
    t.integer('created_by').unsigned().references('id').inTable('users');
  });

  // --- Enhance inventory_movements ---
  await knex.schema.alterTable('inventory_movements', (t) => {
    t.decimal('cost_per_unit', 15, 2).defaultTo(0);
    t.decimal('total_cost', 15, 2).defaultTo(0);
    t.string('currency', 10).defaultTo('PKR');
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('order_id').unsigned().references('id').inTable('export_orders');
    t.integer('transfer_id').unsigned().references('id').inTable('internal_transfers');
  });

  // --- Create inventory_reservations ---
  await knex.schema.createTable('inventory_reservations', (t) => {
    t.increments('id').primary();
    t.integer('lot_id').unsigned().references('id').inTable('inventory_lots').onDelete('CASCADE');
    t.integer('order_id').unsigned().references('id').inTable('export_orders');
    t.decimal('reserved_qty', 15, 2).notNullable();
    t.string('status', 20).defaultTo('Active');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('inventory_reservations');

  await knex.schema.alterTable('inventory_movements', (t) => {
    t.dropColumn('cost_per_unit');
    t.dropColumn('total_cost');
    t.dropColumn('currency');
    t.dropColumn('batch_id');
    t.dropColumn('order_id');
    t.dropColumn('transfer_id');
  });

  await knex.schema.alterTable('inventory_lots', (t) => {
    t.dropColumn('product_id');
    t.dropColumn('batch_ref');
    t.dropColumn('cost_per_unit');
    t.dropColumn('cost_currency');
    t.dropColumn('total_value');
    t.dropColumn('reserved_qty');
    t.dropColumn('available_qty');
    t.dropColumn('expiry_date');
    t.dropColumn('created_by');
  });
};
