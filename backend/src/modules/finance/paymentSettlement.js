/**
 * What a payment does to the rows it settles, in one place.
 *
 * Record, clear-cheque and reverse each used to carry their own copy of "add
 * the amount to the payable, then mirror it onto the source row". The copies
 * drifted: recording mirrored onto expenses and mill purchases only, clearing a
 * cheque reached lots and export costs but not printed bags, and reversing
 * undid fewer tables than recording had touched. A Money-Out payment against a
 * printed-bag or export-cost payable left the source row saying "unpaid", so
 * the Purchases tab offered to pay it again. Every path now goes through the
 * same helpers, which add a signed delta to the row they read under a lock.
 */
const { nextDocNo } = require('../../utils/docNumber');
const accountingService = require('../accounting/accounting.service');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;

// Source rows that carry their own paid_amount / payment_status, how to read
// their total (PKR), and the word each CHECK constraint uses for "nothing paid".
const SOURCES = {
  business_expenses: { total: (r) => num(r.amount_pkr), unpaid: 'Pending', paidDate: 'paid_date' },
  mill_purchases: { total: (r) => num(r.total_amount), unpaid: 'Pending', paidDate: 'paid_date' },
  export_order_costs: {
    total: (r) => num(r.base_amount_pkr) || num(r.amount) * (num(r.fx_rate) || 1),
    unpaid: 'Pending', paidDate: 'paid_at',
  },
  printed_bag_orders: { total: (r) => num(r.total_amount), unpaid: 'Unpaid' },
  inventory_lots: { total: (r) => num(r.landed_cost_total), unpaid: 'Pending', due: 'due_amount' },
};
// Legacy payables carry no source_table, only the source row's natural key.
const NATURAL_KEYS = [['inventory_lots', 'lot_no'], ['mill_purchases', 'purchase_no'], ['business_expenses', 'expense_no']];

/**
 * The source row a payment settles: the payment's own source ref (payPurchase
 * cheques carry one), else the payable's, else — for a legacy payable with no
 * source_table at all — its linked_ref matched against each natural key.
 * A payable that names a source_table outside SOURCES (lot_transport,
 * lot_commission, …) is that party's own bill and has no source row to mirror.
 */
async function resolveSource(trx, { payment, payable }) {
  if (payment && SOURCES[payment.source_table] && payment.source_id) {
    return { table: payment.source_table, id: payment.source_id };
  }
  if (payable && SOURCES[payable.source_table] && payable.source_id) {
    return { table: payable.source_table, id: payable.source_id };
  }
  if (payable && !payable.source_table && payable.linked_ref) {
    for (const [table, col] of NATURAL_KEYS) {
      const r = await trx(table).where(col, payable.linked_ref).first('id');
      if (r) return { table, id: r.id };
    }
  }
  return null;
}

/** Add a signed PKR delta to a source row's paid_amount and restate its status. */
async function mirrorSourcePaid(trx, source, deltaPkr, extra = {}) {
  if (!source || !SOURCES[source.table]) return null;
  const spec = SOURCES[source.table];
  const row = await trx(source.table).where({ id: source.id }).forUpdate().first();
  if (!row) return null;
  const total = spec.total(row);
  const paid = Math.max(0, round2(num(row.paid_amount) + deltaPkr));
  const status = paid <= 0.01 ? spec.unpaid : (total - paid <= 0.01 ? 'Paid' : 'Partial');
  const upd = { paid_amount: paid, payment_status: status, updated_at: trx.fn.now(), ...extra };
  if (spec.paidDate) upd[spec.paidDate] = status === 'Paid' ? (row[spec.paidDate] || new Date()) : null;
  if (spec.due) upd[spec.due] = Math.max(0, round2(total - paid));
  await trx(source.table).where({ id: source.id }).update(upd);
  return { table: source.table, paid, status };
}

/**
 * Add a signed delta to a payable (already read under lock) and mirror the new
 * state onto its transport_costs record (#14: the transporter ledger reads it).
 */
