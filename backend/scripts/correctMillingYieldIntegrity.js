/**
 * Correct the milling yield damage detectMillingYieldIntegrity.js finds — only
 * the patterns that are unambiguous; everything else is listed for review.
 *
 *   phantom_output_correctable (MIL-06): the lot's receipt rows were deleted by a
 *     pre-P3 re-yield that zeroed the output, and its qty was kept. Per lot, in
 *     its own transaction (re-checked under a row lock):
 *       1. the deleted receipt is RESTORED as a ledger row (remarks say so), so
 *          the lot's history explains the qty it holds;
 *       2. a receipt REVERSAL takes the lot to 0 through postMovement (status
 *          Closed) — nothing is deleted;
 *       3. the batch's 1220 ↔ 1240 output split is re-synced (signed delta;
 *          usually nothing, the split already excluded the phantom lot).
 *   consumed_remainder (MIL-16): a raw lot still holding rice flagged 'Consumed'
 *     gets its flag cleared (no qty / cost / GL change).
 *   residual_drift_unsold (MIL-04 / MIL-13): only with FIX_RESIDUAL=1 — runs the
 *     existing re-price cascade (recomputeBatchOutputsAfterPriceChange: lots,
 *     cost/kg, un-locked COGS, 1220 / 1240 split delta) on batches whose outputs
 *     are untouched.
 * service_resurrected and noncanonical_category are LISTED only — they need the
 * client record / an accountant (see the runbook).
 *
 * Dry run by default (prints what it would do, writes nothing):
 *   node scripts/correctMillingYieldIntegrity.js
 * Write (after review + backup):
 *   FIX_MILLING_YIELD=1 node scripts/correctMillingYieldIntegrity.js
 *   FIX_MILLING_YIELD=1 FIX_RESIDUAL=1 node scripts/correctMillingYieldIntegrity.js
 * Output: counts + IDs only.
 * Runbook: docs/runbooks/milling-yield-integrity.md
 */
const { detect } = require('./detectMillingYieldIntegrity');

const num = (v) => parseFloat(v) || 0;

async function correctPhantomLot(trx, lotId, { userId = null } = {}) {
  const inventory = require('../src/modules/inventory/inventory.service');
  const lot = await trx('inventory_lots').where({ id: lotId }).forUpdate().first();
  if (!lot) return { skipped: 'gone' };
  const [again] = (await detect(trx, { sections: ['phantom'] })).phantom_output_correctable.filter((id) => id === lotId);
  if (!again) return { skipped: 'no_longer_phantom' };
  const batchId = parseInt(String(lot.batch_ref).replace('batch-', ''), 10);
  const qty = num(lot.qty);
  const byproduct = lot.type === 'byproduct';
  const cost = num(lot.cost_per_unit);
  // 1. Restore the receipt the old resync deleted.
  const today = new Date().toISOString().slice(0, 10);
  const no = await trx('lot_transactions')
    .whereRaw('transaction_no LIKE ?', [`TXN-${today.replace(/-/g, '')}-%`])
    .select(trx.raw("MAX(CAST(split_part(transaction_no, '-', 3) AS INTEGER)) as m")).first();
  await trx('lot_transactions').insert({
    transaction_no: `TXN-${today.replace(/-/g, '')}-${String((parseInt(no && no.m, 10) || 0) + 1).padStart(4, '0')}`,
    transaction_date: today, lot_id: lot.id,
    transaction_type: byproduct ? 'byproduct_receipt' : 'milling_receipt',
    reference_module: 'milling_batch', reference_id: batchId, reference_no: `batch-${batchId}`,
    input_unit: 'KG', input_qty: qty, quantity_kg: qty, rate_input_unit: 'KG',
    rate_per_kg: cost > 0 ? cost : null, unit_cost: cost > 0 ? cost : null,
    cost_impact: cost * qty, total_cost: cost * qty || null, currency: 'PKR', balance_kg: qty,
    remarks: 'MIL-06 correction: receipt restored — deleted by a pre-P3 re-recorded yield that kept this qty',
    created_by: userId, performed_by: userId, performed_at: new Date(),
  });
  // 2. Reverse it to zero through the stock writer.
  await inventory.postOutputToTarget(trx, {
    lot, targetKg: 0, byproduct, costPerKg: cost, warehouseId: lot.warehouse_id, batchId,
    notes: 'MIL-06 correction: output no longer produced by the batch\'s recorded yield', userId,
  });
  // 3. GL output split follows the lots (signed delta, usually none).
  const batch = await trx('milling_batches').where({ id: batchId }).first();
  const { syncOutputSplit } = require('../src/modules/milling/millingCompletionJournal');
  const split = await syncOutputSplit(trx, require('../src/modules/accounting/accounting.service'), { batch, userId });
  await trx('historical_cost_repair_log').insert({
    lot_id: lot.id, batch_id: batchId, issue_type: 'mil06_phantom_output_reversed',
    old_value_json: JSON.stringify({ qty }), new_value_json: JSON.stringify({ qty: 0, splitDelta: split ? split.delta : 0 }),
    repaired_by: userId, repaired_at: new Date(),
  });
  return { corrected: true, qty, splitDelta: split ? split.delta : 0 };
}

