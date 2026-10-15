/**
 * Void a purchase — P3-11 / INV-09 (owner decisions D-23: void, never delete;
 * Owner approval on the route).
 *
 * A purchase entered by mistake (wrong supplier, duplicate, never arrived)
 * could only be removed by the Super-Admin Danger Zone hard delete, which
 * destroys its history. A void keeps every row and takes the purchase back
 * out of the books by signed deltas, in one transaction:
 *
 *   stock    the lot's whole quantity leaves by postMovement('purchase_void')
 *            at its own cost — a lot_transactions row, qty → 0, status Closed;
 *   GL       every Posted journal the purchase wrote under the lot number
 *            ('Purchase Lot', 'Lot Transport', 'Lot Commission', including any
 *            later price / cost edits) gets its signed delta, debit and credit
 *            swapped, party stamp kept (paymentSettlement.postDeltaOf). Nothing
 *            is marked Reversed or deleted. The lot's journals must then net
 *            to zero on every account, or the void is refused;
 *   AP       every live payable of the purchase (rice, itemised supplier
 *            lines, hauler freight, broker commission) → status 'Reversed',
 *            outstanding 0; original_amount kept as the record of the bill;
 *   freight  its transport_costs rows → 'cancelled'.
 *
 * Only an UNTOUCHED purchase can be voided: a raw, company-owned lot that is
 * not opening stock, with nothing sold, reserved, committed to or issued to
 * milling, transferred or otherwise drawn down, and no payment recorded (or
 * cheque waiting) against any of its bills. Anything else is refused with what
 * to undo first — a void never cascades into milling, sales or payments.
 */
const inventoryService = require('./inventory.service');
const { postDeltaOf } = require('../finance/paymentSettlement');

