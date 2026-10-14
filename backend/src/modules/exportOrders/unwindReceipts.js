// What happens to an export order's receipts when the order is cancelled
// (P2-15, owner decision D-7). Receipts are NEVER deleted (D-23): the receipt
// row, its bank_transactions row and its journal all stay as they were.
//
// Only a receipt that was CONFIRMED ever credited a bank (status 'Confirmed',
// or legacy NULL). For those the cancel records ONE disposition each, chosen
// by the person cancelling:
//
//   refund   a money-out payment (refund_of_payment_id → the receipt) through
//            the payment engine: bank debited, its own bank row, journal
//            Dr 1310 (advance) / 1110 (balance) / Cr Bank — at the receipt's own
//            rate, so the bank's PKR comes back out exactly as it went in.
//   credit   the money stays and is owed to the buyer as credit, held in 1310
//            Customer Advances (an advance is already there; a balance receipt
//            is re-classed 1110 → 1310). credit_status 'Open'.
//   forfeit  kept as other income, Dr 1310/1110 / Cr 4080 — Owner-approved only
//            (the route logs it as its own 'export_cancel_forfeit' approval).
//
// A balance receipt credited 1110 at the BOOKED rate and put the difference to
// what the bank fetched on 6210 (G-7). Its disposition reverses that split too,
// so 1110 nets to zero for the cancelled order.
//
//   pending (unconfirmed)   → marked Rejected (order cancelled), no money moved
//   rejected / reversed / superseded / bounced → left as they are
//
// Every disposition is an export_receipt_dispositions row (mig 347).

const accountingService = require('../accounting/accounting.service');
const { recordMoneyMovement } = require('../finance/paymentEngine');
const { bookedRateFor } = require('../finance/paymentSettlement');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');

