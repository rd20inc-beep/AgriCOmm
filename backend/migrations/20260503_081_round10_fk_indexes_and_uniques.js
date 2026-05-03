/**
 * Round-10 schema refinement.
 *
 * Built on a live audit of the dev DB after migrations 062–080. Three
 * groups of changes:
 *
 * 1. FK index coverage. 122 foreign-key columns lack a supporting
 *    B-tree index. Every JOIN, every cascade-on-delete check, and
 *    every "find rows that reference X" lookup currently scans the
 *    full table. Adding all-IF-NOT-EXISTS indexes — zero data risk.
 *
 * 2. UNIQUE constraints that prevent silent data corruption:
 *      - mill_workers(cnic): national ID, duplicates are always errors.
 *      - fx_rates(from_currency, to_currency, effective_date): two
 *        rates for the same pair on the same day breaks rate lookups.
 *      - accounting_periods(fiscal_year, name): duplicate periods
 *        break journal_entries.period_id resolution.
 *      - mill_consumption_ratios(item_id) WHERE product_id IS NULL:
 *        the existing UNIQUE(item_id, product_id) does not deduplicate
 *        when product_id is NULL because Postgres treats NULLs as
 *        distinct, allowing multiple "default" ratios per item.
 *    All four were verified dupe-free in the live DB before adding.
 *
 * 3. Default cleanup:
 *      - payments.currency default changes from 'USD' to 'PKR'. The
 *        table is empty, and the dominant payment flow now is local
 *        PKR vendor settlements (per the export-outflow rule in 079).
 *
 * Idempotent throughout: every DDL is guarded by IF EXISTS / IF NOT
 * EXISTS or a pre-check.
 */

