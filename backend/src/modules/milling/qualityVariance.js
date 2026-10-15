/**
 * Sample-vs-arrival quality variance for a milling batch (P3-16 / MIL-05,
 * MIL-36).
 *
 * variance_pct = the largest absolute difference, in percentage points,
 * between the batch's SAMPLE analysis (what the supplier showed) and its
 * ARRIVAL analysis (what the trucks delivered), over the parameters both
 * record. The Quality Comparison page used to compute this in the browser
 * after 50 per-batch detail fetches; it now lives on milling_batches
 * (migration 381), maintained here whenever an analysis is saved, and the
 * page reads one list endpoint.
 */

// Compared parameters (milling_quality_samples columns). Same list as the
// migration 381 back-fill and the page's qualityParams.
const VARIANCE_PARAMS = ['moisture', 'broken', 'chalky', 'foreign_matter', 'discoloration', 'purity', 'grain_size'];

// The QC decisions milling_batches.variance_status may hold (CHECK, mig 381).
const VARIANCE_STATUSES = ['Pending', 'Approved', 'On Hold', 'Renegotiation', 'Rejected'];

const num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/** Pure. null unless both analyses exist; 0 when they share no parameter. */
function computeVariancePct(sample, arrival) {
  if (!sample || !arrival) return null;
  let max = null;
  for (const p of VARIANCE_PARAMS) {
    const s = num(sample[p]);
    const a = num(arrival[p]);
    if (s == null || a == null) continue;
    const d = Math.abs(a - s);
    if (max == null || d > max) max = d;
  }
  return max == null ? 0 : Math.round(max * 100) / 100;
}

async function latestAnalyses(q, batchIds) {
  const rows = await q('milling_quality_samples')
    .whereIn('batch_id', batchIds)
    .whereIn('analysis_type', ['sample', 'arrival'])
    .orderBy('created_at', 'asc');
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.batch_id)) out.set(r.batch_id, { sample: null, arrival: null });
    out.get(r.batch_id)[r.analysis_type] = r; // ascending → the latest wins
  }
  return out;
}

/** Recompute and store one batch's variance_pct. Returns the new figure. */
async function refreshBatchVariance(trx, batchId) {
  const a = (await latestAnalyses(trx, [batchId])).get(batchId) || {};
  const pct = computeVariancePct(a.sample, a.arrival);
  await trx('milling_batches').where({ id: batchId }).update({ variance_pct: pct });
  return pct;
}

const analysisOut = (r) => (r ? {
  moisture: num(r.moisture), broken: num(r.broken), chalky: num(r.chalky),
  foreign_matter: num(r.foreign_matter), discoloration: num(r.discoloration),
  purity: num(r.purity), grain_size: num(r.grain_size),
  price_per_kg: num(r.price_per_kg), price_per_mt: num(r.price_per_mt),
} : null);

/**
 * The Quality Comparison list: every non-service batch (newest first, up to
 * `limit`) with its latest sample / arrival analysis and stored variance.
 * One query per table instead of one detail fetch per batch.
 */
async function listQualityComparison(db, { limit = 200 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const batches = await db('milling_batches as mb')
    .leftJoin('suppliers as s', 's.id', 'mb.supplier_id')
    .leftJoin('products as p', 'p.id', 'mb.product_id')
    .where(function () { this.where('mb.is_service_milling', false).orWhereNull('mb.is_service_milling'); })
    .orderBy('mb.created_at', 'desc')
    .limit(lim)
    .select('mb.id', 'mb.batch_no', 'mb.status', 'mb.supplier_id', 's.name as supplier_name',
      'mb.product_id', 'p.name as product_name', 'mb.raw_qty_kg', 'mb.created_at',
      'mb.variance_status', 'mb.variance_pct');
  const analyses = batches.length ? await latestAnalyses(db, batches.map((b) => b.id)) : new Map();
  return batches.map((b) => {
    const a = analyses.get(b.id) || {};
    return {
      ...b,
      variance_pct: num(b.variance_pct),
      sample: analysisOut(a.sample),
      arrival: analysisOut(a.arrival),
      has_quality: !!(a.sample || a.arrival),
    };
  });
}

module.exports = {
  VARIANCE_PARAMS, VARIANCE_STATUSES, computeVariancePct, refreshBatchVariance, listQualityComparison,
};
