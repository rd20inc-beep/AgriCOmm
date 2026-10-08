// The milling_completion journal — DR 1220 Finished Rice for the batch's
// capitalised cost, credited to the accounts the inputs were carried in —
// posted ONCE per batch.
//
// Inputs leave their OWN inventory account. A batch that re-mills or blends
// finished rice (or by-products) consumes stock carried in 1220 / 1240, not raw
// rice; crediting 1210 for it drove 1210 down and left 1220 overstated by the
// value of every finished input (prod M-001..M-006). The raw-rice part of the
// cost sheet is split by the batch's source lots (batch_source_lots — the same
// per-lot cost_total_pkr the raw_rice cost sheet row was built from):
//   raw lot → 1210 · finished lot → 1220 (1230 export) · by-product → 1240.
// Processing costs (labour, transport, packaging, ...) and any raw cost not
// covered by a source lot (truck intake) stay on 1210 as before.
//
// Every Posted journal a batch writes under ref_type 'Milling Batch' moves value
// into 1220: the completion itself and each later cost-sheet edit (addCost
// posts the signed delta). So the net DR 1220 over those journals is what the
// GL has moved into finished rice for the batch (finished inputs net out).
// A completion that runs again (M-004 on prod: a re-yield of all zeros retired
// the output lot, the next save took the first-yield path and posted the full
// Rs 5,206,175.25 a second time) must post nothing once the batch already has
// its completion on the books.

const MILLING_REF_TYPE = 'Milling Batch';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const { inventoryAccountForLot } = require('../localSales/inventoryAccount');

const RAW_ACCOUNT = '1210';

/**
 * Value of the batch's source lots by the inventory account each was carried
 * in: { '1210': x, '1220': y, '1240': z }. A lot's value is the cost snapshot
 * the cost sheet used (cost_total_pkr; qty × unit cost as a fallback).
 */
async function sourceLotValuesByAccount(trx, batchId) {
  const out = {};
  if (batchId == null) return out;
  const rows = await trx('batch_source_lots as bsl')
    .leftJoin('inventory_lots as il', 'il.id', 'bsl.lot_id')
    .where('bsl.batch_id', batchId)
    .select('bsl.qty_kg', 'bsl.unit_cost_pkr', 'bsl.cost_total_pkr', 'bsl.lot_type',
      'il.type', 'il.entity', 'il.landed_cost_per_kg');
  for (const r of rows || []) {
    const qty = Number(r.qty_kg) || 0;
    const value = r.cost_total_pkr != null && Number(r.cost_total_pkr) > 0
      ? Number(r.cost_total_pkr)
      : qty * (Number(r.unit_cost_pkr) || Number(r.landed_cost_per_kg) || 0);
    if (!(value > 0)) continue;
    const code = inventoryAccountForLot({ type: r.type || r.lot_type, entity: r.entity });
    out[code] = r2((out[code] || 0) + value);
  }
  return out;
}

/**
 * Split `amount` (the cost being capitalised) into credit lines by input
 * account. Only the raw-rice part (`rawCost`) is matched against source lots;
 * the non-raw source-lot value can never exceed it (scaled down if it would).
 * Everything else — processing costs and raw cost no lot accounts for — stays
 * on 1210. Returns [{ code, amount }] summing exactly to `amount`.
 */
function splitInputCredits(amount, rawCost, valuesByAccount) {
  const total = r2(amount);
  const nonRaw = Object.entries(valuesByAccount || {}).filter(([c, v]) => c !== RAW_ACCOUNT && v > 0);
  const nonRawSum = nonRaw.reduce((s, [, v]) => s + v, 0);
  const cap = Math.max(0, Math.min(r2(rawCost), total));
  const scale = nonRawSum > cap && nonRawSum > 0 ? cap / nonRawSum : 1;
  const lines = [];
  let assigned = 0;
  for (const [code, v] of nonRaw.sort(([a], [b]) => a.localeCompare(b))) {
    const amt = r2(v * scale);
    if (amt <= 0) continue;
    lines.push({ code, amount: amt });
    assigned = r2(assigned + amt);
  }
  const rest = r2(total - assigned);
  if (rest > 0) lines.unshift({ code: RAW_ACCOUNT, amount: rest });
  return lines;
}