// FK columns missing a supporting B-tree index, generated from
// pg_constraint ⟕ pg_index on 2026-05-03.
const MISSING_FK_INDEXES = [
  ['accounting_periods', 'closed_by'],
  ['advance_allocations', 'advance_id'],
  ['advance_allocations', 'allocated_by'],
  ['advance_allocations', 'order_id'],
  ['advance_payments', 'bank_account_id'],
  ['advance_payments', 'created_by'],
  ['advance_payments', 'customer_id'],
  ['api_sync_log', 'integration_id'],
  ['approval_queue', 'approved_by'],
  ['approval_queue', 'requested_by'],
  ['background_jobs', 'created_by'],
  ['bank_reconciliation', 'bank_account_id'],
  ['bank_reconciliation', 'reconciled_by'],
  ['bank_reconciliation_items', 'reconciliation_id'],
  ['bank_transactions', 'bank_account_id'],
  ['bank_transactions', 'linked_payment_id'],
  ['batch_source_lots', 'batch_id'],
  ['batch_source_lots', 'lot_id'],
  ['business_expenses', 'approved_by'],
  ['business_expenses', 'bank_account_id'],
  ['business_expenses', 'created_by'],
  ['business_expenses', 'supplier_id'],
  ['chart_of_accounts', 'parent_id'],
  ['comments', 'user_id'],
  ['commodity_rate_master', 'product_id'],
  ['cost_allocation_lines', 'allocation_id'],
  ['cost_predictions', 'product_id'],
  ['credit_notes', 'created_by'],
  ['customer_scores', 'customer_id'],
  ['data_imports', 'created_by'],
  ['data_imports', 'job_id'],
  ['document_approvals', 'approver_id'],
  ['document_approvals', 'document_id'],
  ['document_dispatch_log', 'dispatched_by'],
  ['document_dispatch_log', 'document_id'],
  ['document_templates', 'created_by'],
  ['email_logs', 'sent_by'],
  ['email_templates', 'created_by'],
  ['exception_inbox', 'assigned_to'],
  ['exception_inbox', 'resolved_by'],
  ['follow_ups', 'user_id'],
  ['fx_gain_loss_ledger', 'export_order_id'],
  ['historical_cost_repair_log', 'repaired_by'],
  ['internal_transfers', 'batch_id'],
  ['internal_transfers', 'created_by'],
  ['internal_transfers', 'export_order_id'],
  ['inventory_movements', 'batch_id'],
  ['inventory_movements', 'created_by'],
  ['inventory_movements', 'from_warehouse_id'],
  ['inventory_movements', 'order_id'],
  ['inventory_movements', 'to_warehouse_id'],
  ['inventory_movements', 'transfer_id'],
  ['inventory_reservations', 'created_by'],
  ['inventory_reservations', 'lot_id'],
  ['inventory_reservations', 'order_id'],
  ['journal_entries', 'created_by'],
  ['journal_entries', 'period_id'],
  ['journal_entries', 'posting_rule_id'],
  ['journal_entries', 'reversal_of'],
  ['local_sales', 'created_by'],
  ['local_sales', 'lot_id'],
  ['machine_downtime', 'batch_id'],
  ['machine_downtime', 'mill_id'],
  ['machine_downtime', 'reported_by'],
  ['margin_analysis', 'order_id'],
  ['mill_consumption_logs', 'used_by'],
  ['mill_consumption_logs', 'warehouse_id'],
  ['mill_consumption_ratios', 'product_id'],
  ['mill_expenses', 'created_by'],
  ['mill_expenses', 'mill_id'],
  ['mill_performance', 'mill_id'],
  ['mill_stock_adjustments', 'approved_by'],
  ['mill_stock_adjustments', 'item_id'],
  ['mill_stock_adjustments', 'requested_by'],
  ['mill_stock_adjustments', 'warehouse_id'],
  ['mill_stock_movements', 'approved_by'],
  ['mill_stock_movements', 'performed_by'],
  ['mill_stock_movements', 'warehouse_id'],
  ['mill_workers', 'mill_id'],
  ['milling_output_market_prices', 'batch_id'],
  ['milling_output_market_prices', 'confirmed_by'],
  ['milling_quality_post', 'batch_id'],
  ['mobile_uploads', 'uploaded_by'],
  ['notifications', 'user_id'],
  ['password_reset_tokens', 'user_id'],
  ['posting_rules', 'credit_account_id'],
  ['posting_rules', 'debit_account_id'],
  ['pricing_simulations', 'created_by'],
  ['pricing_simulations', 'product_id'],
  ['production_plans', 'batch_id'],
  ['production_plans', 'created_by'],
  ['production_plans', 'mill_id'],
  ['purchase_returns', 'created_by'],
  ['purchase_returns', 'grn_id'],
  ['purchase_returns', 'supplier_id'],
  ['recovery_benchmarks', 'product_id'],
  ['report_exports', 'generated_by'],
  ['reprocessing_batches', 'created_by'],
  ['reprocessing_batches', 'original_batch_id'],
  ['role_permissions', 'permission_id'],
  ['root_cause_analyses', 'created_by'],
  ['saved_reports', 'created_by'],
  ['scenarios', 'created_by'],
  ['scheduled_reports', 'created_by'],
  ['scheduled_reports', 'saved_report_id'],
  ['stock_adjustments', 'approved_by'],
  ['stock_adjustments', 'lot_id'],
  ['stock_adjustments', 'requested_by'],
  ['stock_count_items', 'lot_id'],
  ['stock_count_items', 'stock_count_id'],
  ['stock_counts', 'approved_by'],
  ['stock_counts', 'counted_by'],
  ['stock_counts', 'created_by'],
  ['stock_counts', 'warehouse_id'],
  ['supplier_scores', 'supplier_id'],
  ['system_settings', 'updated_by'],
  ['task_execution_log', 'task_id'],
  ['tasks_assignments', 'assigned_by'],
  ['tasks_assignments', 'assigned_to'],
  ['utility_consumption', 'batch_id'],
  ['utility_consumption', 'mill_id'],
  ['utility_consumption', 'recorded_by'],
  ['whatsapp_logs', 'sent_by'],
  ['whatsapp_templates', 'created_by'],
];

