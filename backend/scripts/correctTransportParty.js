/**
 * Correct the transport problems scripts/detectTransportParty.js reports
 * (P3-08 / MIL-12, DAT-20). DRY RUN by default — set FIX_TRANSPORT_PARTY=1
 * to write. Prints counts and IDs only.
 *
 *   1. lost hauler — a batch transport record whose hauler_id a costs-drawer
 *      re-save wiped gets it back from its own payable (the payable kept it).
 *      No money moves.
 *   2. stale batch payable (UNPAID only) — re-runs the same sync the costs
 *      drawer now runs (modules/milling/batchTransport.js): the payable is
 *      moved in place or set Reversed, the Dr 1210 / Cr 2010 accrual moves by
 *      a signed delta per hauler; for a batch already yielded, the 'Milling
 *      Batch' adjustment re-points that freight to 2110 so finished stock is
 *      untouched. Paid ones are listed for Owner review and never touched.
 *   3. legacy supplier transport vendor — ONLY with MAPPING_FILE pointing at a
 *      reviewed JSON { "<supplier id>": <hauler id> }: sets the lot's
 *      hauler_id for lots still on that supplier (transport_vendor_id is kept
 *      as history). No payable or journal is changed — a legacy freight bill
 *      already owed to the supplier stays the supplier's until Finance decides.
 *
 * Runbook: docs/runbooks/transport-party-model.md
 */
const fs = require('fs');
const accountingService = require('../src/modules/accounting/accounting.service');
const { syncBatchTransport, transportAdjustmentParts } = require('../src/modules/milling/batchTransport');
const { detect, staleBatches } = require('./detectTransportParty');

async function postYieldAdjustment(trx, batch, staged) {
  if (Math.abs(staged) <= 0.01) return null;
  const posted = await trx('journal_entries').where({ ref_type: 'Milling Batch', ref_no: batch.batch_no, status: 'Posted' }).first('id');
  if (!posted) return null; // pre-yield: the completion will credit what is staged
  const parts = transportAdjustmentParts(0, staged);
  const accs = await trx('chart_of_accounts').whereIn('code', parts.map((p) => p.code));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a]));
  if (!parts.every((p) => byCode[p.code])) throw new Error(`chart of accounts is missing ${parts.map((p) => p.code).join('/')}`);
  const j = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10), entity: 'mill', refType: 'Milling Batch', refNo: batch.batch_no,
    description: `P3-08 correction: transport re-pointed for ${batch.batch_no}`,
    currency: 'PKR', fxRate: 1, isAuto: true, userId: null,
    lines: parts.map((p) => {
      const acc = byCode[p.code]; const dr = p.amount > 0; const amt = Math.round(Math.abs(p.amount) * 100) / 100;
      return { account_id: acc.id, account: acc.name, debit: dr ? amt : 0, credit: dr ? 0 : amt, narration: `${dr ? 'DR' : 'CR'} ${acc.code} ${acc.name} — P3-08 transport correction` };
    }),
  });
  if (j && j.id) await accountingService.postJournal(trx, j.id);
  return j;
}

async function correctBatch(trx, batchId) {
  // Re-check under the lock: only an unpaid stale payable is corrected.
  const [again] = await staleBatches(trx, { batchId });
  if (!again || again.kind !== 'unpaid') return { skipped: again ? 'paid' : 'no longer stale' };
  const batch = await trx('milling_batches').where({ id: batchId }).forUpdate().first();
  const cost = await trx('milling_costs').where({ batch_id: batchId, category: 'transport' }).whereNull('business_expense_id')
    .sum('amount as s').first();
  const r = await syncBatchTransport(trx, { batch, amount: parseFloat(cost && cost.s) || 0, body: {}, userId: null });
  await postYieldAdjustment(trx, batch, r.staged);
  return { corrected: true };
}

function readMapping(file) {
  if (!file) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = parseInt(k, 10); const h = parseInt(v, 10);
    if (!Number.isInteger(s) || !Number.isInteger(h)) throw new Error(`mapping entry ${k} → ${v} is not a supplier id → hauler id pair`);
    out[s] = h;
  }
  return out;
}

/** The whole correction against `db`; writes only when `write`. */
async function correct(db, { write = false, mapping = null, log = console.log } = {}) {
  const f = await detect(db);
  log(`${write ? 'WRITE' : 'DRY RUN'} — lost hauler: ${f.lostHauler.length}; stale unpaid: ${f.stale.filter((s) => s.kind === 'unpaid').length}; stale paid (Owner review): ${f.stale.filter((s) => s.kind === 'paid').length}; legacy vendor lots: ${f.legacyLots.length}`);

  // 1. Lost hauler.
  for (const id of f.lostHauler) {
    if (!write) { log(`  would restore hauler on transport_costs #${id} from its payable`); continue; }
    await db.transaction(async (trx) => {
      const tc = await trx('transport_costs').where({ id }).forUpdate().first();
      const pay = tc && tc.payable_id ? await trx('payables').where({ id: tc.payable_id }).first('hauler_id') : null;
      if (tc && !tc.hauler_id && pay && pay.hauler_id) {
        await trx('transport_costs').where({ id }).update({ hauler_id: pay.hauler_id, updated_at: trx.fn.now() });
        log(`  restored hauler on transport_costs #${id}`);
      }
    });
  }

  // 2. Stale batch payables — unpaid only.
  for (const s of f.stale) {
    if (s.kind === 'paid') { log(`  OWNER REVIEW batch #${s.batchId} payable #${s.payableId} — paid, not corrected`); continue; }
    if (!write) { log(`  would re-sync batch #${s.batchId} transport (signed-delta journals)`); continue; }
    const r = await db.transaction((trx) => correctBatch(trx, s.batchId));
    log(r.corrected ? `  corrected batch #${s.batchId}` : `  skipped batch #${s.batchId}: ${r.skipped}`);
  }

  // 3. Legacy supplier transport vendors — reviewed mapping only.
  if (f.legacyLots.length && !mapping) log('  legacy vendor lots left as they are (no MAPPING_FILE given).');
  if (mapping) {
    for (const [supplierId, haulerId] of Object.entries(mapping)) {
      const hauler = await db('haulers').where({ id: haulerId }).first('id');
      if (!hauler) { log(`  mapping supplier #${supplierId} → hauler #${haulerId}: hauler not found, skipped`); continue; }
      const lots = await db('inventory_lots').where({ transport_vendor_id: supplierId }).whereNull('hauler_id').pluck('id');
      if (!write) { log(`  would set hauler #${haulerId} on ${lots.length} lot(s) of supplier #${supplierId}`); continue; }
      const n = await db('inventory_lots').whereIn('id', lots).whereNull('hauler_id')
        .update({ hauler_id: haulerId, updated_at: db.fn.now() });
      log(`  set hauler #${haulerId} on ${n} lot(s) of supplier #${supplierId}`);
    }
  }

  if (write) {
    const after = await detect(db);
    log(`remaining — lost hauler: ${after.lostHauler.length}; stale unpaid: ${after.stale.filter((s) => s.kind === 'unpaid').length}; legacy vendor lots: ${after.legacyLots.length}`);
  } else {
    log('Nothing written. Set FIX_TRANSPORT_PARTY=1 to apply (see runbook).');
  }
  return 0;
}

async function main(_argv = process.argv.slice(2), env = process.env, log = console.log) {
  const db = require('../src/config/database');
  try {
    return await correct(db, { write: env.FIX_TRANSPORT_PARTY === '1', mapping: readMapping(env.MAPPING_FILE), log });
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctTransportParty failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, correctBatch, readMapping, main };
