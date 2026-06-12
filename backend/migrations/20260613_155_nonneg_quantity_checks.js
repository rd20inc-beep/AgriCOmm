/**
 * Schema refinement round 47.
 *
 * Non-negative CHECK on physical quantity / weight / count columns — the
 * companion to round 46 (which did prices/rates). A bag size, gross/tare
 * weight, qty in mt/kg, bag count, mill capacity or reorder level can't be
 * negative; CHECK (col IS NULL OR col >= 0) enforces it while leaving NULL
 * (not-yet-recorded) untouched.
 *
 * Scope excludes anything that can legitimately go negative:
 *   - signed-quantity movement/adjustment tables (lot_transactions,
 *     inventory_movements, mill_stock_*, stock_adjustments, *_log,
 *     consumption) — a quantity there is a delta and may be < 0
 *   - variance / diff / delta / balance / impact columns
 *   - local_sales.profit_per_kg — profit can be a loss (negative)
 *   - columns that already carry a CHECK from an earlier round
 *
 * Verified: 0 negative values across all 58 columns on prod AND dev. The CHECK
 * permits NULL and no migration seeds a negative quantity, so it applies
 * deterministically on a from-scratch build.
 *
 * Constraint name chk_<table>_<col>_nn (max 53 chars, collision-free).
 * Idempotent (guarded by pg_constraint); reversible.
 */

const COLS = [
  ['bag_types', 'reorder_level'],
  ['bag_types', 'size_kg'],
  ['cost_predictions', 'predicted_bags_per_mt'],
  ['cost_predictions', 'predicted_clearing_per_mt'],
  ['cost_predictions', 'predicted_freight_per_mt'],
  ['credit_notes', 'qty_mt'],
  ['export_order_items', 'bag_size_kg'],
  ['export_order_items', 'master_bag_size_kg'],
  ['export_order_items', 'qty_mt'],
  ['export_orders', 'bag_size_kg'],
  ['export_orders', 'bag_weight_gm'],
  ['export_orders', 'inventory_cogs_per_mt_pkr'],
  ['export_orders', 'master_bag_size_kg'],
  ['export_orders', 'quantity_input_value'],
  ['export_orders', 'total_bags'],
  ['goods_receipt_notes', 'gross_weight_mt'],
  ['goods_receipt_notes', 'tare_weight_mt'],
  ['internal_transfers', 'qty_mt'],
  ['inventory_lots', 'bag_size_kg'],
  ['inventory_lots', 'bag_weight_gm'],
  ['inventory_lots', 'bag_weight_kg'],
  ['inventory_lots', 'damaged_weight_kg'],
  ['inventory_lots', 'gross_weight_kg'],
  ['inventory_lots', 'sold_weight_kg'],
  ['inventory_lots', 'total_bags'],
  ['inventory_reservations', 'reserved_qty'],
  ['inventory_valuation_snapshots', 'avg_value_per_kg'],
  ['inventory_valuation_snapshots', 'total_qty_kg'],
  ['local_sales', 'bag_weight_kg'],
  ['local_sales', 'cogs_per_kg'],
  ['local_sales', 'quantity_bags'],
  ['local_sales', 'quantity_input'],
  ['local_sales', 'quantity_kg'],
  ['lot_source_mapping', 'quantity_kg'],
  ['mill_items', 'reorder_level'],
  ['mill_performance', 'total_input_mt'],
  ['mill_performance', 'total_output_mt'],
  ['mill_stock', 'quantity_reserved'],
  ['milling_batches', 'milling_fee_per_kg'],
  ['milling_batches', 'planned_finished_mt'],
  ['mills', 'capacity_mt_per_day'],
  ['order_packing_lines', 'fill_weight_kg'],
  ['order_packing_lines', 'total_weight_kg'],
  ['pricing_simulations', 'qty_mt'],
  ['production_plans', 'actual_qty_mt'],
  ['production_plans', 'planned_qty_mt'],
  ['purchase_lot_templates', 'default_bag_weight_kg'],
  ['purchase_requisitions', 'qty_mt'],
  ['purchase_returns', 'qty_mt'],
  ['reprocessing_batches', 'input_qty_mt'],
  ['reprocessing_batches', 'output_qty_mt'],
  ['reprocessing_batches', 'wastage_mt'],
  ['shipment_containers', 'bags_count'],
  ['shipment_containers', 'gross_weight_kg'],
  ['shipment_containers', 'tare_weight_kg'],
  ['stock_count_items', 'counted_qty'],
  ['stock_count_items', 'system_qty'],
  ['supplier_scores', 'total_qty_mt'],
];

const cname = (t, c) => `chk_${t}_${c}_nn`;

exports.up = async function (knex) {
  for (const [t, c] of COLS) {
    if (!(await knex.schema.hasColumn(t, c))) continue;
    const name = cname(t, c);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR ?? >= 0)`, [t, c, c]);
  }
};

exports.down = async function (knex) {
  for (const [t, c] of COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${cname(t, c)}`, [t]);
  }
};
