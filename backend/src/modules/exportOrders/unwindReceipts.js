// Undo an export order's receipts when the order is cancelled.
//
// Only a receipt that was CONFIRMED ever credited a bank: confirmAdvance /
// confirmBalance insert the posted PAY row (status defaults to 'Confirmed') and
// increment bank_accounts.current_balance in the account's currency. A receipt
// recorded through recordExportReceipt sits at 'Pending Finance Confirmation'
// and moved no money; a 'Rejected' one never did either; a 'Reversed' one has
// already been put back. Decrementing the bank for those would take out money
// that was never put in.
//
//   confirmed (or legacy NULL) → debit the bank by exactly what confirm credited,
//                                drop its bank trail, delete the payment row
//   pending                    → marked Rejected (order cancelled), bank untouched
//   rejected / reversed        → left as they are
//
// The receipt journals themselves are reversed by the caller (cancelOrder
// step 2), which scopes them by ref_type 'Export Order'.

const PENDING = 'Pending Finance Confirmation';
const isConfirmed = (p) => p.status == null || p.status === 'Confirmed';

async function unwindOrderReceipts(trx, payments, { orderNo, userId } = {}) {
  const confirmed = payments.filter(isConfirmed);
  const pending = payments.filter((p) => p.status === PENDING);

  for (const p of confirmed) {
    if (!p.bank_account_id) continue;
    const bank = await trx('bank_accounts').where({ id: p.bank_account_id }).first();
    const debit = bank && bank.currency === p.currency
      ? (parseFloat(p.amount) || 0)
      : (parseFloat(p.base_amount_pkr) || 0);
    if (debit > 0) {
      await trx('bank_accounts').where({ id: p.bank_account_id }).decrement('current_balance', debit);
    }
  }
  const confirmedIds = confirmed.map((p) => p.id);
  if (confirmedIds.length) {
    await trx('bank_transactions').whereIn('linked_payment_id', confirmedIds).del();
    await trx('payments').whereIn('id', confirmedIds).del();
  }

  const pendingIds = pending.map((p) => p.id);
  if (pendingIds.length) {
    await trx('payments').whereIn('id', pendingIds).update({
      status: 'Rejected',
      reject_reason: `Order${orderNo ? ` ${orderNo}` : ''} cancelled before Finance confirmed this receipt`,
      confirmed_by: userId || null,
      confirmed_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  }

  return { refunded: confirmedIds.length, voided: pendingIds.length };
}

module.exports = { unwindOrderReceipts, isConfirmed };
