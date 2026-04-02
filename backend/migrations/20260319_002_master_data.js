/**
 * Migration: Master Data
 */

exports.up = async function (knex) {
  await knex.schema.createTable('customers', (t) => {
    t.increments('id').primary();
    t.string('uid', 50).unique();
    t.string('name', 255).notNullable();
    t.string('contact_person', 255);
    t.string('email', 255);
    t.string('phone', 50);
    t.text('address');
    t.string('country', 100);
    t.string('bank_name', 255);
    t.string('bank_account', 100);
    t.string('bank_swift', 50);
    t.string('bank_iban', 100);
    t.string('payment_terms', 100).defaultTo('Advance');
    t.string('currency', 10).defaultTo('USD');
    t.decimal('credit_limit', 15, 2).defaultTo(0);
    t.string('vat_number', 100);
    t.boolean('is_active').defaultTo(true);
    t.boolean('archived').defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('suppliers', (t) => {
    t.increments('id').primary();
    t.string('uid', 50).unique();
    t.string('name', 255).notNullable();
    t.string('contact_person', 255);
    t.string('email', 255);
    t.string('phone', 50);
    t.text('address');
    t.string('country', 100);
    t.string('type', 50).defaultTo('Paddy Supplier');
    t.boolean('is_active').defaultTo(true);
    t.boolean('archived').defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('products', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('code', 50);
    t.string('grade', 50);
    t.string('category', 50).defaultTo('Rice');
    t.text('description');
    t.boolean('is_byproduct').defaultTo(false);
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('bag_types', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('category', 50);
    t.decimal('size_kg', 10, 2);
    t.string('material', 100);
    t.text('description');
    t.string('unit', 20).defaultTo('pcs');
    t.integer('reorder_level').defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('warehouses', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('entity', 10);
    t.string('type', 20);
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);

    t.check("?? IN ('mill','export')", ['entity']);
  });

  await knex.schema.createTable('bank_accounts', (t) => {
    t.increments('id').primary();
    t.string('uid', 50).unique();
    t.string('name', 255).notNullable();
    t.string('type', 20);
    t.string('account_number', 100);
    t.string('bank_name', 255);
    t.string('branch', 255);
    t.string('currency', 10).defaultTo('PKR');
    t.decimal('current_balance', 15, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);

    t.check("?? IN ('bank','cash','mobile_money')", ['type']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bank_accounts');
  await knex.schema.dropTableIfExists('warehouses');
  await knex.schema.dropTableIfExists('bag_types');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('suppliers');
  await knex.schema.dropTableIfExists('customers');
};
