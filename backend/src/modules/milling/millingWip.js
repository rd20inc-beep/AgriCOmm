// Milling work-in-progress in the GL (P3-09 / owner decision D-6 (a), 2026-10-15).
//
// Rice committed to a milling batch is no longer stock that can be sold — the
// lots hold it for the batch (milling_reserved_qty) — but the GL used to carry
// it in 1210 Raw Rice (or 1220 / 1240 for a re-mill) until the yield, with no
// WIP account. Now:
//
//   commit / receive onto a batch   Dr 1260 Milling WIP / Cr the lot's account
//   cancel / reject / delete        the reverse (signed delta back to zero)
//   yield (completion journal)      Cr 1260 for everything the batch moved in
//
// One function keeps the batch's WIP equal to what it has committed:
// syncBatchWip compares the batch's committed rice (stockValue
// .millingCommitments — the SAME rows the stock valuation and the GL tie-out
// read, at landed cost × KG, D-14) with what its 'Milling WIP' journals have
// moved, per source account, and posts the signed difference. It is
// idempotent, so every place that changes a commitment (commit, truck receipt,
// a vehicle edit, a lot re-price, cancel) just calls it. Never reverse+repost:
// the GL is Posted-only. A posting failure throws — the caller's transaction
// (the commitment itself) rolls back with it.
//
// Once a batch has yielded its WIP belongs to the completion journal
// (millingCompletionJournal.applyWipToCredits relieves all of it), so the sync
// does nothing for a yielded batch.

const { millingCommitments, WIP_ACCOUNT } = require('../inventory/stockValue');

const WIP_REF_TYPE = 'Milling WIP';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Net value the batch's 'Milling WIP' journals moved into WIP, per source account. */
async function wipBookedByAccount(trx, batchNo) {
  const out = {};
  if (!batchNo) return out;
  const rows = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': WIP_REF_TYPE, 'je.ref_no': batchNo, 'je.status': 'Posted' })
    .groupBy('c.code')
    .select('c.code', trx.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS moved'));
  for (const r of rows || []) {
    if (r.code === WIP_ACCOUNT) continue;
    const v = r2(r.moved);
    if (Math.abs(v) >= 0.01) out[r.code] = v;
  }
  return out;
}

/** What the batch should carry in WIP now, per source account ({} for a closed batch). */
async function wipTargetByAccount(trx, batchId) {
  const out = {};
  for (const c of await millingCommitments(trx, { batchId })) {
    out[c.account] = r2((out[c.account] || 0) + c.value);
  }
  return out;
}

/**
 * Bring a batch's WIP to what it has committed (to zero with `release`). Returns
 * { posted: bool, target, booked, deltas } or null when nothing applies
 * (service batch, yielded batch, unknown batch).
 */
async function syncBatchWip(trx, batchId, { userId = null, reason = null, release = false } = {}) {
  const batch = await trx('milling_batches').where({ id: batchId }).first();
  if (!batch || batch.is_service_milling || !batch.batch_no) return null;
  const { batchYielded } = require('./costEditLocks');
  if (await batchYielded(trx, batch)) return null;

  // release: the batch is being deleted — everything goes back, whatever it
  // still commits on paper.
  const target = release ? {} : await wipTargetByAccount(trx, batch.id);
  const booked = await wipBookedByAccount(trx, batch.batch_no);
  const deltas = {};
  for (const code of new Set([...Object.keys(target), ...Object.keys(booked)])) {
    const d = r2((target[code] || 0) - (booked[code] || 0));
    if (Math.abs(d) >= 0.01) deltas[code] = d;
  }
  const codes = Object.keys(deltas).sort();
  if (!codes.length) return { posted: false, target, booked, deltas };

  const accs = await trx('chart_of_accounts').whereIn('code', [...codes, WIP_ACCOUNT]);
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a]));
  const missing = [...codes, WIP_ACCOUNT].filter((c) => !byCode[c]);
  if (missing.length) {
    const e = new Error(`Chart of accounts is missing ${missing.join(' / ')} — cannot move batch ${batch.batch_no}'s rice into Milling WIP.`);
    e.status = 500; e.statusCode = 500; throw e;
  }
  const label = reason || 'committed rice';
  const lines = [];
  let net = 0;
  for (const code of codes) {
    const d = deltas[code];
    const acc = byCode[code];
    net = r2(net + d);
    // + : rice leaves its stock account for WIP (Cr stock); − : it comes back.
    lines.push({
      account_id: acc.id, account: acc.name, debit: d < 0 ? -d : 0, credit: d > 0 ? d : 0,
      narration: `${d > 0 ? 'CR' : 'DR'} ${acc.code} ${acc.name} — ${label}, batch ${batch.batch_no}`,
    });
  }
  if (Math.abs(net) >= 0.01) {
    const wip = byCode[WIP_ACCOUNT];
    lines.unshift({
      account_id: wip.id, account: wip.name, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0,
      narration: `${net > 0 ? 'DR' : 'CR'} ${wip.code} ${wip.name} — ${label}, batch ${batch.batch_no}`,
    });
  }
  const accountingService = require('../accounting/accounting.service');
  const j = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10), entity: 'mill',
    refType: WIP_REF_TYPE, refNo: batch.batch_no,
    description: `Milling WIP ${net >= 0 ? '+' : '-'}Rs ${Math.abs(net).toLocaleString('en-US')} — ${label}, batch ${batch.batch_no}`,
    currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null, lines,
  });
  if (j && j.id) await accountingService.postJournal(trx, j.id);
  return { posted: true, target, booked, deltas, journalId: j && j.id };
}

