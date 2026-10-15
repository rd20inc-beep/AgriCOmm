/**
 * Reset the old Rs 5/kg default processing fee to 0 (P4-02 / MIL-02).
 * DRY-RUN BY DEFAULT.
 *
 *   node scripts/fixMillingFeeDefault.js                       dry-run: counts + ids
 *   FIX_MILLING_FEE_DEFAULT=1 BATCH_IDS=12,15,19 node scripts/fixMillingFeeDefault.js
 *                                                              writes, in ONE transaction
 *
 * BATCH_IDS is REQUIRED to write: the owner reviews the dry-run list (a stored
 * 5 may have been typed in an older form) and passes the ids that were the
 * default. Only those ids, and only while they still read exactly 5, are set
 * to 0. Each gets an audit_logs row (action milling_fee_default_reset).
 *
 * What it writes (nothing else): milling_batches.milling_fee_per_kg 5 → 0.
 * The fee feeds no cost, valuation, KPI or journal, so no GL entry moves.
 * Runbook: docs/runbooks/milling-fee-default.md
 */
const { detect, report, DEFAULT_FEE } = require('./detectMillingFeeDefault');

const parseIds = (s) => String(s || '').split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

async function correct(db, { write, ids = [], log = console.log }) {
  const before = await detect(db);
  const flagged = new Set(before.defaultFeeIds);
  const chosen = ids.filter((id) => flagged.has(id));
  const ignored = ids.filter((id) => !flagged.has(id));
  const tag = write ? '' : '[dry-run] ';
  log(`${tag}batches reading Rs ${DEFAULT_FEE}/kg: ${before.defaultFeeIds.length}`);
  log(`${tag}batches selected by BATCH_IDS: ${chosen.length}${ignored.length ? ` (not at Rs ${DEFAULT_FEE}, ignored: ${ignored.join(', ')})` : ''}`);
  if (!write) return { before, reset: 0 };
  if (!chosen.length) {
    log('nothing to write: pass the reviewed ids in BATCH_IDS');
    return { before, reset: 0 };
  }
  let reset = 0;
  await db.transaction(async (trx) => {
    reset = await trx('milling_batches').whereIn('id', chosen).where('milling_fee_per_kg', DEFAULT_FEE)
      .update({ milling_fee_per_kg: 0, updated_at: trx.fn.now() });
    for (const id of chosen) {
      await trx('audit_logs').insert({
        action: 'milling_fee_default_reset', entity_type: 'milling_batch', entity_id: String(id),
        details: JSON.stringify({ source: 'scripts/fixMillingFeeDefault.js', from: DEFAULT_FEE, to: 0 }),
        created_at: trx.fn.now(),
      });
    }
  });
  log(`batches reset to 0: ${reset}`);
  return { before, reset };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.FIX_MILLING_FEE_DEFAULT === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await correct(db, { write, ids: parseIds(env.BATCH_IDS), log });
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
    console.error('fixMillingFeeDefault failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, main, parseIds };