exports.up = async function (knex) {
  // 1. FK indexes — skip silently if the table doesn't exist in this env.
  let added = 0;
  for (const [table, col] of MISSING_FK_INDEXES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;
    const idxName = `idx_${table}_${col}`.slice(0, 63); // pg identifier limit
    await knex.raw(`CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" ("${col}")`);
    added += 1;
  }
  if (added > 0) console.log(`[081] Ensured ${added} FK index(es)`);

  // 2a. UNIQUE on mill_workers.cnic — partial, ignores empty/null.
  if (await knex.schema.hasTable('mill_workers')) {
    const dupe = await knex.raw(`
      SELECT cnic FROM mill_workers
       WHERE cnic IS NOT NULL AND cnic <> ''
       GROUP BY cnic HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_mill_workers_cnic
          ON mill_workers (cnic)
          WHERE cnic IS NOT NULL AND cnic <> ''
      `);
    } else {
      console.warn('[081] Skipping mill_workers.cnic UNIQUE — duplicates present.');
    }
  }

  // 2b. UNIQUE on fx_rates(from_currency, to_currency, effective_date).
  if (await knex.schema.hasTable('fx_rates')) {
    const dupe = await knex.raw(`
      SELECT 1 FROM fx_rates
       GROUP BY from_currency, to_currency, effective_date
       HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_fx_rates_pair_date
          ON fx_rates (from_currency, to_currency, effective_date)
      `);
    } else {
      console.warn('[081] Skipping fx_rates UNIQUE — duplicates present.');
    }
  }

  // 2c. UNIQUE on accounting_periods(fiscal_year, name).
  if (await knex.schema.hasTable('accounting_periods')) {
    const dupe = await knex.raw(`
      SELECT 1 FROM accounting_periods
       GROUP BY fiscal_year, name HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_accounting_periods_year_name
          ON accounting_periods (fiscal_year, name)
      `);
    } else {
      console.warn('[081] Skipping accounting_periods UNIQUE — duplicates present.');
    }
  }

  // 2d. Partial UNIQUE on mill_consumption_ratios(item_id) WHERE product_id IS NULL.
  //     The existing UNIQUE(item_id, product_id) does not stop multiple
  //     "default" rows because NULL ≠ NULL in Postgres uniqueness semantics.
  if (await knex.schema.hasTable('mill_consumption_ratios')) {
    const dupe = await knex.raw(`
      SELECT item_id FROM mill_consumption_ratios
       WHERE product_id IS NULL
       GROUP BY item_id HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_mill_consumption_ratios_default
          ON mill_consumption_ratios (item_id)
          WHERE product_id IS NULL
      `);
    } else {
      console.warn('[081] Skipping mill_consumption_ratios default UNIQUE — duplicates present.');
    }
  }

  // 3. payments.currency default 'USD' → 'PKR'. Table is empty in dev;
  //    most production payment flows are local PKR settlements after the
  //    export-outflow rule (079).
  if (await knex.schema.hasTable('payments') && (await knex.schema.hasColumn('payments', 'currency'))) {
    await knex.raw(`ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'PKR'`);
  }
};

exports.down = async function (knex) {
  // Drop only the constraints we added; leave indexes in place — they're
  // pure perf wins, no rollback needed.
  await knex.raw(`DROP INDEX IF EXISTS uniq_mill_workers_cnic`);
  await knex.raw(`DROP INDEX IF EXISTS uniq_fx_rates_pair_date`);
  await knex.raw(`DROP INDEX IF EXISTS uniq_accounting_periods_year_name`);
  await knex.raw(`DROP INDEX IF EXISTS uniq_mill_consumption_ratios_default`);
  if (await knex.schema.hasTable('payments') && (await knex.schema.hasColumn('payments', 'currency'))) {
    await knex.raw(`ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'USD'`);
  }
};
