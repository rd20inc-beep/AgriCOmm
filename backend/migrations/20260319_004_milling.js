/**
 * Migration: Milling
 */

exports.up = async function (knex) {
  await knex.schema.createTable('milling_batches', (t) => {
    t.increments('id').primary();
    t.string('batch_no', 20).unique().notNullable();
    t.integer('linked_export_order_id').unsigned().references('id').inTable('export_orders');
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers');
    t.string('supplier_name', 255);
    t.string('status', 30).defaultTo('Queued');
    t.decimal('raw_qty_mt', 12, 2);
    t.decimal('planned_finished_mt', 12, 2);
    t.decimal('actual_finished_mt', 12, 2).defaultTo(0);
    t.decimal('broken_mt', 12, 2).defaultTo(0);
    t.decimal('bran_mt', 12, 2).defaultTo(0);
    t.decimal('husk_mt', 12, 2).defaultTo(0);
    t.decimal('wastage_mt', 12, 2).defaultTo(0);
    t.decimal('yield_pct', 5, 1).defaultTo(0);
    t.timestamp('completed_at');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('milling_quality_samples', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.string('analysis_type', 10);
    t.decimal('moisture', 5, 2);
    t.decimal('broken', 5, 2);
    t.decimal('chalky', 5, 2);
    t.decimal('foreign_matter', 5, 2);
    t.decimal('discoloration', 5, 2);
    t.decimal('purity', 5, 2);
    t.decimal('grain_size', 5, 2);
    t.decimal('price_per_kg', 10, 2);
    t.decimal('price_per_mt', 12, 2);
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.check("?? IN ('sample','arrival')", ['analysis_type']);
  });

  await knex.schema.createTable('milling_costs', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.string('category', 50).notNullable();
    t.decimal('amount', 15, 2).defaultTo(0);
    t.string('currency', 10).defaultTo('PKR');
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('milling_vehicle_arrivals', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches').onDelete('CASCADE');
    t.string('vehicle_no', 50).notNullable();
    t.string('driver_name', 255);
    t.string('driver_phone', 50);
    t.decimal('weight_mt', 12, 2);
    t.date('arrival_date');
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('milling_vehicle_arrivals');
  await knex.schema.dropTableIfExists('milling_costs');
  await knex.schema.dropTableIfExists('milling_quality_samples');
  await knex.schema.dropTableIfExists('milling_batches');
};
