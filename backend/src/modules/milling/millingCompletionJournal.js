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
// Any raw cost not covered by a source lot (truck intake) stays on 1210.
//
// Processing costs (labour, transport, packaging, unloading, other ...) are
// credited to the account they were accrued to (owner decision A3b,
// 2026-10-09) — they never went into 1210, so crediting it drove Raw Rice
// down by every batch's processing (prod M-001..M-006: 381,045.60):
//   - freight owed to a transporter was accrued Dr 1210 / Cr 2010 ('Batch
//     Transport') — that much comes off 1210;
//   - what was already EXPENSED for the batch — bags drawn by its packing
//     runs and store issues (Dr 6000 / Cr 1250), business expenses booked
//     against it (Dr 6000, salaries 6135) — is absorbed into finished stock:
//     Cr that expense account. Capitalised once, never expensed twice
//     (M-002's 42,163.20 of bags sat in 6000 AND 1220);
//   - the rest of the cost sheet was never booked anywhere (labour, unloading,
//     other typed straight onto the sheet): it is a cost incurred and not yet
//     paid — Cr 2110 Accrued Expenses. Pay it against 2110.
//
// The OUTPUTS are debited where the yield lots carry them (A3a): by-product
// lots at their booked value → 1240, the rest → 1220. The split is its own
// journal ('Milling Output Split': Dr 1240 / Cr 1220), kept equal to the
// by-product lots' value by syncOutputSplit — a re-yield or re-price that
// moves value between finished and by-products posts the signed delta.
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
const FINISHED_ACCOUNT = '1220';
const BYPRODUCT_ACCOUNT = '1240';
const ABSORBED_ACCOUNT = '6000';
const ACCRUED_ACCOUNT = '2110';
// Journals that EXPENSE a batch's packaging / store issues under its batch no.
const EXPENSED_REF_TYPES = ['Mill Packing', 'Mill Store Consumption'];
const OUTPUT_SPLIT_REF_TYPE = 'Milling Output Split';
// Journals that accrue a batch's processing cost INTO 1210 before the yield.
const STAGED_REF_TYPES = ['Batch Transport'];

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

/** Net Dr 1210 the batch's accrual journals staged there (transport owed to a hauler). */
async function stagedRawForBatch(trx, batchNo) {
  if (!batchNo) return 0;
  const row = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': RAW_ACCOUNT })
    .whereIn('je.ref_type', STAGED_REF_TYPES)
    .select(trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'))
    .first();
  return Math.max(0, r2(row && row.net));
}

/**
 * Net expense (Dr − Cr on Expense / COGS accounts) already booked for a batch:
 * its packing runs and store issues (under the batch no) and the business
 * expenses booked against it (business_expenses.batch_id, by expense no).
 * Returns [{ code, amount }] with amount > 0, 6000 first.
 */
async function expensedForBatch(trx, batch) {
  if (!batch || !batch.batch_no) return [];
  const sumBy = async (where) => {
    const q = trx('journal_lines as jl')
      .join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where('je.status', 'Posted')
      .whereIn('c.type', ['Expense', 'COGS'])
      .groupBy('c.code')
      .select('c.code', trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'));
    where(q);
    return q;
  };
  const rows = [...await sumBy((q) => q.where('je.ref_no', batch.batch_no).whereIn('je.ref_type', EXPENSED_REF_TYPES))];
  if (batch.id != null) {
    const expNos = await trx('business_expenses').where({ batch_id: batch.id }).pluck('expense_no');
    if (Array.isArray(expNos) && expNos.length) rows.push(...await sumBy((q) => q.whereIn('je.ref_no', expNos)));
  }
  const by = {};
  for (const r of rows || []) by[r.code] = r2((by[r.code] || 0) + Number(r.net || 0));
  return Object.entries(by).filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a === ABSORBED_ACCOUNT ? -1 : b === ABSORBED_ACCOUNT ? 1 : a.localeCompare(b)))
    .map(([code, amount]) => ({ code, amount }));
}

