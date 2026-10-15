// Milling yield, one definition (owner decision D-14, 2026-10-15):
//
//   yield % = Σ finished output KG ÷ Σ raw input KG × 100   (weighted)
//
// over COMPLETED company batches only — service (toll) milling is the client's
// rice and never counts. Averaging each batch's stored yield_pct gave a 1-tonne
// trial batch the same weight as a 50-tonne run, and the stored yield_pct is a
// snapshot that can lag the trucks. "Output" is finished rice, the same thing
// yield_pct has always measured.

/** Restrict a milling_batches query to the batches a yield figure may use. */
function yieldBatches(q, mb = 'mb') {
  return q.where(`${mb}.status`, 'Completed')
    .where((w) => w.whereNull(`${mb}.is_service_milling`).orWhere(`${mb}.is_service_milling`, false))
    .where(`${mb}.raw_qty_kg`, '>', 0);
}

/** Weighted yield % over the grouped rows (SQL aggregate). */
const weightedYieldPctSql = (mb = 'mb') =>
  `ROUND(100.0 * COALESCE(SUM(${mb}.actual_finished_kg), 0) / NULLIF(SUM(${mb}.raw_qty_kg), 0), 2)`;

/** JS twin: weighted yield % of batch rows ({ raw_qty_kg, actual_finished_kg, status, is_service_milling }). */
function weightedYieldPct(batches) {
  let raw = 0; let fin = 0;
  for (const b of Array.isArray(batches) ? batches : []) {
    if (!b || b.status !== 'Completed' || b.is_service_milling) continue;
    const r = parseFloat(b.raw_qty_kg) || 0;
    if (!(r > 0)) continue;
    raw += r; fin += parseFloat(b.actual_finished_kg) || 0;
  }
  return raw > 0 ? Math.round((fin / raw) * 10000) / 100 : null;
}

module.exports = { yieldBatches, weightedYieldPctSql, weightedYieldPct };
