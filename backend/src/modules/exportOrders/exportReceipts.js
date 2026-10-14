/**
 * An export order's receipts — the advance and the balance — recorded and
 * confirmed in one place, whichever screen the money is entered on (the order's
 * Financials tab, Finance ▸ Confirmations, or Money In against the order's
 * RCV-ADV- / RCV-BAL- receivable).
 *
 *   recordPendingExportReceipt  — the maker: a payment row at 'Pending Finance
 *                                 Confirmation'; no bank, no GL, no settlement.
 *   postExportReceipt           — the checker's posting: the order's advance /
 *                                 balance, its financial_status and workflow
 *                                 promotion, plus the money itself through the
 *                                 one payment engine (receivable, bank +
 *                                 bank_transactions row, journal Dr 1000 /
 *                                 Cr 1310 advance or Cr 1110 balance) — all in
 *                                 the caller's transaction.
 *
 * The journal keeps its ref_type 'Export Order' / ref_no = order number, so
 * cancelling the order still finds and reverses it, and Money Out's
 * reverse-payment still refuses it (undone from the order).
 */
const inventoryService = require('../../services/inventoryService');
const workflowService = require('../../services/exportOrderWorkflowService');
const { recordMoneyMovement, generatePaymentNo } = require('../finance/paymentEngine');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { isCheque, applyReceivableDelta, bookedRateFor } = require('../finance/paymentSettlement');
const accountingService = require('../accounting/accounting.service');
const { shortReceiptToleranceUsd, shortWriteOffAccount, BANK_CHARGES_CODE } = require('./receiptSettings');

const { MONEY_EPSILON, settledAmount } = workflowService;
const PENDING = 'Pending Finance Confirmation';
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const lockRow = (q) => (typeof q?.forUpdate === 'function' ? q.forUpdate() : q);

// D-8: what the banks deduct from a wire (bank charges) is the company's
// expense, up to a tolerance set in USD. Above it, or on a non-USD order, the
// receipt is recorded for what arrived and the rest goes to an Owner-approved
// write-off. Returns the charge, 2dp; throws a 400 when it is not allowed.
async function checkBankCharges(conn, { bankCharges, currency }) {
  const charges = settledAmount(bankCharges || 0);
  if (charges < 0) throw httpError('Bank charges cannot be negative.');
  if (charges <= 0) return 0;
  if ((currency || 'USD') !== 'USD') {
    throw httpError('Bank charges can be entered on a USD receipt only. Record what arrived; the shortfall can be written off with Owner approval.');
  }
  const tolerance = await shortReceiptToleranceUsd(conn);
  if (charges - tolerance > MONEY_EPSILON) {
    throw httpError(`Bank charges of USD ${charges.toFixed(2)} exceed the USD ${tolerance.toFixed(2)} tolerance. Record what arrived; the shortfall needs an Owner-approved write-off.`);
  }
  return charges;
}