async function main(_argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.FIX_MILLING_YIELD === '1';
  const residual = env.FIX_RESIDUAL === '1';
  const db = require('../src/config/database');
  try {
    const f = await detect(db);
    log(`${write ? 'WRITE' : 'DRY RUN'} — phantom outputs: ${f.phantom_output.length} (correctable ${f.phantom_output_correctable.length}); `
      + `consumed remainders: ${f.consumed_remainder.length}; residual drift: ${f.residual_drift.length} (unsold ${f.residual_drift_unsold.length})`);
    const review = f.phantom_output.filter((id) => !f.phantom_output_correctable.includes(id));
    if (review.length) log(`  MANUAL REVIEW phantom lots: ${review.join(', ')}`);
    if (f.service_resurrected.length) log(`  CLIENT REVIEW service batches (dispatch ledger rows missing): ${f.service_resurrected.join(', ')}`);
    if (f.noncanonical_category.length) log(`  ACCOUNTANT REVIEW cost rows (batch:category): ${f.noncanonical_category.join(', ')}`);
    const soldDrift = f.residual_drift.filter((id) => !f.residual_drift_unsold.includes(id));
    if (soldDrift.length) log(`  ACCOUNTANT REVIEW residual drift with sold output (batch ids): ${soldDrift.join(', ')}`);
    if (!write) {
      log(`  would reverse phantom lots: ${f.phantom_output_correctable.join(', ') || '—'}`);
      log(`  would clear Consumed flag on raw lots: ${f.consumed_remainder.join(', ') || '—'}`);
      if (residual) log(`  would re-run the re-price cascade on batches: ${f.residual_drift_unsold.join(', ') || '—'}`);
      return 0;
    }
    let lots = 0;
    for (const id of f.phantom_output_correctable) {
      const r = await db.transaction((trx) => correctPhantomLot(trx, id));
      if (r.corrected) lots += 1; else log(`  skipped lot #${id}: ${r.skipped}`);
    }
    let flags = 0;
    if (f.consumed_remainder.length) {
      flags = await db('inventory_lots').whereIn('id', f.consumed_remainder).where('qty', '>', 0.001)
        .where('milling_status', 'Consumed').update({ milling_status: null, updated_at: db.fn.now() });
    }
    let repriced = 0;
    if (residual) {
      const inventory = require('../src/modules/inventory/inventory.service');
      const { consumedOutputLot } = require('../src/modules/milling/costEditLocks');
      for (const batchId of f.residual_drift_unsold) {
        await db.transaction(async (trx) => {
          if (await consumedOutputLot(trx, batchId)) return; // moved since detection
          await inventory.recomputeBatchOutputsAfterPriceChange(trx, batchId, {});
          repriced += 1;
        });
      }
    }
    log(`  reversed phantom lots: ${lots}; cleared Consumed flags: ${flags}; re-priced batches: ${repriced}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctMillingYieldIntegrity failed:', err.message);
    process.exit(1);
  });
}

module.exports = { main, correctPhantomLot };
