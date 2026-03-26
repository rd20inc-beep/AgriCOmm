/**
 * Migration: Users & Roles
 */

exports.up = async function (knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id').primary();
    t.string('name', 50).unique().notNullable();
    t.text('description');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.uuid('uid').unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).unique().notNullable();
    t.string('password_hash', 255).notNullable();
    t.string('full_name', 255).notNullable();
    t.integer('role_id').unsigned().references('id').inTable('roles');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_login');
    t.timestamps(true, true);
  });

  // Seed default roles
  await knex('roles').insert([
    { name: 'Super Admin', description: 'Full system access' },
    { name: 'Export Manager', description: 'Manages export orders and shipments' },
    { name: 'Finance Manager', description: 'Manages financials, receivables, payables' },
    { name: 'Mill Manager', description: 'Manages milling operations' },
    { name: 'QC Analyst', description: 'Quality control and sample analysis' },
    { name: 'Inventory Officer', description: 'Manages inventory and warehouses' },
    { name: 'Documentation Officer', description: 'Manages export documentation' },
    { name: 'Read-Only Auditor', description: 'Read-only access for auditing' },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('roles');
};
