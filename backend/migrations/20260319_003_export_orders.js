/**
 * Migration: Export Orders
 */

exports.up = async function (knex) {
  await knex.schema.createTable('export_orders', (t) => {
    t.increments('id').primary();
    t.string('order_no', 20).unique().notNullable();
    t.integer('customer_id').unsigned().references('id').inTable('customers');
    t.string('country', 100);
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('product_name', 255);
    t.decimal('qty_mt', 12, 2);
    t.decimal('price_per_mt', 12, 2);
    t.string('currency', 10).defaultTo('USD');
    t.decimal('contract_value', 15, 2);
    t.string('incoterm', 10);
    t.decimal('advance_pct', 5, 2).defaultTo(20);
    t.decimal('advance_expected', 15, 2);
    t.decimal('advance_received', 15, 2).defaultTo(0);
    t.date('advance_date');
    t.decimal('balance_expected', 15, 2);
    t.decimal('balance_received', 15, 2).defaultTo(0);
    t.date('balance_date');
    t.string('status', 30).defaultTo('Draft');
    t.integer('current_step').defaultTo(1);
    t.date('shipment_eta');
    t.integer('milling_order_id');
    t.string('source', 30).defaultTo('Internal Mill');
    t.string('vessel_name', 255);
    t.string('booking_no', 100);
    t.date('etd');
    t.date('atd');
    t.date('eta');
    t.date('ata');
    t.string('destination_port', 255);
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('export_order_costs', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('id').inTable('export_orders').onDelete('CASCADE');
    t.string('category', 50).notNullable();
    t.decimal('amount', 15, 2).defaultTo(0);
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('export_order_documents', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('id').inTable('export_orders').onDelete('CASCADE');
    t.string('doc_type', 50).notNullable();
    t.string('status', 30).defaultTo('Pending');
    t.string('uploaded_by', 100);
    t.date('upload_date');
    t.text('file_path');
    t.integer('version').defaultTo(1);
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('export_order_status_history', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('id').inTable('export_orders').onDelete('CASCADE');
    t.string('from_status', 30);
    t.string('to_status', 30);
    t.integer('changed_by').unsigned().references('id').inTable('users');
    t.text('reason');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('export_order_status_history');
  await knex.schema.dropTableIfExists('export_order_documents');
  await knex.schema.dropTableIfExists('export_order_costs');
  await knex.schema.dropTableIfExists('export_orders');
};
