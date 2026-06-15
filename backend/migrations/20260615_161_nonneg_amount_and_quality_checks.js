/**
 * Schema refinement round 50.
 *
 * Two invariants the earlier rounds left uncovered:
 *
 * 1. Non-negative CHECK on additive AMOUNT / COST / VALUE columns — the landed-
 *    cost breakdown on a lot, payment amounts, allocation/expense/invoice totals,
 *    and the blend source-lot cost snapshot. Round 46 (chk_*_nn) deliberately
 *    covered only price/rate/unit-cost columns and left these additive amounts
 *    for a later pass; this is that pass. A purchase amount, paid/due amount,
 *    landed-cost component, allocation or invoice total is non-negative by
 *    nature — a negative one is a data-entry or calculation error. CHECK
 *    (col IS NULL OR col >= 0) makes the invariant a guarantee, NULL untouched.
 *
 *    Deliberately EXCLUDED — amounts that legitimately go negative, so a nonneg
 *    CHECK would be wrong:
 *      - signed ledgers / movements: bank_transactions.amount,
 *        bank_reconciliation_items.amount, lot_transactions.cost_impact /
 *        .total_cost, inventory_movements.*, mill_stock_movements.*,
 *        stock_adjustments.total_cost_impact (reversals & adjustments)
 *      - gain/loss & fx: fx_gain_loss_ledger.foreign_amount, *_gain_loss,
 *        variance / margin columns
 *      - ambiguous metric/threshold scales: exception_inbox.metric_value /
 *        .threshold_value, kpi_benchmarks.target_value, supplier_scores
 *        .total_value (could be a signed weighted score)
 *
 * 2. 0–100 range CHECK on the three quality-percentage columns in
 *    milling_quality_samples that round 48 (chk_*_range) missed — discoloration,
 *    foreign_matter and purity are percentages, definitionally within 0–100,
 *    sitting right beside broken / chalky / moisture which are already bounded.
 *    grain_size stays a plain non-negative (it is a grain LENGTH in mm, not a %).
 *
 * Verified: 0 violations across every listed column on prod AND dev; CHECK
 * permits NULL and no migration seeds an out-of-range value, so it applies
 * deterministically on a from-scratch build. Names chk_<table>_<col>_{nn,range}
 * (≤ 63 chars, collision-free). Idempotent (guarded by pg_constraint); reversible.
 */

const NN_COLS = [
  ['inventory_lots', 'cost_per_unit'],
  ['inventory_lots', 'due_amount'],
  ['inventory_lots', 'labor_cost'],
  ['inventory_lots', 'landed_cost_total'],
  ['inventory_lots', 'milling_cost_component'],
  ['inventory_lots', 'other_cost'],
  ['inventory_lots', 'packing_cost'],
  ['inventory_lots', 'paid_amount'],
  ['inventory_lots', 'purchase_amount'],
  ['inventory_lots', 'raw_cost_component'],
  ['inventory_lots', 'rate_input_value'],
  ['inventory_lots', 'total_bag_cost'],
  ['inventory_lots', 'total_value'],
  ['inventory_lots', 'transport_cost'],
  ['inventory_lots', 'unloading_cost'],
  ['inventory_lots', 'whiteness'],
  ['batch_source_lots', 'cost_total_pkr'],
  ['business_expenses', 'amount_pkr'],
  ['business_expenses', 'paid_amount'],
  ['cost_allocations', 'gross_amount'],
  ['cost_allocation_lines', 'amount'],
  ['export_order_costs', 'base_amount_pkr'],
  ['export_order_costs', 'paid_amount'],
  ['internal_transfers', 'total_value_pkr'],
  ['local_sales', 'cost_per_kg'],
  ['lot_source_mapping', 'cost_share_amount'],
  ['mill_consumption_logs', 'cost_per_unit'],
  ['mill_consumption_logs', 'total_cost'],
  ['mill_items', 'last_purchase_cost'],
  ['mill_performance', 'total_electricity_cost'],
  ['mill_performance', 'total_labor_cost'],
  ['mill_purchase_items', 'total_cost'],
  ['mill_purchases', 'paid_amount'],
  ['pricing_simulations', 'other_costs_per_mt'],
  ['supplier_invoices', 'deductions'],
  ['supplier_invoices', 'gross_amount'],
  ['utility_consumption', 'total_cost'],
  ['advance_allocations', 'amount'],
  ['advance_payments', 'unallocated_amount'],
  ['inventory_valuation_snapshots', 'total_value'],
  ['milling_quality_samples', 'grain_size'],
];

const RANGE_COLS = [
  ['milling_quality_samples', 'discoloration'],
  ['milling_quality_samples', 'foreign_matter'],
  ['milling_quality_samples', 'purity'],
];

const nnName = (t, c) => `chk_${t}_${c}_nn`;
const rangeName = (t, c) => `chk_${t}_${c}_range`;

exports.up = async function (knex) {
  for (const [t, c] of NN_COLS) {
    if (!(await knex.schema.hasColumn(t, c))) continue;
    const name = nnName(t, c);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR ?? >= 0)`, [t, c, c]);
  }
  for (const [t, c] of RANGE_COLS) {
    if (!(await knex.schema.hasColumn(t, c))) continue;
    const name = rangeName(t, c);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR (?? >= 0 AND ?? <= 100))`, [t, c, c, c]);
  }
};

exports.down = async function (knex) {
  for (const [t, c] of NN_COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${nnName(t, c)}`, [t]);
  }
  for (const [t, c] of RANGE_COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${rangeName(t, c)}`, [t]);
  }
};
