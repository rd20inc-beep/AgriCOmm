/**
 * Void a mill-store purchase — P3-11 / INV-09 (D-23; Owner approval on the
 * route). The store-purchase twin of inventory/purchaseVoid.js.
 *
 * A store purchase posted stock (mill_stock + a 'purchase' movement per line,
 * moving the item's average cost), one payable and one journal ('Mill
 * Purchase': Dr 1250 / Cr 2010, stamped with the supplier). The void keeps
 * all of it on record and takes it back out:
 *
 *   stock  each line's quantity leaves its store as an 'adjustment' movement
 *          (reference_type 'purchase_void') at the line's cost, and the item's
 *          average cost is unwound — the exact inverse of the purchase's
 *          weighted average (left as is once nothing is left in stock);
 *   GL     the signed delta of every Posted 'Mill Purchase' journal under the
 *          purchase number (paymentSettlement.postDeltaOf), party kept;
 *   AP     its payable → 'Reversed', outstanding 0, figure kept.
 *
 * Refused when any of it has been paid (or a payment / cheque is recorded
 * against it), or when the store no longer holds a line's quantity — the
 * bags were already used, so the purchase did happen; adjust instead.
 */
const { postDeltaOf } = require('../finance/paymentSettlement');

const REF_TYPE = 'Mill Purchase';
const DEAD_PAYMENT = ['Reversed', 'Rejected', 'Bounced', 'Superseded'];
const num = (v) => parseFloat(v) || 0;
const refuse = (statusCode, message) => { const e = new Error(message); e.statusCode = statusCode; return e; };

/**
 * Pure: the average cost before a purchase of `qty` @ `cost`, given the
 * average and total quantity after it. Null when nothing would be left.
 */
function unwindAverage({ avgAfter, qtyAfter, qty, cost }) {
  const left = num(qtyAfter) - num(qty);
  if (left <= 0.0001) return null;
  const v = (num(qtyAfter) * num(avgAfter) - num(qty) * num(cost)) / left;
  return v > 0 ? Number(v.toFixed(4)) : 0;
}

async function voidStorePurchase(trx, purchaseId, { reason, userId = null, ownerId = null }) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw refuse(400, 'Give a reason for voiding the purchase.');
  const purchase = await trx('mill_purchases').where({ id: purchaseId }).forUpdate().first();
  if (!purchase) throw refuse(404, 'Purchase not found.');
  if (purchase.voided_at) throw refuse(409, `${purchase.purchase_no} is already voided.`);
  if (num(purchase.paid_amount) > 0.01) {
    throw refuse(409, `${purchase.purchase_no} has Rs ${num(purchase.paid_amount).toLocaleString('en-US')} paid — reverse the payment first.`);
  }

  const payables = await trx('payables')
    .where({ source_table: 'mill_purchases', source_id: purchase.id }).forUpdate();
  const paidBill = payables.find((p) => num(p.paid_amount) > 0.01);
  if (paidBill) throw refuse(409, `Rs ${num(paidBill.paid_amount).toLocaleString('en-US')} has been paid on ${paidBill.pay_no} — reverse the payment first.`);
  const payableIds = payables.map((p) => p.id);
  const live = await trx('payments')
    .where((q) => {
      if (payableIds.length) q.whereIn('linked_payable_id', payableIds);
      q.orWhere((q2) => q2.where({ source_table: 'mill_purchases', source_id: purchase.id }));
    })
    .where((q) => q.whereNull('status').orWhereNotIn('status', DEAD_PAYMENT))
    .first('payment_no');
  if (live) throw refuse(409, `Payment ${live.payment_no} is recorded against ${purchase.purchase_no} — reverse it first.`);

  const lines = await trx('mill_purchase_items').where({ purchase_id: purchase.id }).orderBy('id');

  // ── Stock: every line must still be in its store ──
  for (const l of lines) {
    const qty = num(l.quantity);
    if (qty <= 0) continue;
    const wh = l.warehouse_id || null;
    const stock = await trx('mill_stock').where({ item_id: l.item_id, warehouse_id: wh }).forUpdate().first();
    if (!stock || num(stock.quantity_available) < qty - 0.0001) {
      const item = await trx('mill_items').where({ id: l.item_id }).first('name');
      throw refuse(409, `Only ${num(stock && stock.quantity_available)} of ${item ? item.name : 'the item'} is left in the store but the purchase brought in ${qty} — the rest has been used. Correct it with a stock adjustment instead.`);
    }
    const item = await trx('mill_items').where({ id: l.item_id }).forUpdate().first();
    const total = await trx('mill_stock').where({ item_id: l.item_id }).sum({ q: 'quantity_available' }).first();
    const avg = unwindAverage({ avgAfter: item.avg_cost_per_unit, qtyAfter: num(total && total.q), qty, cost: l.cost_per_unit });
    await trx('mill_stock').where({ id: stock.id })
      .update({ quantity_available: trx.raw('quantity_available - ?', [qty]), updated_at: trx.fn.now() });
    await trx('mill_stock_movements').insert({
      item_id: l.item_id, warehouse_id: wh, movement_type: 'adjustment', quantity: -qty,
      cost_per_unit: l.cost_per_unit, total_cost: l.total_cost,
      reference_type: 'purchase_void', reference_id: purchase.id,
      reason: `Void of ${purchase.purchase_no}: ${why}`.slice(0, 500), performed_by: userId || null,
    });
    if (avg != null) {
      await trx('mill_items').where({ id: l.item_id }).update({ avg_cost_per_unit: avg, updated_at: trx.fn.now() });
    }
  }

  // ── GL and AP ──
  const mirrored = await postDeltaOf(trx, {
    refNo: purchase.purchase_no, refTypes: [REF_TYPE], refType: REF_TYPE,
    description: `Void of mill store purchase ${purchase.purchase_no} — ${why}`.slice(0, 240), userId,
  });
  for (const p of payables.filter((x) => x.status !== 'Reversed')) {
    await trx('payables').where({ id: p.id }).update({
      status: 'Reversed', outstanding: 0,
      notes: `${p.notes ? `${p.notes} — ` : ''}voided: ${why}`.slice(0, 1000),
      updated_at: trx.fn.now(),
    });
  }

  const [updated] = await trx('mill_purchases').where({ id: purchase.id }).update({
    voided_at: trx.fn.now(), voided_by: userId || null, void_reason: why,
    void_authorized_by: ownerId || null, updated_at: trx.fn.now(),
  }).returning('*');
  return { purchase: updated, journalsMirrored: mirrored, linesReversed: lines.length };
}

module.exports = { voidStorePurchase, unwindAverage };
