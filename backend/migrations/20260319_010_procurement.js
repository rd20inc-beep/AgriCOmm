/**
 * Migration: Procurement & Purchase Management
 * Tables: purchase_requisitions, purchase_orders, goods_receipt_notes,
 *         supplier_invoices, purchase_returns
 */

exports.up = async function (knex) {
  // --- Purchase Requisitions ---
  await knex.schema.createTable('purchase_requisitions', (t) => {
    t.increments('id').primary();
    t.string('req_no', 20).unique().notNullable();
    t.string('entity', 10);
    t.integer('requested_by').unsigned().references('id').inTable('users');
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('product_name', 255);
    t.decimal('qty_mt', 12, 2).notNullable();
    t.date('required_by_date');
    t.integer('linked_export_order_id').unsigned().references('id').inTable('export_orders');
    t.integer('linked_batch_id').unsigned().references('id').inTable('milling_batches');
    t.string('priority', 20).defaultTo('Normal');
    t.string('status', 20).defaultTo('Draft');
    t.text('notes');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamp('approved_at');
    t.timestamps(true, true);

    t.check("?? IN ('mill', 'export')", ['entity']);
    t.check("?? IN ('Normal', 'Urgent', 'Low')", ['priority']);
    t.check("?? IN ('Draft', 'Submitted', 'Approved', 'Rejected', 'Ordered', 'Fulfilled', 'Cancelled')", ['status']);
  });

  // --- Purchase Orders ---
  await knex.schema.createTable('purchase_orders', (t) => {
    t.increments('id').primary();
    t.string('po_no', 20).unique().notNullable();
    t.integer('requisition_id').unsigned().references('id').inTable('purchase_requisitions');
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers').notNullable();
    t.string('entity', 10);
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('product_name', 255);
    t.decimal('qty_mt', 12, 2).notNullable();
    t.decimal('price_per_mt', 15, 2).notNullable();
    t.string('currency', 10).defaultTo('PKR');
    t.decimal('total_amount', 15, 2);
    t.string('transport_terms', 100);
    t.date('delivery_date');
    t.string('payment_terms', 100);
    t.decimal('moisture_expected', 5, 2);
    t.decimal('broken_expected', 5, 2);
    t.string('status', 20).defaultTo('Draft');
    t.integer('linked_batch_id').unsigned().references('id').inTable('milling_batches');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);

    t.check("?? IN ('Draft', 'Sent', 'Acknowledged', 'Partially Received', 'Fully Received', 'Cancelled')", ['status']);
  });

  // --- Goods Receipt Notes ---
  await knex.schema.createTable('goods_receipt_notes', (t) => {
    t.increments('id').primary();
    t.string('grn_no', 20).unique().notNullable();
    t.integer('po_id').unsigned().references('id').inTable('purchase_orders').notNullable();
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers');
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.date('receipt_date').notNullable();
    t.string('vehicle_no', 50);
    t.string('driver_name', 255);
    t.string('driver_phone', 50);
    t.decimal('gross_weight_mt', 12, 2);
    t.decimal('tare_weight_mt', 12, 2);
    t.decimal('net_weight_mt', 12, 2);
    t.decimal('accepted_qty_mt', 12, 2);
    t.decimal('rejected_qty_mt', 12, 2).defaultTo(0);
    t.text('rejection_reason');
    t.string('quality_status', 20).defaultTo('Pending');
    t.decimal('moisture_actual', 5, 2);
    t.decimal('broken_actual', 5, 2);
    t.decimal('price_per_mt', 15, 2);
    t.decimal('total_value', 15, 2);
    t.string('currency', 10).defaultTo('PKR');
    t.string('status', 20).defaultTo('Draft');
    t.integer('received_by').unsigned().references('id').inTable('users');
    t.integer('inspected_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);

    t.check("?? IN ('Pending', 'Approved', 'Rejected', 'Conditional')", ['quality_status']);
    t.check("?? IN ('Draft', 'Posted', 'Cancelled')", ['status']);
  });

  // --- Supplier Invoices ---
  await knex.schema.createTable('supplier_invoices', (t) => {
    t.increments('id').primary();
    t.string('invoice_no', 50).notNullable();
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers').notNullable();
    t.integer('po_id').unsigned().references('id').inTable('purchase_orders');
    t.integer('grn_id').unsigned().references('id').inTable('goods_receipt_notes');
    t.date('invoice_date');
    t.date('due_date');
    t.decimal('gross_amount', 15, 2);
    t.decimal('deductions', 15, 2).defaultTo(0);
    t.decimal('net_amount', 15, 2);
    t.string('currency', 10).defaultTo('PKR');
    t.string('status', 20).defaultTo('Pending');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);

    t.check("?? IN ('Pending', 'Approved', 'Partially Paid', 'Paid', 'Disputed', 'Cancelled')", ['status']);
  });

  // --- Purchase Returns ---
  await knex.schema.createTable('purchase_returns', (t) => {
    t.increments('id').primary();
    t.string('return_no', 20).unique().notNullable();
    t.integer('grn_id').unsigned().references('id').inTable('goods_receipt_notes');
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers');
    t.decimal('qty_mt', 12, 2);
    t.text('reason');
    t.string('status', 20).defaultTo('Pending');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);

    t.check("?? IN ('Pending', 'Approved', 'Completed')", ['status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('purchase_returns');
  await knex.schema.dropTableIfExists('supplier_invoices');
  await knex.schema.dropTableIfExists('goods_receipt_notes');
  await knex.schema.dropTableIfExists('purchase_orders');
  await knex.schema.dropTableIfExists('purchase_requisitions');
};
