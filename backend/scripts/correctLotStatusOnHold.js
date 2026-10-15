/**
 * Normalise inventory_lots.status 'OnHold' → 'On Hold' (P3-15 / DAT-23).
 * DRY-RUN BY DEFAULT.
 *
 *   node scripts/correctLotStatusOnHold.js                     dry-run: counts + ids
 *   CORRECT_LOT_STATUS_ON_HOLD=1 node scripts/correctLotStatusOnHold.js
 *                                                              writes, in ONE transaction
 *
 * What it writes (nothing else):
 *   1. UPDATE inventory_lots SET status = 'On Hold' WHERE status = 'OnHold'
 *      — a label change only; no quantity, cost, ledger row or journal moves.
 *   2. Then, once no 'OnHold' row is left, replaces inventory_lots_status_chk
 *      with the single-spelling CHECK migration 380 would have applied.
 *
 * Output is counts and lot ids only. Runbook: docs/runbooks/lot-status-on-hold.md
 */
const { detect, report, CONSTRAINT } = require('./detectLotStatusOnHold');
const { NEW_PREDICATE } = require('../migrations/20261017_380_lot_status_single_on_hold');

async function correct(db, { write, log = console.log }) {
  const before = await detect(db);
  const needsTighten = before.constraintAdmitsOnHold || !before.constraintPresent;
  const tag = write ? '' : '[dry-run] ';
  log(`${tag}lots to relabel 'OnHold' → 'On Hold': ${before.onHoldIds.length}`);
  log(`${tag}tighten ${CONSTRAINT}: ${needsTighten ? 'yes' : 'no (already single spelling)'}`);
  if (!write) return { before, relabelled: 0, tightened: false };

  let relabelled = 0;
  let tightened = false;
  await db.transaction(async (trx) => {
    if (before.onHoldIds.length) {
      relabelled = await trx('inventory_lots').whereIn('id', before.onHoldIds).where({ status: 'OnHold' })
        .update({ status: 'On Hold', updated_at: trx.fn.now() });
    }
    const left = await trx('inventory_lots').where({ status: 'OnHold' }).count('id as n').first();
    if (Number(left.n) === 0 && needsTighten) {
      await trx.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
      await trx.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT ${CONSTRAINT} CHECK (${NEW_PREDICATE})`);
      tightened = true;
    }
  });
  log(`relabelled lots: ${relabelled}; ${CONSTRAINT} tightened: ${tightened ? 'yes' : 'no'}`);
  return { before, relabelled, tightened };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.CORRECT_LOT_STATUS_ON_HOLD === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await correct(db, { write, log });
    if (write) {
      log('--- after ---');
      report(await detect(db), log);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctLotStatusOnHold failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, main };