const PENDING = 'Pending Finance Confirmation';
const isConfirmed = (p) => (p.type == null || p.type === 'receipt') && (p.status == null || p.status === 'Confirmed');
const DISPOSITIONS = ['refund', 'credit', 'forfeit'];
const FORFEIT_CODE = '4080';
const CREDIT_CODE = '1310';
const FX_CODE = '6210';
// Payment methods a refund can go out by. A cheque would sit uncleared and
// move nothing, so a receipt banked by cheque is refunded by bank transfer.
const REFUND_METHODS = ['bank_transfer', 'tt', 'wire', 'online', 'cash', 'lc', 'mobile'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const today = () => new Date().toISOString().slice(0, 10);

async function account(trx, code) {
  const a = await trx('chart_of_accounts').where({ code }).first();
  if (!a) throw missingAccounts([code], 'The cancellation');
  return a;
}

/**
 * The receipt's counter account and how it was credited: 1310 at the PKR the
 * bank received (an advance), or 1110 at the booked rate with the gap on 6210
 * (a balance). Returns { counterCode, counterPkr, basePkr, fxPkr } where
 * counterPkr + fxPkr = basePkr (fxPkr > 0 was a realised gain).
 */
async function receiptSplit(trx, payment, receivable) {
  const basePkr = round2(num(payment.base_amount_pkr) || num(payment.amount) * (num(payment.fx_rate) || 1));
  const advance = String(receivable?.type || '').toLowerCase() === 'advance';
  const counterCode = advance ? '1310' : '1110';
  const cur = String(payment.currency || 'PKR').toUpperCase();
  if (counterCode !== '1110' || cur === 'PKR') return { counterCode, counterPkr: basePkr, basePkr, fxPkr: 0 };
  const booked = await bookedRateFor(trx, { payment, receivable });
  const counterPkr = booked > 0 ? round2(num(payment.amount) * booked) : basePkr;
  return { counterCode, counterPkr, basePkr, fxPkr: round2(basePkr - counterPkr) };
}

async function postJournal(trx, { order, description, lines, userId }) {
  try {
    const je = await accountingService.createJournal(trx, {
      date: today(),
      entity: 'export',
      refType: 'Export Order',
      refNo: order.order_no,
      description,
      currency: 'PKR', fxRate: 1, isAuto: true, userId: userId || null,
      partyType: order.customer_id ? 'customer' : null,
      partyId: order.customer_id || null,
      lines,
    });
    if (je?.id) await accountingService.postJournal(trx, je.id);
    return je || null;
  } catch (e) {
    throw ledgerFailure(e, 'The cancellation');
  }
}

// Undo the receipt's 6210 split (balance receipts only): the debit side then
// totals counterPkr + fxPkr = basePkr.
async function fxReverseLine(trx, split, label) {
  if (Math.abs(split.fxPkr) < 0.01) return [];
  const fx = await account(trx, FX_CODE);
  return [{
    account_id: fx.id, account: fx.name,
    debit: split.fxPkr > 0 ? split.fxPkr : 0, credit: split.fxPkr < 0 ? -split.fxPkr : 0,
    narration: `${split.fxPkr > 0 ? 'DR' : 'CR'} ${fx.code} ${fx.name} — reverse realised FX on ${label}`,
  }];
}

async function refund(trx, { order, payment, receivable, split, bankAccountId, refundDate, refundReference, userId, reason }) {
  const method = REFUND_METHODS.includes(payment.payment_method) ? payment.payment_method : 'bank_transfer';
  const bankId = bankAccountId || payment.bank_account_id || null;
  // The engine posts Dr counter / Cr Bank at the receipt's own PKR (basePkr).
  const { payment: out, journal } = await recordMoneyMovement(trx, {
    type: 'payment',
    amount: num(payment.amount),
    currency: payment.currency || 'PKR',
    fxRate: num(payment.fx_rate) || null,
    method,
    bankAccountId: bankId,
    accountEntity: 'export',
    paymentDate: refundDate || null,
    bankReference: refundReference || null,
    notes: `Refund of ${payment.payment_no} — export order ${order.order_no} cancelled${reason ? `: ${reason}` : ''}`,
    userId,
    checkOutstanding: false,
    extra: {
      refund_of_payment_id: payment.id,
      confirmed_by: userId || null,
      confirmed_at: trx.fn.now(),
    },
    journal: {
      refType: 'Export Order',
      refNo: order.order_no,
      counterCode: split.counterCode,
      entity: 'export',
      partyType: order.customer_id ? 'customer' : null,
      partyId: order.customer_id || null,
      description: `Refund of ${payment.payment_no} — ${order.order_no} cancelled`,
    },
    bt: { source: 'export_refund', notes: `Refund ${order.order_no} (${payment.payment_no})` },
  });
  if (!journal) throw httpError(`The refund of ${payment.payment_no} could not be posted to the ledger.`);
  // A balance receipt: the engine debited 1110 at basePkr; 1110 was credited at
  // counterPkr. True it up against 6210 so 1110 nets to zero.
  if (Math.abs(split.fxPkr) >= 0.01) {
    const ar = await account(trx, split.counterCode);
    const fxLines = await fxReverseLine(trx, split, payment.payment_no);
    await postJournal(trx, {
      order, userId,
      description: `Refund of ${payment.payment_no} — reverse realised FX (${order.order_no} cancelled)`,
      lines: [
        ...fxLines,
        {
          account_id: ar.id, account: ar.name,
          debit: split.fxPkr < 0 ? -split.fxPkr : 0, credit: split.fxPkr > 0 ? split.fxPkr : 0,
          narration: `${split.fxPkr > 0 ? 'CR' : 'DR'} ${ar.code} ${ar.name} — FX true-up on refund of ${payment.payment_no}`,
        },
      ],
    });
  }
  return { refundPaymentId: out.id, journalId: journal.id };
}

// credit / forfeit: Dr the counter at what it was credited (+ 6210 reversal)
// / Cr `toCode` at the PKR the bank received. A credit on an advance needs no
// journal at all — the money is already held in 1310 for the buyer.
async function reclass(trx, { order, payment, split, toCode, verb, userId }) {
  if (split.counterCode === toCode && Math.abs(split.fxPkr) < 0.01) return null;
  const [from, to] = [await account(trx, split.counterCode), await account(trx, toCode)];
  const je = await postJournal(trx, {
    order, userId,
    description: `${verb} ${payment.payment_no} — ${order.order_no} cancelled`,
    lines: [
      { account_id: from.id, account: from.name, debit: split.counterPkr, credit: 0, narration: `DR ${from.code} ${from.name} — ${verb.toLowerCase()} ${payment.payment_no}` },
      ...(await fxReverseLine(trx, split, payment.payment_no)),
      { account_id: to.id, account: to.name, debit: 0, credit: split.basePkr, narration: `CR ${to.code} ${to.name} — ${verb.toLowerCase()} ${payment.payment_no}` },
    ],
  });
  return je ? je.id : null;
}

/**
 * Dispose of every receipt on a cancelled order. `payments` are the payment
 * rows linked to the order's receivables. Throws (400) when money was received
 * and no disposition was chosen, or a forfeit has no Owner authorisation.
 * Returns { refunded, credited, forfeited, voided, receipts: [...] }.
 */
async function disposeOrderReceipts(trx, {
  order, payments, disposition = null, refundBankAccountId = null, refundDate = null,
  refundReference = null, userId = null, ownerId = null, reason = null,
}) {
  const confirmed = payments.filter(isConfirmed);
  const pending = payments.filter((p) => p.status === PENDING);
  const out = { refunded: 0, credited: 0, forfeited: 0, voided: 0, receipts: [] };

  if (confirmed.length) {
    if (!DISPOSITIONS.includes(disposition)) {
      throw httpError(`Order ${order.order_no} has ${confirmed.length} confirmed receipt(s). Choose what happens to the money: refund it, keep it as the customer's credit, or (Owner only) forfeit it.`);
    }
    if (disposition === 'forfeit' && !ownerId) {
      throw httpError('Forfeiting money a buyer paid needs an Owner\'s approval.', 403);
    }
  }

  const receivables = {};
  for (const p of confirmed) {
    if (p.linked_receivable_id && !receivables[p.linked_receivable_id]) {
      // eslint-disable-next-line no-await-in-loop
      receivables[p.linked_receivable_id] = await trx('receivables').where({ id: p.linked_receivable_id }).first();
    }
    const receivable = receivables[p.linked_receivable_id] || null;
    // eslint-disable-next-line no-await-in-loop
    const split = await receiptSplit(trx, p, receivable);
    let refundPaymentId = null; let journalId = null; let creditStatus = null;
    if (disposition === 'refund') {
      // eslint-disable-next-line no-await-in-loop
      ({ refundPaymentId, journalId } = await refund(trx, {
        order, payment: p, receivable, split, bankAccountId: refundBankAccountId, refundDate, refundReference, userId, reason,
      }));
      out.refunded += 1;
    } else if (disposition === 'credit') {
      // eslint-disable-next-line no-await-in-loop
      journalId = await reclass(trx, { order, payment: p, split, toCode: CREDIT_CODE, verb: 'Customer credit from', userId });
      creditStatus = 'Open';
      out.credited += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      journalId = await reclass(trx, { order, payment: p, split, toCode: FORFEIT_CODE, verb: 'Forfeited', userId });
      out.forfeited += 1;
    }
    // eslint-disable-next-line no-await-in-loop
    const [row] = await trx('export_receipt_dispositions').insert({
      order_id: order.id,
      payment_id: p.id,
      customer_id: order.customer_id || null,
      disposition,
      amount: round2(num(p.amount)),
      currency: String(p.currency || 'PKR').toUpperCase(),
      amount_pkr: split.basePkr,
      refund_payment_id: refundPaymentId,
      journal_id: journalId,
      credit_status: creditStatus,
      authorized_by_owner_id: ownerId || null,
      reason: reason || null,
      created_by: userId || null,
    }).returning('*');
    out.receipts.push(row);
  }

  const pendingIds = pending.map((p) => p.id);
  if (pendingIds.length) {
    await trx('payments').whereIn('id', pendingIds).update({
      status: 'Rejected',
      reject_reason: `Order${order.order_no ? ` ${order.order_no}` : ''} cancelled before Finance confirmed this receipt`,
      confirmed_by: userId || null,
      confirmed_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    out.voided = pendingIds.length;
  }
  return out;
}

module.exports = { disposeOrderReceipts, isConfirmed, receiptSplit, DISPOSITIONS };
