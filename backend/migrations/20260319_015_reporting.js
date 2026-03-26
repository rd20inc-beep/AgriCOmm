/**
 * Migration: Reporting, BI & Management Control Tower (Phase 9)
 * Tables: saved_reports, scheduled_reports, kpi_benchmarks, report_exports
 */

exports.up = async function (knex) {
  // 1. Saved Reports
  await knex.schema.createTable('saved_reports', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('report_type', 50).notNullable(); // order_pipeline, profitability, receivable_aging, supplier_quality, customer_ranking, stock_aging, cash_forecast, production_efficiency, country_analysis, custom
    t.string('entity', 10); // null, 'export', 'mill'
    t.jsonb('filters'); // stored filter config
    t.jsonb('columns'); // selected columns
    t.string('sort_by', 100);
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.boolean('is_shared').defaultTo(false);
    t.timestamp('last_run');
    t.timestamps(true, true);
  });

  // 2. Scheduled Reports
  await knex.schema.createTable('scheduled_reports', (t) => {
    t.increments('id').primary();
    t.integer('saved_report_id').unsigned().references('id').inTable('saved_reports').onDelete('CASCADE');
    t.string('frequency', 20); // daily, weekly, monthly
    t.string('delivery_method', 20); // email, dashboard
    t.jsonb('recipients'); // array of email addresses
    t.timestamp('next_run');
    t.timestamp('last_run');
    t.boolean('is_active').defaultTo(true);
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 3. KPI Benchmarks
  await knex.schema.createTable('kpi_benchmarks', (t) => {
    t.increments('id').primary();
    t.string('kpi_name', 100).notNullable().unique();
    t.string('entity', 10);
    t.decimal('target_value', 15, 2);
    t.string('unit', 20); // '%', 'USD', 'PKR', 'MT', 'days'
    t.string('comparison', 10).defaultTo('gte'); // gte, lte, eq
    t.string('period', 20).defaultTo('monthly'); // daily, weekly, monthly, yearly
    t.text('notes');
    t.timestamps(true, true);
  });

  // 4. Report Exports
  await knex.schema.createTable('report_exports', (t) => {
    t.increments('id').primary();
    t.string('report_type', 50);
    t.string('format', 10); // xlsx, pdf, csv
    t.text('file_path');
    t.integer('file_size');
    t.integer('generated_by').unsigned().references('id').inTable('users');
    t.jsonb('filters_used');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('report_exports');
  await knex.schema.dropTableIfExists('kpi_benchmarks');
  await knex.schema.dropTableIfExists('scheduled_reports');
  await knex.schema.dropTableIfExists('saved_reports');
};
