/**
 * Migration: Enterprise Polish & Scale (Phase 10)
 * Tables: background_jobs, data_imports, api_integrations, api_sync_log,
 *         system_health, user_preferences
 */

exports.up = async function (knex) {
  // 1. Background Jobs
  await knex.schema.createTable('background_jobs', (t) => {
    t.increments('id').primary();
    t.string('job_type', 50).notNullable(); // import, export, sync, report_generation, email_batch, cleanup
    t.string('name', 255);
    t.string('status', 20).defaultTo('Pending'); // Pending, Running, Completed, Failed, Cancelled
    t.integer('progress').defaultTo(0); // 0-100 percentage
    t.integer('total_items').defaultTo(0);
    t.integer('processed_items').defaultTo(0);
    t.integer('failed_items').defaultTo(0);
    t.jsonb('input_data'); // job configuration
    t.jsonb('result_data'); // output/results
    t.text('error');
    t.timestamp('started_at');
    t.timestamp('completed_at');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. Data Imports
  await knex.schema.createTable('data_imports', (t) => {
    t.increments('id').primary();
    t.string('import_type', 50).notNullable(); // customers, suppliers, products, bank_accounts, inventory, opening_balances
    t.string('file_name', 255);
    t.text('file_path');
    t.integer('total_rows').defaultTo(0);
    t.integer('imported_rows').defaultTo(0);
    t.integer('failed_rows').defaultTo(0);
    t.jsonb('errors'); // array of {row, field, error}
    t.string('status', 20).defaultTo('Pending'); // Pending, Processing, Completed, Failed
    t.integer('job_id').unsigned().references('id').inTable('background_jobs');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 3. API Integrations
  await knex.schema.createTable('api_integrations', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable(); // agri_crm, bank_statement, shipping_api, whatsapp, sms
    t.string('base_url', 500);
    t.string('auth_type', 20); // bearer, basic, api_key, none
    t.jsonb('auth_credentials'); // encrypted credentials
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_sync');
    t.string('sync_frequency', 20); // manual, hourly, daily
    t.jsonb('config'); // integration-specific config
    t.timestamps(true, true);
  });

  // 4. API Sync Log
  await knex.schema.createTable('api_sync_log', (t) => {
    t.increments('id').primary();
    t.integer('integration_id').unsigned().references('id').inTable('api_integrations').onDelete('CASCADE');
    t.string('direction', 10); // inbound, outbound
    t.string('entity_type', 50); // what was synced
    t.integer('records_synced').defaultTo(0);
    t.integer('records_failed').defaultTo(0);
    t.string('status', 20); // Success, Partial, Failed
    t.jsonb('details');
    t.timestamp('started_at');
    t.timestamp('completed_at');
  });

  // 5. System Health
  await knex.schema.createTable('system_health', (t) => {
    t.increments('id').primary();
    t.string('check_type', 50); // database, disk, memory, api_response, queue_depth
    t.string('status', 20); // Healthy, Warning, Critical
    t.string('value', 100);
    t.string('threshold', 100);
    t.jsonb('details');
    t.timestamp('checked_at').defaultTo(knex.fn.now());
  });

  // 6. User Preferences
  await knex.schema.createTable('user_preferences', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').unique();
    t.string('language', 10).defaultTo('en');
    t.string('timezone', 50).defaultTo('Asia/Karachi');
    t.string('date_format', 20).defaultTo('DD/MM/YYYY');
    t.string('number_format', 20).defaultTo('en-PK');
    t.string('currency_display', 20).defaultTo('symbol'); // symbol, code, name
    t.jsonb('dashboard_layout'); // custom widget positions
    t.boolean('notifications_email').defaultTo(true);
    t.boolean('notifications_push').defaultTo(true);
    t.boolean('notifications_sms').defaultTo(false);
    t.string('theme', 20).defaultTo('light');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_preferences');
  await knex.schema.dropTableIfExists('system_health');
  await knex.schema.dropTableIfExists('api_sync_log');
  await knex.schema.dropTableIfExists('api_integrations');
  await knex.schema.dropTableIfExists('data_imports');
  await knex.schema.dropTableIfExists('background_jobs');
};