/**
 * Fold the batch's WIP into its completion credits. `credits` are the
 * [{ code, amount }] the completion would take from each input account; the
 * part of each that the batch already moved into WIP comes off WIP instead.
 * An account can end negative (WIP held more than the completion consumes
 * from it — e.g. a source lot re-priced after commitment): that line becomes a
 * debit, returning the excess to its account. Totals are unchanged, and the
 * batch's WIP nets to zero. Pure; exported for tests.
 */
function applyWipToCredits(credits, wipByAccount) {
  const out = (credits || []).map((c) => ({ ...c }));
  let wipTotal = 0;
  for (const [code, v] of Object.entries(wipByAccount || {})) {
    const amt = r2(v);
    if (Math.abs(amt) < 0.01) continue;
    wipTotal = r2(wipTotal + amt);
    const hit = out.find((c) => c.code === code);
    if (hit) hit.amount = r2(hit.amount - amt); else out.push({ code, amount: r2(-amt) });
  }
  const res = out.filter((c) => Math.abs(c.amount) >= 0.01);
  if (Math.abs(wipTotal) >= 0.01) res.unshift({ code: WIP_ACCOUNT, amount: wipTotal });
  return res;
}

/**
 * After any change to what a batch holds — a truck received / edited / removed,
 * a source lot re-priced, the batch cancelled or rejected: first the truck
 * purchase (Dr 1210 / Cr 2010, truckIntakePurchase), then the move into WIP
 * (Dr 1260 / Cr 1210), so the purchase lands in 1210 and passes through it.
 */
async function syncBatchIntake(trx, batchId, opts = {}) {
  const { syncTruckIntakePurchase } = require('./truckIntakePurchase');
  const purchase = await syncTruckIntakePurchase(trx, batchId, { userId: opts.userId || null });
  const wip = await syncBatchWip(trx, batchId, opts);
  return { purchase, wip };
}

/** The batch's whole WIP balance in the GL, every journal under its batch no (detection). */
async function wipBalance(q, batchNo) {
  const row = await q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': WIP_ACCOUNT })
    .select(q.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS bal'))
    .first();
  return r2(row && row.bal);
}

module.exports = {
  WIP_ACCOUNT, WIP_REF_TYPE,
  syncBatchWip, syncBatchIntake, wipBookedByAccount, wipTargetByAccount, applyWipToCredits, wipBalance,
};
