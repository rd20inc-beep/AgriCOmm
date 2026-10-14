// The batch-level supplier payable for raw rice (MILL-RICE-<batch>, journal
// 'Rice Purchase': Dr 1210 / Cr 2010) — WHEN a yield may book it (P2-06/MIL-01).
//
// That payable is the purchase of rice that reached the mill WITHOUT a purchase
// document of its own: trucks received straight onto the batch (receiveRice →
// a raw lot with batch_ref 'batch-<id>' and no batch_source_lots). Rice that is
// already on the books must never be bought a second time when it is milled:
//   - a FINISHED or BY-PRODUCT lot (re-mill / blend) was capitalised into 1220 /
//     1240 by its own batch's completion, and its supplier was paid through that
//     batch's payable or its purchase lot;
//   - an OPENING-STOCK lot was loaded at go-live against 3000 equity, with the
//     supplier's balance loaded separately as opening AP;
//   - a PURCHASE lot carries its own payable (linked_ref = lot_no) or a
//     procurement invoice;
//   - a TRANSFERRED lot came from one of the above;
//   - a truck-intake lot of ANOTHER batch is booked once that batch booked its
//     own Rice Purchase.
// The old test ("a source lot has a non-milling payable linked by lot_no")
// passed for finished and opening lots, so re-milling one owed the supplier
// twice and left a phantom 1210 balance.
//
// Blends are excluded wholesale: a blend re-mills owned stock (memory: blend
// raw + output are excluded from payables everywhere).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const RICE_PURCHASE_REF = 'Rice Purchase';
const MILL_RICE_SOURCE = 'milling_raw_rice';

// Same marker lotInventory.controller's isOpeningStockLot uses: the go-live load
// wrote ONE ledger row with transaction_type AND reference_module
// 'opening_balance'; no app flow writes that pair.
async function isOpeningStockLot(trx, lotId) {
  const row = await trx('lot_transactions')
    .where({ lot_id: lotId, transaction_type: 'opening_balance', reference_module: 'opening_balance' })
    .first('id');
  return !!row;
}

/**
 * Why a source lot is already on the books, or null when it is not (a raw lot
 * nobody has bought yet — the only kind a batch-level payable may cover).
 */
async function sourceLotBookedReason(trx, lot) {
  if (!lot) return 'missing';
  if (lot.type && lot.type !== 'raw') return lot.type; // finished / byproduct
  if (lot.ownership === 'client') return 'client_owned';
  if (lot.purchase_invoice_id) return 'purchase_invoice';
  if (await isOpeningStockLot(trx, lot.id)) return 'opening_stock';
  const lotPayable = await trx('payables')
    .where((qb) => qb.where('linked_ref', lot.lot_no)
      .orWhere((q2) => q2.whereNull('source_table').where('source_id', lot.id)))
    .where((qb) => qb.whereNull('source_table').orWhereNot('source_table', MILL_RICE_SOURCE))
    .first('id');
  if (lotPayable) return 'purchase_lot';
  const transferred = await trx('lot_transactions')
    .where({ lot_id: lot.id, transaction_type: 'warehouse_transfer_in' }).first('id');
  if (transferred) return 'transfer';
  const m = /^batch-(\d+)$/.exec(lot.batch_ref || '');
  if (m) {
    const origin = await trx('milling_batches').where({ id: parseInt(m[1], 10) }).first('id', 'batch_no');
    if (origin) {
      const booked = await trx('payables').where({ source_table: MILL_RICE_SOURCE, source_id: origin.id }).first('id')
        || await trx('journal_entries').where({ ref_type: RICE_PURCHASE_REF, ref_no: origin.batch_no }).first('id');
      if (booked) return 'origin_batch_purchase';
    }
  }
  return null;
}

/**
 * The raw-rice value a batch's yield may book as a NEW supplier purchase.
 *
 *   { amount, hasSources, sources: [{ lotId, lotNo, value, booked }] }
 *
 *   - blended batch / no supplier / service batch → 0
 *   - no source lots (truck intake) → the batch's whole raw_rice cost
 *   - source lots → only the value of the source lots not yet on the books
 *     (normally 0). An unbooked lot of a DIFFERENT supplier cannot sit on this
 *     batch's single supplier payable: refused (409) rather than mis-owed.
 */
