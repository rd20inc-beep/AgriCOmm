/**
 * The one money-movement engine. Every receipt and every payment — Money In /
 * Money Out, the Purchases tab, Mill Store, Printed Bags, expenses, export
 * receipt confirmation, service-milling invoices — is written here, inside the
 * caller's transaction:
 *
 *   1. the payment row, carrying the document it settles (payable / receivable
 *      and the source behind it: expense, lot, mill purchase, export cost,
 *      printed-bag order, local sale, service invoice, export order);
 *   2. the cash / bank account moved in the account's own currency (a non-PKR
 *      account moves only its own currency);
 *   3. a bank_transactions row for that move, linked to the payment;
 *   4. the GL journal — Dr/Cr 1000 Cash & Bank against the document's own
 *      account — posted in the same transaction, so a ledger failure rolls the
 *      whole payment back;
 *   5. the documents settled by a signed delta (payable / receivable, the
 *      source row, the local sale, the service invoice).
 *
 * A cheque — same-day included — is recorded but settles nothing, moves no
 * account and posts no journal until it clears (Clear Cheque does all three
 * through the same helpers).
 *
 * The other writers are thin adapters: they keep their own validation and
 * their own parent-document bookkeeping (an export order's advance / balance),
 * and hand the money movement to recordMoneyMovement.
 */
const fxRateService = require('./fxRate.service');
const { resolvePaymentAccountId } = require('../../shared/cashAccounts');
const { assertAccountCurrency } = require('../../shared/accountCurrency');
const { assertMillEntity, assertMillAccount } = require('../../shared/millPayer');
const {
  isCheque, postPaymentJournal, settleDocuments, resolveSource,
  pendingChequeTotal, nextBtNo, round2,
} = require('./paymentSettlement');

