/**
 * Migration: Lot-based inventory with Pakistani rice trading units
 *
 * Enhances inventory_lots with full lot tracking fields:
 * - Quality specs, bag details, supplier linkage
 * - KG-based storage with katta/maund/ton display support
 * - Landed costing per lot
 * - Stock tracking: available, reserved, sold, damaged
 *
 * Creates lot_transactions ledger for full traceability.
 */

exports.up = function (knex) {
  return knex.schema

    // ─── Enhance inventory_lots ───
    .alterTable('inventory_lots', (table) => {
      // Supplier & purchase linkage
      table.integer('supplier_id').unsigned().nullable().references('id').inTable('suppliers').onDelete('SET NULL');
      table.integer('broker_id').unsigned().nullable();
      table.integer('purchase_invoice_id').unsigned().nullable();
      table.date('purchase_date').nullable();
      table.string('crop_year', 10).nullable();     // e.g. "2025-26"

      // Rice quality specs
      table.string('variety', 100).nullable();       // e.g. "1121 Basmati", "Super Kernel"
      table.string('grade', 50).nullable();          // e.g. "A", "B", "C", "Sella"
      table.decimal('moisture_pct', 5, 2).nullable();
      table.decimal('broken_pct', 5, 2).nullable();
      table.string('sortex_status', 30).nullable();  // "Done", "Pending", "N/A"
      table.decimal('whiteness', 5, 2).nullable();
      table.text('quality_notes').nullable();

      // Bag details
      table.string('bag_type', 100).nullable();
      table.string('bag_quality', 100).nullable();
      table.decimal('bag_size_kg', 8, 2).nullable(); // actual weight per bag
      table.decimal('bag_weight_gm', 8, 2).nullable(); // empty bag weight
      table.string('bag_color', 50).nullable();
      table.decimal('bag_cost_per_bag', 10, 2).nullable().defaultTo(0);
      table.boolean('bag_cost_included').defaultTo(false); // whether bag cost is in purchase price

      // Unit tracking — all stored in KG, display in business units
      table.string('standard_unit_type', 20).defaultTo('katta'); // katta, maund, bag
      table.decimal('bag_weight_kg', 10, 3).defaultTo(50); // katta/bag = 50kg default
      table.integer('total_bags').nullable();
      table.decimal('gross_weight_kg', 15, 3).defaultTo(0);
      table.decimal('net_weight_kg', 15, 3).defaultTo(0);

      // Purchase pricing — stored per KG, input unit preserved
      table.string('rate_input_unit', 20).nullable(); // unit user entered rate in
      table.decimal('rate_input_value', 15, 4).nullable(); // original rate in input unit
      table.decimal('rate_per_kg', 15, 4).defaultTo(0);
      table.decimal('purchase_amount', 15, 2).defaultTo(0);

      // Additional costs for landed costing
      table.decimal('transport_cost', 15, 2).defaultTo(0);
      table.decimal('labor_cost', 15, 2).defaultTo(0);
      table.decimal('unloading_cost', 15, 2).defaultTo(0);
      table.decimal('packing_cost', 15, 2).defaultTo(0);
      table.decimal('other_cost', 15, 2).defaultTo(0);
      table.decimal('total_bag_cost', 15, 2).defaultTo(0);
      table.decimal('landed_cost_total', 15, 2).defaultTo(0);
      table.decimal('landed_cost_per_kg', 15, 4).defaultTo(0);

      // Stock tracking — all in KG
      table.decimal('sold_weight_kg', 15, 3).defaultTo(0);
      table.decimal('damaged_weight_kg', 15, 3).defaultTo(0);

      // Payment tracking
      table.string('payment_status', 30).nullable(); // Paid, Partial, Unpaid
      table.decimal('paid_amount', 15, 2).defaultTo(0);
      table.decimal('due_amount', 15, 2).defaultTo(0);

      // Notes
      table.text('notes').nullable();
    })

    // ─── Lot Transactions Ledger ───
    .createTable('lot_transactions', (table) => {
      table.increments('id').primary();
      table.string('transaction_no', 50).unique();
      table.date('transaction_date').notNullable().defaultTo(knex.fn.now());
      table.integer('lot_id').unsigned().notNullable().references('id').inTable('inventory_lots').onDelete('CASCADE');
      table.string('transaction_type', 40).notNullable();
      // Types: purchase_in, warehouse_transfer, milling_issue, milling_receipt,
      //        export_allocation, sales_allocation, dispatch_out, stock_adjustment,
      //        wastage, damage, shortage, lot_split, lot_merge, return_in

      // Reference linkage
      table.string('reference_module', 50).nullable(); // export_order, milling_batch, purchase, sale, manual
      table.integer('reference_id').unsigned().nullable();
      table.string('reference_no', 50).nullable();

      // Warehouse movement
      table.integer('warehouse_from_id').unsigned().nullable().references('id').inTable('warehouses');
      table.integer('warehouse_to_id').unsigned().nullable().references('id').inTable('warehouses');

      // Quantity — input unit preserved, KG authoritative
      table.string('input_unit', 20).nullable(); // what unit user entered
      table.decimal('input_qty', 15, 3).nullable(); // original entered qty
      table.decimal('quantity_kg', 15, 3).notNullable(); // authoritative KG value
      table.integer('quantity_bags').nullable();

      // Rate / cost impact
      table.string('rate_input_unit', 20).nullable();
      table.decimal('rate_input_value', 15, 4).nullable();
      table.decimal('rate_per_kg', 15, 4).nullable();
      table.decimal('cost_impact', 15, 2).nullable(); // total cost of this movement
      table.string('currency', 10).defaultTo('PKR');

      // Balance after this transaction
      table.decimal('balance_kg', 15, 3).nullable();
      table.integer('balance_bags').nullable();

      // Audit
      table.text('remarks').nullable();
      table.integer('created_by').unsigned().nullable().references('id').inTable('users');
      table.timestamps(true, true);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('lot_transactions')
    .alterTable('inventory_lots', (table) => {
      const cols = [
        'supplier_id', 'broker_id', 'purchase_invoice_id', 'purchase_date', 'crop_year',
        'variety', 'grade', 'moisture_pct', 'broken_pct', 'sortex_status', 'whiteness', 'quality_notes',
        'bag_type', 'bag_quality', 'bag_size_kg', 'bag_weight_gm', 'bag_color',
        'bag_cost_per_bag', 'bag_cost_included',
        'standard_unit_type', 'bag_weight_kg', 'total_bags', 'gross_weight_kg', 'net_weight_kg',
        'rate_input_unit', 'rate_input_value', 'rate_per_kg', 'purchase_amount',
        'transport_cost', 'labor_cost', 'unloading_cost', 'packing_cost', 'other_cost',
        'total_bag_cost', 'landed_cost_total', 'landed_cost_per_kg',
        'sold_weight_kg', 'damaged_weight_kg',
        'payment_status', 'paid_amount', 'due_amount',
      ];
      cols.forEach(c => table.dropColumn(c));
    });
};
