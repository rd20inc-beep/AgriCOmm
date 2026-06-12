/**
 * Schema refinement round 49.
 *
 * NOT NULL on 59 numeric columns that DEFAULT to 0 and are additive in nature —
 * amounts, costs, quantities and counters where 0 is the genuine "nothing yet"
 * value and NULL carries no distinct meaning (you haven't paid NULL, you've paid
 * 0; a job processed NULL items, it processed 0). The default already yields 0
 * when the column is omitted, so SET NOT NULL changes no insert path; it only
 * forbids an explicit NULL.
 *
 * One default-0 numeric is deliberately EXCLUDED: export_orders
 * .current_fx_value_pkr. It actually carries NULLs (10 rows on dev), i.e. null
 * is a state the app really produces — "not yet revalued" — distinct from 0.
 * Locking it would erase that, so it stays nullable.
 *
 * (Earlier drafts also held back credit_limit, current_balance, aging, age_days
 * and contract_value_pkr_locked on a "NULL might mean unset" hunch — but they
 * have 0 NULLs on prod AND dev and no IS NULL / ?? handling anywhere in the
 * code, so the hunch wasn't real and they're included.)
 *
 * Verified 0 NULLs across all 65 on prod AND dev; defaults cover any
 * migration-seeded rows, so it applies deterministically on a from-scratch
 * build (no data-conditional skips). Idempotent; reversible.
 */

const COLS = [
  ['advance_payments', 'allocated_amount'],
  ['advance_payments', 'unallocated_amount'],
  ['alerts', 'age_days'],
  ['api_sync_log', 'records_failed'],
  ['api_sync_log', 'records_synced'],
  ['background_jobs', 'failed_items'],
  ['background_jobs', 'processed_items'],
  ['background_jobs', 'progress'],
  ['background_jobs', 'total_items'],
  ['bag_types', 'reorder_level'],
  ['bank_accounts', 'current_balance'],
  ['customers', 'credit_limit'],
  ['data_imports', 'failed_rows'],
  ['data_imports', 'imported_rows'],
  ['data_imports', 'total_rows'],
  ['export_orders', 'contract_value_pkr_locked'],
  ['export_orders', 'fx_gain_loss_pkr'],
  ['goods_receipt_notes', 'rejected_qty_mt'],
  ['inventory_lots', 'bag_cost_per_bag'],
  ['inventory_lots', 'cost_per_unit'],
  ['inventory_lots', 'damaged_weight_kg'],
  ['inventory_lots', 'due_amount'],
  ['inventory_lots', 'gross_weight_kg'],
  ['inventory_lots', 'labor_cost'],
  ['inventory_lots', 'landed_cost_per_kg'],
  ['inventory_lots', 'landed_cost_total'],
  ['inventory_lots', 'other_cost'],
  ['inventory_lots', 'packing_cost'],
  ['inventory_lots', 'paid_amount'],
  ['inventory_lots', 'purchase_amount'],
  ['inventory_lots', 'rate_per_kg'],
  ['inventory_lots', 'sold_weight_kg'],
  ['inventory_lots', 'total_bag_cost'],
  ['inventory_lots', 'total_value'],
  ['inventory_lots', 'transport_cost'],
  ['inventory_lots', 'unloading_cost'],
  ['inventory_movements', 'cost_per_unit'],
  ['inventory_movements', 'total_cost'],
  ['journal_entries', 'total_credit'],
  ['journal_entries', 'total_debit'],
  ['journal_lines', 'credit'],
  ['journal_lines', 'debit'],
  ['local_sales', 'due_amount'],
  ['local_sales', 'paid_amount'],
  ['machine_downtime', 'impact_mt'],
  ['mill_attendance', 'overtime_hours'],
  ['payables', 'aging'],
  ['receivables', 'aging'],
  ['milling_batches', 'actual_finished_mt'],
  ['milling_batches', 'bran_mt'],
  ['milling_batches', 'broken_mt'],
  ['milling_batches', 'husk_mt'],
  ['milling_batches', 'moisture_loss_pct'],
  ['milling_batches', 'processing_hours'],
  ['milling_batches', 'sortex_rejects_mt'],
  ['milling_batches', 'wastage_mt'],
  ['milling_batches', 'yield_pct'],
  ['production_plans', 'actual_qty_mt'],
  ['receivables', 'base_amount_pkr'],
  ['reprocessing_batches', 'output_qty_mt'],
  ['reprocessing_batches', 'wastage_mt'],
  ['shipment_containers', 'gross_weight_kg'],
  ['shipment_containers', 'net_weight_kg'],
  ['supplier_invoices', 'deductions'],
  ['task_execution_log', 'items_processed'],
];

exports.up = async function (knex) {
  for (const [t, c] of COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL`, [t, c]);
    }
  }
};

exports.down = async function (knex) {
  for (const [t, c] of COLS) {
    if (await knex.schema.hasColumn(t, c)) {
      await knex.raw(`ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL`, [t, c]);
    }
  }
};
