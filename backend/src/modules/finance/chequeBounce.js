/**
 * A cheque that was recorded but never cleared, marked BOUNCED (owner decision
 * B1). The payment row stays for audit with status 'Bounced', who bounced it,
 * when and why.
 *
 * What a bounce undoes is what the cheque actually did, which under the cheque
 * rules (2026-10-07) is nothing: an uncleared cheque settles no document, moves
 * no account and posts no journal (paymentEngine.recordMoneyMovement returns
 * before settleDocuments; Clear Cheque does all three). So the document is NOT
 * un-settled by a negative delta — that would understate what is still owed.
 * It is reopened because a Bounced cheque no longer counts as "in the post":
 * pendingChequeTotal, the local-sale cheque reservation and the Due Dates /
 * alert queries all leave it out, so the full outstanding is payable again.
 *
 * Belt and braces for cheques recorded under the older rules (a post-dated
 * cheque used to journal, and sometimes move the bank, when recorded): any
 * Posted journal under the payment number gets its signed delta, and any bank
 * movement linked to the payment is moved back — never reverse-and-repost.
 *
 * Optional bank return charge: Dr 6200 Bank Charges / Cr the charged account's
 * own GL (glAccountFor), in PKR, plus a 'debit' bank_transactions row through
 * the engine's postAccountMovement. A foreign account's charge is in its own
 * currency, valued at the fx_rates rate for the day (never the system fallback).
 */
const accountingService = require('../accounting/accounting.service');
const fxRateService = require('./fxRate.service');
const { glAccountFor } = require('../../shared/accountGl');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const { postDeltaOf, round2 } = require('./paymentSettlement');
const { postAccountMovement } = require('./paymentEngine');

const num = (v) => parseFloat(v) || 0;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const isoDay = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : new Date().toISOString().slice(0, 10));
const entityOfAccount = (a) => (['mill', 'export', 'general'].includes(a?.entity) ? a.entity : 'general');

/** Why this payment cannot bounce, or null when it can. Mirrors bounceCheque. */
function bounceBlockedReason(p) {
  if (!p) return 'Payment not found.';
  if (String(p.payment_method || '').toLowerCase() !== 'cheque') return 'Only a cheque can bounce.';
  if (p.status === 'Bounced') return 'This cheque has already bounced.';
  if (p.status === 'Reversed') return 'This cheque was reversed — it cannot bounce.';
  if (p.status === 'Rejected' || p.status === 'Superseded' || p.status === 'Pending Finance Confirmation') return 'This cheque was never confirmed — it cannot bounce.';
  if (p.cleared !== false) return 'This cheque has cleared — reverse the payment instead.';
  return null;
}

/**
 * Mark payment `paymentId` Bounced inside `trx`. Throws (statusCode set) on a
 * refusal so the caller's transaction rolls back.
 * opts: reason (required), bankCharge, chargeDate, chargeAccountId, userId.
 * Returns { payment, charge: { amount, currency, amountPkr, accountId } | null, mirrored }.
 */
