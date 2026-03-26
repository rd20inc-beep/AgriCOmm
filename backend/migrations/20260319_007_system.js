/**
 * Migration: System
 */

exports.up = async function (knex) {
  await knex.schema.createTable('alerts', (t) => {
    t.increments('id').primary();
    t.string('severity', 10);
    t.string('entity', 10);
    t.string('linked_ref', 50);
    t.string('title', 255);
    t.text('summary');
    t.decimal('amount_at_risk', 15, 2);
    t.integer('age_days').defaultTo(0);
    t.text('recommended_action');
    t.string('status', 20).defaultTo('Open');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('id').inTable('users');
    t.string('action', 100).notNullable();
    t.string('entity_type', 50);
    t.string('entity_id', 50);
    t.jsonb('details');
    t.string('ip_address', 50);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('notifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('id').inTable('users');
    t.string('title', 255);
    t.text('message');
    t.string('type', 30);
    t.string('linked_ref', 50);
    t.boolean('is_read').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('system_settings', (t) => {
    t.increments('id').primary();
    t.string('key', 100).unique().notNullable();
    t.text('value');
    t.string('category', 50);
    t.integer('updated_by').unsigned().references('id').inTable('users');
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('system_settings');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('alerts');
};