/**
 * Split `amount` across the input accounts in proportion to the source-lot
 * values (a post-yield change to the raw-rice cost of a batch that consumed
 * lots from several accounts). No source lots → all 1210. Exact to the paisa:
 * the last account takes the rounding.
 */
function proportionalInputSplit(amount, valuesByAccount) {
  const total = r2(amount);
  const entries = Object.entries(valuesByAccount || {}).filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || sum <= 0) return [{ code: RAW_ACCOUNT, amount: total }];
  const out = [];
  let assigned = 0;
  entries.forEach(([code, v], i) => {
    const amt = i === entries.length - 1 ? r2(total - assigned) : r2(total * (v / sum));
    assigned = r2(assigned + amt);
    if (amt !== 0) out.push({ code, amount: amt });
  });
  return out;
}

/** Credit lines for a batch: reads its raw_rice cost and source lots. */
async function completionCredits(trx, batchId, amount) {
  if (batchId == null) return [{ code: RAW_ACCOUNT, amount: r2(amount) }];
  const rawRow = await trx('milling_costs').where({ batch_id: batchId, category: 'raw_rice' })
    .sum('amount as t').first();
  const rawCost = Number(rawRow && rawRow.t) || 0;
  return splitInputCredits(amount, rawCost, await sourceLotValuesByAccount(trx, batchId));
}

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
  const credits = await completionCredits(trx, batch.id, target);
  if (credits.some((c) => c.code !== RAW_ACCOUNT)) {
    await postSplitCompletion(trx, accountingService, { batch, target, credits, qty, userId });
    return { posted: 'full', amount: target, alreadyPosted: 0, credits };
  }
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
  return { posted: 'full', amount: target, alreadyPosted: 0, credits };
}

// The completion with inputs from more than one account: one journal, DR the
// rule's debit (1220) for the whole amount, CR each input account. A finished
// input shows as CR 1220 against the DR 1220 (gross, so the consumption is on
// the journal and a pure re-mill still has a completion on the books).
async function postSplitCompletion(trx, accountingService, { batch, target, credits, qty, userId }) {
  const rule = await trx('posting_rules')
    .where({ trigger_event: 'milling_completion', is_active: true })
    .where((qb) => qb.where({ entity: 'mill' }).orWhereNull('entity'))
    .first();
  if (!rule) return null;
  const debitAcc = await trx('chart_of_accounts').where({ id: rule.debit_account_id }).first();
  const accs = await trx('chart_of_accounts').whereIn('code', credits.map((c) => c.code));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a]));
  const description = `Milling completed for batch ${batch.batch_no} — ${qty}`;
  const lines = [{
    account_id: debitAcc.id, account: debitAcc.name, debit: target, credit: 0,
    narration: `DR ${debitAcc.code} ${debitAcc.name} — ${description}`,
  }];
  for (const c of credits) {
    const acc = byCode[c.code];
    if (!acc) throw new Error(`Chart of accounts has no ${c.code} for the milling completion of ${batch.batch_no}.`);
    lines.push({
      account_id: acc.id, account: acc.name, debit: 0, credit: c.amount,
      narration: `CR ${acc.code} ${acc.name} — inputs consumed, batch ${batch.batch_no}`,
    });
  }
  const journal = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10), entity: 'mill',
    refType: MILLING_REF_TYPE, refNo: batch.batch_no, description,
    currency: 'PKR', fxRate: 1, isAuto: true, postingRuleId: rule.id, userId: userId || null,
    lines,
  });
  if (journal && journal.id) await accountingService.postJournal(trx, journal.id);
  return journal;
}

/** True once a batch has a Posted completion on the books (its yield was taken). */
async function hasPostedCompletion(q, batchNo) {
  const row = await q('journal_entries')
    .where({ ref_type: MILLING_REF_TYPE, ref_no: batchNo, status: 'Posted' })
    .first('id');
  return !!row;
}

module.exports = {
  postMillingCompletion, postedMillingTransfer, hasPostedCompletion, MILLING_REF_TYPE,
  sourceLotValuesByAccount, splitInputCredits, completionCredits, proportionalInputSplit,
};
