/**
 * Migration: Finance
 */

exports.up = async function (knex) {
  await knex.schema.createTable('receivables', (t) => {
    t.increments('id').primary();
    t.string('recv_no', 20).unique();
    t.string('entity', 10);
    t.integer('order_id').unsigned().references('id').inTable('export_orders');
    t.integer('customer_id').unsigned().references('id').inTable('customers');
    t.string('type', 30);
    t.decimal('expected_amount', 15, 2);
    t.decimal('received_amount', 15, 2).defaultTo(0);
    t.decimal('outstanding', 15, 2);
    t.date('due_date');
    t.string('status', 20).defaultTo('Pending');
    t.string('currency', 10).defaultTo('USD');
    t.integer('aging').defaultTo(0);
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payables', (t) => {
    t.increments('id').primary();
    t.string('pay_no', 20).unique();
    t.string('entity', 10);
    t.string('category', 50);
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers');
    t.string('linked_ref', 50);
    t.decimal('original_amount', 15, 2);
    t.decimal('paid_amount', 15, 2).defaultTo(0);
    t.decimal('outstanding', 15, 2);
    t.date('due_date');
    t.string('status', 20).defaultTo('Pending');
    t.string('currency', 10).defaultTo('USD');
    t.integer('aging').defaultTo(0);
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payments', (t) => {
    t.increments('id').primary();
    t.string('payment_no', 20).unique();
    t.string('type', 20);
    t.integer('linked_receivable_id').unsigned().references('id').inTable('receivables');
    t.integer('linked_payable_id').unsigned().references('id').inTable('payables');
    t.decimal('amount', 15, 2).notNullable();
    t.string('currency', 10);
    t.string('payment_method', 50);
    t.integer('bank_account_id').unsigned().references('id').inTable('bank_accounts');
    t.string('bank_reference', 100);
    t.date('payment_date');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.check("?? IN ('receipt','payment')", ['type']);
  });

  await knex.schema.createTable('internal_transfers', (t) => {
    t.increments('id').primary();
    t.string('transfer_no', 20).unique();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('export_order_id').unsigned().references('id').inTable('export_orders');
    t.string('product_name', 255);
    t.decimal('qty_mt', 12, 2);
    t.decimal('transfer_price_pkr', 15, 2);
    t.decimal('total_value_pkr', 15, 2);
    t.decimal('usd_equivalent', 15, 2);
    t.decimal('pkr_rate', 10, 2).defaultTo(280);
    t.date('dispatch_date');
    t.string('status', 20).defaultTo('Pending');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('journal_entries', (t) => {
    t.increments('id').primary();
    t.string('journal_no', 20).unique();
    t.date('date').notNullable();
    t.string('entity', 10);
    t.string('ref_type', 50);
    t.string('ref_no', 50);
    t.text('description');
    t.string('status', 20).defaultTo('Draft');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('journal_lines', (t) => {
    t.increments('id').primary();
    t.integer('journal_id').unsigned().references('id').inTable('journal_entries').onDelete('CASCADE');
    t.string('account', 255).notNullable();
    t.decimal('debit', 15, 2).defaultTo(0);
    t.decimal('credit', 15, 2).defaultTo(0);
    t.text('narration');
  });

  await knex.schema.createTable('cost_allocations', (t) => {
    t.increments('id').primary();
    t.string('cost_no', 20).unique();
    t.date('date');
    t.string('entity', 10);
    t.string('category', 50);
    t.string('vendor', 255);
    t.decimal('gross_amount', 15, 2);
    t.string('currency', 10);
    t.string('status', 20).defaultTo('Unallocated');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('cost_allocation_lines', (t) => {
    t.increments('id').primary();
    t.integer('allocation_id').unsigned().references('id').inTable('cost_allocations').onDelete('CASCADE');
    t.string('target_type', 20);
    t.string('target_id', 50);
    t.decimal('amount', 15, 2);
    t.decimal('pct', 5, 1);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('cost_allocation_lines');
  await knex.schema.dropTableIfExists('cost_allocations');
  await knex.schema.dropTableIfExists('journal_lines');
  await knex.schema.dropTableIfExists('journal_entries');
  await knex.schema.dropTableIfExists('internal_transfers');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('payables');
  await knex.schema.dropTableIfExists('receivables');
};
