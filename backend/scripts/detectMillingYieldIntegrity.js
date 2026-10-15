/**
 * READ-ONLY: milling yield / costing damage left by the pre-P3 code paths.
 *
 *   phantom_output        (MIL-06) an output lot of a batch whose qty differs from
 *                         its ledger (Σ lot_transactions) — a re-recorded yield
 *                         deleted the receipt rows and kept the qty of a grade it
 *                         zeroed. `phantom_output_correctable` = the clear pattern:
 *                         ledger 0, the batch's current yield for that output 0,
 *                         nothing else ever touched the lot.
 *   service_resurrected   (MIL-08) a service batch with a dispatch whose ledger row
 *                         is gone (the re-yield resync deleted it and re-added
 *                         the full yield) — client stock overstated. Needs the
 *                         client record; never corrected by script.
 *   consumed_remainder    (MIL-16) a partially-milled batch's raw lot still holding
 *                         rice but flagged milling_status 'Consumed' (hidden from
 *                         every picker).
 *   noncanonical_category (MIL-11) milling_costs rows whose category is not on the
 *                         canonical list (e.g. 'rawRice' — raw rice booked as a
 *                         processing cost, Cr 2110 at completion). Accountant review.
 *   residual_drift        (MIL-04 / MIL-13) a yielded company batch whose stored
 *                         total_cost_per_kg_finished differs from the residual
 *                         engine re-run on its current cost sheet by > Rs 0.01/kg.
 *                         `residual_drift_unsold` = the subset whose outputs are
 *                         untouched (the re-price cascade can fix those).
 *
 * Output: counts + IDs only. Nothing is written (the residual figure is computed
 * with the pure engine, not loadBatchAllocation, which can backfill a raw row).
 *   node scripts/detectMillingYieldIntegrity.js
 * Correction: scripts/correctMillingYieldIntegrity.js — runbook
 * docs/runbooks/milling-yield-integrity.md
 */
const { MILLING_COST_CATEGORIES } = require('../src/modules/milling/costCategories');

const num = (v) => parseFloat(v) || 0;
const OWN_TYPES = ['milling_receipt', 'byproduct_receipt', 'milling_receipt_reversal', 'byproduct_receipt_reversal'];

// The batch's current yield figure for one output lot.
function targetFor(batch, lot) {
  if (lot.type === 'finished') return num(batch.actual_finished_kg);
  const g = String(lot.grade || '').toLowerCase();
  const byGrade = { b1: 'b1_kg', b2: 'b2_kg', b3: 'b3_kg', csr: 'csr_kg', 'short grain': 'short_grain_kg' };
  if (byGrade[g]) return num(batch[byGrade[g]]);
  const n = String(lot.item_name || '').toLowerCase();
  if (n.includes('bran')) return num(batch.bran_kg);
  if (n.includes('husk')) return num(batch.husk_kg);
  if (n.includes('sortex')) return num(batch.sortex_rejects_kg);
  if (n.includes('powder')) return num(batch.powder_kg);
  if (n.includes('sweeping')) return num(batch.sweeping_kg);
  if (n.includes('choba')) return num(batch.choba_kg);
  if (n.includes('broken')) return num(batch.broken_kg);
  return null;
}