const num = (v) => parseFloat(v) || 0;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const isoDay = (d) => {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

/**
 * PAY-NNN. Scoped to its own namespace: other shapes (PAY-MS001, PAY-EOC0001,
 * legacy PP- / EXP-PAY- / PS- rows) live alongside and must not be parsed.
 */
async function generatePaymentNo(trx) {
  const last = await trx('payments')
    .whereRaw("payment_no ~ '^PAY-[0-9]+$'")
    .orderByRaw("CAST(REPLACE(payment_no, 'PAY-', '') AS INTEGER) DESC")
    .first('payment_no');
  const n = last?.payment_no ? (parseInt(String(last.payment_no).replace('PAY-', ''), 10) || 0) : 0;
  return `PAY-${String(n + 1).padStart(3, '0')}`;
}

/**
 * What is still owed on a payable / receivable, net of cheques written against
 * it and not yet cleared (they have not touched paid_amount, yet the money is
 * spoken for). Refuses a fully-settled row and an amount above the rest.
 */
async function assertWithinOutstanding(trx, { row, isReceipt, amount }) {
  const pendingCheques = await pendingChequeTotal(trx, isReceipt ? { receivableId: row.id } : { payableId: row.id });
  const total = num(isReceipt ? row.expected_amount : row.original_amount);
  const settled = num(isReceipt ? row.received_amount : row.paid_amount);
  const outstanding = Math.max(0, total - settled - pendingCheques);
  const chequeNote = pendingCheques > 0.01 ? ` (after ${pendingCheques.toFixed(2)} in uncleared cheques)` : '';
  if (outstanding <= 0.01) {
    throw httpError(`This ${isReceipt ? 'receivable' : 'payable'} is already fully settled — no payment is due${chequeNote}.`);
  }
  if (amount - outstanding > 0.01) {
    throw httpError(`Amount exceeds the outstanding balance of ${outstanding.toFixed(2)}${chequeNote}.`);
  }
  return outstanding;
}

/**
 * Move a cash / bank account and write its bank_transactions row — the one way
 * money enters or leaves an account (the engine, and the statutory remittance,
 * which pays a liability account rather than a document).
 */
async function postAccountMovement(trx, {
  account, direction, amount, date, reference = null, paymentId = null, userId = null,
  source, notes = null, counterparty = null, category = null,
}) {
  const amt = round2(amount);
  await trx('bank_accounts').where({ id: account.id })[direction === 'in' ? 'increment' : 'decrement']('current_balance', amt);
  const [row] = await trx('bank_transactions').insert({
    transaction_no: await nextBtNo(trx),
    bank_account_id: account.id,
    type: direction === 'in' ? 'credit' : 'debit',
    amount: amt,
    currency: account.currency || 'PKR',
    status: 'posted',
    transaction_date: date || new Date(),
    reference,
    counterparty,
    category,
    notes,
    source,
    linked_payment_id: paymentId,
    created_by: userId || null,
  }).returning('*');
  return row;
}

/**
 * Record one receipt or payment. Runs inside `trx`; throws (statusCode set for
 * the user's mistakes) so the caller's transaction rolls back.
 *
 * opts:
 *   type             'payment' | 'receipt'
 *   payable / receivable          rows already read under lock, or
 *   payableId / receivableId      ids, read here under lock
 *   source           { table, id } the payment settles when there is no payable
 *                    (or to name it explicitly); else resolved from the payable
 *   amount, currency, fxRate      native amount; fxRate defaults to 1 for PKR,
 *                                 else the latest rate for the currency
 *   method, bankAccountId, accountEntity (whose cash float a cash payment with
 *                    no account uses)
 *   paymentDate, dueDate, bankReference, notes
 *   wht, whtRate, discount, attachmentUrl, attachmentName   (payments only)
 *   paymentNo        defaults to the next PAY-NNN
 *   extra            more payments columns (status, confirmed_by, created_by …)
 *   userId, millOnly, checkOutstanding (default true)
 *   journal          postPaymentJournal overrides (refType, refNo, counterCode,
 *                    entity, partyType, partyId, description, origCurrency, origFxRate)
 *   bt               { source, notes, counterparty, category } for the bank row
 *   stamp            extra fields for a source row that records how it was paid
 *
 * Returns { payment, accountId, isPostDated, bankMove, journal, settled }.
 */
async function recordMoneyMovement(trx, opts) {
  const {
    type, source: sourceIn = null, currency = 'PKR', fxRate = null, method = null,
    bankAccountId = null, accountEntity = null, paymentDate = null, dueDate = null,
    bankReference = null, notes = null, whtRate = null, attachmentUrl = null, attachmentName = null,
    paymentNo = null, extra = {}, userId = null, millOnly = false, checkOutstanding = true,
    journal: journalOpts = {}, bt = {}, stamp = null,
  } = opts;
  if (type !== 'payment' && type !== 'receipt') throw httpError('type must be payment or receipt.');
  const isReceipt = type === 'receipt';
  const amt = round2(opts.amount);
  if (!(amt > 0)) throw httpError('Amount must be greater than zero.');
  const whtNum = isReceipt ? 0 : Math.max(0, num(opts.wht));
  const discNum = isReceipt ? 0 : Math.max(0, num(opts.discount));
  if (whtNum + discNum - amt > 0.01) throw httpError('Withholding tax + discount cannot exceed the payment amount.');
  const isPostDated = isCheque(method);

  // The document, under lock: two payments racing on one row must not both
  // pass the outstanding check and each write their own figure.
  let payable = isReceipt ? null : (opts.payable || null);
  let receivable = isReceipt ? (opts.receivable || null) : null;
  if (!isReceipt && !payable && opts.payableId) {
    payable = await trx('payables').where({ id: opts.payableId }).forUpdate().first();
    if (!payable) throw httpError('Payable not found.', 404);
  }
  if (isReceipt && !receivable && opts.receivableId) {
    receivable = await trx('receivables').where({ id: opts.receivableId }).forUpdate().first();
    if (!receivable) throw httpError('Receivable not found.', 404);
  }
  const linked = isReceipt ? receivable : payable;
  if (millOnly && linked) {
    // A receivable raised from a local sale is the mill's (it posts to 1120).
    assertMillEntity(linked.local_sale_id ? 'mill' : linked.entity, isReceipt ? 'receivables' : 'payables');
  }
  if (linked && checkOutstanding) await assertWithinOutstanding(trx, { row: linked, isReceipt, amount: amt });

  const source = sourceIn || (!isReceipt && payable ? await resolveSource(trx, { payable }) : null);

  // The account the money moves through. Cash with none picked lands in the
  // owning entity's cash float; any other method must name one, except a
  // cheque, which moves money only when it clears.
  const accountId = await resolvePaymentAccountId(trx, {
    bankAccountId,
    method,
    entity: accountEntity || (linked?.local_sale_id ? 'mill' : (linked?.entity || 'general')),
    isPostDated,
  });
  if (millOnly) await assertMillAccount(trx, accountId || bankAccountId);
  const cur = String(currency || 'PKR').toUpperCase();
  const acct = accountId ? await trx('bank_accounts').where({ id: accountId }).first() : null;
  if (accountId && !acct) throw httpError('Bank account not found.');
  if (acct) assertAccountCurrency(acct, cur);

  const fx = cur === 'PKR' ? 1 : (num(fxRate) > 0 ? num(fxRate) : num((await fxRateService.getLatestRate(cur)).rate));
  const basePkr = round2(cur === 'PKR' ? amt : amt * fx);
  const no = paymentNo || await generatePaymentNo(trx);

  const [payment] = await trx('payments').insert({
    payment_no: no,
    type,
    linked_receivable_id: receivable?.id || null,
    linked_payable_id: payable?.id || null,
    source_table: source?.table || null,
    source_id: source?.id || null,
    local_sale_id: receivable?.local_sale_id || null,
    service_invoice_id: receivable?.service_invoice_id || null,
    amount: amt,
    currency: cur,
    fx_rate: fx,
    base_amount_pkr: basePkr,
    payment_method: method || null,
    bank_account_id: accountId || null,
    bank_reference: bankReference || null,
    due_date: isPostDated ? isoDay(dueDate || paymentDate) : (dueDate || null),
    cleared: !isPostDated,
    payment_date: paymentDate || trx.fn.now(),
    notes: notes || null,
    wht_amount: whtNum,
    wht_rate: (!isReceipt && whtRate != null && whtRate !== '') ? num(whtRate) : null,
    discount_amount: discNum,
    attachment_url: attachmentUrl || null,
    attachment_name: attachmentName || null,
    created_by: userId || null,
    ...extra,
  }).returning('*');

  if (isPostDated) return { payment, accountId, isPostDated, bankMove: 0, journal: null, settled: null };

  const settled = await settleDocuments(trx, {
    payment, payable, receivable, delta: amt, deltaPkr: basePkr,
    stamp: stamp || { bank_account_id: accountId || null, payment_method: method || null, payment_reference: bankReference || null },
    paidOn: paymentDate ? new Date(paymentDate) : null,
  });

  let bankMove = 0;
  if (acct) {
    // Native when the account holds the payment's currency, else the PKR
    // figure stamped on the payment; only the NET (after WHT + discount)
    // leaves the bank. The bank row carries the same figure, so the Cash tab's
    // balance = Σ(transactions).
    bankMove = round2((String(acct.currency || 'PKR').toUpperCase() === cur ? amt : basePkr) - whtNum - discNum);
    await postAccountMovement(trx, {
      account: acct,
      direction: isReceipt ? 'in' : 'out',
      amount: bankMove,
      date: paymentDate || new Date(),
      reference: bankReference || no,
      paymentId: payment.id,
      userId,
      source: bt.source || 'record_payment',
      notes: bt.notes || `${isReceipt ? 'Receipt' : 'Payment'} ${no}`,
      counterparty: bt.counterparty || null,
      category: bt.category || null,
    });
  }

  const journal = await postPaymentJournal(trx, {
    payment, userId, date: paymentDate || new Date(), overrides: journalOpts,
  });

  return { payment, accountId, isPostDated, bankMove, journal, settled };
}

module.exports = { recordMoneyMovement, postAccountMovement, generatePaymentNo, assertWithinOutstanding };
