/**
 * READ-ONLY: transport-cost and transporter-party problems left by the old code
 * (P3-08 / MIL-12, DAT-20; owner decision D-25b (a): transporters are
 * `haulers`, one row each).
 *
 *   duplicate haulers    active haulers sharing a name (case / spacing
 *                        ignored) or a phone number (digits only). Mig 393 left
 *                        the later rows out of the unique indexes; they must be
 *                        resolved by a person (deactivate or rename) — parties
 *                        are never merged automatically.
 *   index exclusions     whether uq_haulers_active_* still carry an
 *                        "id NOT IN (…)" list (→ scripts/validateHaulerUnique.js
 *                        once the duplicates are gone).
 *   legacy vendor lots   lots whose freight party is the old supplier-based
 *                        transport_vendor_id with no hauler_id. Needs a REVIEWED
 *                        supplier → hauler mapping (correctTransportParty.js,
 *                        MAPPING_FILE) — never guessed.
 *   lost hauler          batch transport records whose hauler_id was wiped by a
 *                        costs-drawer re-save while the payable kept it.
 *   stale batch payable  a batch's transporter payable / Dr 1210 Cr 2010 accrual
 *                        that no longer matches the cost line (transport lowered
 *                        to 0 or the payer switched never voided it). Split into
 *                        unpaid (correctable) and paid (Owner review only).
 *
 * Output: counts + IDs only — no names, no amounts.
 *   node scripts/detectTransportParty.js
 * Runbook: docs/runbooks/transport-party-model.md
 */
const { accruedByHauler } = require('../src/modules/milling/batchTransport');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const NAME_EXPR = 'lower(btrim(name))';
const PHONE_EXPR = "regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')";

async function duplicateGroups(q, expr, extraWhere = '') {
  const r = await q.raw(`
    SELECT array_agg(id ORDER BY id) AS ids FROM haulers
    WHERE is_active ${extraWhere}
    GROUP BY ${expr} HAVING count(*) > 1 ORDER BY min(id)`);
  return r.rows.map((row) => row.ids.map(Number));
}

async function indexExclusions(q) {
  const r = await q.raw("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'haulers' AND indexname LIKE 'uq_haulers_active_%'");
  return r.rows.map((row) => ({ name: row.indexname, excludes: /NOT IN|<> ALL/i.test(row.indexdef) }));
}

/** What the batch's transport line says is owed to a transporter now. */
async function batchTarget(q, batchId) {
  const tc = await q('transport_costs').where({ batch_id: batchId }).whereNull('lot_id').first();
  const cost = await q('milling_costs').where({ batch_id: batchId, category: 'transport' }).whereNull('business_expense_id')
    .sum('amount as s').first();
  const amount = r2(cost && cost.s);
  const pay = await q('payables').where({ source_table: 'batch_transport', source_id: batchId }).first();
  const haulerId = (tc && tc.hauler_id) || (pay && pay.hauler_id) || null;
  const paidBy = (tc && tc.paid_by) || 'company';
  const owed = paidBy === 'company' && haulerId && amount > 0 ? amount : 0;
  return { tc, pay, amount, haulerId, paidBy, owed };
}

/** Stale batch transporter payables / accruals. `batchId` narrows to one batch. */
async function staleBatches(q, { batchId = null } = {}) {
  let query = q('payables').where({ source_table: 'batch_transport' });
  if (batchId != null) query = query.where({ source_id: batchId });
  const pays = await query.select('source_id');
  const ids = [...new Set(pays.map((p) => p.source_id))];
  const out = [];
  for (const id of ids) {
    const batch = await q('milling_batches').where({ id }).first('id', 'batch_no');
    if (!batch) continue;
    const t = await batchTarget(q, id);
    const accrued = await accruedByHauler(q, batch.batch_no);
    const accruedTotal = r2(Object.values(accrued).reduce((s, v) => s + v, 0));
    const live = t.pay && !['Reversed', 'Written Off'].includes(t.pay.status);
    const payFigure = live ? r2(t.pay.original_amount) : 0;
    const wrongHauler = live && t.owed > 0 && String(t.pay.hauler_id || '') !== String(t.haulerId || '');
    const accrualOff = Object.keys(accrued).some((h) => h !== String(t.haulerId || '') && Math.abs(accrued[h]) > 0.01)
      || Math.abs(accruedTotal - t.owed) > 0.01;
    if (Math.abs(payFigure - t.owed) <= 0.01 && !wrongHauler && !accrualOff) continue;
    const paid = r2(t.pay && t.pay.paid_amount);
    out.push({ batchId: id, payableId: t.pay ? t.pay.id : null, kind: paid > 0.01 ? 'paid' : 'unpaid' });
  }
  return out;
}

async function detect(q) {
  const dupName = await duplicateGroups(q, NAME_EXPR);
  const dupPhone = await duplicateGroups(q, PHONE_EXPR, `AND ${PHONE_EXPR} <> ''`);
  const legacyLots = await q('inventory_lots').whereNotNull('transport_vendor_id').whereNull('hauler_id').pluck('id');
  const lostHauler = await q('transport_costs as tc')
    .join('payables as p', 'p.id', 'tc.payable_id')
    .whereNull('tc.hauler_id').whereNotNull('p.hauler_id').whereNull('tc.lot_id')
    .pluck('tc.id');
  const stale = await staleBatches(q);
  return { dupName, dupPhone, indexes: await indexExclusions(q), legacyLots, lostHauler, stale };
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const f = await detect(db);
    log(`duplicate active haulers by name: ${f.dupName.length} group(s)`);
    for (const g of f.dupName) log(`  hauler ids ${g.join(', ')}`);
    log(`duplicate active haulers by phone: ${f.dupPhone.length} group(s)`);
    for (const g of f.dupPhone) log(`  hauler ids ${g.join(', ')}`);
    for (const i of f.indexes) log(`index ${i.name}: ${i.excludes ? 'still excludes earlier duplicates' : 'covers every active hauler'}`);
    log(`lots on the legacy supplier transport vendor (no hauler): ${f.legacyLots.length}`);
    if (f.legacyLots.length) log(`  lot ids ${f.legacyLots.join(', ')}`);
    log(`batch transport records that lost their hauler: ${f.lostHauler.length}`);
    if (f.lostHauler.length) log(`  transport_costs ids ${f.lostHauler.join(', ')}`);
    const unpaid = f.stale.filter((s) => s.kind === 'unpaid');
    const paid = f.stale.filter((s) => s.kind === 'paid');
    log(`stale batch transporter payables — unpaid (correctable): ${unpaid.length}`);
    for (const s of unpaid) log(`  batch #${s.batchId} payable #${s.payableId || '—'}`);
    log(`stale batch transporter payables — paid (Owner review, NOT auto-corrected): ${paid.length}`);
    for (const s of paid) log(`  batch #${s.batchId} payable #${s.payableId || '—'}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectTransportParty failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, staleBatches, batchTarget, duplicateGroups, indexExclusions, NAME_EXPR, PHONE_EXPR, main };