const VOID_REF_TYPES = ['Purchase Lot', 'Lot Transport', 'Lot Commission'];
const DEAD_PAYMENT = ['Reversed', 'Rejected', 'Bounced', 'Superseded'];
const num = (v) => parseFloat(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const refuse = (statusCode, message) => { const e = new Error(message); e.statusCode = statusCode; return e; };

/** The lot's payables: keyed by its lot number (every create path) or its id. */
function lotPayables(trx, lot) {
  return trx('payables')
    .where((q) => q.where({ linked_ref: lot.lot_no })
      .orWhere((q2) => q2.where({ source_id: lot.id }).where('source_table', 'like', 'lot\\_%')))
    .forUpdate();
}

/** Net Σ(debit − credit) per account over the Posted journals with this ref. */
async function netByAccount(trx, refNo) {
  const rows = await trx('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
    .groupBy('jl.account_id')
    .select('jl.account_id', trx.raw('COALESCE(SUM(jl.debit - jl.credit), 0) as net'));
  return (rows || []).map((r) => ({ account_id: r.account_id, net: r2(r.net) }));
}

/**
 * Why this lot cannot be voided, or null. Read under the caller's lock.
 * Exported for tests.
 */
async function voidRefusal(trx, lot) {
  if (lot.voided_at) return refuse(409, `Lot ${lot.lot_no} is already voided.`);
  if (lot.type !== 'raw') return refuse(409, `Only a purchase (raw rice) lot can be voided — ${lot.lot_no} is ${lot.type}.`);
  if (lot.ownership === 'client') return refuse(409, `${lot.lot_no} is a service-milling client's rice, not a purchase.`);
  const opening = await trx('lot_transactions')
    .where({ lot_id: lot.id, transaction_type: 'opening_balance', reference_module: 'opening_balance' }).first('id');
  if (opening) return refuse(409, `${lot.lot_no} is opening stock — correct it with an opening-stock revaluation, not a void.`);

  if (num(lot.reserved_qty) > 0.001 || num(lot.milling_reserved_qty) > 0.001) {
    return refuse(409, `${lot.lot_no} has stock reserved — release the reservation first.`);
  }
  if (num(lot.sold_weight_kg) > 0.001 || num(lot.damaged_weight_kg) > 0.001) {
    return refuse(409, `${lot.lot_no} has already been sold from or written down — return or reverse that first.`);
  }
  const milled = await trx('batch_source_lots').where({ lot_id: lot.id }).first('batch_id');
  if (milled) return refuse(409, `${lot.lot_no} is committed to a milling batch — remove it from the batch first.`);
  // Any movement that took rice out (milling issue, sale, transfer, write-off …).
  const drawn = await trx('lot_transactions').where({ lot_id: lot.id }).where('quantity_kg', '<', 0).first('transaction_no');
  if (drawn) return refuse(409, `Stock has already left ${lot.lot_no} (${drawn.transaction_no}) — reverse that movement first.`);
  return null;
}

/**
 * Void one purchase lot inside `trx`. Throws (statusCode set) on a refusal.
 * Returns { lot, payablesReversed, journalsMirrored, transportCancelled }.
 */
async function voidPurchaseLot(trx, lotId, { reason, userId = null, ownerId = null }) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw refuse(400, 'Give a reason for voiding the purchase.');
  const lot = await trx('inventory_lots').where({ id: lotId }).forUpdate().first();
  if (!lot) throw refuse(404, 'Lot not found.');
  const refusal = await voidRefusal(trx, lot);
  if (refusal) throw refusal;

  const payables = await lotPayables(trx, lot);
  const payableIds = payables.map((p) => p.id);
  const paid = payables.find((p) => num(p.paid_amount) > 0.01);
  if (paid) {
    throw refuse(409, `Rs ${num(paid.paid_amount).toLocaleString('en-US')} has been paid on ${paid.pay_no} — reverse the payment first.`);
  }
  const live = await trx('payments')
    .where((q) => {
      if (payableIds.length) q.whereIn('linked_payable_id', payableIds);
      q.orWhere((q2) => q2.where({ source_table: 'inventory_lots', source_id: lot.id }));
    })
    .where((q) => q.whereNull('status').orWhereNotIn('status', DEAD_PAYMENT))
    .first('payment_no');
  if (live) throw refuse(409, `Payment ${live.payment_no} is recorded against ${lot.lot_no} — reverse it first.`);

  const label = `${lot.lot_no} voided: ${why}`.slice(0, 200);

  // ── Stock: the whole lot leaves at its own cost ──
  const qty = num(lot.qty);
  if (qty > 0.001) {
    await inventoryService.postMovement(trx, {
      movementType: 'purchase_void', lotId: lot.id, qty,
      fromWarehouseId: lot.warehouse_id, sourceEntity: lot.entity, linkedRef: lot.lot_no,
      notes: `Purchase void — ${why}`.slice(0, 500),
      costPerUnit: num(lot.cost_per_unit), currency: 'PKR', userId,
    });
  }

  // ── GL: the signed delta of every Posted purchase journal ──
  let mirrored = 0;
  for (const refType of VOID_REF_TYPES) {
    mirrored += await postDeltaOf(trx, {
      refNo: lot.lot_no, refTypes: [refType], refType,
      description: `Void of purchase ${lot.lot_no} — ${why}`.slice(0, 240), userId,
    });
  }
  const leftover = (await netByAccount(trx, lot.lot_no)).filter((r) => Math.abs(r.net) > 0.01);
  if (leftover.length) {
    throw refuse(409, `${lot.lot_no} has other postings on the books under its number, so a void cannot net it to zero. Ask Finance to review the lot's journals.`);
  }

  // ── AP: every live bill of the purchase is reversed, its figure kept ──
  const toReverse = payables.filter((p) => p.status !== 'Reversed');
  for (const p of toReverse) {
    await trx('payables').where({ id: p.id }).update({
      status: 'Reversed', outstanding: 0,
      notes: `${p.notes ? `${p.notes} — ` : ''}${label}`.slice(0, 1000),
      updated_at: trx.fn.now(),
    });
  }
  const tc = await trx('transport_costs').where({ lot_id: lot.id }).whereNotIn('status', ['cancelled', 'reversed'])
    .update({ status: 'cancelled', updated_at: trx.fn.now() });

  const [updated] = await trx('inventory_lots').where({ id: lot.id }).update({
    status: 'Closed', due_amount: 0,
    voided_at: trx.fn.now(), voided_by: userId || null, void_reason: why,
    void_authorized_by: ownerId || null, updated_at: trx.fn.now(),
  }).returning('*');

  return { lot: updated, payablesReversed: toReverse.length, journalsMirrored: mirrored, transportCancelled: Number(tc) || 0 };
}

module.exports = { voidPurchaseLot, voidRefusal, VOID_REF_TYPES };
