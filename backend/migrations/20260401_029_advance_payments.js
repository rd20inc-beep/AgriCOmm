/**
 * Migration: Advance Payments
 * Tracks unallocated buyer advances and their allocation to export orders.
 */

exports.up = async function (knex) {
  const hasAdvancePayments = await knex.schema.hasTable('advance_payments');
  if (!hasAdvancePayments) {
    await knex.schema.createTable('advance_payments', (t) => {
      t.increments('id').primary();
      t.string('advance_no', 50).unique();
      t.integer('customer_id').unsigned().references('id').inTable('customers');
      t.decimal('amount', 15, 2).notNullable();
      t.decimal('allocated_amount', 15, 2).defaultTo(0);
      t.decimal('unallocated_amount', 15, 2).defaultTo(0);
      t.string('currency', 10).defaultTo('USD');
      t.integer('bank_account_id').unsigned().references('id').inTable('bank_accounts');
      t.string('payment_method', 50);
      t.string('bank_reference', 255);
      t.date('payment_date');
      t.string('status', 20).defaultTo('Unallocated');
      t.text('notes');
      t.integer('created_by').unsigned().references('id').inTable('users');
      t.timestamps(true, true);

      t.check("?? IN ('Unallocated', 'Partial', 'Allocated')", ['status']);
    });
  }

  const hasAdvanceAllocations = await knex.schema.hasTable('advance_allocations');
  if (!hasAdvanceAllocations) {
    await knex.schema.createTable('advance_allocations', (t) => {
      t.increments('id').primary();
      t.integer('advance_id').unsigned().notNullable().references('id').inTable('advance_payments').onDelete('CASCADE');
      t.integer('order_id').unsigned().references('id').inTable('export_orders');
      t.decimal('amount', 15, 2).notNullable();
      t.integer('allocated_by').unsigned().references('id').inTable('users');
      t.text('notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('advance_allocations');
  await knex.schema.dropTableIfExists('advance_payments');
};
