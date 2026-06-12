/**
 * Schema refinement round 46.
 *
 * Non-negative CHECK on every price / per-unit-rate / per-unit-cost column. A
 * unit price, rate-per-kg, price-per-mt or cost-per-unit is non-negative by
 * nature; a negative one is always a data-entry or calculation error. Adding
 * CHECK (col IS NULL OR col >= 0) turns that invariant into a guarantee while
 * leaving NULL (not-yet-priced) untouched.
 *
 * Scope is deliberately limited to price/rate/unit-cost columns — the
 * unambiguous case. Signed quantity columns on movement/adjustment tables
 * (e.g. lot_transactions.quantity_kg, which legitimately goes negative for
 * outflows) are NOT touched; nor are balances, variances or impacts.
 *
 * Covers the 41 price/rate columns that lacked such a CHECK; 10 others
 * (export_orders.price_per_mt, several milling_batches.*_price_per_mt, …)
 * already got one in earlier rounds and are skipped to avoid duplicates.
 *
 * Verified: 0 negative values across all 41 columns on prod AND dev. The CHECK
 * permits NULL, and no migration seeds a negative price, so it applies
 * deterministically on a from-scratch build.
 *
 * Constraint name: chk_<table>_<col>_nn (<=63 chars, collision-free for this
 * set). Idempotent (guarded by pg_constraint); reversible.
 */

const COLS = [
  ['batch_source_lots', 'unit_cost_pkr'],
  ['cost_predictions', 'predicted_milling_cost_per_mt'],
  ['cost_predictions', 'predicted_min_sell_price'],
  ['cost_predictions', 'predicted_raw_cost_per_mt'],
  ['cost_predictions', 'predicted_total_cost_per_mt'],
  ['credit_notes', 'original_price_per_mt'],
  ['export_order_items', 'price_per_mt'],
  ['internal_transfers', 'transfer_price_pkr'],
  ['inventory_lots', 'bag_cost_per_bag'],
  ['inventory_lots', 'landed_cost_per_kg'],
  ['inventory_lots', 'rate_per_kg'],
  ['local_sales', 'rate_per_kg'],
  ['lot_transactions', 'rate_per_kg'],
  ['lot_transactions', 'unit_cost'],
  ['mill_items', 'avg_cost_per_unit'],
  ['mill_performance', 'avg_cost_per_mt'],
  ['milling_batches', 'bran_price_per_mt'],
  ['milling_batches', 'broken_price_per_mt'],
  ['milling_batches', 'finished_price_per_mt'],
  ['milling_batches', 'husk_price_per_mt'],
  ['milling_batches', 'milling_cost_per_kg_finished'],
  ['milling_batches', 'purchase_price_per_kg'],
  ['milling_batches', 'raw_cost_per_kg_finished'],
  ['milling_batches', 'sortex_rejects_price_per_mt'],
  ['milling_output_market_prices', 'bran_price_per_mt'],
  ['milling_output_market_prices', 'broken_price_per_mt'],
  ['milling_output_market_prices', 'finished_price_per_mt'],
  ['milling_output_market_prices', 'husk_price_per_mt'],
  ['milling_output_market_prices', 'other_output_price_per_mt'],
  ['milling_quality_samples', 'price_per_kg'],
  ['pricing_simulations', 'bags_cost_per_mt'],
  ['pricing_simulations', 'clearing_cost_per_mt'],
  ['pricing_simulations', 'freight_cost_per_mt'],
  ['pricing_simulations', 'milling_cost_per_mt'],
  ['pricing_simulations', 'minimum_selling_price'],
  ['pricing_simulations', 'raw_rice_cost_per_mt'],
  ['pricing_simulations', 'recommended_price'],
  ['pricing_simulations', 'total_cost_per_mt'],
  ['purchase_lot_templates', 'default_rate_per_kg'],
  ['stock_adjustments', 'unit_cost'],
  ['utility_consumption', 'rate_per_unit'],
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