// Dr 6200 Bank Charges / Cr the receivable's account for the charge, in the
// caller's transaction, under the order's ref so cancelling the order finds it
// too. A balance clears 1110 at the BOOKED rate (what AR was raised at — the
// charge was never cash, so it realises no FX); an advance clears 1310 at the
// receipt's rate (what the advance is held at).
async function postReceiptChargeJournal(trx, {
  order, isAdvance, charges, ratePkr, userId, paymentNo, paymentDate,
}) {
  const amtPkr = settledAmount(charges * ratePkr);
  if (!(amtPkr > 0)) return null;
  const counterCode = isAdvance ? '1310' : '1110';
  const [exp, counter] = await Promise.all([
    trx('chart_of_accounts').where({ code: BANK_CHARGES_CODE }).first(),
    trx('chart_of_accounts').where({ code: counterCode }).first(),
  ]);
  if (!exp || !counter) throw httpError(`Chart of accounts is missing ${BANK_CHARGES_CODE} or ${counterCode}.`, 500);
  const foreign = (order.currency || 'USD') !== 'PKR';
  const ref = paymentNo || order.order_no;
  const d = paymentDate ? new Date(paymentDate) : new Date();
  const journal = await accountingService.createJournal(trx, {
    date: (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10),
    entity: 'export',
    refType: 'Export Order',
    refNo: order.order_no,
    description: `Bank charges on ${isAdvance ? 'advance' : 'balance'} receipt ${ref} (${order.order_no})`,
    currency: 'PKR',
    fxRate: 1,
    isAuto: true,
    userId: userId || null,
    partyType: order.customer_id ? 'customer' : null,
    partyId: order.customer_id || null,
    origCurrency: foreign ? order.currency : null,
    origFxRate: foreign ? ratePkr : null,
    lines: [
      { account_id: exp.id, account: exp.name, debit: amtPkr, credit: 0, narration: `DR ${exp.code} ${exp.name} — deducted from ${ref}` },
      { account_id: counter.id, account: counter.name, debit: 0, credit: amtPkr, narration: `CR ${counter.code} ${counter.name} — bank charges ${ref}` },
    ],
  });
  if (journal?.id) await accountingService.postJournal(trx, journal.id);
  return journal?.id || null;
}

// Maker-checker (audit R10a): whoever recorded a receipt does not confirm it —
// except an Owner or Super Admin, who answer for the books anyway. Resolved by
// role NAME (role ids differ between environments, see ownerApproval).
const SELF_CONFIRM_ROLES = ['Owner', 'Super Admin'];
async function maySelfConfirm(conn, userId) {
  if (!userId) return false;
  const u = await conn('users').where({ id: userId }).first('role_id');
  const role = u && u.role_id ? await conn('roles').where({ id: u.role_id }).first('name') : null;
  return !!role && SELF_CONFIRM_ROLES.includes(role.name);
}
const SELF_CONFIRM_MESSAGE = 'You recorded this receipt, so another Finance user must confirm it (maker-checker). Only an Owner may confirm a receipt they recorded.';
async function assertNotSelfConfirm(conn, { recordedBy, userId, message = SELF_CONFIRM_MESSAGE }) {
  if (!recordedBy || !userId || String(recordedBy) !== String(userId)) return;
  if (await maySelfConfirm(conn, userId)) return;
  throw httpError(message, 403);
}

/**
 * Record a pending advance / balance receipt (the maker's step). `order` is the
 * order row. Refuses more than is still outstanding, net of receipts already
 * pending. Returns the pending payment row.
 */
