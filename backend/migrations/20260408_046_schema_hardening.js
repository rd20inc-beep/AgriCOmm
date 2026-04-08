/**
 * Migration 046 — Schema Hardening
 *
 * Fixes:
 * 1. NOT NULL constraints on all status columns (41 tables) with defaults
 * 2. NOT NULL constraints on critical identifier columns (lot_no, journal_no, etc.)
 * 3. Missing created_at / updated_at timestamps on 16 tables
 * 4. Missing FK constraints on key _id columns
 * 5. Missing indexes on frequently queried columns
 */

exports.up = async function (knex) {
  // =========================================================================
  // 1. SET NOT NULL ON STATUS COLUMNS
  //    All have defaults already set — we just need to backfill NULLs then
  //    add the NOT NULL constraint.
  // =========================================================================

  const statusTables = [
    { table: 'accounting_periods', default: 'Open' },
    { table: 'advance_payments', default: 'Unallocated' },
    { table: 'alerts', default: 'Open' },
    { table: 'api_sync_log', default: 'pending' },
    { table: 'approval_queue', default: 'Pending' },
    { table: 'background_jobs', default: 'Pending' },
    { table: 'bank_reconciliation', default: 'Draft' },
    { table: 'bank_transactions', default: 'posted' },
    { table: 'cost_allocations', default: 'Unallocated' },
    { table: 'data_imports', default: 'Pending' },
    { table: 'document_dispatch_log', default: 'Sent' },
    { table: 'document_store', default: 'Draft' },
    { table: 'email_logs', default: 'Sent' },
    { table: 'exception_inbox', default: 'Open' },
    { table: 'export_order_documents', default: 'Pending' },
    { table: 'export_orders', default: 'Draft' },
    { table: 'follow_ups', default: 'Pending' },
    { table: 'goods_receipt_notes', default: 'Draft' },
    { table: 'internal_transfers', default: 'Pending' },
    { table: 'inventory_lots', default: 'Available' },
    { table: 'inventory_reservations', default: 'Active' },
    { table: 'journal_entries', default: 'Draft' },
    { table: 'local_sales', default: 'Completed' },
    { table: 'mill_attendance', default: 'present' },
    { table: 'milling_batches', default: 'Queued' },
    { table: 'mills', default: 'Active' },
    { table: 'payables', default: 'Pending' },
    { table: 'predictive_alerts', default: 'Active' },
    { table: 'production_plans', default: 'Planned' },
    { table: 'purchase_orders', default: 'Draft' },
    { table: 'purchase_requisitions', default: 'Draft' },
    { table: 'purchase_returns', default: 'Pending' },
    { table: 'receivables', default: 'Pending' },
    { table: 'reprocessing_batches', default: 'Pending' },
    { table: 'stock_count_items', default: 'Pending' },
    { table: 'stock_counts', default: 'Planned' },
    { table: 'supplier_invoices', default: 'Pending' },
    { table: 'system_health', default: 'ok' },
    { table: 'task_execution_log', default: 'completed' },
    { table: 'tasks_assignments', default: 'Open' },
    { table: 'whatsapp_logs', default: 'Pending' },
  ];

  for (const { table, default: defaultVal } of statusTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    // Backfill any NULL status values
    await knex(table).whereNull('status').update({ status: defaultVal });

    // Add NOT NULL constraint
    await knex.schema.alterTable(table, (t) => {
      t.string('status').notNullable().defaultTo(defaultVal).alter();
    });
  }

  // =========================================================================
  // 2. SET NOT NULL ON CRITICAL IDENTIFIER COLUMNS
  // =========================================================================

  const identifierFixes = [
    { table: 'inventory_lots', column: 'lot_no' },
    { table: 'journal_entries', column: 'journal_no' },
    { table: 'lot_transactions', column: 'transaction_no' },
    { table: 'payments', column: 'payment_no' },
    { table: 'bank_transactions', column: 'transaction_no' },
  ];

  for (const { table, column } of identifierFixes) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    const hasCol = await knex.schema.hasColumn(table, column);
    if (!hasCol) continue;

    // Backfill NULLs with generated values
    const nullRows = await knex(table).whereNull(column).select('id');
    for (let i = 0; i < nullRows.length; i++) {
      const prefix = column.replace('_no', '').toUpperCase();
      const val = `${prefix}-BACKFILL-${String(i + 1).padStart(4, '0')}`;
      await knex(table).where('id', nullRows[i].id).update({ [column]: val });
    }

    // Add NOT NULL constraint
    await knex.schema.alterTable(table, (t) => {
      t.string(column).notNullable().alter();
    });
  }

  // local_sales.lot_no is optional (not all sales are lot-based) — skip it

  // =========================================================================
  // 3. ADD MISSING created_at / updated_at TIMESTAMPS
  // =========================================================================

  const timestampTables = [
    'api_sync_log',
    'bank_reconciliation_items',
    'cost_allocation_lines',
    'customer_scores',
    'fx_gain_loss_ledger',
    'historical_cost_repair_log',
    'inventory_valuation_snapshots',
    'journal_lines',
    'mill_performance',
    'milling_output_market_prices',
    'risk_scores',
    'stock_count_items',
    'supplier_scores',
    'system_health',
    'system_settings',
    'task_execution_log',
  ];

  for (const table of timestampTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    const hasCreatedAt = await knex.schema.hasColumn(table, 'created_at');
    const hasUpdatedAt = await knex.schema.hasColumn(table, 'updated_at');

    if (!hasCreatedAt || !hasUpdatedAt) {
      await knex.schema.alterTable(table, (t) => {
        if (!hasCreatedAt) t.timestamp('created_at').defaultTo(knex.fn.now());
        if (!hasUpdatedAt) t.timestamp('updated_at').defaultTo(knex.fn.now());
      });
    }
  }

  // =========================================================================
  // 4. ADD MISSING FOREIGN KEY CONSTRAINTS
  //    Only on columns that have clear parent tables and are NOT polymorphic.
  // =========================================================================

  // export_order_costs.order_id -> export_orders.id
  if (await knex.schema.hasTable('export_order_costs')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'export_order_costs' AND kcu.column_name = 'order_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('export_order_costs', (t) => {
        t.foreign('order_id').references('id').inTable('export_orders').onDelete('CASCADE');
      });
    }
  }

  // export_order_documents.order_id -> export_orders.id
  if (await knex.schema.hasTable('export_order_documents')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'export_order_documents' AND kcu.column_name = 'order_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('export_order_documents', (t) => {
        t.foreign('order_id').references('id').inTable('export_orders').onDelete('CASCADE');
      });
    }
  }

  // export_order_status_history.order_id -> export_orders.id
  if (await knex.schema.hasTable('export_order_status_history')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'export_order_status_history' AND kcu.column_name = 'order_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('export_order_status_history', (t) => {
        t.foreign('order_id').references('id').inTable('export_orders').onDelete('CASCADE');
      });
    }
  }

  // shipment_containers.order_id -> export_orders.id
  if (await knex.schema.hasTable('shipment_containers')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'shipment_containers' AND kcu.column_name = 'order_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('shipment_containers', (t) => {
        t.foreign('order_id').references('id').inTable('export_orders').onDelete('CASCADE');
      });
    }
  }

  // milling_costs.batch_id -> milling_batches.id
  if (await knex.schema.hasTable('milling_costs')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'milling_costs' AND kcu.column_name = 'batch_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('milling_costs', (t) => {
        t.foreign('batch_id').references('id').inTable('milling_batches').onDelete('CASCADE');
      });
    }
  }

  // milling_quality_samples.batch_id -> milling_batches.id
  if (await knex.schema.hasTable('milling_quality_samples')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'milling_quality_samples' AND kcu.column_name = 'batch_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('milling_quality_samples', (t) => {
        t.foreign('batch_id').references('id').inTable('milling_batches').onDelete('CASCADE');
      });
    }
  }

  // milling_vehicle_arrivals.batch_id -> milling_batches.id
  if (await knex.schema.hasTable('milling_vehicle_arrivals')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'milling_vehicle_arrivals' AND kcu.column_name = 'batch_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
        t.foreign('batch_id').references('id').inTable('milling_batches').onDelete('CASCADE');
      });
    }
  }

  // journal_lines.journal_id -> journal_entries.id
  if (await knex.schema.hasTable('journal_lines')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'journal_lines' AND kcu.column_name = 'journal_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('journal_lines', (t) => {
        t.foreign('journal_id').references('id').inTable('journal_entries').onDelete('CASCADE');
      });
    }
  }

  // inventory_movements.lot_id -> inventory_lots.id (already has index, check FK)
  if (await knex.schema.hasTable('inventory_movements')) {
    const hasFk = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_name = 'inventory_movements' AND kcu.column_name = 'lot_id'
    `);
    if (hasFk.rows.length === 0) {
      await knex.schema.alterTable('inventory_movements', (t) => {
        t.foreign('lot_id').references('id').inTable('inventory_lots').onDelete('CASCADE');
      });
    }
  }

  // =========================================================================
  // 5. ADD MISSING INDEXES ON FREQUENTLY QUERIED COLUMNS
  // =========================================================================

  // export_order_costs — queried by order_id constantly
  if (await knex.schema.hasTable('export_order_costs')) {
    const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='export_order_costs' AND indexname='idx_export_order_costs_order_id'`);
    if (hasIdx.rows.length === 0) {
      await knex.schema.alterTable('export_order_costs', (t) => {
        t.index('order_id', 'idx_export_order_costs_order_id');
      });
    }
  }

  // inventory_lots — entity column is filtered frequently
  if (await knex.schema.hasTable('inventory_lots')) {
    const hasEntityIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='inventory_lots' AND indexname='idx_inventory_lots_entity'`);
    if (hasEntityIdx.rows.length === 0) {
      await knex.schema.alterTable('inventory_lots', (t) => {
        t.index('entity', 'idx_inventory_lots_entity');
        t.index('type', 'idx_inventory_lots_type');
        t.index('batch_ref', 'idx_inventory_lots_batch_ref');
      });
    }
  }

  // lot_transactions — reference_module + reference_id are queried together
  if (await knex.schema.hasTable('lot_transactions')) {
    const hasRefIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='lot_transactions' AND indexname='idx_lot_txn_ref'`);
    if (hasRefIdx.rows.length === 0) {
      await knex.schema.alterTable('lot_transactions', (t) => {
        t.index(['reference_module', 'reference_id'], 'idx_lot_txn_ref');
      });
    }
  }

  // receivables — entity + order_id queried together
  if (await knex.schema.hasTable('receivables')) {
    const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='receivables' AND indexname='idx_receivables_order'`);
    if (hasIdx.rows.length === 0 && await knex.schema.hasColumn('receivables', 'order_id')) {
      await knex.schema.alterTable('receivables', (t) => {
        t.index('order_id', 'idx_receivables_order');
      });
    }
  }

  // payments — receivable_id / payable_id lookups (check columns exist first)
  if (await knex.schema.hasTable('payments')) {
    const hasRecvCol = await knex.schema.hasColumn('payments', 'receivable_id');
    const hasPayCol = await knex.schema.hasColumn('payments', 'payable_id');

    if (hasRecvCol) {
      const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='payments' AND indexname='idx_payments_receivable'`);
      if (hasIdx.rows.length === 0) {
        await knex.schema.alterTable('payments', (t) => {
          t.index('receivable_id', 'idx_payments_receivable');
        });
      }
    }
    if (hasPayCol) {
      const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='payments' AND indexname='idx_payments_payable'`);
      if (hasIdx.rows.length === 0) {
        await knex.schema.alterTable('payments', (t) => {
          t.index('payable_id', 'idx_payments_payable');
        });
      }
    }
  }

  // journal_lines — journal_id is always queried
  if (await knex.schema.hasTable('journal_lines')) {
    const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='journal_lines' AND indexname='idx_journal_lines_journal_id'`);
    if (hasIdx.rows.length === 0) {
      await knex.schema.alterTable('journal_lines', (t) => {
        t.index('journal_id', 'idx_journal_lines_journal_id');
      });
    }
  }

  // audit_logs — entity_type + entity_id queried together, user_id filtered
  if (await knex.schema.hasTable('audit_logs')) {
    const hasIdx = await knex.raw(`SELECT 1 FROM pg_indexes WHERE tablename='audit_logs' AND indexname='idx_audit_entity'`);
    if (hasIdx.rows.length === 0) {
      await knex.schema.alterTable('audit_logs', (t) => {
        t.index(['entity_type', 'entity_id'], 'idx_audit_entity');
        t.index('user_id', 'idx_audit_user');
        t.index('created_at', 'idx_audit_created');
      });
    }
  }
};

