/**
 * The canonical payment-method values, and the one legacy spelling.
 *
 * `payments.payment_method` is CHECK-constrained to this set
 * (chk_payments_payment_method_valid). `business_expenses.payment_method` is
 * not, and for years it stored the UI's shorthand `'bank'` while the payments
 * row written for the SAME payment stored `'bank_transfer'` — two columns
 * disagreeing about one event, so a report reading the expense and a report
 * reading the payment gave different answers about how it was settled.
 *
 * Callers may still pass `'bank'`: the payroll settlement and statutory
 * remittance paths build an expense with `pay_method` ('bank' | 'cash'), which
 * is a different column with its own domain. They are normalised here rather
 * than at a dozen call sites.
 */
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'lc', 'tt', 'wire', 'online', 'mobile'];

// 'bank' is what the expense form sent and what payroll still sends.
const LEGACY_METHODS = { bank: 'bank_transfer' };

/**
 * Canonical form of a method, for any column that stores one. An empty or
 * missing value means a bank transfer — that was the expense form's default
 * before this existed, so defaulting anywhere else would change what old rows
 * mean.
 */
function normalizePaymentMethod(method, fallback = 'bank_transfer') {
  if (method === null || method === undefined || method === '') return fallback;
  const m = String(method).trim().toLowerCase();
  if (LEGACY_METHODS[m]) return LEGACY_METHODS[m];
  if (PAYMENT_METHODS.includes(m)) return m;
  // Not silently coerced: a value outside the set used to reach
  // payments.payment_method and die on the CHECK constraint as a 500, after the
  // UI had already said the payment went through.
  throw new Error(`Unknown payment method "${method}". Use one of: ${PAYMENT_METHODS.join(', ')}.`);
}

/** The Joi-valid list for a request field: the canonical set plus the legacy spelling. */
const ACCEPTED_METHODS = [...PAYMENT_METHODS, ...Object.keys(LEGACY_METHODS)];

module.exports = { PAYMENT_METHODS, LEGACY_METHODS, ACCEPTED_METHODS, normalizePaymentMethod };
