// Truck intake is a purchase AT RECEIPT (P3-09 / MIL-09, MIL-17, INV-26 —
// owner decision D-6 (a), 2026-10-15).
//
// Rice received by truck straight onto a milling batch (receiveRice → the
// batch's raw lot, batch_ref 'batch-<id>') used to be valued in the lot at
// intake but reached AP and the GL only at the first yield (MILL-RICE-<batch>,
// dated yield day): AP ageing lagged, stock and GL disagreed, and cancelling
// the batch left a valued lot nobody owed for. Now the truck lot is bought
// the way New Purchase Lot buys a lot:
//
//   - a supplier payable on the lot (category 'Raw Material', linked_ref =
//     lot_no, source_id = lot id) — the row Edit Price, Money Out and the
//     supplier statement already understand;
//   - a 'Purchase Lot' journal for the lot, Dr 1210 / Cr 2010 on the
//     purchase_invoice rule, party-stamped to the supplier.
//
// syncTruckIntakePurchase keeps both equal to the truck lot's value (landed
// cost × KG on hand, D-14) by posting the signed difference: every truck
// added, edited or removed moves it. A batch whose rice was already bought at
// yield the old way (a 'Rice Purchase' journal) is left alone.
//
// At the yield the cost sheet's raw rice (Σ truck weight × truck price) is
// what the supplier is owed; when it differs from what the receipts booked
// (an unpriced truck, a price-only edit) the yield moves the SAME payable to
// it (`target`) — a true-up, never a second payable.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PURCHASE_LOT_REF = 'Purchase Lot';

/** The batch's truck-intake raw lot (company-owned), or null. */
function truckLotOf(q, batchId) {
  return q('inventory_lots')
    .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
    .whereNot('ownership', 'client')
    .orderBy('id')
    .first();
}

/** The truck lot's rice payable — the row findRicePayable (Edit Price) finds. */
function lotRicePayable(q, lot) {
  const qb = q('payables')
    .where({ linked_ref: lot.lot_no, category: 'Raw Material' })
    .whereNot('status', 'Reversed')
    .orderByRaw('CASE WHEN source_id = ? THEN 0 ELSE 1 END, id', [lot.id]);
  if (lot.supplier_id) qb.where({ supplier_id: lot.supplier_id });
  return qb.first();
}

