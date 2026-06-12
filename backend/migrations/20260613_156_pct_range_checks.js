/**
 * Schema refinement round 48.
 *
 * 0–100 range CHECK on composition / yield / moisture percentage columns,
 * extending the existing chk_quality_*_pct_range convention (which already
 * bounds the milling_quality_samples grain fractions) to the 28 other such
 * columns that lacked it. A moisture %, broken %, yield %, bran/husk/wastage %,
 * chalky %, rejection % or advance % is definitionally within 0–100; the CHECK
 * (col IS NULL OR (col >= 0 AND col <= 100)) catches typo'd values (e.g. a
 * 1250% moisture) while leaving NULL untouched.
 *
 * Deliberately EXCLUDED — these are percentages too but NOT bounded 0–100:
 *   - margin %  (margin_pct, *_margin_pct, target_margin_pct) — can exceed 100
 *     or be negative (a loss)
 *   - variance % (variance_pct, *_variance) — signed
 *   - utilization_pct — a mill can run over rated capacity (>100%)
 *   - confidence_pct — ambiguous scale (0–1 vs 0–100), no data to confirm
 *
 * Verified: every column with data is within 0–100 on prod AND dev; the others
 * are empty and definitionally bounded. CHECK permits NULL and no migration
 * seeds an out-of-range value, so it applies deterministically on a fresh build.
 *
 * Constraint name chk_<table>_<col>_range (max 50 chars, collision-free).
 * Idempotent (guarded by pg_constraint); reversible.
 */

const COLS = [
  ['export_order_items', 'broken_pct_target'],
  ['export_orders', 'advance_pct'],
  ['export_orders', 'broken_pct_target'],
  ['goods_receipt_notes', 'broken_actual'],
  ['goods_receipt_notes', 'moisture_actual'],
  ['inventory_lots', 'broken_pct'],
  ['inventory_lots', 'moisture_pct'],
  ['mill_performance', 'avg_bran_pct'],
  ['mill_performance', 'avg_broken_pct'],
  ['mill_performance', 'avg_yield_pct'],
  ['milling_batches', 'moisture_loss_pct'],
  ['milling_batches', 'yield_pct'],
  ['milling_quality_post', 'broken_pct'],
  ['milling_quality_post', 'chalky_pct'],
  ['milling_quality_post', 'moisture'],
  ['milling_quality_samples', 'broken'],
  ['milling_quality_samples', 'chalky'],
  ['milling_quality_samples', 'moisture'],
  ['purchase_orders', 'broken_expected'],
  ['purchase_orders', 'moisture_expected'],
  ['recovery_benchmarks', 'expected_bran_pct'],
  ['recovery_benchmarks', 'expected_broken_pct'],
  ['recovery_benchmarks', 'expected_husk_pct'],
  ['recovery_benchmarks', 'expected_wastage_pct'],
  ['recovery_benchmarks', 'expected_yield_pct'],
  ['recovery_benchmarks', 'moisture_range_max'],
  ['recovery_benchmarks', 'moisture_range_min'],
  ['supplier_scores', 'rejection_pct'],
];

const cname = (t, c) => `chk_${t}_${c}_range`;

exports.up = async function (knex) {
  for (const [t, c] of COLS) {
    if (!(await knex.schema.hasColumn(t, c))) continue;
    const name = cname(t, c);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR (?? >= 0 AND ?? <= 100))`, [t, c, c, c]);
  }
};

exports.down = async function (knex) {
  for (const [t, c] of COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${cname(t, c)}`, [t]);
  }
};
