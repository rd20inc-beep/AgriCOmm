/**
 * One-off backfill — reconcile lot_transactions against inventory_lots.qty
 * so the Stock Adjustments → Run Reconciliation report comes back clean.
 *
 * Root cause: the May-18 backfillBrokenGradeLots.js split aggregate
 * "Broken Rice" lots into per-grade lots (B1/B2/B3/CSR/Short Grain). It
 * updated inventory_lots.qty for each new lot but never wrote matching
 * lot_transactions rows — so the ledger (sum of lot_transactions) and
 * the system (inventory_lots.qty) drifted apart on the affected lots.
 *
 * Strategy: for every lot where ledger != system within 1 KG tolerance,
 * insert a single corrective transaction equal to the diff. We don't
 * try to unwind the original aggregate transaction (that would be
 * surgical and risky) — instead we record a clean reconciliation entry
 * with a clear narrative so the audit trail is intact.
 *
 * Idempotent: skips lots whose ledger already matches system.
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/backfillLotReconciliation.js
 */
require('dotenv').config();
const db = require('../src/config/database');

async function generateTxnNo() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const last = await db('lot_transactions')
    .where('transaction_no', 'like', `TXN-${today}-%`)
    .orderBy('id', 'desc')
    .first('transaction_no');
  const next = last
    ? (parseInt(String(last.transaction_no).split('-').pop(), 10) || 0) + 1
    : 1;
  return `TXN-${today}-${String(next).padStart(4, '0')}`;
}

async function main() {
  const lots = await db('inventory_lots').where('qty', '>', 0).select('id', 'lot_no', 'qty', 'item_name', 'type', 'warehouse_id');

  const candidates = [];
  for (const lot of lots) {
    const txnSum = await db('lot_transactions')
      .where('lot_id', lot.id)
      .sum('quantity_kg as total_kg')
      .first();
    const ledgerKg = parseFloat(txnSum?.total_kg) || 0;
    const systemKg = (parseFloat(lot.qty) || 0) * 1000;
    const diffKg = systemKg - ledgerKg;
    if (Math.abs(diffKg) >= 1) {
      candidates.push({ ...lot, ledgerKg, systemKg, diffKg });
    }
  }

  if (candidates.length === 0) {
    console.log('[backfill] All lots already reconciled — nothing to do.');
    await db.destroy();
    return;
  }

  console.log(`[backfill] Found ${candidates.length} discrepant lots. Writing corrective transactions…`);

  // System user fallback (created_by NOT NULL on lot_transactions)
  const sysUser = await db('users').orderBy('id', 'asc').first('id');
  if (!sysUser) throw new Error('No users in DB — cannot satisfy created_by NOT NULL');

  let fixed = 0;
  await db.transaction(async (trx) => {
    for (const c of candidates) {
      const txnNo = await generateTxnNo();
      await trx('lot_transactions').insert({
        transaction_no: txnNo,
        transaction_date: new Date().toISOString().slice(0, 10),
        lot_id: c.id,
        transaction_type: c.diffKg > 0 ? 'byproduct_receipt' : 'milling_issue',
        reference_module: 'reconciliation',
        reference_id: null,
        reference_no: null,
        warehouse_from_id: c.diffKg < 0 ? c.warehouse_id : null,
        warehouse_to_id:   c.diffKg > 0 ? c.warehouse_id : null,
        input_unit: 'KG',
        input_qty: Math.abs(c.diffKg) / 1000,
        quantity_kg: c.diffKg,
        quantity_bags: 0,
        cost_impact: 0,
        currency: 'PKR',
        balance_kg: c.systemKg,
        balance_bags: 0,
        remarks: 'Backfill reconciliation: split broken-grade lots after backfillBrokenGradeLots.js (2026-05-18) left lot_transactions out of sync with inventory_lots.qty',
        created_by: sysUser.id,
        performed_by: sysUser.id,
      });
      console.log(`  ${c.lot_no.padEnd(20)} ${c.item_name.padEnd(28)} diff=${String(c.diffKg).padStart(8)} KG ${txnNo}`);
      fixed += 1;
    }
  });

  // Verify
  const stillOff = [];
  for (const c of candidates) {
    const txnSum = await db('lot_transactions').where('lot_id', c.id).sum('quantity_kg as t').first();
    const ledger = parseFloat(txnSum?.t) || 0;
    if (Math.abs(c.systemKg - ledger) >= 1) stillOff.push({ lot_no: c.lot_no, system: c.systemKg, ledger });
  }

  console.log(`\n[backfill] Done. Reconciled ${fixed} lots.`);
  if (stillOff.length > 0) {
    console.log(`[backfill] WARNING: ${stillOff.length} lots still off:`);
    stillOff.forEach(s => console.log('   ', s.lot_no, 'system=' + s.system, 'ledger=' + s.ledger));
  } else {
    console.log('[backfill] Re-check confirmed: ledger == system on every previously-discrepant lot.');
  }

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
