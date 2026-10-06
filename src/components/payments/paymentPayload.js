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

import { isFavorite } from '../../shared/utils/favorites';

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
 * A cheque is never money in the bank until it is cleared — same-day cheques
 * included (owner decision, 2026-10-07). Recording one settles nothing, moves
 * no account and posts nothing to the ledger; clearing it in Due Dates does all
 * three, and asks for the bank account then. So a cheque is the one payment
 * that needs no account when it is recorded. `form` carries `method` or
 * `paymentMethod`.
 */
export function isUnclearedCheque(form) {
  return (form.method ?? form.paymentMethod) === 'cheque';
}

/** The one wording for a cheque's clearing date and what recording one does. */
export const CHEQUE_DATE_LABEL = 'Cheque clears on';
export const CHEQUE_HINT = 'Cheques settle when you clear them in Due Dates.';

/** The accounts a method draws on: cash from a cash account, anything else from a bank one. */
export function accountsForMethod(accounts = [], method) {
  return accounts.filter((a) => (method === 'cash' ? a.type === 'cash' : a.type !== 'cash'));
}

/**
 * The account the picker should hold for this method, or '' for none.
 *  - a chosen account that does not suit the method is dropped (switching from
 *    Bank Transfer to Cash used to keep the bank selected, and the "cash"
 *    payment left the bank);
 *  - with nothing chosen, the only matching account is picked, else the
 *    starred one — never an account of the wrong kind.
 * `current` is the selected id ('' for none). Pure; PaymentFields applies it.
 */
export function pickAccountForMethod({ accounts = [], method, current = '' }) {
  const matching = accountsForMethod(accounts, method);
  if (current !== '' && current != null) {
    return matching.some((a) => String(a.id) === String(current)) ? String(current) : '';
  }
  if (matching.length === 1) return String(matching[0].id);
  const fav = matching.find(isFavorite);
  return fav ? String(fav.id) : '';
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
  // A cheque picks its account when it is cleared.
  if (requireAccount && !form.bankAccountId && !isUnclearedCheque(form)) return 'Select a cash or bank account';
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
    // A cheque's clearing date, for Due Dates. A cheque is recorded but does
    // NOT settle the purchase until it is cleared there.
    due_date: form.dueDate || null,
    notes: form.notes || null,
  };
}