exports.down = async function (knex) {
  // Removing NOT NULL constraints in down migration
  // This is destructive in reverse — we just make columns nullable again

  const statusTables = [
    'accounting_periods', 'advance_payments', 'alerts', 'api_sync_log',
    'approval_queue', 'background_jobs', 'bank_reconciliation', 'bank_transactions',
    'cost_allocations', 'data_imports', 'document_dispatch_log', 'document_store',
    'email_logs', 'exception_inbox', 'export_order_documents', 'export_orders',
    'follow_ups', 'goods_receipt_notes', 'internal_transfers', 'inventory_lots',
    'inventory_reservations', 'journal_entries', 'local_sales', 'mill_attendance',
    'milling_batches', 'mills', 'payables', 'predictive_alerts', 'production_plans',
    'purchase_orders', 'purchase_requisitions', 'purchase_returns', 'receivables',
    'reprocessing_batches', 'stock_count_items', 'stock_counts', 'supplier_invoices',
    'system_health', 'task_execution_log', 'tasks_assignments', 'whatsapp_logs',
  ];

  for (const table of statusTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    await knex.schema.alterTable(table, (t) => {
      t.string('status').nullable().alter();
    });
  }

  // Make identifiers nullable again
  const idFixes = [
    { table: 'inventory_lots', column: 'lot_no' },
    { table: 'journal_entries', column: 'journal_no' },
    { table: 'lot_transactions', column: 'transaction_no' },
    { table: 'payments', column: 'payment_no' },
    { table: 'bank_transactions', column: 'transaction_no' },
  ];
  for (const { table, column } of idFixes) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    await knex.schema.alterTable(table, (t) => {
      t.string(column).nullable().alter();
    });
  }

  // Drop added indexes (safe to ignore if they don't exist)
  const indexDrops = [
    { table: 'export_order_costs', index: 'idx_export_order_costs_order_id' },
    { table: 'inventory_lots', index: 'idx_inventory_lots_entity' },
    { table: 'inventory_lots', index: 'idx_inventory_lots_type' },
    { table: 'inventory_lots', index: 'idx_inventory_lots_batch_ref' },
    { table: 'lot_transactions', index: 'idx_lot_txn_ref' },
    { table: 'receivables', index: 'idx_receivables_order' },
    { table: 'payments', index: 'idx_payments_receivable' },
    { table: 'payments', index: 'idx_payments_payable' },
    { table: 'journal_lines', index: 'idx_journal_lines_journal_id' },
    { table: 'audit_logs', index: 'idx_audit_entity' },
    { table: 'audit_logs', index: 'idx_audit_user' },
    { table: 'audit_logs', index: 'idx_audit_created' },
  ];

  for (const { table, index } of indexDrops) {
    try {
      await knex.schema.alterTable(table, (t) => { t.dropIndex([], index); });
    } catch (e) { /* index may not exist */ }
  }

  // Note: FK constraints and timestamp columns are left in place (non-destructive).
};