async function recordPendingExportReceipt(trx, {
  order, kind, amount, bankAccountId, fxRate, paymentDate, paymentMethod, bankReference, notes, userId, bankCharges = 0,
}) {
  const isAdvance = kind !== 'balance';
  const amt = settledAmount(amount);
  if (!(amt > 0)) throw httpError('A positive amount is required.');
  if (['Closed', 'Cancelled'].includes(order.status)) {
    throw httpError(`Cannot record a receipt for an order in '${order.status}' status.`);
  }
  const charges = await checkBankCharges(trx, { bankCharges, currency: order.currency });

  const expected = settledAmount(isAdvance ? order.advance_expected : order.balance_expected);
  const received = settledAmount(isAdvance ? order.advance_received : order.balance_received);
  // Already-pending receipts of this kind reduce what can still be recorded.
  const recv = await trx('receivables').where({ order_id: order.id, type: isAdvance ? 'Advance' : 'Balance' }).first();
  const pendingRow = await trx('payments')
    .where({ status: PENDING, type: 'receipt' })
    .modify((q) => { if (recv) q.where('linked_receivable_id', recv.id); else q.whereRaw('1=0'); })
    .sum('amount as s').first();
  const pending = settledAmount(pendingRow && pendingRow.s);
  const room = Math.max(0, settledAmount(expected - received - pending));
  // The buyer paid amount + bank charges; both come off what is owed.
  if (expected > 0 && amt + charges - room > MONEY_EPSILON) {
    throw httpError(`Amount exceeds what's still outstanding for this ${isAdvance ? 'advance' : 'balance'} (${room.toFixed(2)}${pending > 0 ? `, ${pending.toFixed(2)} already pending` : ''}).`);
  }

  const orderCurrency = order.currency || 'USD';
  // FX at record time is only an ESTIMATE; Finance sets the real rate at
  // confirm. base_amount_pkr is NOT NULL, so store the estimate (this row is
  // excluded from Money-In until confirmed, so it books no real money).
  const fxEst = orderCurrency === 'PKR' ? 1 : (parseFloat(fxRate) > 0 ? parseFloat(fxRate) : (parseFloat(order.booked_fx_rate) || 0));
  const [row] = await trx('payments').insert({
    payment_no: await generatePaymentNo(trx),
    type: 'receipt',
    status: PENDING,
    linked_receivable_id: recv ? recv.id : null,
    source_table: 'export_orders',
    source_id: order.id,
    amount: amt,
    bank_charges: charges,
    currency: orderCurrency,
    fx_rate: fxEst || null,
    base_amount_pkr: settledAmount(amt * fxEst),
    payment_method: paymentMethod ? String(paymentMethod).toLowerCase().replace(/\s+/g, '_') : null,
    // #6 — default to the order's bank account when the recorder didn't pick one.
    bank_account_id: bankAccountId || order.bank_account_id || null,
    bank_reference: bankReference || null,
    payment_date: paymentDate || trx.fn.now(),
    notes: notes || `${isAdvance ? 'Advance' : 'Balance'} receipt for ${order.order_no} — pending Finance confirmation`,
    created_by: userId || null,
  }).returning('*');

  // #2 financial track: an advance receipt awaiting Finance confirmation moves
  // the order's financial_status to 'Pending Confirmation' WITHOUT touching the
  // operational status. Balance receipts don't affect the advance track.
  if (isAdvance) {
    await trx('export_orders').where({ id: order.id }).update({
      financial_status: 'Pending Confirmation',
      updated_at: trx.fn.now(),
    });
  }
  return row;
}

/**
 * Post a confirmed advance / balance receipt (the checker's step), inside `trx`.
 * `orderWhere` finds the order ({ id } or { order_no }). `recordedBy` keeps the
 * maker on the posted row when a pending receipt is being confirmed.
 * Returns the context the caller needs for its post-commit automation.
 */