/**
 * Credit lines for the processing part of a capitalisation, in order: what
 * was staged in 1210 (`staged`), what was already expensed (`expensed`,
 * [{code, amount}]), each capped by what is left; the remainder was never
 * booked — Cr 2110 Accrued Expenses. Pure; exported for tests.
 */
function processingCredits(processing, staged, expensed = []) {
  let left = r2(processing);
  if (left <= 0) return [];
  const out = [];
  const take = (code, avail) => {
    const amt = r2(Math.min(left, Math.max(0, r2(avail))));
    if (amt > 0) { out.push({ code, amount: amt }); left = r2(left - amt); }
  };
  take(RAW_ACCOUNT, staged);
  for (const e of expensed || []) take(e.code, e.amount);
  if (left > 0) out.push({ code: ACCRUED_ACCOUNT, amount: left });
  return out;
}

/** Merge [{code, amount}] lines by code (order of first appearance). Pure. */
function mergeCredits(lines) {
  const out = [];
  for (const l of lines) {
    const hit = out.find((x) => x.code === l.code);
    if (hit) hit.amount = r2(hit.amount + l.amount); else out.push({ ...l });
  }
  return out.filter((l) => l.amount > 0);
}

/**
 * Credit lines for a batch's completion: the raw-rice cost split by source
 * lot (1210 / 1220 / 1240), the processing costs by where they were accrued
 * (1210 staged transport → the expense accounts already charged → 2110).
 */
async function completionCredits(trx, batchId, amount, batchNo = null) {
  if (batchId == null) return [{ code: RAW_ACCOUNT, amount: r2(amount) }];
  const rawRow = await trx('milling_costs').where({ batch_id: batchId, category: 'raw_rice' })
    .sum('amount as t').first();
  const rawCost = Math.min(r2(amount), Number(rawRow && rawRow.t) || 0);
  const raw = rawCost > 0 ? splitInputCredits(rawCost, rawCost, await sourceLotValuesByAccount(trx, batchId)) : [];
  const staged = await stagedRawForBatch(trx, batchNo);
  const expensed = await expensedForBatch(trx, { id: batchId, batch_no: batchNo });
  return mergeCredits([...raw, ...processingCredits(r2(amount - rawCost), staged, expensed)]);
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
  const credits = await completionCredits(trx, batch.id, target, batch.batch_no);
  if (credits.some((c) => c.code !== RAW_ACCOUNT)) {
    await postSplitCompletion(trx, accountingService, { batch, target, credits, qty, userId });
    await syncOutputSplit(trx, accountingService, { batch, userId });
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
  await syncOutputSplit(trx, accountingService, { batch, userId });
  return { posted: 'full', amount: target, alreadyPosted: 0, credits };
}

/** Net Dr 1240 the batch's 'Milling Output Split' journals have booked. */
async function bookedOutputSplit(trx, batchNo) {
  const row = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': OUTPUT_SPLIT_REF_TYPE, 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': BYPRODUCT_ACCOUNT })
    .select(trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'))
    .first();
  return r2(row && row.net);
}

/**
 * Keep the GL's by-product output for a batch equal to what its yield lots
 * carry (batchOutputValues): post the signed delta Dr 1240 / Cr 1220 (or the
 * reverse). Only for a company batch whose completion is on the books;
 * idempotent — a second call with nothing changed posts nothing. `date`
 * dates the journal (default today). Returns { target, booked, delta }.
 */
