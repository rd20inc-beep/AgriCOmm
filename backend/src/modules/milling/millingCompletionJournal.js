// The milling_completion journal — DR 1220 Finished Rice / CR 1210 Raw Rice for
// the batch's capitalised cost — posted ONCE per batch.
//
// Every Posted journal a batch writes under ref_type 'Milling Batch' moves value
// between the same two accounts: the completion itself and each later
// cost-sheet edit (addCost posts the signed delta). So the net DR 1220 over
// those journals is exactly what the GL has already capitalised for the batch.
// A completion that runs again (M-004 on prod: a re-yield of all zeros retired
// the output lot, the next save took the first-yield path and posted the full
// Rs 5,206,175.25 a second time) must post nothing once the batch already has
// its completion on the books.

const MILLING_REF_TYPE = 'Milling Batch';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Net DR 1220 already posted for this batch across its Posted 'Milling Batch'
 * journals (completion + cost adjustments, reductions included).
 */
async function postedMillingTransfer(trx, batchNo) {
  const row = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': MILLING_REF_TYPE, 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': '1220' })
    .select(trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'))
    .first();
  return r2(row && row.net);
}

/**
 * Post the completion journal for a batch, idempotently.
 *   - nothing posted yet  → the full amount through the milling_completion rule
 *   - already posted      → nothing
 * Returns { posted: 'full' | 'none', amount, alreadyPosted }.
 */
async function postMillingCompletion(trx, accountingService, { batch, amount, finishedKg, userId }) {
  const target = r2(amount);
  // Already on the books → post nothing. Later cost-sheet edits reach the GL
  // through addCost's signed deltas and packing material through the Mill
  // Packing journal, so the batch's net Dr 1220 is NOT expected to equal its
  // cost sheet; topping it up here would double-count those.
  if (await hasPostedCompletion(trx, batch.batch_no)) {
    return { posted: 'none', amount: 0, alreadyPosted: await postedMillingTransfer(trx, batch.batch_no) };
  }
  if (target <= 0) return { posted: 'none', amount: 0, alreadyPosted: 0 };
  const qty = `${Number(finishedKg || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} kg finished`;
  await accountingService.autoPost(trx, {
    triggerEvent: 'milling_completion',
    entity: 'mill',
    amount: target,
    currency: 'PKR',
    refType: MILLING_REF_TYPE,
    refNo: batch.batch_no,
    description: `Milling completed for batch ${batch.batch_no} — ${qty}`,
    userId,
  });
  return { posted: 'full', amount: target, alreadyPosted: 0 };
}

/** True once a batch has a Posted completion on the books (its yield was taken). */
async function hasPostedCompletion(q, batchNo) {
  const row = await q('journal_entries')
    .where({ ref_type: MILLING_REF_TYPE, ref_no: batchNo, status: 'Posted' })
    .first('id');
  return !!row;
}

module.exports = { postMillingCompletion, postedMillingTransfer, hasPostedCompletion, MILLING_REF_TYPE };
