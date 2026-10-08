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
const { isCheque } = require('../finance/paymentSettlement');

const { MONEY_EPSILON, settledAmount } = workflowService;
const PENDING = 'Pending Finance Confirmation';
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const lockRow = (q) => (typeof q?.forUpdate === 'function' ? q.forUpdate() : q);

/**
 * Record a pending advance / balance receipt (the maker's step). `order` is the
 * order row. Refuses more than is still outstanding, net of receipts already
 * pending. Returns the pending payment row.
 */
async function recordPendingExportReceipt(trx, {
  order, kind, amount, bankAccountId, fxRate, paymentDate, paymentMethod, bankReference, notes, userId,
}) {
  const isAdvance = kind !== 'balance';
  const amt = settledAmount(amount);
  if (!(amt > 0)) throw httpError('A positive amount is required.');
  if (['Closed', 'Cancelled'].includes(order.status)) {
    throw httpError(`Cannot record a receipt for an order in '${order.status}' status.`);
  }

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
  if (expected > 0 && amt - room > MONEY_EPSILON) {
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
  userId, recordedBy = null,
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

  const expected = settledAmount(isAdvance ? order.advance_expected : order.balance_expected);
  const receivedSoFar = settledAmount(isAdvance ? order.advance_received : order.balance_received);
  const outstanding = Math.max(0, settledAmount(expected - receivedSoFar));
  if (outstanding <= MONEY_EPSILON) {
    throw httpError(isAdvance ? 'Advance has already been fully received for this order.' : 'Balance has already been fully received for this order.');
  }
  if (confirmedAmount - outstanding > MONEY_EPSILON) {
    throw httpError(`${isAdvance ? 'Advance' : 'Balance'} confirmation exceeds outstanding amount of ${outstanding.toFixed(2)}.`);
  }
  const newReceived = settledAmount(receivedSoFar + confirmedAmount);

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
    if (confirmedAmount - recvOutstanding > MONEY_EPSILON) {
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
      advance_received_pkr: settledAmount((parseFloat(order.advance_received_pkr) || 0) + receiptPkr),
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
      balance_received_pkr: settledAmount((parseFloat(order.balance_received_pkr) || 0) + receiptPkr),
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
    newReceived,
    payment,
  };
}

/**
 * Finance confirms a pending receipt: posts it (postExportReceipt) and removes
 * the pending placeholder in the SAME transaction, so a posting failure leaves
 * the pending row for another try. The posted row keeps the recorder as
 * created_by and the confirmer as confirmed_by.
 */
async function confirmPendingExportReceipt(trx, { paymentId, fxRate, bankAccountId, paymentMethod, userId }) {
  const pending = await lockRow(trx('payments').where({ id: paymentId })).first();
  if (!pending) throw httpError('Payment not found.', 404);
  if (pending.status !== PENDING) throw httpError(`This receipt is already ${pending.status}.`, 409);
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
  });
  // The confirmed PAY row now exists; drop the pending placeholder so it isn't
  // double-counted.
  await trx('payments').where({ id: pending.id }).del();
  return { ...ctx, isAdvance: !(recv && recv.type === 'Balance') };
}

module.exports = { recordPendingExportReceipt, postExportReceipt, confirmPendingExportReceipt, PENDING };
