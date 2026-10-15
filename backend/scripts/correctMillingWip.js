/**
 * One-time D-6 cut-over for batches in flight when Milling WIP shipped
 * (P3-09). Takes the findings of detectMillingWipBacklog.js and, ONE BATCH PER
 * TRANSACTION, runs the same code the app now runs at every commitment
 * (millingWip.syncBatchIntake):
 *   1. truck_not_bought → books the truck lot's purchase as of today: supplier
 *      payable on the lot + 'Purchase Lot' journal Dr 1210 / Cr 2010 (party-
 *      stamped) for the lot's value (landed cost × KG on hand);
 *   2. wip_not_booked   → the signed-delta reclass 'Milling WIP' journal
 *      Dr 1260 Milling WIP / Cr 1210 (1220 / 1240 for re-milled stock) for the
 *      rice the batch has committed.
 * Nothing is reversed, re-posted or deleted; history keeps its dates. Running
 * it twice posts nothing the second time (the syncs are idempotent).
 * wip_after_yield findings are only LISTED — fix those by hand.
 *
 * Dry run by default (prints what it would do, writes nothing):
 *   node scripts/correctMillingWip.js
 * Write (after review + backup, see the runbook):
 *   FIX_MILLING_WIP=1 node scripts/correctMillingWip.js
 * Output: counts + batch / lot IDs only.
 * Runbook: docs/runbooks/milling-wip-cutover.md
 */
const { detect, summarize } = require('./detectMillingWipBacklog');
const { syncBatchIntake } = require('../src/modules/milling/millingWip');

async function correctOne(trx, batchId, { userId = null } = {}) {
  const locked = await trx('milling_batches').where({ id: batchId }).forUpdate().first();
  if (!locked) return { skipped: 'gone' };
  const before = await detect(trx, { batchId });
  if (!before.some((f) => f.kind === 'wip_not_booked' || f.kind === 'truck_not_bought')) return { skipped: 'nothing_to_book' };
  const r = await syncBatchIntake(trx, batchId, { userId, reason: 'D-6 cut-over (committed before Milling WIP)' });
  return { corrected: true, purchase: !!(r.purchase && Math.abs(r.purchase.delta) >= 0.01), wip: !!(r.wip && r.wip.posted) };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.FIX_MILLING_WIP === '1';
  const db = require('../src/config/database');
  try {
    const s = summarize(await detect(db));
    const batchIds = [...new Set([...s.truckNotBought, ...s.wipNotBooked].map((f) => f.batchId))].sort((a, b) => a - b);
    log(`${write ? 'WRITE' : 'DRY RUN'} — batches to book: ${batchIds.length} (truck purchases: ${s.truckNotBought.length}, WIP reclass: ${s.wipNotBooked.length}); manual review: ${s.wipAfterYield.length}`);
    for (const f of s.wipAfterYield) log(`  MANUAL REVIEW batch #${f.batchId} — WIP left after yield / close`);
    let done = 0;
    for (const id of batchIds) {
      const kinds = [...s.truckNotBought, ...s.wipNotBooked].filter((f) => f.batchId === id).map((f) => f.kind).join(' + ');
      if (!write) { log(`  would book batch #${id}: ${kinds}`); continue; }
      const r = await db.transaction((trx) => correctOne(trx, id));
      if (r.corrected) { done += 1; log(`  booked batch #${id}:${r.purchase ? ' truck purchase' : ''}${r.wip ? ' WIP reclass' : ''}`); }
      else log(`  skipped batch #${id}: ${r.skipped}`);
    }
    if (write) {
      const after = summarize(await detect(db));
      log(`booked: ${done}; remaining — WIP not booked: ${after.wipNotBooked.length}, truck not bought: ${after.truckNotBought.length}`);
    } else {
      log('Nothing written. Set FIX_MILLING_WIP=1 to apply (see runbook).');
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctMillingWip failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correctOne, main };
