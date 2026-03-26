/**
 * Migration: Control Systems & Operational Intelligence (Phase 11)
 * Tables: approval_queue, margin_analysis, supplier_scores, customer_scores,
 *         mill_performance, stock_counts, stock_count_items, pricing_simulations
 */

exports.up = async function (knex) {
  // 1. Approval Queue (Maker-Checker)
  await knex.schema.createTable('approval_queue', (t) => {
    t.increments('id').primary();
    t.string('approval_type', 50).notNullable(); // payment_confirmation, stock_adjustment, internal_transfer, manual_journal, cost_edit, order_close, quality_override, price_change
    t.string('entity_type', 50).notNullable(); // export_order, milling_batch, inventory_lot, journal_entry, internal_transfer, receivable, payable
    t.integer('entity_id').notNullable();
    t.string('entity_ref', 50); // e.g. 'EX-101', 'M-201'
    t.integer('requested_by').unsigned().references('id').inTable('users').notNullable();
    t.timestamp('requested_at').defaultTo(knex.fn.now());
    t.jsonb('current_data'); // snapshot before change
    t.jsonb('proposed_data'); // what maker wants to change
    t.decimal('amount', 15, 2); // financial amount involved
    t.string('currency', 10);
    t.string('status', 20).defaultTo('Pending'); // Pending, Approved, Rejected, Cancelled, Expired
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamp('approved_at');
    t.text('rejection_reason');
    t.text('notes');
    t.string('priority', 20).defaultTo('Normal'); // Low, Normal, High, Urgent
    t.timestamp('expires_at'); // auto-expire after X days
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. Margin Analysis
  await knex.schema.createTable('margin_analysis', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('id').inTable('export_orders');
    t.date('analysis_date').defaultTo(knex.raw('CURRENT_DATE'));
    t.decimal('estimated_revenue', 15, 2);
    t.decimal('actual_revenue', 15, 2);
    t.jsonb('estimated_costs'); // {rice: X, bags: Y, freight: Z, ...}
    t.jsonb('actual_costs');
    t.decimal('estimated_margin_pct', 5, 2);
    t.decimal('actual_margin_pct', 5, 2);
    t.decimal('variance_amount', 15, 2);
    t.decimal('variance_pct', 5, 2);
    t.decimal('fx_rate_booked', 10, 4);
    t.decimal('fx_rate_actual', 10, 4);
    t.decimal('fx_gain_loss', 15, 2);
    t.jsonb('risk_flags'); // array of flags
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. Supplier Scores
  await knex.schema.createTable('supplier_scores', (t) => {
    t.increments('id').primary();
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.decimal('quality_score', 5, 2); // 0-100
    t.decimal('delivery_score', 5, 2);
    t.decimal('price_score', 5, 2);
    t.decimal('overall_score', 5, 2);
    t.decimal('total_qty_mt', 12, 2);
    t.decimal('total_value', 15, 2);
    t.decimal('avg_moisture_variance', 5, 2);
    t.decimal('avg_broken_variance', 5, 2);
    t.decimal('rejection_pct', 5, 2);
    t.decimal('avg_delivery_days', 5, 1);
    t.integer('batches_count');
    t.integer('grn_count');
    t.text('notes');
    t.timestamp('calculated_at').defaultTo(knex.fn.now());
  });

  // 4. Customer Scores
  await knex.schema.createTable('customer_scores', (t) => {
    t.increments('id').primary();
    t.integer('customer_id').unsigned().references('id').inTable('customers').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.decimal('payment_score', 5, 2); // 0-100 based on on-time payments
    t.decimal('profitability_score', 5, 2);
    t.decimal('volume_score', 5, 2);
    t.decimal('overall_score', 5, 2);
    t.integer('total_orders');
    t.decimal('total_revenue', 15, 2);
    t.decimal('total_profit', 15, 2);
    t.decimal('avg_margin_pct', 5, 2);
    t.decimal('avg_advance_days', 5, 1); // avg days to pay advance
    t.decimal('avg_balance_days', 5, 1);
    t.integer('overdue_count');
    t.string('risk_level', 20).defaultTo('Low'); // Low, Medium, High, Critical
    t.timestamp('calculated_at').defaultTo(knex.fn.now());
  });

  // 5. Mill Performance
  await knex.schema.createTable('mill_performance', (t) => {
    t.increments('id').primary();
    t.integer('mill_id').unsigned().references('id').inTable('mills');
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.integer('batches_processed');
    t.decimal('total_input_mt', 12, 2);
    t.decimal('total_output_mt', 12, 2);
    t.decimal('avg_yield_pct', 5, 2);
    t.decimal('avg_broken_pct', 5, 2);
    t.decimal('avg_bran_pct', 5, 2);
    t.decimal('avg_cost_per_mt', 15, 2);
    t.decimal('total_downtime_hours', 8, 2);
    t.decimal('utilization_pct', 5, 2);
    t.decimal('total_electricity_cost', 15, 2);
    t.decimal('total_labor_cost', 15, 2);
    t.string('currency', 10).defaultTo('PKR');
    t.timestamp('calculated_at').defaultTo(knex.fn.now());
  });

  // 6. Stock Counts
  await knex.schema.createTable('stock_counts', (t) => {
    t.increments('id').primary();
    t.string('count_no', 20).unique(); // SC-001
    t.string('count_type', 20).notNullable(); // full, cycle, spot
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.string('status', 20).defaultTo('Planned'); // Planned, In Progress, Completed, Cancelled
    t.date('planned_date');
    t.timestamp('started_at');
    t.timestamp('completed_at');
    t.integer('counted_by').unsigned().references('id').inTable('users');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 7. Stock Count Items
  await knex.schema.createTable('stock_count_items', (t) => {
    t.increments('id').primary();
    t.integer('stock_count_id').unsigned().references('id').inTable('stock_counts').onDelete('CASCADE');
    t.integer('lot_id').unsigned().references('id').inTable('inventory_lots');
    t.string('item_name', 255);
    t.decimal('system_qty', 15, 2); // what DB says
    t.decimal('counted_qty', 15, 2); // what was physically counted
    t.decimal('variance_qty', 15, 2); // counted - system
    t.decimal('variance_pct', 5, 2);
    t.decimal('variance_value', 15, 2);
    t.string('status', 20).defaultTo('Pending'); // Pending, Counted, Approved, Adjusted
    t.text('notes');
    t.timestamp('counted_at');
  });

  // 8. Pricing Simulations
  await knex.schema.createTable('pricing_simulations', (t) => {
    t.increments('id').primary();
    t.string('name', 255);
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.decimal('qty_mt', 12, 2);
    t.decimal('target_margin_pct', 5, 2);
    t.decimal('raw_rice_cost_per_mt', 15, 2);
    t.decimal('milling_cost_per_mt', 15, 2);
    t.decimal('bags_cost_per_mt', 15, 2);
    t.decimal('freight_cost_per_mt', 15, 2);
    t.decimal('clearing_cost_per_mt', 15, 2);
    t.decimal('other_costs_per_mt', 15, 2);
    t.decimal('total_cost_per_mt', 15, 2);
    t.decimal('minimum_selling_price', 15, 2);
    t.decimal('recommended_price', 15, 2);
    t.decimal('fx_rate', 10, 4);
    t.string('currency', 10).defaultTo('USD');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('pricing_simulations');
  await knex.schema.dropTableIfExists('stock_count_items');
  await knex.schema.dropTableIfExists('stock_counts');
  await knex.schema.dropTableIfExists('mill_performance');
  await knex.schema.dropTableIfExists('customer_scores');
  await knex.schema.dropTableIfExists('supplier_scores');
  await knex.schema.dropTableIfExists('margin_analysis');
  await knex.schema.dropTableIfExists('approval_queue');
};
