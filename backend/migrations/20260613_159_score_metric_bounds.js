/**
 * Schema refinement round 51 — finishes the numeric-bounds sweep.
 *
 * (a) 0–100 range CHECK on the nine 0–100 score columns (weighted scores the
 *     scoring service produces; prod data sits at 15–90):
 *       customer_scores.{overall,payment,profitability,volume}_score
 *       supplier_scores.{delivery,price,quality,overall}_score
 *       risk_scores.risk_score
 *
 * (b) Non-negative CHECK on the remaining metric columns — hours, durations,
 *     day-counts, item counts, versions, sequence numbers — that can't be < 0:
 *       mill_attendance.hours_worked / overtime_hours,
 *       milling_batches.processing_hours, mill_performance.total_downtime_hours,
 *       machine_downtime.duration_minutes, customer_scores.{avg_balance_days,
 *       overdue_count}, supplier_scores.{avg_delivery_days,batches_count,
 *       grn_count}, export_order_items.bag_count, order_packing_lines.bag_count,
 *       document_store.version, export_order_documents.version,
 *       shipment_containers.sequence_no, alerts.age_days
 *
 * EXCLUDED: customer_scores.avg_advance_days — "days of advance" can in
 * principle be negative (advance received after the order), so it isn't a clean
 * non-negative; left unconstrained.
 *
 * Verified on prod AND dev: scores within 0–100, all metrics >= 0. Both checks
 * permit NULL. Idempotent (guarded by pg_constraint); reversible.
 */

const SCORE_COLS = [
  ['customer_scores', 'overall_score'],
  ['customer_scores', 'payment_score'],
  ['customer_scores', 'profitability_score'],
  ['customer_scores', 'volume_score'],
  ['supplier_scores', 'delivery_score'],
  ['supplier_scores', 'price_score'],
  ['supplier_scores', 'quality_score'],
  ['supplier_scores', 'overall_score'],
  ['risk_scores', 'risk_score'],
];

const NN_COLS = [
  ['alerts', 'age_days'],
  ['customer_scores', 'avg_balance_days'],
  ['customer_scores', 'overdue_count'],
  ['document_store', 'version'],
  ['export_order_documents', 'version'],
  ['export_order_items', 'bag_count'],
  ['machine_downtime', 'duration_minutes'],
  ['mill_attendance', 'hours_worked'],
  ['mill_attendance', 'overtime_hours'],
  ['mill_performance', 'total_downtime_hours'],
  ['milling_batches', 'processing_hours'],
  ['order_packing_lines', 'bag_count'],
  ['shipment_containers', 'sequence_no'],
  ['supplier_scores', 'avg_delivery_days'],
  ['supplier_scores', 'batches_count'],
  ['supplier_scores', 'grn_count'],
];

async function addCheck(knex, t, c, name, expr) {
  if (!(await knex.schema.hasColumn(t, c))) return;
  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  if (exists.rows.length) return;
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (${expr})`, [t]);
}

exports.up = async function (knex) {
  for (const [t, c] of SCORE_COLS) {
    await addCheck(knex, t, c, `chk_${t}_${c}_range`, `"${c}" IS NULL OR ("${c}" >= 0 AND "${c}" <= 100)`);
  }
  for (const [t, c] of NN_COLS) {
    await addCheck(knex, t, c, `chk_${t}_${c}_nn`, `"${c}" IS NULL OR "${c}" >= 0`);
  }
};

exports.down = async function (knex) {
  for (const [t, c] of SCORE_COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS chk_${t}_${c}_range`, [t]);
  }
  for (const [t, c] of NN_COLS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS chk_${t}_${c}_nn`, [t]);
  }
};
