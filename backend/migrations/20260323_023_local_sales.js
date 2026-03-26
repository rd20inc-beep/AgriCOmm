/**
 * Migration: Local Sales module
 * Supports selling inventory in the local Pakistani market (PKR).
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('local_sales', (table) => {
      table.increments('id').primary();
      table.string('sale_no', 30).unique();
      table.date('sale_date').notNullable().defaultTo(knex.fn.now());
      table.string('entity', 10).defaultTo('mill'); // mill or export
      table.integer('customer_id').unsigned().nullable().references('id').inTable('customers').onDelete('SET NULL');
      table.string('buyer_name', 255).nullable(); // for walk-in / unregistered buyers
      table.string('buyer_phone', 50).nullable();
      table.string('buyer_address', 500).nullable();

      // What's being sold
      table.integer('lot_id').unsigned().nullable().references('id').inTable('inventory_lots').onDelete('SET NULL');
      table.string('lot_no', 50).nullable();
      table.string('item_name', 255).notNullable();
      table.string('item_type', 30).nullable(); // finished, byproduct, raw

      // Quantity
      table.string('quantity_unit', 20).defaultTo('kg');
      table.decimal('quantity_input', 15, 3).notNullable();
      table.decimal('quantity_kg', 15, 3).notNullable();
      table.integer('quantity_bags').nullable();
      table.decimal('bag_weight_kg', 10, 3).defaultTo(50);

      // Pricing
      table.string('rate_unit', 20).defaultTo('kg'); // kg, katta, maund, ton
      table.decimal('rate_input', 15, 4).notNullable();
      table.decimal('rate_per_kg', 15, 4).notNullable();
      table.decimal('total_amount', 15, 2).notNullable();
      table.string('currency', 10).defaultTo('PKR');

      // Payment
      table.string('payment_mode', 30).defaultTo('cash'); // cash, cheque, bank_transfer, credit
      table.string('payment_status', 20).defaultTo('Paid'); // Paid, Partial, Credit, Unpaid
      table.decimal('paid_amount', 15, 2).defaultTo(0);
      table.decimal('due_amount', 15, 2).defaultTo(0);
      table.string('payment_reference', 100).nullable();

      // Dispatch
      table.string('vehicle_no', 50).nullable();
      table.string('driver_name', 100).nullable();
      table.boolean('dispatched').defaultTo(false);
      table.date('dispatch_date').nullable();

      // Meta
      table.text('notes').nullable();
      table.string('status', 20).defaultTo('Completed'); // Completed, Pending, Cancelled
      table.integer('created_by').unsigned().nullable().references('id').inTable('users');
      table.timestamps(true, true);
    });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('local_sales');
};