async function postExportReceipt(trx, {
  orderWhere, kind, amount, fxRate, bankAccountId, paymentMethod, paymentDate, bankReference, notes,
  userId, recordedBy = null, bankCharges = 0,
}) {
  const isAdvance = kind !== 'balance';
  const label = isAdvance ? 'advance' : 'balance';
  if (!amount || parseFloat(amount) <= 0) throw httpError('A positive amount is required.');
  const confirmedAmount = settledAmount(amount);

  const order = await lockRow(trx('export_orders').where(orderWhere)).first();
  if (!order) throw httpError('Export order not found.', 404);
  if (['Closed', 'Cancelled'].includes(order.status)) {
    throw httpError(`Cannot confirm ${label} for an order in '${order.status}' status.`);
  }

  // What the banks deducted (D-8) settles the receivable along with the amount.
  const charges = await checkBankCharges(trx, { bankCharges, currency: order.currency });
  const settles = settledAmount(confirmedAmount + charges);

  const expected = settledAmount(isAdvance ? order.advance_expected : order.balance_expected);
  const receivedSoFar = settledAmount(isAdvance ? order.advance_received : order.balance_received);
  const outstanding = Math.max(0, settledAmount(expected - receivedSoFar));
  if (outstanding <= MONEY_EPSILON) {
    throw httpError(isAdvance ? 'Advance has already been fully received for this order.' : 'Balance has already been fully received for this order.');
  }
  if (settles - outstanding > MONEY_EPSILON) {
    throw httpError(`${isAdvance ? 'Advance' : 'Balance'} confirmation${charges > 0 ? ' plus bank charges' : ''} exceeds outstanding amount of ${outstanding.toFixed(2)}.`);
  }
  const newReceived = settledAmount(receivedSoFar + settles);

  // The rate the bank actually applied: the one Finance entered, else the
  // advance / booked rate so older clients keep working. PKR orders: 1.
  const currency = order.currency || 'USD';
  const isPkrOrder = currency === 'PKR';
  const requested = parseFloat(fxRate);
  const fallbackRate = isAdvance
    ? (parseFloat(order.booked_fx_rate) || 280)
    : (parseFloat(order.advance_fx_rate) || parseFloat(order.booked_fx_rate) || 280);
  const effectiveFxRate = isPkrOrder ? 1 : (Number.isFinite(requested) && requested > 0 ? requested : fallbackRate);
  const receiptPkr = settledAmount(confirmedAmount * effectiveFxRate);
  // The order's PKR received counts what the buyer paid, charges included: the
  // advance is released from 1310 by advance_received_pkr at shipment, and
  // 1310 is credited with the charge as well as the cash.
  const settlesPkr = settledAmount(settles * effectiveFxRate);

  const receivable = await lockRow(trx('receivables').where({ order_id: order.id, type: isAdvance ? 'Advance' : 'Balance' })).first();
  // Guard against a double receipt: a receivable already settled (e.g. by an
  // older Money-In receipt that never reached the order) cannot take another.
  if (receivable) {
    const recvOutstanding = Math.max(0, settledAmount(
      parseFloat(receivable.expected_amount || 0) - parseFloat(receivable.received_amount || 0),
    ));
    if (recvOutstanding <= MONEY_EPSILON) {
      throw httpError(`This ${label} has already been received (the receivable is settled). It may have been recorded via Money-In → Record Payment.`);
    }
    if (settles - recvOutstanding > MONEY_EPSILON) {
      throw httpError(`${isAdvance ? 'Advance' : 'Balance'} confirmation exceeds the receivable's outstanding amount of ${recvOutstanding.toFixed(2)}.`);
    }
  }

  // A receipt is confirmed when the money is in the bank. A cheque would
  // settle nothing until it clears, while the order already counts it.
  let method;
  try {
    method = normalizePaymentMethod(paymentMethod ? String(paymentMethod).toLowerCase().replace(/\s+/g, '_') : null, 'bank_transfer');
  } catch (e) { throw httpError(e.message); }
  if (isCheque(method)) {
    throw httpError('An export receipt is confirmed once the money is in the bank — record the cheque when it has cleared, as a bank transfer.');
  }

  // The order's own advance / balance figures.
  if (isAdvance) {
    await trx('export_orders').where({ id: order.id }).update({
      advance_received: newReceived,
      advance_date: paymentDate || trx.fn.now(),
      advance_fx_rate: isPkrOrder ? null : effectiveFxRate,
      advance_received_pkr: settledAmount((parseFloat(order.advance_received_pkr) || 0) + settlesPkr),
      // #2 financial track: fully received → Confirmed (dispatch unlocked),
      // otherwise Partially Confirmed. (Operational status is untouched.)
      financial_status: newReceived >= expected - MONEY_EPSILON ? 'Confirmed' : 'Partially Confirmed',
      updated_at: trx.fn.now(),
    });
  } else {
    await trx('export_orders').where({ id: order.id }).update({
      balance_received: newReceived,
      balance_date: paymentDate || trx.fn.now(),
      balance_fx_rate: isPkrOrder ? null : effectiveFxRate,
      balance_received_pkr: settledAmount((parseFloat(order.balance_received_pkr) || 0) + settlesPkr),
      updated_at: trx.fn.now(),
    });
  }

  // The money: receivable, bank + bank_transactions, journal — one engine.
  // #6 — the receipt lands in the bank chosen for it, else the order's.
  const description = isPkrOrder
    ? `${isAdvance ? 'Adv' : 'Bal'} rcpt ${order.order_no}`
    : `${isAdvance ? 'Adv' : 'Bal'} rcpt ${order.order_no} (${currency} ${confirmedAmount.toLocaleString()} @ ${effectiveFxRate})`;
  const { payment } = await recordMoneyMovement(trx, {
    type: 'receipt',
    receivable: receivable || null,
    source: { table: 'export_orders', id: order.id },
    amount: confirmedAmount,
    currency,
    fxRate: effectiveFxRate,
    method,
    bankAccountId: bankAccountId || order.bank_account_id || null,
    accountEntity: 'export',
    paymentDate: paymentDate || null,
    bankReference: bankReference || null,
    notes: notes || `${isAdvance ? 'Advance' : 'Balance'} payment for ${order.order_no}`,
    userId,
    checkOutstanding: false, // checked above against the order and its receivable
    extra: {
      created_by: recordedBy || userId || null,
      confirmed_by: userId || null,
      confirmed_at: trx.fn.now(),
    },
    journal: {
      refType: 'Export Order',
      refNo: order.order_no,
      counterCode: isAdvance ? '1310' : '1110',
      entity: 'export',
      partyType: order.customer_id ? 'customer' : null,
      partyId: order.customer_id || null,
      description,
      origCurrency: isPkrOrder ? null : currency,
      origFxRate: isPkrOrder ? null : effectiveFxRate,
    },
    bt: { source: 'export_receipt', notes: `${isAdvance ? 'Advance' : 'Balance'} receipt ${order.order_no}` },
  });

  if (charges > 0) {
    if (payment?.id) await trx('payments').where({ id: payment.id }).update({ bank_charges: charges });
    if (receivable) {
      const fresh = await lockRow(trx('receivables').where({ id: receivable.id })).first();
      await applyReceivableDelta(trx, fresh, charges);
    }
    const booked = isAdvance || isPkrOrder ? 0 : await bookedRateFor(trx, { payment: payment || {}, receivable });
    await postReceiptChargeJournal(trx, {
      order, isAdvance, charges,
      ratePkr: isPkrOrder ? 1 : (booked > 0 ? booked : effectiveFxRate),
      userId, paymentNo: payment?.payment_no, paymentDate,
    });
  }

  if (isAdvance) {
    await workflowService.maybePromoteAfterAdvance(trx, {
      order, newAdvanceReceived: newReceived, userId, reason: `Advance payment of ${confirmedAmount} confirmed`,
    });
    // Best-effort auto-reserve of the STILL-UNRESERVED portion of the order,
    // in a savepoint so a failure cannot abort the posting transaction.
    try {
      await trx.transaction(async (sp) => {
        const targetKg = (parseFloat(order.qty_mt) || 0) * 1000; // MT (doc) → KG
        const alreadyRow = await sp('inventory_reservations')
          .where({ order_id: order.id, status: 'Active' })
          .sum('reserved_qty as r').first();
        const remainingKg = targetKg - (parseFloat(alreadyRow?.r) || 0);
        if (remainingKg > 0.0001) {
          const availableLot = await sp('inventory_lots')
            .where({ entity: 'export', type: 'finished', status: 'Available' })
            .where('available_qty', '>=', remainingKg)
            .first();
          if (availableLot) {
            await inventoryService.reserveStock(sp, { lotId: availableLot.id, orderId: order.id, qtyKg: remainingKg, userId });
          }
        }
      });
    } catch (e) { console.warn('Stock reservation failed:', e.message); }
  } else {
    await workflowService.maybePromoteAfterBalance(trx, {
      order, newBalanceReceived: newReceived, userId, reason: `Balance payment of ${confirmedAmount} confirmed`,
    });
  }

  return {
    orderId: order.id,
    orderNo: order.order_no,
    customerId: order.customer_id,
    currency,
    fxRate: effectiveFxRate,
    amountPkr: receiptPkr,
    bankCharges: charges,
    newReceived,
    payment,
  };
}

