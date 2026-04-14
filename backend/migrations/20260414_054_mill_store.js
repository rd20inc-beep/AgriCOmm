/**
 * Mill Store / Consumables Inventory — Phase 1 schema
 *
 * Creates the stock-management module for operational materials consumed
 * during milling (bags, thread, chemicals, diesel, spare parts).
 *
 * This module is standalone — it does NOT extend export inventory_lots
 * or the generic purchase_orders flow. The only integration point with
 * the rest of the system is batch_costs rows posted on consumption.
 */

exports.up = async function (knex) {
  // ─── mill_items: master of consumable SKUs ───
  await knex.schema.createTable('mill_items', (t) => {
    t.increments('id').primary();
    t.string('code', 50).unique().notNullable();
    t.string('name', 255).notNullable();
    t.string('category', 30).notNullable();
    t.string('subcategory', 50);
    t.string('unit', 20).notNullable();
    t.integer('bag_type_id').unsigned().references('id').inTable('bag_types');
    t.decimal('reorder_level', 12, 3).notNullable().defaultTo(0);
    t.decimal('avg_cost_per_unit', 15, 4);
    t.decimal('last_purchase_cost', 15, 4);
    t.integer('preferred_supplier_id').unsigned().references('id').inTable('suppliers');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex.schema.alterTable('mill_items', (t) => {
    t.index('category');
    t.index('is_active');
  });
  // CHECK constraints
  await knex.raw(`
    ALTER TABLE mill_items
    ADD CONSTRAINT mill_items_category_chk
    CHECK (category IN ('packaging','operational','fuel','maintenance'))
  `);

  // ─── mill_stock: on-hand quantity per item per warehouse ───
  await knex.schema.createTable('mill_stock', (t) => {
    t.increments('id').primary();
    t.integer('item_id').unsigned().notNullable()
      .references('id').inTable('mill_items').onDelete('CASCADE');
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.decimal('quantity_available', 12, 3).notNullable().defaultTo(0);
    t.decimal('quantity_reserved', 12, 3).notNullable().defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['item_id', 'warehouse_id']);
  });
  await knex.raw(`
    ALTER TABLE mill_stock
    ADD CONSTRAINT mill_stock_available_non_neg
    CHECK (quantity_available >= 0)
  `);

  // ─── mill_stock_movements: append-only audit ledger ───
  await knex.schema.createTable('mill_stock_movements', (t) => {
    t.increments('id').primary();
    t.integer('item_id').unsigned().notNullable().references('id').inTable('mill_items');
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.string('movement_type', 20).notNullable();
    t.decimal('quantity', 12, 3).notNullable();         // signed: +in / -out
    t.decimal('cost_per_unit', 15, 4);
    t.decimal('total_cost', 15, 2);
    t.string('reference_type', 30);
    t.integer('reference_id').unsigned();
    t.text('reason');
    t.integer('performed_by').unsigned().references('id').inTable('users');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('mill_stock_movements', (t) => {
    t.index(['item_id', 'created_at']);
    t.index(['reference_type', 'reference_id']);
  });
  await knex.raw(`
    ALTER TABLE mill_stock_movements
    ADD CONSTRAINT mill_stock_movements_type_chk
    CHECK (movement_type IN ('purchase','consumption','adjustment','reservation','return'))
  `);

  // ─── mill_purchases: header ───
  await knex.schema.createTable('mill_purchases', (t) => {
    t.increments('id').primary();
    t.string('purchase_no', 50).unique().notNullable();
    t.integer('supplier_id').unsigned().notNullable().references('id').inTable('suppliers');
    t.string('invoice_number', 100);
    t.date('purchase_date').notNullable();
    t.decimal('total_amount', 15, 2).notNullable().defaultTo(0);
    t.string('currency', 10).defaultTo('PKR');
    t.string('payment_status', 20).defaultTo('Unpaid');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE mill_purchases
    ADD CONSTRAINT mill_purchases_payment_status_chk
    CHECK (payment_status IN ('Unpaid','Partial','Paid'))
  `);

  // ─── mill_purchase_items: lines ───
  await knex.schema.createTable('mill_purchase_items', (t) => {
    t.increments('id').primary();
    t.integer('purchase_id').unsigned().notNullable()
      .references('id').inTable('mill_purchases').onDelete('CASCADE');
    t.integer('item_id').unsigned().notNullable().references('id').inTable('mill_items');
    t.decimal('quantity', 12, 3).notNullable();
    t.decimal('cost_per_unit', 15, 4).notNullable();
    t.decimal('total_cost', 15, 2).notNullable();
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
  });
  await knex.raw(`
    ALTER TABLE mill_purchase_items
    ADD CONSTRAINT mill_purchase_items_qty_pos CHECK (quantity > 0)
  `);

  // ─── mill_consumption_logs: what was used for which batch ───
  await knex.schema.createTable('mill_consumption_logs', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().notNullable()
      .references('id').inTable('milling_batches').onDelete('RESTRICT');
    t.integer('item_id').unsigned().notNullable().references('id').inTable('mill_items');
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.decimal('quantity_used', 12, 3).notNullable();
    t.decimal('cost_per_unit', 15, 4).notNullable();
    t.decimal('total_cost', 15, 2).notNullable();
    t.integer('used_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('mill_consumption_logs', (t) => {
    t.index('batch_id');
  });
  await knex.raw(`
    ALTER TABLE mill_consumption_logs
    ADD CONSTRAINT mill_consumption_logs_qty_pos CHECK (quantity_used > 0)
  `);

  // ─── mill_consumption_ratios: "unit per MT" per item (optionally per product) ───
  await knex.schema.createTable('mill_consumption_ratios', (t) => {
    t.increments('id').primary();
    t.integer('item_id').unsigned().notNullable().references('id').inTable('mill_items');
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.decimal('unit_per_mt', 12, 4).notNullable();
    t.text('notes');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['item_id', 'product_id']);
  });

  // ─── mill_stock_adjustments: approval-gated stock corrections ───
  await knex.schema.createTable('mill_stock_adjustments', (t) => {
    t.increments('id').primary();
    t.integer('item_id').unsigned().notNullable().references('id').inTable('mill_items');
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.string('adjustment_type', 20).notNullable();
    t.decimal('quantity_delta', 12, 3).notNullable();
    t.text('reason').notNullable();
    t.string('status', 20).defaultTo('Pending');
    t.integer('requested_by').unsigned().references('id').inTable('users');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamp('approved_at');
    t.text('rejection_reason');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE mill_stock_adjustments
    ADD CONSTRAINT mill_stock_adjustments_type_chk
    CHECK (adjustment_type IN ('damage','correction','wastage','count'));
    ALTER TABLE mill_stock_adjustments
    ADD CONSTRAINT mill_stock_adjustments_status_chk
    CHECK (status IN ('Pending','Approved','Rejected'));
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mill_stock_adjustments');
  await knex.schema.dropTableIfExists('mill_consumption_ratios');
  await knex.schema.dropTableIfExists('mill_consumption_logs');
  await knex.schema.dropTableIfExists('mill_purchase_items');
  await knex.schema.dropTableIfExists('mill_purchases');
  await knex.schema.dropTableIfExists('mill_stock_movements');
  await knex.schema.dropTableIfExists('mill_stock');
  await knex.schema.dropTableIfExists('mill_items');
};
