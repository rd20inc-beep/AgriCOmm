/**
 * What a purchase lot owes its supplier, and how much of it is paid (P3-10).
 *
 * A lot's landed cost is rice + supplier extras + bags + commission + company
 * freight (lotCosting.computeLotLanded), but only the SUPPLIER's part is the
 * supplier's bill: the rice ('Raw Material') line(s) and the itemised lot_*
 * lines. Freight is the hauler's bill and commission the broker's, paid from
 * Money Out on their own payables — so a lot measured against its landed
 * total stayed 'Partial' for ever once the supplier was paid in full (INV-11).
 *
 * From here:
 *   supplier gross = Σ original_amount of the lot's live supplier payables
 *                    (no bill at all — opening stock, a legacy lot — falls back
 *                    to the landed total, which is what such a lot was paid
 *                    against);
 *   paid_amount    = what payments on those bills mirrored onto the lot;
 *   due_amount     = supplier gross − paid  — ONE meaning, everywhere;
 *   payment_status = Pending / Partial / Paid against the supplier gross.
 *
 * The payable lookup is shared with Finance ▸ Purchases (payPurchase) and the
 * Purchase Invoice, so all three see the same bills in the same order.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;

// The itemised supplier lines of a purchase lot (labour, bags, …) are part of
// the same purchase as its 'Raw Material' line: each carries source_id = the
// lot. Lines owed to another party (lot_transport → hauler, lot_commission →
// broker) are not.
const LOT_SUPPLIER_LINES = ['lot_labor', 'lot_unloading', 'lot_packing', 'lot_other', 'lot_bag'];

const isRiceLine = (p) => !p.source_table && p.category === 'Raw Material';

/**
 * The supplier's payables for a lot, rice line(s) first, then the itemised
 * lines in the order they were raised. The rice line is keyed by source_id =
 * the lot (createPurchaseLot) or — legacy and added purchases — by the lot
 * number. Only the lot's own supplier; never a hauler's bill.
 * `forUpdate` locks them (payment paths); `includeReversed` keeps zeroed rows.
 */
async function lotSupplierPayables(q, lot, { forUpdate = false, includeReversed = false } = {}) {
  const lock = (qb) => (forUpdate ? qb.forUpdate() : qb);
  const byLot = await lock(q('payables').where({ source_id: lot.id })).select('*');
  const byLotNo = lot.lot_no
    ? await lock(q('payables').where({ linked_ref: lot.lot_no, category: 'Raw Material' })).select('*')
    : [];
  const seen = new Set();
  const rows = [
    ...(Array.isArray(byLot) ? byLot : []).filter((p) => isRiceLine(p) || p.source_table === 'inventory_lots' || LOT_SUPPLIER_LINES.includes(p.source_table)),
    ...(Array.isArray(byLotNo) ? byLotNo : []).filter(isRiceLine),
  ].filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  return rows
    .filter((p) => !lot.supplier_id || !p.supplier_id || String(p.supplier_id) === String(lot.supplier_id))
    .filter((p) => !p.hauler_id)
    .filter((p) => includeReversed || p.status !== 'Reversed')
    .sort((a, b) => (a.category === 'Raw Material' ? 0 : 1) - (b.category === 'Raw Material' ? 0 : 1) || a.id - b.id);
}

/** The total a lot's payment status is measured against (see the header). */
async function lotPaymentTotal(q, lot) {
  const bills = await lotSupplierPayables(q, lot);
  if (!bills.length) return round2(num(lot.landed_cost_total));
  return round2(bills.reduce((s, p) => s + num(p.original_amount), 0));
}

/** Status / due for a paid figure against a total. */
function paymentState(total, paid) {
  const t = round2(total);
  const p = round2(paid);
  return {
    payment_status: p <= 0.01 ? 'Pending' : (t - p <= 0.01 ? 'Paid' : 'Partial'),
    due_amount: Math.max(0, round2(t - p)),
  };
}

/**
 * Restate a lot's payment_status / due_amount from its supplier bills and its
 * paid_amount — after anything that changes the bills (create, add purchase,
 * cost / price / received edits) or the paid figure (a payment's mirror).
 * Reads the lot under lock. Returns the new { total, paid, payment_status, due_amount }.
 */
async function restateLotPayment(trx, lotId) {
  const lot = await trx('inventory_lots').where({ id: lotId }).forUpdate().first();
  if (!lot) return null;
  const total = await lotPaymentTotal(trx, lot);
  const paid = num(lot.paid_amount);
  const state = paymentState(total, paid);
  // lot-qty-free: payment_status / due_amount only.
  await trx('inventory_lots').where({ id: lotId }).update({ ...state, updated_at: trx.fn.now() });
  return { total, paid, ...state };
}

module.exports = {
  LOT_SUPPLIER_LINES,
  lotSupplierPayables,
  lotPaymentTotal,
  paymentState,
  restateLotPayment,
};
