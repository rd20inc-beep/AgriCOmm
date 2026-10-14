/**
 * Correct UNPAID duplicate MILL-RICE-<batch> payables (P2-06 / MIL-01).
 *
 * Takes the findings of detectMillRiceDuplicatePayables.js of kind 'unpaid' and,
 * one payable per transaction (re-checked under a row lock):
 *   - posts a SIGNED-DELTA journal 'Rice Purchase Correction' (ref = batch no):
 *     Dr 2010 Supplier Payable / Cr 1210 Raw Rice Stock, party-stamped to the
 *     supplier — for the duplicate amount the GL actually booked (never more);
 *     nothing is reversed, re-posted or deleted;
 *   - updates the payable IN PLACE (same id, same pay_no): a wholly duplicate
 *     payable becomes status 'Reversed' with outstanding 0 (original_amount kept
 *     for the audit trail); a part-duplicate is reduced by the excess.
 * PAID / part-paid duplicates are only LISTED for the Owner — never touched.
 *
 * Dry run by default (prints what it would do, writes nothing):
 *   node scripts/correctMillRiceDuplicatePayables.js
 * Write (after review + backup, see the runbook):
 *   FIX_MILL_RICE_DUPLICATES=1 node scripts/correctMillRiceDuplicatePayables.js
 * Output: counts + payable/batch IDs only.
 * Runbook: docs/runbooks/mill-rice-duplicate-payables.md
 */
const { detect, summarize } = require('./detectMillRiceDuplicatePayables');
const { postRicePurchaseDelta } = require('../src/modules/milling/rawPurchasePayable');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function correctOne(trx, payableId, { userId = null } = {}) {
  const locked = await trx('payables').where({ id: payableId }).forUpdate().first();
  if (!locked) return { skipped: 'gone' };
  const [f] = await detect(trx, { payableId });
  if (!f || f.kind !== 'unpaid') return { skipped: f ? f.kind : 'no_longer_duplicate' };
  const glDelta = r2(Math.min(f.excess, Math.max(0, f.glNet)));
  const j = glDelta > 0.01
    ? await postRicePurchaseDelta(trx, {
      batchNo: f.batchNo, supplierId: f.supplierId, delta: -glDelta, userId,
      refType: 'Rice Purchase Correction',
      description: `Duplicate rice purchase removed — batch ${f.batchNo} milled stock already on the books (MIL-01)`,
    })
    : null;
  const original = r2(locked.original_amount);
  const whole = original - f.excess <= 0.01;
  const note = `MIL-01 correction: duplicate rice purchase of Rs ${f.excess} removed${j ? ` (journal ${j.journal_no || j.id})` : ''}.`;
  await trx('payables').where({ id: payableId }).update(whole
    ? { status: 'Reversed', outstanding: 0,
      notes: `${locked.notes ? `${locked.notes} | ` : ''}${note}`, updated_at: trx.fn.now() }
    : { original_amount: r2(original - f.excess), outstanding: r2(Number(locked.outstanding) - f.excess),
      notes: `${locked.notes ? `${locked.notes} | ` : ''}${note}`, updated_at: trx.fn.now() });
  return { corrected: true, whole, journalId: j?.id || null };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.FIX_MILL_RICE_DUPLICATES === '1';
  const db = require('../src/config/database');
  try {
    const s = summarize(await detect(db));
    log(`${write ? 'WRITE' : 'DRY RUN'} — unpaid duplicates: ${s.unpaid.length}; paid (Owner review): ${s.paid.length}; manual review: ${s.review.length}`);
    for (const f of s.paid) log(`  OWNER REVIEW payable #${f.payableId} batch #${f.batchId} — paid, not corrected`);
    for (const f of s.review) log(`  MANUAL REVIEW payable #${f.payableId} batch #${f.batchId}`);
    let done = 0;
    for (const f of s.unpaid) {
      if (!write) { log(`  would correct payable #${f.payableId} batch #${f.batchId} (journal Dr 2010 / Cr 1210)`); continue; }
      const r = await db.transaction((trx) => correctOne(trx, f.payableId));
      if (r.corrected) { done += 1; log(`  corrected payable #${f.payableId} batch #${f.batchId}${r.whole ? ' (voided)' : ' (reduced)'}${r.journalId ? ` journal #${r.journalId}` : ''}`); }
      else log(`  skipped payable #${f.payableId}: ${r.skipped}`);
    }
    if (write) {
      const after = summarize(await detect(db));
      log(`corrected: ${done}; unpaid duplicates remaining: ${after.unpaid.length}`);
    } else {
      log('Nothing written. Set FIX_MILL_RICE_DUPLICATES=1 to apply (see runbook).');
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctMillRiceDuplicatePayables failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correctOne, main };
