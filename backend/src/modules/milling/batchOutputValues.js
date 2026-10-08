/**
 * What a milling batch's output is booked at — read from the output lots its
 * yield created, not recomputed from the batch's price columns.
 *
 * At yield, recordMillingOutput creates one inventory_lot per output, tied to
 * the batch by `batch_ref = 'batch-<id>'` (type 'finished' / 'byproduct'), and
 * writes a receipt row in lot_transactions (`milling_receipt` /
 * `byproduct_receipt`, reference_module 'milling_batch', reference_id = batch).
 *
 *   value = receipt qty (kg yielded INTO the lot by this batch)
 *         × the lot's landed_cost_per_kg (what the lot is carried at now)
 *
 * - The receipt qty, not lots.qty: a lot may have been partly sold or re-milled
 *   since, and the report wants what the batch produced, not what is left.
 * - The lot's per-kg, not the receipt's rate: a later price confirmation /
 *   source-lot re-price (reallocateBatchCosts) re-costs the lots in place but
 *   leaves the receipt row's rate as it was; a re-recorded yield
 *   (resyncBatchOutputsFromBatch) rewrites both. The lot is the value the books
 *   carry for that output — stock valuation and COGS-on-sale both read it.
 *
 * Client-owned lots (service milling) and Closed lots (voided duplicates,
 * which reallocateBatchCosts also skips) are left out. A batch with no
 * company-owned output lot carrying a receipt — not yielded yet, legacy, or a
 * toll batch — has no stored value; callers fall back to the computed figure.
 */

const RECEIPT_TYPES = ['milling_receipt', 'byproduct_receipt'];

// Label a by-product lot: its grade (B1/B2/CSR…) when it has one, else the
// by-product name (a blend's lot is "<blend label> — Powder" → "Powder").
function byproductLabel(lot) {
  if (lot.grade) return String(lot.grade);
  const name = String(lot.item_name || '');
  const i = name.lastIndexOf(' — ');
  return (i >= 0 ? name.slice(i + 3) : name).trim() || 'By-product';
}

/**
 * @param conn  knex instance or transaction
 * @param batchIds  milling_batches ids
 * @returns Map<batchId, { byproductValue, finishedValue, byproductByGrade, source: 'yield_lots' }>
 *          — only batches that HAVE stored output values are in the map.
 */
async function batchOutputValues(conn, batchIds) {
  const ids = [...new Set((batchIds || []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  if (!ids.length) return new Map();

  const rows = await conn('inventory_lots as l')
    .join('lot_transactions as t', function joinReceipt() {
      this.on('t.lot_id', '=', 'l.id')
        .andOn('t.reference_module', '=', conn.raw('?', ['milling_batch']))
        // Compared as text so a non-numeric batch_ref can never fail a cast.
        .andOn(conn.raw("CAST(t.reference_id AS TEXT) = REPLACE(l.batch_ref, 'batch-', '')"));
    })
    .whereIn('l.batch_ref', ids.map((id) => `batch-${id}`))
    .whereIn('l.type', ['finished', 'byproduct'])
    .whereNot('l.status', 'Closed')
    .whereRaw("COALESCE(l.ownership, 'company') <> 'client'")
    .whereIn('t.transaction_type', RECEIPT_TYPES)
    .groupBy('l.id', 'l.batch_ref', 'l.type', 'l.grade', 'l.item_name', 'l.landed_cost_per_kg', 'l.cost_per_unit')
    .select(
      'l.id', 'l.batch_ref', 'l.type', 'l.grade', 'l.item_name',
      'l.landed_cost_per_kg', 'l.cost_per_unit',
      conn.raw('SUM(t.quantity_kg) as yield_kg'),
    );

  return aggregateOutputRows(rows);
}

/**
 * Fold per-lot rows ({ batch_ref, type, grade, item_name, landed_cost_per_kg,
 * cost_per_unit, yield_kg }) into the per-batch Map batchOutputValues returns.
 */
function aggregateOutputRows(rows) {
  const out = new Map();
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const lot of rows || []) {
    const batchId = parseInt(String(lot.batch_ref).replace('batch-', ''), 10);
    const kg = parseFloat(lot.yield_kg) || 0;
    if (kg <= 0) continue;
    const perKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.cost_per_unit) || 0;
    const value = kg * perKg;
    let v = out.get(batchId);
    if (!v) {
      v = { byproductValue: 0, finishedValue: 0, byproductByGrade: {}, source: 'yield_lots' };
      out.set(batchId, v);
    }
    if (lot.type === 'finished') {
      v.finishedValue += value;
    } else {
      v.byproductValue += value;
      const label = byproductLabel(lot);
      v.byproductByGrade[label] = (v.byproductByGrade[label] || 0) + value;
    }
  }
  for (const v of out.values()) {
    v.byproductValue = r2(v.byproductValue);
    v.finishedValue = r2(v.finishedValue);
    for (const k of Object.keys(v.byproductByGrade)) v.byproductByGrade[k] = r2(v.byproductByGrade[k]);
  }
  return out;
}

module.exports = { batchOutputValues, aggregateOutputRows, byproductLabel, RECEIPT_TYPES };
