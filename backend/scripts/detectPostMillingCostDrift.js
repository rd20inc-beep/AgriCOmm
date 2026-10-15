/**
 * READ-ONLY: list the batches whose output-lot value may have drifted from the
 * GL because of edits made BEFORE P2-08 locked them:
 *
 *   manual_override   batch carries a manual Milling / Other total (MIL-03): its
 *                     lots are valued on that figure, the GL on the itemised
 *                     cost lines.
 *   repriced_after_yield
 *                     a source-lot price / cost edit cascaded into the batch
 *                     after its yield (INV-08 — historical_cost_repair_log
 *                     'lot_cost_edit_propagated' later than completed_at): the
 *                     outputs were re-costed with no journal.
 *   price_after_yield the arrival price / raw cost line was changed after yield
 *                     (MIL-07 — milling_costs raw_rice updated after completed_at).
 *
 * Output: counts + batch IDs only. Nothing is written. Each flagged batch needs
 * an accountant's review; any correction is a signed-delta journal (see
 * docs/runbooks/post-milling-cost-edits.md) — never a rewrite of lots or journals.
 *   node scripts/detectPostMillingCostDrift.js
 */
async function detect(q) {
  const manual = await q('milling_batches')
    .where((w) => w.where('manual_milling_cost_pkr', '>', 0).orWhere('manual_other_expenses_pkr', '>', 0))
    .where((w) => w.whereNull('is_service_milling').orWhere('is_service_milling', false))
    .orderBy('id').pluck('id');
  const repriced = await q('historical_cost_repair_log as h')
    .join('milling_batches as mb', 'mb.id', 'h.batch_id')
    .where('h.issue_type', 'lot_cost_edit_propagated')
    .whereNotNull('mb.completed_at')
    .whereRaw('h.repaired_at > mb.completed_at')
    .distinct('mb.id').orderBy('mb.id').pluck('mb.id');
  const rawAfter = await q('milling_costs as mc')
    .join('milling_batches as mb', 'mb.id', 'mc.batch_id')
    .where('mc.category', 'raw_rice')
    .whereNotNull('mb.completed_at')
    .whereRaw('mc.updated_at > mb.completed_at + interval \'1 minute\'')
    .distinct('mb.id').orderBy('mb.id').pluck('mb.id');
  return { manual_override: manual, repriced_after_yield: repriced, price_after_yield: rawAfter };
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const r = await detect(db);
    for (const [k, idsList] of Object.entries(r)) {
      log(`${k}: ${idsList.length}${idsList.length ? ` — batch ids ${idsList.join(', ')}` : ''}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectPostMillingCostDrift failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, main };
