/**
 * The one place a recordPayment body is built and validated.
 *
 * Eight screens each wrote their own copy of this arithmetic, and the copies had
 * already drifted: `'bank'` where the Joi schema wants `'bank_transfer'`, a
 * `due_date` the schema strips, a cheque reference sent as `reference` on one
 * screen and `bank_reference` on another. The payload shape lives in
 * backend/src/middleware/schemas.js (`recordPayment`) and validate() runs with
 * stripUnknown, so a field named wrongly here does not error — it vanishes.
 *
 * Pure functions, no React: the arithmetic is what goes wrong, so it is the part
 * that gets tested.
 */

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
];

export const METHOD_LABEL = PAYMENT_METHODS.reduce((m, o) => ({ ...m, [o.value]: o.label }), {
  mobile: 'Mobile',
});

const num = (v) => parseFloat(v) || 0;

export const money = (v, currency = 'PKR') => {
  const n = num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${n}` : `${currency === 'PKR' ? 'Rs' : currency} ${n}`;
};

export function blankPaymentForm({ amount = '', method = 'bank_transfer', date } = {}) {
  return {
    amount: amount === null || amount === undefined ? '' : String(amount),
    method,
    bankAccountId: '',
    date: date || new Date().toISOString().slice(0, 10),
    reference: '',
    dueDate: '',
    notes: '',
    whtRate: '', whtAmount: '', discountAmount: '', attachmentUrl: '', attachmentName: '',
  };
}

/**
 * The cash that actually leaves the account. WHT and the early-payment discount
 * reduce the cash but NOT the amount settled against the payable: the vendor's
 * claim is cleared in full, the withheld tax is remitted to FBR and the discount
 * is booked as income. Getting this backwards leaves the payable short-paid.
 */
export function netCash(form) {
  return Math.max(0, num(form.amount) - num(form.whtAmount) - num(form.discountAmount));
}

/**
 * Returns the first problem with the form as a sentence, or null when it is
 * payable. `outstanding` null means uncapped (nothing to overpay against).
 */
export function validatePayment(form, { outstanding = null, requireAccount = true, currency = 'PKR' } = {}) {
  const amt = num(form.amount);
  if (!(amt > 0)) return 'Enter a positive amount';
  // A cent of float slop is not an overpayment.
  if (outstanding != null && amt - num(outstanding) > 0.01) {
    return `Amount exceeds the outstanding ${money(outstanding, currency)}.`;
  }
  if (num(form.whtAmount) + num(form.discountAmount) - amt > 0.01) {
    return 'WHT + discount cannot exceed the amount.';
  }
  if (requireAccount && !form.bankAccountId) return 'Select a cash or bank account';
  return null;
}

/**
 * The recordPayment body. Every key here is one the Joi schema declares; add a
 * key it does not and the field is silently dropped before the controller.
 */
export function paymentPayload(form, {
  type = 'payment',
  currency = 'PKR',
  payableId = null,
  receivableId = null,
  notes = '',
  bankAccountId,          // override, for a screen that pays from a fixed account
} = {}) {
  const acct = bankAccountId !== undefined ? bankAccountId : form.bankAccountId;
  return {
    type,
    amount: num(form.amount),
    currency,
    payment_method: form.method,
    bank_account_id: acct ? parseInt(acct, 10) : null,
    bank_reference: form.reference || null,
    payment_date: form.date,
    // A cheque's clearing date. Only sent when there is one: the schema accepts
    // null but not an empty string.
    due_date: form.dueDate || null,
    ...(payableId ? { linked_payable_id: payableId } : {}),
    ...(receivableId ? { linked_receivable_id: receivableId } : {}),
    notes: form.notes || notes || null,
    wht_amount: num(form.whtAmount),
    wht_rate: form.whtRate ? parseFloat(form.whtRate) : null,
    discount_amount: num(form.discountAmount),
    attachment_url: form.attachmentUrl || null,
    attachment_name: form.attachmentName || null,
  };
}

/**
 * The body for `POST /api/finance/purchases/pay`, which settles a purchase
 * document (a lot, a mill-store purchase, an export cost, an expense, a printed
 * bag order) rather than a payable row. A different endpoint and a different
 * field name — `payment_reference`, not `bank_reference` — which is exactly the
 * kind of detail that gets mistyped when each screen writes its own.
 *
 * It takes no WHT or discount: the endpoint does not accept them, and a field it
 * does not read would be dropped silently.
 */
export function purchasePayPayload(form, { source, sourceId }) {
  return {
    source,
    source_id: sourceId,
    amount: num(form.amount),
    payment_method: form.method,
    bank_account_id: form.bankAccountId || null,
    payment_reference: form.reference || null,
    payment_date: form.date,
    // A post-dated cheque is recorded but does NOT settle the purchase until it
    // clears — the server branches on this, so dropping it (as two screens did)
    // settles a cheque that has not been presented.
    due_date: form.dueDate || null,
    notes: form.notes || null,
  };
}