async function bounceCheque(trx, { paymentId, reason, bankCharge = null, chargeDate = null, chargeAccountId = null, userId = null }) {
  const why = String(reason || '').trim();
  if (!why) throw httpError('A reason is required to mark a cheque bounced.');
  // Locked: a bounce must not race a clear or a reversal of the same cheque.
  const p = await trx('payments').where({ id: paymentId }).forUpdate().first();
  if (!p) throw httpError('Payment not found.', 404);
  const blocked = bounceBlockedReason(p);
  if (blocked) throw httpError(blocked, String(p.payment_method || '').toLowerCase() === 'cheque' ? 409 : 400);

  const charge = round2(num(bankCharge));
  if (charge < 0) throw httpError('The bank charge cannot be negative.');
  const day = isoDay(chargeDate);
  const label = `Cheque ${p.payment_no}${p.bank_reference ? ` (${p.bank_reference})` : ''} bounced — ${why}`;

  // 1) Legacy cheques only: undo a journal / bank move made at recording.
  let mirrored = 0;
  try {
    mirrored = await postDeltaOf(trx, {
      refNo: p.payment_no, refTypes: ['Payment', 'Local Sale Receipt'],
      refType: 'Cheque Bounce', description: label, userId, date: isoDay(new Date()),
      cashAccountId: p.bank_account_id || null,
    });
  } catch (e) { throw ledgerFailure(e, 'The bounce'); }
  const moved = await trx('bank_transactions').where({ linked_payment_id: p.id, status: 'posted' }).select('bank_account_id', 'type', 'amount');
  const netByAccount = new Map();
  for (const b of Array.isArray(moved) ? moved : []) {
    const signed = (b.type === 'credit' ? 1 : -1) * num(b.amount);
    netByAccount.set(b.bank_account_id, round2((netByAccount.get(b.bank_account_id) || 0) + signed));
  }
  for (const [acctId, net] of netByAccount) {
    if (Math.abs(net) < 0.005) continue;
    const acct = await trx('bank_accounts').where({ id: acctId }).first();
    if (!acct) continue;
    await postAccountMovement(trx, {
      account: acct, direction: net > 0 ? 'out' : 'in', amount: Math.abs(net), date: day,
      reference: p.payment_no, paymentId: p.id, userId, source: 'cheque_bounce', notes: label,
    });
  }

  // 2) The bank's return charge.
  let chargeOut = null;
  if (charge > 0) {
    const acctId = chargeAccountId || p.bank_account_id || null;
    if (!acctId) throw httpError('Choose the account the bank charged.');
    const acct = await trx('bank_accounts').where({ id: acctId }).first();
    if (!acct) throw httpError('Bank account not found.');
    const cur = String(acct.currency || 'PKR').toUpperCase();
    let rate = 1;
    if (cur !== 'PKR') {
      const r = await fxRateService.getRateForDate(cur, day);
      if (!r || !(num(r.rate) > 0) || r.source !== 'fx_rates') {
        throw httpError(`No ${cur}→PKR rate is recorded for ${day} — add one in Rates before charging ${acct.name}.`);
      }
      rate = num(r.rate);
    }
    const chargePkr = round2(charge * rate);
    await postAccountMovement(trx, {
      account: acct, direction: 'out', amount: charge, date: day, reference: p.payment_no, paymentId: p.id, userId,
      source: 'cheque_bounce', category: 'Bank Charges', counterparty: 'Bank charges',
      notes: `Bank charge on bounced cheque ${p.payment_no}`,
    });
    try {
      const [fee, cash] = await Promise.all([
        trx('chart_of_accounts').where({ code: '6200' }).first(),
        glAccountFor(trx, acct),
      ]);
      if (!fee || !cash) throw missingAccounts(['6200', '1000'], 'The bank charge');
      const j = await accountingService.createJournal(trx, {
        date: day, entity: entityOfAccount(acct), refType: 'Cheque Bounce Charge', refNo: p.payment_no,
        description: `Bank charge on bounced cheque ${p.payment_no} (${acct.name})`,
        currency: 'PKR', fxRate: 1, isAuto: true, userId,
        origCurrency: cur !== 'PKR' ? cur : null, origFxRate: cur !== 'PKR' ? rate : null,
        lines: [
          { account_id: fee.id, account: fee.name, debit: chargePkr, credit: 0, narration: `DR ${fee.code} ${fee.name} — bounced ${p.payment_no}` },
          { account_id: cash.id, account: cash.name, debit: 0, credit: chargePkr, narration: `CR ${cash.code} ${cash.name} — bounced ${p.payment_no}` },
        ],
      });
      if (j?.id) await accountingService.postJournal(trx, j.id);
    } catch (e) { throw ledgerFailure(e, 'The bank charge'); }
    chargeOut = { amount: charge, currency: cur, amountPkr: chargePkr, accountId: acct.id };
  }

  // 3) The payment itself: kept, marked Bounced.
  const [updated] = await trx('payments').where({ id: p.id }).update({
    status: 'Bounced', bounced_at: trx.fn.now(), bounced_by: userId || null,
    bounce_reason: why, updated_at: trx.fn.now(),
  }).returning('*');
  return { payment: updated || { ...p, status: 'Bounced', bounce_reason: why }, charge: chargeOut, mirrored };
}

module.exports = { bounceCheque, bounceBlockedReason };