/** Net Cr 2010 the lot's Posted 'Purchase Lot' journals booked. */
async function bookedForLot(q, lotNo) {
  const row = await q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_type': PURCHASE_LOT_REF, 'je.ref_no': lotNo, 'je.status': 'Posted', 'c.code': '2010' })
    .select(q.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS net'))
    .first();
  return r2(row && row.net);
}

/** True when the batch's rice was bought at yield the old way (MILL-RICE / 'Rice Purchase'). */
async function boughtAtYield(q, batch) {
  const j = await q('journal_entries').where({ ref_type: 'Rice Purchase', ref_no: batch.batch_no }).first('id');
  if (j) return true;
  const p = await q('payables').where({ source_table: 'milling_raw_rice', source_id: batch.id }).first('id');
  return !!p;
}

/** True when the truck lot was bought at receipt (a payable or a Purchase Lot journal). */
async function receiptBooked(q, lot) {
  if (!lot) return false;
  if (await lotRicePayable(q, lot)) return true;
  const j = await q('journal_entries').where({ ref_type: PURCHASE_LOT_REF, ref_no: lot.lot_no }).first('id');
  return !!j;
}

const lotValueNow = (lot) => {
  const net = parseFloat(lot.net_weight_kg) || 0;
  const kg = net > 0 ? net : (parseFloat(lot.qty) || 0);
  return r2(kg * (parseFloat(lot.landed_cost_per_kg) || 0));
};

/**
 * Book / adjust the truck-intake purchase of a batch to `target` (default: the
 * truck lot's value now). Returns { delta, amount, payableId } or null when
 * nothing applies: service / blended batch, no supplier, no truck lot, rice
 * already bought at yield, or (default target) a batch that has yielded — its
 * lot has been consumed, so its value no longer measures the purchase.
 * Throws 409 when the new amount is below what has been paid.
 */
async function syncTruckIntakePurchase(trx, batchId, { userId = null, target = null } = {}) {
  const batch = await trx('milling_batches').where({ id: batchId }).first();
  if (!batch || batch.is_service_milling || batch.processing_type === 'blended' || !batch.supplier_id) return null;
  const hasSources = await trx('batch_source_lots').where({ batch_id: batch.id }).first('id');
  if (hasSources) return null;
  const lot = await truckLotOf(trx, batch.id);
  if (!lot) return null;
  if (await boughtAtYield(trx, batch)) return null;
  if (target == null) {
    const { batchYielded } = require('./costEditLocks');
    if (await batchYielded(trx, batch)) return null;
  }
  const amount = r2(target != null ? target : lotValueNow(lot));
  const booked = await bookedForLot(trx, lot.lot_no);
  let pay = await lotRicePayable(trx, lot);
  const delta = r2(amount - booked);
  if (!pay && amount <= 0.01 && Math.abs(delta) < 0.01) return { delta: 0, amount, payableId: null };

  const supplierId = lot.supplier_id || batch.supplier_id;
  if (!pay) {
    const { nextDocNo } = require('../../utils/docNumber');
    const due = new Date(); due.setDate(due.getDate() + 30);
    [pay] = await trx('payables').insert({
      pay_no: await nextDocNo(trx, { table: 'payables', column: 'pay_no', prefix: 'PAY-', pad: 3 }),
      entity: 'mill', payable_type: 'vendor', category: 'Raw Material',
      supplier_id: supplierId, linked_ref: lot.lot_no, source_table: null, source_id: lot.id,
      original_amount: 0, paid_amount: 0, outstanding: 0,
      due_date: due.toISOString().slice(0, 10), status: 'Pending', currency: 'PKR',
      notes: `Rice purchase — truck intake ${lot.lot_no} (batch ${batch.batch_no})`,
    }).returning('*');
  }
  const paid = parseFloat(pay.paid_amount) || 0;
  if (amount < paid - 0.01) {
    const e = new Error(`Truck rice ${lot.lot_no} would be bought for Rs ${amount.toLocaleString('en-US')}, less than the Rs ${paid.toLocaleString('en-US')} already paid to the supplier. Reverse the supplier payment first.`);
    e.status = 409; e.statusCode = 409; throw e;
  }
  if (Math.abs((parseFloat(pay.original_amount) || 0) - amount) >= 0.01) {
    await trx('payables').where({ id: pay.id }).update({
      original_amount: amount,
      outstanding: r2(Math.max(0, amount - paid)),
      status: paid <= 0.01 ? 'Pending' : (paid < amount - 0.01 ? 'Partial' : 'Paid'),
      updated_at: trx.fn.now(),
    });
  }
  if (Math.abs(delta) >= 0.01) {
    const { postRicePurchaseDelta } = require('./rawPurchasePayable');
    await postRicePurchaseDelta(trx, {
      batchNo: lot.lot_no, refType: PURCHASE_LOT_REF, supplierId, delta, userId,
      description: `Truck rice purchase ${lot.lot_no} (batch ${batch.batch_no})${target != null ? ' — at yield, cost sheet raw rice' : ''}`,
    });
  }
  return { delta, amount, payableId: pay.id };
}

/**
 * A truck lot is being deleted with its batch (deleteBatchTx): void its unpaid
 * payable and take the purchase back off the books by its net (signed delta).
 * Refuses (409) when the supplier has been paid against it.
 */
async function voidTruckIntakePurchase(trx, lot, { userId = null, label = '' } = {}) {
  const pay = await lotRicePayable(trx, lot);
  if (pay && (parseFloat(pay.paid_amount) || 0) > 0.01) {
    const e = new Error(`Truck rice ${lot.lot_no}${label ? ` of ${label}` : ''} has supplier payments recorded against ${pay.pay_no} — reverse the payment first.`);
    e.status = 409; e.statusCode = 409; throw e;
  }
  if (pay) {
    await trx('payables').where({ id: pay.id }).update({
      status: 'Reversed', outstanding: 0,
      notes: `${pay.notes ? `${pay.notes} — ` : ''}voided: ${label || 'batch'} deleted`,
      updated_at: trx.fn.now(),
    });
  }
  const booked = await bookedForLot(trx, lot.lot_no);
  if (Math.abs(booked) >= 0.01) {
    const { postRicePurchaseDelta } = require('./rawPurchasePayable');
    await postRicePurchaseDelta(trx, {
      batchNo: lot.lot_no, refType: PURCHASE_LOT_REF, supplierId: lot.supplier_id || (pay && pay.supplier_id) || null,
      delta: -booked, userId, description: `Truck rice purchase ${lot.lot_no} voided — ${label || 'batch'} deleted`,
    });
  }
  return { voided: !!pay, reversed: booked };
}

module.exports = {
  syncTruckIntakePurchase, voidTruckIntakePurchase, truckLotOf, lotRicePayable,
  receiptBooked, boughtAtYield, bookedForLot, PURCHASE_LOT_REF,
};