/**
 * Finance confirms a pending receipt: posts it (postExportReceipt) and marks
 * the pending placeholder Superseded in the SAME transaction, so a posting
 * failure leaves the pending row for another try. The posted row keeps the recorder as
 * created_by and the confirmer as confirmed_by — never the same person unless
 * an Owner / Super Admin (403 otherwise).
 */
async function confirmPendingExportReceipt(trx, {
  paymentId, fxRate, bankAccountId, paymentMethod, userId, bankCharges,
}) {
  const pending = await lockRow(trx('payments').where({ id: paymentId })).first();
  if (!pending) throw httpError('Payment not found.', 404);
  if (pending.status !== PENDING) throw httpError(`This receipt is already ${pending.status}.`, 409);
  await assertNotSelfConfirm(trx, { recordedBy: pending.created_by, userId });
  const recv = pending.linked_receivable_id ? await trx('receivables').where({ id: pending.linked_receivable_id }).first() : null;
  const orderId = recv?.order_id || (pending.source_table === 'export_orders' ? pending.source_id : null);
  if (!orderId) throw httpError('Cannot resolve the export order for this receipt.');
  const ctx = await postExportReceipt(trx, {
    orderWhere: { id: orderId },
    kind: recv && recv.type === 'Balance' ? 'balance' : 'advance',
    amount: pending.amount,
    fxRate: (fxRate != null && fxRate !== '') ? parseFloat(fxRate) : pending.fx_rate,
    bankAccountId: bankAccountId || pending.bank_account_id || null,
    paymentMethod: paymentMethod || pending.payment_method || null,
    paymentDate: pending.payment_date,
    bankReference: pending.bank_reference || null,
    notes: pending.notes,
    userId,
    recordedBy: pending.created_by || null,
    // Finance may correct the charge the recorder entered.
    bankCharges: bankCharges != null && bankCharges !== '' ? bankCharges : pending.bank_charges,
  });
  // The confirmed PAY row now exists. The pending placeholder is kept as
  // history (P2-15: receipts are never deleted), marked Superseded and pointing
  // at the posted row — like Rejected, every money reader leaves it out, so it
  // is not double-counted.
  await trx('payments').where({ id: pending.id }).update({
    status: 'Superseded',
    superseded_by_payment_id: ctx.payment ? ctx.payment.id : null,
    updated_at: trx.fn.now(),
  });
  return { ...ctx, isAdvance: !(recv && recv.type === 'Balance') };
}

