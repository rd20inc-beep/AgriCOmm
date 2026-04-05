/**
 * Phase 1: Centralize movement taxonomy and ledger enforcement
 * Phase 2: Add cost_incomplete flag for zero-cost detection
 *
 * Adds missing columns to lot_transactions for full traceability.
 * Adds cost_incomplete flag to inventory_lots.
 * Creates lot_source_mapping for parent-child lineage.
 * Creates stock_adjustments for controlled adjustment workflow.
 * Creates milling_output_market_prices for allocation snapshot.
 */
exports.up = function (knex) {
  return knex.schema
    // Enhance lot_transactions with cost and entity columns
    .alterTable('lot_transactions', (table) => {
      table.decimal('unit_cost', 15, 4).nullable();
      table.decimal('total_cost', 15, 2).nullable();
      table.string('entity_from', 50).nullable();
      table.string('entity_to', 50).nullable();
      table.integer('performed_by').unsigned().nullable().references('id').inTable('users');
      table.timestamp('performed_at').nullable().defaultTo(knex.fn.now());
      table.decimal('reservation_effect', 15, 3).nullable();
    })

    // Add cost_incomplete flag to inventory_lots
    .alterTable('inventory_lots', (table) => {
      table.boolean('cost_incomplete').defaultTo(false);
    })

    // Lot source mapping — parent/child lineage
    .createTable('lot_source_mapping', (table) => {
      table.increments('id').primary();
      table.integer('parent_lot_id').unsigned().nullable().references('id').inTable('inventory_lots');
      table.integer('child_lot_id').unsigned().nullable().references('id').inTable('inventory_lots');
      table.integer('source_batch_id').unsigned().nullable().references('id').inTable('milling_batches');
      table.integer('source_transaction_id').unsigned().nullable();
      table.decimal('quantity_kg', 15, 3).notNullable();
      table.decimal('cost_share_amount', 15, 2).nullable();
      table.string('mapping_type', 50).notNullable();
      // mapping_type: milling_input_to_output, transfer_split, export_allocation,
      //               dispatch_consumption, manual_split, adjustment_origin
      table.timestamps(true, true);
    })

    // Stock adjustments with approval workflow
    .createTable('stock_adjustments', (table) => {
      table.increments('id').primary();
      table.integer('lot_id').unsigned().notNullable().references('id').inTable('inventory_lots');
      table.string('adjustment_type', 50).notNullable();
      // adjustment_type: excess_found, shortage_found, damaged, spoiled,
      //                  moisture_loss, bag_loss, manual_correction
      table.decimal('quantity_kg', 15, 3).notNullable();
      table.text('reason').nullable();
      table.decimal('unit_cost', 15, 4).nullable();
      table.decimal('total_cost_impact', 15, 2).nullable();
      table.string('approval_status', 20).defaultTo('draft');
      // approval_status: draft, pending_approval, approved, rejected
      table.integer('requested_by').unsigned().nullable().references('id').inTable('users');
      table.integer('approved_by').unsigned().nullable().references('id').inTable('users');
      table.timestamp('approved_at').nullable();
      table.string('reference_note', 255).nullable();
      table.timestamps(true, true);
    })

    // Milling output market prices snapshot
    .createTable('milling_output_market_prices', (table) => {
      table.increments('id').primary();
      table.integer('batch_id').unsigned().notNullable().references('id').inTable('milling_batches');
      table.decimal('finished_price_per_mt', 15, 2).notNullable();
      table.decimal('broken_price_per_mt', 15, 2).nullable();
      table.decimal('bran_price_per_mt', 15, 2).nullable();
      table.decimal('husk_price_per_mt', 15, 2).nullable();
      table.decimal('other_output_price_per_mt', 15, 2).nullable();
      table.integer('confirmed_by').unsigned().nullable().references('id').inTable('users');
      table.timestamp('confirmed_at').defaultTo(knex.fn.now());
      table.text('notes').nullable();
    })

    // Inventory valuation snapshots
    .createTable('inventory_valuation_snapshots', (table) => {
      table.increments('id').primary();
      table.date('snapshot_date').notNullable();
      table.string('entity', 20).nullable();
      table.string('lot_type', 20).nullable();
      table.decimal('total_qty_kg', 15, 3).nullable();
      table.decimal('total_value', 15, 2).nullable();
      table.decimal('avg_value_per_kg', 15, 4).nullable();
      table.timestamp('generated_at').defaultTo(knex.fn.now());
    })

    // Historical cost repair log
    .createTable('historical_cost_repair_log', (table) => {
      table.increments('id').primary();
      table.integer('lot_id').unsigned().nullable();
      table.integer('batch_id').unsigned().nullable();
      table.integer('order_id').unsigned().nullable();
      table.string('issue_type', 100).notNullable();
      table.json('old_value_json').nullable();
      table.json('new_value_json').nullable();
      table.integer('repaired_by').unsigned().nullable().references('id').inTable('users');
      table.timestamp('repaired_at').defaultTo(knex.fn.now());
      table.text('notes').nullable();
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('historical_cost_repair_log')
    .dropTableIfExists('inventory_valuation_snapshots')
    .dropTableIfExists('milling_output_market_prices')
    .dropTableIfExists('stock_adjustments')
    .dropTableIfExists('lot_source_mapping')
    .alterTable('lot_transactions', (table) => {
      ['unit_cost', 'total_cost', 'entity_from', 'entity_to', 'performed_by', 'performed_at', 'reservation_effect'].forEach(c => table.dropColumn(c));
    })
    .alterTable('inventory_lots', (table) => {
      table.dropColumn('cost_incomplete');
    });
};