async function applyPayableDelta(trx, payable, delta) {
  const orig = num(payable.original_amount);
  const paid = Math.max(0, round2(num(payable.paid_amount) + delta));
  const status = paid <= 0.01 ? 'Pending' : (paid >= orig - 0.01 ? 'Paid' : 'Partial');
  await trx('payables').where({ id: payable.id }).update({
    paid_amount: paid,
    outstanding: Math.max(0, round2(orig - paid)),
    status,
    updated_at: trx.fn.now(),
  });
  if (payable.hauler_id || payable.source_table === 'lot_transport') {
    const tc = status === 'Paid' ? 'paid' : status === 'Partial' ? 'partially_paid' : 'unpaid';
    await trx('transport_costs').where({ payable_id: payable.id }).update({ status: tc, updated_at: trx.fn.now() });
  }
  return { paid, status, fullyPaid: status === 'Paid' };
}

/** Add a signed delta to a receivable (already read under lock). */
async function applyReceivableDelta(trx, rec, delta) {
  const expected = num(rec.expected_amount);
  const received = Math.max(0, round2(num(rec.received_amount) + delta));
  const outstanding = Math.max(0, round2(expected - received));
  const status = received <= 0.01 ? 'Pending' : (outstanding <= 0.01 ? 'Paid' : 'Partial');
  await trx('receivables').where({ id: rec.id }).update({
    received_amount: received, outstanding, status, updated_at: trx.fn.now(),
  });
  return { received, outstanding, status };
}

/**
 * Cheques written against a payable / receivable that have not cleared yet.
 * They have not touched paid_amount, so an outstanding read off the row alone
 * lets a second payment be booked on top of a cheque already in the post.
 */
async function pendingChequeTotal(trx, { payableId, receivableId, sourceTable, sourceId, excludeId }) {
  const where = payableId ? { linked_payable_id: payableId }
    : receivableId ? { linked_receivable_id: receivableId }
      : { source_table: sourceTable, source_id: sourceId };
  const rows = await trx('payments').where({ ...where, cleared: false }).select('id', 'amount', 'status');
  return round2((Array.isArray(rows) ? rows : [])
    .filter((p) => p.status !== 'Reversed' && p.status !== 'Rejected' && String(p.id) !== String(excludeId))
    .reduce((s, p) => s + num(p.amount), 0));
}

/** Collision-safe BT- number, same BT-NNNN shape as before. */
function nextBtNo(trx) {
  return nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
}

/**
 * Post the signed-delta of every Posted journal with this ref: each line comes
 * back with its debit and credit swapped, as one fresh Posted journal per
 * original. Nothing is edited or marked — the trial balance counts Posted
 * journals only, so the original plus its delta nets to zero (never
 * reverse-and-repost, which double-counts). Returns how many were mirrored.
 */
async function postDeltaOf(trx, { refNo, refTypes, refType, description, userId, date }) {
  let q = trx('journal_entries').where({ ref_no: refNo, status: 'Posted' });
  if (refTypes && refTypes.length) q = q.whereIn('ref_type', refTypes);
  const originals = await q.select('*');
  let n = 0;
  for (const j of Array.isArray(originals) ? originals : []) {
    const lines = await trx('journal_lines').where({ journal_id: j.id }).select('*');
    if (!Array.isArray(lines) || !lines.length) continue;
    const delta = await accountingService.createJournal(trx, {
      date: date || new Date().toISOString().slice(0, 10),
      entity: j.entity || 'mill',
      refType,
      refNo,
      description: description || `Reversal of ${j.journal_no || refNo}`,
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType: j.party_type || null,
      partyId: j.party_id || null,
      lines: lines.map((l) => ({
        account_id: l.account_id,
        account: l.account,
        debit: num(l.credit),
        credit: num(l.debit),
        narration: `Reversal — ${l.narration || refNo}`.slice(0, 240),
      })),
    });
    if (delta?.id) await accountingService.postJournal(trx, delta.id);
    n += 1;
  }
  return n;
}

module.exports = {
  SOURCES, round2, resolveSource, mirrorSourcePaid, applyPayableDelta, applyReceivableDelta,
  pendingChequeTotal, nextBtNo, postDeltaOf,
};