/**
 * Write off what is left of a shipped order's balance (D-8), Owner-approved —
 * the route sits behind ownerApproval, and `ownerId` is the Owner who approved.
 *
 * Up to the tolerance (USD orders) it is a bank charge: Dr 6200. Above it, the
 * account named in setting export_short_write_off_account; while that is empty
 * the write-off is refused — which account carries a bad debt is the
 * accountant's call, not this code's. Either way Cr 1110 at the rate the
 * receivable was booked at, so 1110 clears exactly. The Balance receivable is
 * settled by the amount (its received figure — and, through migration 342, the
 * order's balance_received — includes it), the write-off row records who, why
 * and which journal, and the order can then be closed. No cash moves, so
 * balance_received_pkr (PKR actually fetched) is left alone.
 */
async function writeOffShortBalance(trx, {
  orderId, amount, reason, userId, ownerId,
}) {
  const why = String(reason || '').trim();
  if (!why) throw httpError('A reason is required to write off a balance.');
  if (!ownerId) throw httpError('An Owner must approve a write-off.', 403);

  const order = await lockRow(trx('export_orders').where({ id: orderId })).first();
  if (!order) throw httpError('Export order not found.', 404);
  if (!['Shipped', 'Arrived'].includes(order.status)) {
    throw httpError(`Only a shipped order's balance can be written off — this order is '${order.status}'.`);
  }
  const recv = await lockRow(trx('receivables').where({ order_id: order.id, type: 'Balance' })).first();
  if (!recv || recv.status === 'Written Off') throw httpError('This order has no open balance receivable.');
  const outstanding = Math.max(0, settledAmount(parseFloat(recv.expected_amount || 0) - parseFloat(recv.received_amount || 0)));
  if (outstanding <= MONEY_EPSILON) throw httpError('The balance is already settled.');
  const amt = amount == null || amount === '' ? outstanding : settledAmount(amount);
  if (!(amt > 0)) throw httpError('A positive amount is required.');
  if (amt - outstanding > MONEY_EPSILON) {
    throw httpError(`The write-off exceeds the outstanding balance of ${outstanding.toFixed(2)}.`);
  }
  // Pending balance receipts would settle the same money twice.
  const pending = await trx('payments').where({ linked_receivable_id: recv.id, status: PENDING }).first('id');
  if (pending) throw httpError('A balance receipt is waiting for Finance confirmation. Confirm or reject it first.');

  const currency = order.currency || 'USD';
  const tolerance = await shortReceiptToleranceUsd(trx);
  const withinTolerance = currency === 'USD' && amt - tolerance <= MONEY_EPSILON;
  const accountCode = withinTolerance ? BANK_CHARGES_CODE : await shortWriteOffAccount(trx);
  if (!accountCode) {
    throw httpError(`The shortfall is above the USD ${tolerance.toFixed(2)} bank-charge tolerance${currency !== 'USD' ? ' (or the order is not in USD)' : ''}, and no write-off account is set. Ask the accountant to name one in Settings (export_short_write_off_account).`);
  }

  const booked = currency === 'PKR' ? 1 : await bookedRateFor(trx, { payment: {}, receivable: recv });
  // FX: postings need a real rate (D-10); never a guess.
  if (!(booked > 0)) throw httpError('This receivable has no booked FX rate, so the write-off cannot be valued. Enter the order\'s booked rate first.');
  const amtPkr = settledAmount(amt * booked);

  const [dr, cr] = await Promise.all([
    trx('chart_of_accounts').where({ code: accountCode }).first(),
    trx('chart_of_accounts').where({ code: '1110' }).first(),
  ]);
  if (!dr || !cr) throw httpError(`Chart of accounts is missing ${accountCode} or 1110.`, 500);
  const foreign = currency !== 'PKR';
  const journal = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10),
    entity: 'export',
    refType: 'Export Order',
    refNo: order.order_no,
    description: `Short balance written off — ${order.order_no}: ${why}`.slice(0, 500),
    currency: 'PKR',
    fxRate: 1,
    isAuto: true,
    userId: userId || null,
    partyType: order.customer_id ? 'customer' : null,
    partyId: order.customer_id || null,
    origCurrency: foreign ? currency : null,
    origFxRate: foreign ? booked : null,
    lines: [
      { account_id: dr.id, account: dr.name, debit: amtPkr, credit: 0, narration: `DR ${dr.code} ${dr.name} — short balance ${order.order_no} written off` },
      { account_id: cr.id, account: cr.name, debit: 0, credit: amtPkr, narration: `CR ${cr.code} ${cr.name} — ${currency} ${amt.toFixed(2)} @ booked ${booked}` },
    ],
  });
  if (journal?.id) await accountingService.postJournal(trx, journal.id);

  await applyReceivableDelta(trx, recv, amt);
  await trx('receivables').where({ id: recv.id }).update({
    notes: [recv.notes, `${currency} ${amt.toFixed(2)} written off (Owner-approved)`].filter(Boolean).join('; '),
  });
  const [row] = await trx('export_receivable_write_offs').insert({
    order_id: order.id,
    receivable_id: recv.id,
    currency,
    amount: amt,
    fx_rate: foreign ? booked : 1,
    amount_pkr: amtPkr,
    account_code: accountCode,
    reason: why,
    journal_id: journal?.id || null,
    approved_by_owner_id: ownerId,
    created_by: userId || null,
  }).returning('*');
  return { writeOff: row, orderId: order.id, withinTolerance };
}

module.exports = {
  recordPendingExportReceipt, postExportReceipt, confirmPendingExportReceipt, assertNotSelfConfirm,
  writeOffShortBalance, checkBankCharges,
  SELF_CONFIRM_ROLES, PENDING,
};
