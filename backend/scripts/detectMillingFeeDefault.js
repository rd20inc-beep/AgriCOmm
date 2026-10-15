/**
 * Detect milling batches carrying the old Rs 5/kg default processing fee
 * (P4-02 / MIL-02). READ-ONLY.
 *
 *   node scripts/detectMillingFeeDefault.js
 *
 * milling_batches.milling_fee_per_kg was DEFAULT 5 and the create paths read
 * the form's 0 as "missing" and stored 5. The form has not asked for a fee for
 * a long time, so a stored 5 is almost always that default — but a user could
 * have typed 5 in an older form, so the correction is reviewed, not automatic.
 * No KPI, cost or journal reads the fee any more; the stored value only shows
 * on the batch record. No GL impact.
 *
 * Prints counts and batch ids only. Runbook: docs/runbooks/milling-fee-default.md
 */
const DEFAULT_FEE = 5;

async function detect(db) {
  const five = await db('milling_batches').where('milling_fee_per_kg', DEFAULT_FEE)
    .orderBy('id').select('id', 'is_service_milling');
  const [{ n: other }] = await db('milling_batches')
    .where('milling_fee_per_kg', '>', 0).whereNot('milling_fee_per_kg', DEFAULT_FEE).count('id as n');
  const def = await db.raw(`
    SELECT column_default FROM information_schema.columns
     WHERE table_name = 'milling_batches' AND column_name = 'milling_fee_per_kg'`);
  return {
    defaultFeeIds: five.map((r) => r.id),
    defaultFeeServiceIds: five.filter((r) => r.is_service_milling).map((r) => r.id),
    otherFeeCount: Number(other) || 0,
    columnDefault: def.rows.length ? def.rows[0].column_default : null,
  };
}

function report(r, log = console.log) {
  log(`batches with milling_fee_per_kg = ${DEFAULT_FEE}: ${r.defaultFeeIds.length}${r.defaultFeeIds.length ? ` (ids: ${r.defaultFeeIds.join(', ')})` : ''}`);
  log(`  of which service-milling batches: ${r.defaultFeeServiceIds.length}`);
  log(`batches with any other fee > 0 (typed; left alone): ${r.otherFeeCount}`);
  log(`column default: ${r.columnDefault == null ? 'none' : r.columnDefault}`);
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    report(await detect(db), log);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectMillingFeeDefault failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, DEFAULT_FEE };
