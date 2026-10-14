/**
 * READ-ONLY: find MILL-RICE-<batch> supplier payables that bought rice already
 * on the books (P2-06 / MIL-01).
 *
 * Before the fix, a yield booked a batch-level raw-rice payable (Dr 1210 /
 * Cr 2010) whenever the batch was not a blend, had a supplier, and no source lot
 * had a lot-level purchase payable. Re-milling a FINISHED lot, or milling an
 * OPENING-STOCK lot, passed that test — so the supplier was owed twice and 1210
 * kept a phantom balance.
 *
 * For every live payable with source_table 'milling_raw_rice' this compares the
 * amount booked with what the corrected rule (rawPurchaseToBook) would book now:
 *   excess = original_amount − expected        (> 0.01 → a duplicate)
 * Only batches WITH source lots (or blends) are judged: a truck-intake batch's
 * payable is the real purchase (a later price edit is P2-08, not a duplicate).
 *
 * Each finding is classified:
 *   unpaid   paid_amount = 0 and the excess fits in outstanding → correctable
 *            (scripts/correctMillRiceDuplicatePayables.js)
 *   paid     money already went out against it → Owner review ONLY; never
 *            auto-corrected (a refund / supplier credit is a business decision)
 *   review   the rule itself refused (unbilled lot of another supplier) → manual
 *
 * Output: counts + payable/batch IDs only — no supplier names, no amounts.
 *   node scripts/detectMillRiceDuplicatePayables.js
 * Runbook: docs/runbooks/mill-rice-duplicate-payables.md
 */
const { rawPurchaseToBook, MILL_RICE_SOURCE } = require('../src/modules/milling/rawPurchasePayable');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PURCHASE_REF_TYPES = ['Rice Purchase', 'Rice Purchase Correction', 'Rice Purchase Adjustment'];

/** Net Cr 2010 the batch's Posted rice-purchase journals booked (signed deltas included). */
async function postedPurchaseNet(q, batchNo) {
  const row = await q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': '2010' })
    .whereIn('je.ref_type', PURCHASE_REF_TYPES)
    .select(q.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS n'))
    .first();
  return r2(row?.n);
}

/**
 * One finding per suspicious payable. `q` is a knex instance or transaction;
 * `payableId` narrows to one row (the correction script re-checks under lock).
 */
async function detect(q, { payableId = null } = {}) {
  let query = q('payables').where({ source_table: MILL_RICE_SOURCE }).whereNot('status', 'Reversed');
  if (payableId != null) query = query.where({ id: payableId });
  const payables = await query.orderBy('id');
  const findings = [];
  for (const p of payables) {
    const batch = await q('milling_batches').where({ id: p.source_id }).first();
    if (!batch) continue;
    const hasSources = !!(await q('batch_source_lots').where({ batch_id: batch.id }).first('id'));
    if (!hasSources && batch.processing_type !== 'blended') continue; // truck intake: real purchase
    let expected; let kind = null;
    try {
      // Judge against the batch's supplier as booked, whatever the row says now.
      expected = (await rawPurchaseToBook(q, { ...batch, supplier_id: batch.supplier_id || p.supplier_id })).amount;
    } catch (e) {
      if (e.status !== 409) throw e;
      kind = 'review';
      expected = null;
    }
    const original = r2(p.original_amount);
    const excess = expected == null ? null : r2(original - expected);
    if (kind !== 'review' && !(excess > 0.01)) continue;
    const paid = r2(p.paid_amount);
    const outstanding = r2(p.outstanding);
    if (!kind) kind = (paid <= 0.01 && outstanding + 0.01 >= excess) ? 'unpaid' : 'paid';
    findings.push({
      kind,
      payableId: p.id,
      payNo: p.pay_no,
      batchId: batch.id,
      batchNo: batch.batch_no,
      supplierId: p.supplier_id,
      excess,
      glNet: await postedPurchaseNet(q, batch.batch_no),
    });
  }
  return findings;
}

function summarize(findings) {
  const by = (k) => findings.filter((f) => f.kind === k);
  return { unpaid: by('unpaid'), paid: by('paid'), review: by('review') };
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const live = await db('payables').where({ source_table: MILL_RICE_SOURCE }).whereNot('status', 'Reversed').count('id as n').first();
    const s = summarize(await detect(db));
    log(`MILL-RICE payables scanned: ${live.n}`);
    log(`duplicates — unpaid (correctable): ${s.unpaid.length}`);
    for (const f of s.unpaid) log(`  payable #${f.payableId} batch #${f.batchId}`);
    log(`duplicates — paid/part-paid (Owner review, NOT auto-corrected): ${s.paid.length}`);
    for (const f of s.paid) log(`  payable #${f.payableId} batch #${f.batchId}`);
    log(`needs manual review (unbilled source lot of another supplier): ${s.review.length}`);
    for (const f of s.review) log(`  payable #${f.payableId} batch #${f.batchId}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectMillRiceDuplicatePayables failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, summarize, postedPurchaseNet, PURCHASE_REF_TYPES, main };
