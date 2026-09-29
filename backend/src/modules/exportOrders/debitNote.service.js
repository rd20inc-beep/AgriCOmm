const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const { nextDocNo } = require('../../utils/docNumber');
const { NotFoundError, ValidationError } = require('../../shared/errors');

/**
 * Freight escalation debit notes.
 *
 * The clause on the Proforma and the Sales Contract says any rise in ocean
 * freight, BAF, war-risk or congestion between the date the rate was quoted and
 * the date of the Bill of Lading is for the Buyer's account, "and shall be
 * invoiced by debit note, payable together with the balance of the contract
 * value." This raises that note.
 *
 * WHY IT IS NOT AN ORDER EDIT. A debit note is raised AFTER shipment, when the
 * carrier's actual charge is known. By then quantity, price and freight are all
 * locked — deliberately, because changing them would desync receivables against
 * posted revenue with no reversal. So the claim is additive and audited instead:
 * its own numbered row, its own journal, and an increase to the balance.
 *
 * WHY IT LANDS ON THE BALANCE. Because that is what the clause the buyer signed
 * says. One wire arrives against documents and the existing balance-confirmation
 * flow settles it — no second receipt path, no separate reconciliation, and the
 * order's outstanding figure is right the moment the note is issued.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MONEY_EPSILON = 0.01;

// A `date` column comes back from Postgres as a JS Date, and Date#toString gives
// "Tue Sep 29 2026 …" — slicing that to ten characters produced "Tue Sep 29",
// which the accounting-period lookup rejected as a date. Always go via ISO.
const isoDate = (d) => {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

// Debits AR and credits freight recovery — the same pair the original freight
// used, so 4070 keeps totalling what has been charged to buyers against 6010
// Freight & Shipping, which is what it is there to show.
async function postDebitNoteJournal(trx, { note, order, amountPkr, userId, reversing = false }) {
  const [exportAR, freightRev] = await Promise.all([
    trx('chart_of_accounts').where({ code: '1110' }).first(),
    trx('chart_of_accounts').where({ code: '4070' }).first(),
  ]);
  if (!exportAR || !freightRev) {
    throw new ValidationError('Chart of accounts is missing 1110 Export AR or 4070 Freight & Insurance Recovered.');
  }
  const foreign = (order.currency || 'PKR') !== 'PKR';
  // Cancelling posts a SIGNED DELTA — the opposite entry as its own posted
  // journal. It must never reverse and repost: the trial balance and every
  // ledger count Posted journals only, so that would subtract it twice.
  const amt = round2(Math.abs(amountPkr));
  const lines = reversing
    ? [
      { account_id: freightRev.id, account: freightRev.name, debit: amt, credit: 0, narration: `DR 4070 ${freightRev.name} — debit note ${note.debit_note_no} cancelled` },
      { account_id: exportAR.id, account: exportAR.name, debit: 0, credit: amt, narration: `CR 1110 ${exportAR.name} — debit note ${note.debit_note_no} cancelled` },
    ]
    : [
      { account_id: exportAR.id, account: exportAR.name, debit: amt, credit: 0, narration: `DR 1110 ${exportAR.name} — debit note ${note.debit_note_no}` },
      { account_id: freightRev.id, account: freightRev.name, debit: 0, credit: amt, narration: `CR 4070 ${freightRev.name} — ${note.debit_note_no}` },
    ];

  const journal = await accountingService.createJournal(trx, {
    // A cancellation is posted on the day it is made, not backdated to the note.
    date: reversing ? isoDate(new Date()) : isoDate(note.issue_date),
    entity: 'export',
    refType: 'Export Debit Note',
    refNo: note.debit_note_no,
    description: `${reversing ? 'Cancelled: ' : ''}Freight debit note ${note.debit_note_no} — order ${order.order_no}`,
    currency: 'PKR',
    fxRate: 1,
    isAuto: true,
    userId,
    partyType: order.customer_id ? 'customer' : null,
    partyId: order.customer_id || null,
    origCurrency: foreign ? order.currency : null,
    origFxRate: foreign ? (parseFloat(note.fx_rate) || null) : null,
    lines,
  });
  if (journal?.id) await accountingService.postJournal(trx, journal.id);
  return journal?.id || null;
}

// Keep the order and its Balance receivable in step with the notes raised
// against it. `delta` is in the ORDER's currency and may be negative (a cancel).
async function applyToBalance(trx, { order, delta, deltaPkr, noteNo, cancelled = false }) {
  const newBalanceExpected = round2((parseFloat(order.balance_expected) || 0) + delta);
  // Cancelling a note the buyer has already paid would leave the balance below
  // what was received — a negative outstanding that no ledger can represent.
  if (newBalanceExpected + MONEY_EPSILON < (parseFloat(order.balance_received) || 0)) {
    throw new ValidationError(
      `Cannot cancel ${noteNo}: the balance received (${round2(order.balance_received)}) already exceeds what would remain owing (${newBalanceExpected}). Refund or write off the receipt first.`,
    );
  }
  await trx('export_orders').where({ id: order.id }).update({
    balance_expected: newBalanceExpected,
    updated_at: trx.fn.now(),
  });

  const recv = await trx('receivables').where({ order_id: order.id, type: 'Balance' }).first();
  if (recv) {
    const expected = round2((parseFloat(recv.expected_amount) || 0) + delta);
    const received = parseFloat(recv.received_amount) || 0;
    const outstanding = Math.max(0, round2(expected - received));
    await trx('receivables').where({ id: recv.id }).update({
      expected_amount: Math.max(0, expected),
      outstanding,
      // A note raised against a fully paid balance makes it owing again.
      status: outstanding <= MONEY_EPSILON ? 'Paid' : (received > 0 ? 'Partial' : 'Pending'),
      base_amount_pkr: Math.max(0, round2((parseFloat(recv.base_amount_pkr) || 0) + deltaPkr)),
      notes: [recv.notes, cancelled ? `${noteNo} cancelled` : `Includes debit note ${noteNo}`].filter(Boolean).join('; '),
      updated_at: trx.fn.now(),
    });
  }
  return newBalanceExpected;
}

const debitNoteService = {
  async list(orderId) {
    return db('export_debit_notes as dn')
      .leftJoin('users as u', 'u.id', 'dn.created_by')
      .where('dn.order_id', orderId)
      .select('dn.*', 'u.full_name as created_by_name')
      .orderBy('dn.id', 'desc');
  },

  /**
   * Raise a debit note against a shipped order.
   *
   * The amount may be given outright, or derived from the freight rates: the
   * rise per MT times the tons shipped, which is the arithmetic the clause
   * describes and the one the buyer will check.
   */
  async issue(orderId, body, userId) {
    return db.transaction(async (trx) => {
      const order = await trx('export_orders').where({ id: orderId }).forUpdate().first();
      if (!order) throw new NotFoundError('Export order not found.');
      if (order.status === 'Cancelled') {
        throw new ValidationError('Cannot raise a debit note against a cancelled order.');
      }

      const qtyMt = parseFloat(body.qty_mt) || parseFloat(order.qty_mt) || 0;
      const oldRate = body.old_rate_per_mt == null || body.old_rate_per_mt === ''
        ? null : parseFloat(body.old_rate_per_mt);
      const newRate = body.new_rate_per_mt == null || body.new_rate_per_mt === ''
        ? null : parseFloat(body.new_rate_per_mt);

      // Derive from the rate rise when no amount was typed — old 58 → new 76
      // over 24 MT is 432.00, and the note prints that working.
      let amount = body.amount == null || body.amount === '' ? null : parseFloat(body.amount);
      if (amount == null && oldRate != null && newRate != null) {
        amount = round2((newRate - oldRate) * qtyMt);
      }
      if (!(amount > 0)) {
        throw new ValidationError('Enter the amount to claim, or the old and new freight rates to work it out from.');
      }
      amount = round2(amount);

      // Value it at the order's booked rate, so the claim sits in the ledger on
      // the same basis as the revenue it follows rather than at today's rate.
      const bookedRate = parseFloat(body.fx_rate)
        || parseFloat(order.booked_fx_rate)
        || (parseFloat(order.contract_value) > 0
          ? (parseFloat(order.contract_value_pkr_locked) || 0) / parseFloat(order.contract_value)
          : 0)
        || 1;
      const amountPkr = round2(amount * bookedRate);

      const debitNoteNo = await nextDocNo(trx, {
        table: 'export_debit_notes', column: 'debit_note_no', prefix: 'DN-',
      });

      const [note] = await trx('export_debit_notes').insert({
        debit_note_no: debitNoteNo,
        order_id: order.id,
        customer_id: order.customer_id || null,
        issue_date: body.issue_date || new Date().toISOString().slice(0, 10),
        currency: order.currency || 'USD',
        amount,
        fx_rate: bookedRate,
        amount_pkr: amountPkr,
        basis: body.basis || 'freight_escalation',
        old_rate_per_mt: oldRate,
        new_rate_per_mt: newRate,
        qty_mt: qtyMt || null,
        reason: body.reason || null,
        status: 'Issued',
        created_by: userId || null,
      }).returning('*');

      const journalId = await postDebitNoteJournal(trx, { note, order, amountPkr, userId });
      if (journalId) {
        await trx('export_debit_notes').where({ id: note.id }).update({ journal_id: journalId });
        note.journal_id = journalId;
      }

      note.balance_expected = await applyToBalance(trx, {
        order, delta: amount, deltaPkr: amountPkr, noteNo: debitNoteNo,
      });
      return note;
    });
  },

  async cancel(orderId, noteId, { reason } = {}, userId) {
    return db.transaction(async (trx) => {
      const note = await trx('export_debit_notes').where({ id: noteId, order_id: orderId }).forUpdate().first();
      if (!note) throw new NotFoundError('Debit note not found.');
      if (note.status === 'Cancelled') throw new ValidationError('This debit note is already cancelled.');

      const order = await trx('export_orders').where({ id: orderId }).forUpdate().first();
      if (!order) throw new NotFoundError('Export order not found.');

      // Pull the money back out of the balance FIRST: it is the step that can
      // legitimately refuse (the buyer may already have paid the note), and
      // refusing before anything is posted leaves nothing to unwind.
      await applyToBalance(trx, {
        order,
        delta: -(parseFloat(note.amount) || 0),
        deltaPkr: -(parseFloat(note.amount_pkr) || 0),
        noteNo: note.debit_note_no,
        cancelled: true,
      });

      const cancelJournalId = await postDebitNoteJournal(trx, {
        note, order, amountPkr: parseFloat(note.amount_pkr) || 0, userId, reversing: true,
      });

      const [updated] = await trx('export_debit_notes').where({ id: note.id }).update({
        status: 'Cancelled',
        cancel_journal_id: cancelJournalId,
        cancel_reason: reason || null,
        cancelled_by: userId || null,
        cancelled_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      }).returning('*');
      return updated;
    });
  },
};

module.exports = debitNoteService;
module.exports.__test = { round2, applyToBalance };
