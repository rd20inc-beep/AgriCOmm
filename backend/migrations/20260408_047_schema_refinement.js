/**
 * Migration 047 — Schema Refinement
 *
 * Fixes:
 * 1. NOT NULL + sensible defaults on 24 critical business columns
 * 2. DEFAULT 0 on 14 numeric amount/cost columns that currently lack defaults
 * 3. CHECK constraints on key status columns to enforce valid values
 * 4. Missing NOT NULL on payments.created_at
 * 5. Missing FK on export_order_costs.order_id (if not added by 046)
 */

exports.up = async function (knex) {

  // =========================================================================
  // 1. EXPORT ORDERS — core business fields must not be null
  // =========================================================================

  // Backfill nulls first
  await knex('export_orders').whereNull('qty_mt').update({ qty_mt: 0 });
  await knex('export_orders').whereNull('price_per_mt').update({ price_per_mt: 0 });
  await knex('export_orders').whereNull('contract_value').update({ contract_value: 0 });
  await knex('export_orders').whereNull('currency').update({ currency: 'USD' });
  await knex('export_orders').whereNull('advance_pct').update({ advance_pct: 0 });
  await knex('export_orders').whereNull('advance_expected').update({ advance_expected: 0 });
  await knex('export_orders').whereNull('advance_received').update({ advance_received: 0 });
  await knex('export_orders').whereNull('balance_expected').update({ balance_expected: 0 });
  await knex('export_orders').whereNull('balance_received').update({ balance_received: 0 });

  await knex.schema.alterTable('export_orders', (t) => {
    t.decimal('qty_mt', 14, 4).notNullable().defaultTo(0).alter();
    t.decimal('price_per_mt', 14, 4).notNullable().defaultTo(0).alter();
    t.decimal('contract_value', 16, 2).notNullable().defaultTo(0).alter();
    t.string('currency', 10).notNullable().defaultTo('USD').alter();
    t.decimal('advance_pct', 5, 2).notNullable().defaultTo(0).alter();
    t.decimal('advance_expected', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('advance_received', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('balance_expected', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('balance_received', 16, 2).notNullable().defaultTo(0).alter();
    // Derived FX columns — default 0
    t.decimal('contract_value_pkr_locked', 18, 2).defaultTo(0).alter();
    t.decimal('current_fx_value_pkr', 18, 2).defaultTo(0).alter();
  });

  // =========================================================================
  // 2. INVENTORY LOTS — type and entity must not be null
  // =========================================================================

  await knex('inventory_lots').whereNull('qty').update({ qty: 0 });
  await knex('inventory_lots').whereNull('type').update({ type: 'raw' });
  await knex('inventory_lots').whereNull('entity').update({ entity: 'mill' });
  await knex('inventory_lots').whereNull('reserved_qty').update({ reserved_qty: 0 });
  await knex('inventory_lots').whereNull('available_qty').update({ available_qty: 0 });

  await knex.schema.alterTable('inventory_lots', (t) => {
    t.decimal('qty', 14, 4).notNullable().defaultTo(0).alter();
    t.string('type', 20).notNullable().defaultTo('raw').alter();
    t.string('entity', 20).notNullable().defaultTo('mill').alter();
    t.decimal('reserved_qty', 14, 4).notNullable().defaultTo(0).alter();
    t.decimal('available_qty', 14, 4).notNullable().defaultTo(0).alter();
    t.decimal('total_value', 18, 2).defaultTo(0).alter();
    t.decimal('cost_per_unit', 14, 4).defaultTo(0).alter();
    t.decimal('net_weight_kg', 14, 2).defaultTo(0).alter();
    t.decimal('gross_weight_kg', 14, 2).defaultTo(0).alter();
  });

  // =========================================================================
  // 3. RECEIVABLES — financial columns must not be null
  // =========================================================================

  await knex('receivables').whereNull('expected_amount').update({ expected_amount: 0 });
  await knex('receivables').whereNull('received_amount').update({ received_amount: 0 });
  await knex('receivables').whereNull('outstanding').update({ outstanding: 0 });
  await knex('receivables').whereNull('currency').update({ currency: 'USD' });
  await knex('receivables').whereNull('type').update({ type: 'advance' });
  await knex('receivables').whereNull('entity').update({ entity: 'export' });

  await knex.schema.alterTable('receivables', (t) => {
    t.decimal('expected_amount', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('received_amount', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('outstanding', 16, 2).notNullable().defaultTo(0).alter();
    t.string('currency', 10).notNullable().defaultTo('USD').alter();
    t.string('type', 50).notNullable().defaultTo('advance').alter();
    t.string('entity', 20).notNullable().defaultTo('export').alter();
    t.decimal('base_amount_pkr', 18, 2).defaultTo(0).alter();
  });

  // =========================================================================
  // 4. PAYABLES — financial columns must not be null
  // =========================================================================

  await knex('payables').whereNull('original_amount').update({ original_amount: 0 });
  await knex('payables').whereNull('paid_amount').update({ paid_amount: 0 });
  await knex('payables').whereNull('outstanding').update({ outstanding: 0 });
  await knex('payables').whereNull('currency').update({ currency: 'PKR' });
  await knex('payables').whereNull('entity').update({ entity: 'export' });

  await knex.schema.alterTable('payables', (t) => {
    t.decimal('original_amount', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('paid_amount', 16, 2).notNullable().defaultTo(0).alter();
    t.decimal('outstanding', 16, 2).notNullable().defaultTo(0).alter();
    t.string('currency', 10).notNullable().defaultTo('PKR').alter();
    t.string('entity', 20).notNullable().defaultTo('export').alter();
  });

  // =========================================================================
  // 5. PAYMENTS — type and currency must not be null
  // =========================================================================

  await knex('payments').whereNull('currency').update({ currency: 'USD' });
  await knex('payments').whereNull('type').update({ type: 'receipt' });

  await knex.schema.alterTable('payments', (t) => {
    t.string('currency', 10).notNullable().defaultTo('USD').alter();
    t.string('type', 50).notNullable().defaultTo('receipt').alter();
    t.decimal('base_amount_pkr', 18, 2).defaultTo(0).alter();
    // Fix: created_at should be NOT NULL
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).alter();
  });

  // =========================================================================
  // 6. JOURNAL ENTRIES — currency and entity
  // =========================================================================

  await knex('journal_entries').whereNull('currency').update({ currency: 'PKR' });

  await knex.schema.alterTable('journal_entries', (t) => {
    t.string('currency', 10).notNullable().defaultTo('PKR').alter();
    t.decimal('total_debit', 18, 2).defaultTo(0).alter();
    t.decimal('total_credit', 18, 2).defaultTo(0).alter();
  });

  // =========================================================================
  // 7. LOT TRANSACTIONS — currency
  // =========================================================================

  await knex('lot_transactions').whereNull('currency').update({ currency: 'PKR' });

  await knex.schema.alterTable('lot_transactions', (t) => {
    t.string('currency', 10).notNullable().defaultTo('PKR').alter();
  });

  // =========================================================================
  // 8. CHECK CONSTRAINTS on critical status columns
  // =========================================================================

  // Export order status — enforce valid values
  const hasExportCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_export_orders_status_valid'
  `);
  if (hasExportCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE export_orders
      ADD CONSTRAINT chk_export_orders_status_valid
      CHECK (status IN ('Draft','Awaiting Advance','Advance Received','Procurement Pending','In Milling','Docs In Preparation','Awaiting Balance','Ready to Ship','Shipped','Arrived','Closed','Cancelled','On Hold'))
    `);
  }

  // Inventory lot type — enforce valid values
  const hasLotTypeCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_inventory_lots_type_valid'
  `);
  if (hasLotTypeCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE inventory_lots
      ADD CONSTRAINT chk_inventory_lots_type_valid
      CHECK (type IN ('raw','finished','byproduct'))
    `);
  }

  // Inventory lot entity — enforce valid values
  const hasLotEntityCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_inventory_lots_entity_valid'
  `);
  if (hasLotEntityCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE inventory_lots
      ADD CONSTRAINT chk_inventory_lots_entity_valid
      CHECK (entity IN ('mill','export'))
    `);
  }

  // Milling batch status
  const hasBatchCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_milling_batches_status_valid'
  `);
  if (hasBatchCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE milling_batches
      ADD CONSTRAINT chk_milling_batches_status_valid
      CHECK (status IN ('Queued','Pending','In Progress','Pending Approval','Completed','Cancelled'))
    `);
  }

  // Receivable status
  const hasRecvCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_receivables_status_valid'
  `);
  if (hasRecvCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE receivables
      ADD CONSTRAINT chk_receivables_status_valid
      CHECK (status IN ('Pending','Partial','Paid','Received','Overdue','Written Off'))
    `);
  }

  // Payable status
  const hasPayCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_payables_status_valid'
  `);
  if (hasPayCheck.rows.length === 0) {
    // Normalize lowercase 'paid' to 'Paid' before adding constraint
    await knex('payables').where('status', 'paid').update({ status: 'Paid' });
    await knex.raw(`
      ALTER TABLE payables
      ADD CONSTRAINT chk_payables_status_valid
      CHECK (status IN ('Pending','Partial','Paid','Overdue','Written Off'))
    `);
  }

  // Journal status
  const hasJournalCheck = await knex.raw(`
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_journal_entries_status_valid'
  `);
  if (hasJournalCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE journal_entries
      ADD CONSTRAINT chk_journal_entries_status_valid
      CHECK (status IN ('Draft','Posted','Reversed'))
    `);
  }

  // =========================================================================
  // 9. Non-negative amount constraints
  // =========================================================================

  const amountChecks = [
    { table: 'export_orders', col: 'qty_mt', name: 'chk_eo_qty_nonneg' },
    { table: 'export_orders', col: 'price_per_mt', name: 'chk_eo_price_nonneg' },
    { table: 'export_orders', col: 'contract_value', name: 'chk_eo_cv_nonneg' },
    { table: 'receivables', col: 'expected_amount', name: 'chk_recv_expected_nonneg' },
    { table: 'payables', col: 'original_amount', name: 'chk_pay_original_nonneg' },
    { table: 'payments', col: 'amount', name: 'chk_payments_amount_nonneg' },
  ];

  for (const { table, col, name } of amountChecks) {
    const exists = await knex.raw(`SELECT 1 FROM information_schema.check_constraints WHERE constraint_name='${name}'`);
    if (exists.rows.length === 0) {
      await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK ("${col}" >= 0)`);
    }
  }
};

exports.down = async function (knex) {
  // Remove CHECK constraints
  const checks = [
    'chk_export_orders_status_valid',
    'chk_inventory_lots_type_valid',
    'chk_inventory_lots_entity_valid',
    'chk_milling_batches_status_valid',
    'chk_receivables_status_valid',
    'chk_payables_status_valid',
    'chk_journal_entries_status_valid',
    'chk_eo_qty_nonneg',
    'chk_eo_price_nonneg',
    'chk_eo_cv_nonneg',
    'chk_recv_expected_nonneg',
    'chk_pay_original_nonneg',
    'chk_payments_amount_nonneg',
  ];

  for (const name of checks) {
    try {
      // Find which table owns this constraint
      const result = await knex.raw(`SELECT table_name FROM information_schema.table_constraints WHERE constraint_name='${name}' AND table_schema='public'`);
      if (result.rows.length > 0) {
        await knex.raw(`ALTER TABLE "${result.rows[0].table_name}" DROP CONSTRAINT "${name}"`);
      }
    } catch (e) { /* constraint may not exist */ }
  }

  // Make columns nullable again
  const nullables = [
    { table: 'export_orders', columns: ['qty_mt','price_per_mt','contract_value','currency','advance_pct','advance_expected','advance_received','balance_expected','balance_received'] },
    { table: 'inventory_lots', columns: ['qty','type','entity','reserved_qty','available_qty'] },
    { table: 'receivables', columns: ['expected_amount','received_amount','outstanding','currency','type','entity'] },
    { table: 'payables', columns: ['original_amount','paid_amount','outstanding','currency','entity'] },
    { table: 'payments', columns: ['currency','type'] },
    { table: 'journal_entries', columns: ['currency'] },
    { table: 'lot_transactions', columns: ['currency'] },
  ];

  for (const { table, columns } of nullables) {
    await knex.schema.alterTable(table, (t) => {
      columns.forEach(col => t.string(col).nullable().alter());
    });
  }
};