async function rawPurchaseToBook(trx, batch) {
  const out = { amount: 0, hasSources: false, sources: [] };
  if (!batch || batch.processing_type === 'blended' || !batch.supplier_id || batch.is_service_milling) return out;
  const rows = await trx('batch_source_lots as bsl')
    .leftJoin('inventory_lots as il', 'il.id', 'bsl.lot_id')
    .where('bsl.batch_id', batch.id)
    .select('bsl.lot_id', 'bsl.qty_kg', 'bsl.unit_cost_pkr', 'bsl.cost_total_pkr',
      'il.id as il_id', 'il.lot_no', 'il.type', 'il.ownership', 'il.supplier_id', 'il.batch_ref',
      'il.purchase_invoice_id', 'il.landed_cost_per_kg', 'il.rate_per_kg');
  if (!rows.length) {
    const raw = await trx('milling_costs').where({ batch_id: batch.id, category: 'raw_rice' })
      .sum('amount as total').first();
    out.amount = r2(raw?.total);
    return out;
  }
  out.hasSources = true;
  for (const r of rows) {
    const lot = r.il_id ? { id: r.il_id, lot_no: r.lot_no, type: r.type, ownership: r.ownership,
      batch_ref: r.batch_ref, purchase_invoice_id: r.purchase_invoice_id } : null;
    const booked = await sourceLotBookedReason(trx, lot);
    const qty = Number(r.qty_kg) || 0;
    const value = Number(r.cost_total_pkr) > 0
      ? r2(r.cost_total_pkr)
      : r2(qty * (Number(r.unit_cost_pkr) || Number(r.landed_cost_per_kg) || Number(r.rate_per_kg) || 0));
    out.sources.push({ lotId: r.lot_id, lotNo: r.lot_no, value, booked, supplierId: r.supplier_id });
    if (booked) continue;
    if (r.supplier_id && String(r.supplier_id) !== String(batch.supplier_id)) {
      const e = new Error(`Source lot ${r.lot_no || r.lot_id} has never been billed and belongs to a different supplier than batch ${batch.batch_no}. Record its purchase on the lot (Edit Price) before recording yield, so the right supplier is owed.`);
      e.status = 409; throw e;
    }
    out.amount = r2(out.amount + value);
  }
  return out;
}

/**
 * Move a batch's rice purchase by a SIGNED delta: + is Dr 1210 / Cr 2010 (more
 * stock, more owed), − the reverse. Posted, party-stamped to the supplier, on
 * the accounts of the mill purchase_invoice rule — the same ones the original
 * 'Rice Purchase' journal hit. Never reverse+repost (TB is Posted-only).
 * Returns the journal or null when the delta rounds to zero. Throws when the
 * rule is missing: the caller's business write must roll back with it.
 */
async function postRicePurchaseDelta(trx, { batchNo, supplierId, delta, refType = RICE_PURCHASE_REF, description, userId }) {
  const accountingService = require('../accounting/accounting.service');
  const d = r2(delta);
  if (Math.abs(d) <= 0.01) return null;
  const rule = await trx('posting_rules')
    .where({ trigger_event: 'purchase_invoice', is_active: true })
    .where(function () { this.where({ entity: 'mill' }).orWhereNull('entity'); })
    .orderByRaw('entity IS NULL')
    .first();
  if (!rule) {
    const e = new Error('No active purchase_invoice posting rule — cannot adjust the rice purchase.');
    e.status = 500; throw e;
  }
  const [stockAcc, apAcc] = await Promise.all([
    trx('chart_of_accounts').where({ id: rule.debit_account_id }).first(),
    trx('chart_of_accounts').where({ id: rule.credit_account_id }).first(),
  ]);
  const amt = Math.abs(d);
  const up = d > 0;
  const label = (a) => (a ? `${a.code} ${a.name}` : '');
  const lines = [
    { account_id: rule.debit_account_id, account: stockAcc?.name || '',
      debit: up ? amt : 0, credit: up ? 0 : amt,
      narration: `${up ? 'DR' : 'CR'} ${label(stockAcc)} — ${description}` },
    { account_id: rule.credit_account_id, account: apAcc?.name || '',
      debit: up ? 0 : amt, credit: up ? amt : 0,
      narration: `${up ? 'CR' : 'DR'} ${label(apAcc)} — ${description}` },
  ];
  const j = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10), entity: 'mill',
    refType, refNo: batchNo, description: `${description} (Rs ${up ? '+' : '-'}${amt})`,
    lines, currency: 'PKR', isAuto: true, postingRuleId: rule.id, userId: userId || null,
    partyType: supplierId ? 'supplier' : null, partyId: supplierId || null,
  });
  if (j?.id) await accountingService.postJournal(trx, j.id);
  return j;
}

module.exports = {
  rawPurchaseToBook, sourceLotBookedReason, isOpeningStockLot, postRicePurchaseDelta,
  RICE_PURCHASE_REF, MILL_RICE_SOURCE,
};
