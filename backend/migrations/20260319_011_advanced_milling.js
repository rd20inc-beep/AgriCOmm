/**
 * Migration: Advanced Milling Operations (Phase 5)
 * Adds mills, production plans, machine downtime, utility consumption,
 * recovery benchmarks, post-milling quality, source lots, reprocessing batches,
 * and extends milling_batches with advanced fields.
 */

exports.up = async function (knex) {
  // === Mills ===
  await knex.schema.createTable('mills', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('location', 255);
    t.decimal('capacity_mt_per_day', 10, 2);
    t.string('status', 20).defaultTo('Active'); // Active, Maintenance, Inactive
    t.string('contact_person', 255);
    t.string('phone', 50);
    t.text('notes');
    t.timestamps(true, true);
  });

  // === Recovery Benchmarks ===
  await knex.schema.createTable('recovery_benchmarks', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('variety', 100);
    t.string('season', 20); // Kharif, Rabi
    t.decimal('expected_yield_pct', 5, 2);
    t.decimal('expected_broken_pct', 5, 2);
    t.decimal('expected_bran_pct', 5, 2);
    t.decimal('expected_husk_pct', 5, 2);
    t.decimal('expected_wastage_pct', 5, 2);
    t.decimal('moisture_range_min', 5, 2);
    t.decimal('moisture_range_max', 5, 2);
    t.text('notes');
    t.timestamps(true, true);
  });

  // === Add columns to milling_batches ===
  await knex.schema.alterTable('milling_batches', (t) => {
    t.integer('mill_id').unsigned().references('id').inTable('mills');
    t.string('machine_line', 50);
    t.string('shift', 20);
    t.decimal('moisture_loss_pct', 5, 2).defaultTo(0);
    t.decimal('processing_hours', 8, 2).defaultTo(0);
    t.string('operator_name', 255);
    t.string('post_milling_grade', 50);
    t.integer('benchmark_id').unsigned().references('id').inTable('recovery_benchmarks');
  });

  // === Production Plans ===
  await knex.schema.createTable('production_plans', (t) => {
    t.increments('id').primary();
    t.string('plan_no', 20).unique().notNullable();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('mill_id').unsigned().references('id').inTable('mills');
    t.date('planned_date').notNullable();
    t.string('shift', 20); // Morning, Afternoon, Night
    t.string('machine_line', 50);
    t.decimal('planned_qty_mt', 12, 2);
    t.decimal('actual_qty_mt', 12, 2).defaultTo(0);
    t.string('status', 20).defaultTo('Planned'); // Planned, In Progress, Completed, Cancelled, Rescheduled
    t.string('operator_name', 255);
    t.timestamp('start_time');
    t.timestamp('end_time');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // === Machine Downtime ===
  await knex.schema.createTable('machine_downtime', (t) => {
    t.increments('id').primary();
    t.integer('mill_id').unsigned().references('id').inTable('mills');
    t.string('machine_line', 50).notNullable();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.timestamp('start_time').notNullable();
    t.timestamp('end_time');
    t.integer('duration_minutes');
    t.string('reason', 100); // Breakdown, Maintenance, Power Outage, Cleaning, Setup, Other
    t.text('description');
    t.decimal('impact_mt', 10, 2).defaultTo(0);
    t.boolean('resolved').defaultTo(false);
    t.integer('reported_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // === Utility Consumption ===
  await knex.schema.createTable('utility_consumption', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('mill_id').unsigned().references('id').inTable('mills');
    t.string('utility_type', 30); // Electricity, Water, Gas, Diesel, Other
    t.decimal('reading_start', 12, 2);
    t.decimal('reading_end', 12, 2);
    t.decimal('consumption', 12, 2);
    t.string('unit', 20); // kWh, Liters, m3
    t.decimal('rate_per_unit', 10, 2);
    t.decimal('total_cost', 15, 2);
    t.string('currency', 10).defaultTo('PKR');
    t.date('period_start');
    t.date('period_end');
    t.text('notes');
    t.integer('recorded_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // === Milling Quality Post ===
  await knex.schema.createTable('milling_quality_post', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.string('product_type', 20); // finished, broken, bran
    t.decimal('moisture', 5, 2);
    t.decimal('broken_pct', 5, 2);
    t.decimal('chalky_pct', 5, 2);
    t.decimal('whiteness', 5, 2);
    t.decimal('grain_length', 5, 2);
    t.decimal('foreign_matter', 5, 2);
    t.string('grade_assigned', 50);
    t.string('inspector', 255);
    t.timestamp('inspected_at');
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // === Batch Source Lots ===
  await knex.schema.createTable('batch_source_lots', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.integer('lot_id').unsigned().references('id').inTable('inventory_lots');
    t.decimal('qty_mt', 12, 2);
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // === Reprocessing Batches ===
  await knex.schema.createTable('reprocessing_batches', (t) => {
    t.increments('id').primary();
    t.string('reprocess_no', 20).unique();
    t.integer('original_batch_id').unsigned().references('id').inTable('milling_batches');
    t.text('reason').notNullable();
    t.string('input_product', 255);
    t.decimal('input_qty_mt', 12, 2);
    t.decimal('output_qty_mt', 12, 2).defaultTo(0);
    t.decimal('wastage_mt', 12, 2).defaultTo(0);
    t.string('status', 20).defaultTo('Pending'); // Pending, In Progress, Completed
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('reprocessing_batches');
  await knex.schema.dropTableIfExists('batch_source_lots');
  await knex.schema.dropTableIfExists('milling_quality_post');
  await knex.schema.dropTableIfExists('utility_consumption');
  await knex.schema.dropTableIfExists('machine_downtime');
  await knex.schema.dropTableIfExists('production_plans');

  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('mill_id');
    t.dropColumn('machine_line');
    t.dropColumn('shift');
    t.dropColumn('moisture_loss_pct');
    t.dropColumn('processing_hours');
    t.dropColumn('operator_name');
    t.dropColumn('post_milling_grade');
    t.dropColumn('benchmark_id');
  });

  await knex.schema.dropTableIfExists('recovery_benchmarks');
  await knex.schema.dropTableIfExists('mills');
};