// `sections` limits the run (e.g. ['phantom'] for a per-lot re-check).
async function detect(q, { sections = null } = {}) {
  const want = (k) => !sections || sections.includes(k);
  const out = {
    phantom_output: [], phantom_output_correctable: [], service_resurrected: [],
    consumed_remainder: [], noncanonical_category: [], residual_drift: [], residual_drift_unsold: [],
  };

  // MIL-06
  if (want('phantom')) await phantom(q, out);
  if (!want('rest')) return out;

  // MIL-08
  const resurrected = await q('service_milling_dispatches as d')
    .whereNotExists(function dispatched() {
      this.select('t.id').from('lot_transactions as t')
        .whereRaw('t.lot_id = d.lot_id').where('t.transaction_type', 'service_dispatch_out')
        .whereRaw('t.reference_no = d.dispatch_no');
    })
    .distinct('d.service_batch_id').orderBy('d.service_batch_id').pluck('d.service_batch_id');
  out.service_resurrected = resurrected;

  // MIL-16
  out.consumed_remainder = await q('inventory_lots as l')
    .join('milling_batches as mb', q.raw("l.batch_ref = 'batch-' || mb.id"))
    .where('l.type', 'raw').where('l.milling_status', 'Consumed').where('l.qty', '>', 0.001)
    .orderBy('l.id').pluck('l.id');

  // MIL-11
  const cats = await q('milling_costs').whereNotIn('category', MILLING_COST_CATEGORIES)
    .select('batch_id', 'category').orderBy('batch_id');
  out.noncanonical_category = cats.map((c) => `${c.batch_id}:${c.category}`);

  // MIL-04 / MIL-13 — pure engine on the stored figures.
  const inventory = require('../src/modules/inventory/inventory.service');
  const { consumedOutputLot } = require('../src/modules/milling/costEditLocks');
  const yielded = await q('milling_batches')
    .where('actual_finished_kg', '>', 0)
    .where((w) => w.whereNull('is_service_milling').orWhere('is_service_milling', false))
    .orderBy('id');
  for (const b of yielded) {
    const rows = await q('milling_costs').where({ batch_id: b.id }).select('category').sum('amount as t').groupBy('category');
    let raw = 0; let pack = 0; let proc = 0; let mill = 0;
    for (const r of rows) {
      const t = num(r.t);
      if (r.category === 'raw_rice') raw += t;
      else if (r.category === 'packaging') pack += t;
      else { proc += t; if (r.category === 'processing') mill += t; }
    }
    const a = inventory.computeResidualAllocation(b, raw, proc, pack, mill);
    if (Math.abs(a.finishedCostPerKg - num(b.total_cost_per_kg_finished)) > 0.01) {
      out.residual_drift.push(b.id);
      if (!(await consumedOutputLot(q, b.id))) out.residual_drift_unsold.push(b.id);
    }
  }
  return out;
}

async function phantom(q, out) {
  const lots = await q('inventory_lots as l')
    .whereIn('l.type', ['finished', 'byproduct']).where('l.batch_ref', 'like', 'batch-%')
    .select('l.id', 'l.batch_ref', 'l.type', 'l.grade', 'l.item_name', 'l.qty', 'l.reserved_qty', 'l.sold_weight_kg',
      q.raw('(SELECT COALESCE(SUM(t.quantity_kg), 0) FROM lot_transactions t WHERE t.lot_id = l.id) AS ledger_kg'),
      q.raw(`(SELECT COUNT(*) FROM lot_transactions t WHERE t.lot_id = l.id
               AND t.transaction_type NOT IN (${OWN_TYPES.map(() => '?').join(', ')})) AS foreign_rows`, OWN_TYPES))
    .orderBy('l.id');
  const batchIds = [...new Set(lots.map((l) => parseInt(String(l.batch_ref).replace('batch-', ''), 10)).filter(Number.isFinite))];
  const batches = batchIds.length ? await q('milling_batches').whereIn('id', batchIds) : [];
  const byId = new Map(batches.map((b) => [b.id, b]));
  for (const l of lots) {
    if (Math.abs(num(l.qty) - num(l.ledger_kg)) <= 0.5) continue;
    out.phantom_output.push(l.id);
    const b = byId.get(parseInt(String(l.batch_ref).replace('batch-', ''), 10));
    const untouched = parseInt(l.foreign_rows, 10) === 0 && num(l.reserved_qty) <= 0 && num(l.sold_weight_kg) <= 0;
    if (b && untouched && Math.abs(num(l.ledger_kg)) <= 0.5 && targetFor(b, l) === 0 && num(l.qty) > 0) {
      out.phantom_output_correctable.push(l.id);
    }
  }
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const r = await detect(db);
    for (const [k, list] of Object.entries(r)) {
      log(`${k}: ${list.length}${list.length ? ` — ${list.join(', ')}` : ''}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectMillingYieldIntegrity failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, main, targetFor };