async function syncOutputSplit(trx, accountingService, { batch, userId = null, date = null }) {
  if (!batch || batch.is_service_milling || !batch.batch_no) return null;
  if (!(await hasPostedCompletion(trx, batch.batch_no))) return null;
  const { batchOutputValues } = require('./batchOutputValues');
  const v = (await batchOutputValues(trx, [batch.id])).get(Number(batch.id));
  const target = r2(v ? v.byproductValue : 0);
  const booked = await bookedOutputSplit(trx, batch.batch_no);
  const delta = r2(target - booked);
  if (Math.abs(delta) < 0.01) return { target, booked, delta: 0 };
  const [fin, byp] = await Promise.all([
    trx('chart_of_accounts').where({ code: FINISHED_ACCOUNT }).first(),
    trx('chart_of_accounts').where({ code: BYPRODUCT_ACCOUNT }).first(),
  ]);
  if (!fin || !byp) throw new Error(`Chart of accounts has no ${FINISHED_ACCOUNT} / ${BYPRODUCT_ACCOUNT} for the output split of ${batch.batch_no}.`);
  const amt = Math.abs(delta);
  const up = delta > 0;
  const dr = up ? byp : fin;
  const cr = up ? fin : byp;
  const j = await accountingService.createJournal(trx, {
    date: date || new Date().toISOString().slice(0, 10), entity: 'mill',
    refType: OUTPUT_SPLIT_REF_TYPE, refNo: batch.batch_no,
    description: `By-product output ${up ? 'to' : 'back from'} 1240 — batch ${batch.batch_no} (lots carry ${target.toLocaleString()})`,
    currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
    lines: [
      { account_id: dr.id, account: dr.name, debit: amt, credit: 0, narration: `DR ${dr.code} ${dr.name} — by-product output ${batch.batch_no}` },
      { account_id: cr.id, account: cr.name, debit: 0, credit: amt, narration: `CR ${cr.code} ${cr.name} — by-product output ${batch.batch_no}` },
    ],
  });
  if (j && j.id) await accountingService.postJournal(trx, j.id);
  return { target, booked, delta };
}

/**
 * A processing cost that changed AFTER the batch's completion (a packing run
 * after the yield, store consumption, a business expense booked against the
 * batch): capitalise the signed delta into finished stock — Dr 1220 /
 * Cr `counterCode` (the account the cost was charged to: 6000 by default),
 * reversed for a cut. Posts nothing before the completion (the completion
 * capitalises the whole sheet).
 */
async function postProcessingDelta(trx, accountingService, { batch, delta, label, userId = null, counterCode = ABSORBED_ACCOUNT }) {
  const d = r2(delta);
  if (!batch || batch.is_service_milling || Math.abs(d) < 0.01) return null;
  if (!(await hasPostedCompletion(trx, batch.batch_no))) return null;
  const [fin, counter] = await Promise.all([
    trx('chart_of_accounts').where({ code: FINISHED_ACCOUNT }).first(),
    trx('chart_of_accounts').where({ code: counterCode }).first(),
  ]);
  if (!fin || !counter) return null;
  const amt = Math.abs(d);
  const up = d > 0;
  const j = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10), entity: 'mill',
    refType: MILLING_REF_TYPE, refNo: batch.batch_no,
    description: `Cost adjustment Rs ${Math.round(amt).toLocaleString()} for ${batch.batch_no} ${label}${up ? '' : ' (reduced)'}`,
    currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
    lines: [
      { account_id: fin.id, account: fin.name, debit: up ? amt : 0, credit: up ? 0 : amt, narration: `${up ? 'DR' : 'CR'} ${fin.code} ${fin.name} — cost adj ${batch.batch_no} ${label}` },
      { account_id: counter.id, account: counter.name, debit: up ? 0 : amt, credit: up ? amt : 0, narration: `${up ? 'CR' : 'DR'} ${counter.code} ${counter.name} — cost adj ${batch.batch_no} ${label}` },
    ],
  });
  if (j && j.id) await accountingService.postJournal(trx, j.id);
  return j;
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
  processingCredits, mergeCredits, stagedRawForBatch, expensedForBatch, syncOutputSplit, bookedOutputSplit,
  postProcessingDelta, OUTPUT_SPLIT_REF_TYPE, ABSORBED_ACCOUNT, ACCRUED_ACCOUNT, STAGED_REF_TYPES, EXPENSED_REF_TYPES,
};
