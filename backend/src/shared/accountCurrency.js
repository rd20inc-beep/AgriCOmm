// Which currencies a bank / cash account may move.
//
// A PKR account can take a payment in any currency: the bank converts, and the
// account moves by the payment's stamped PKR figure. A non-PKR account (a USD
// account, say) holds that currency only — moving it by a PKR figure because
// the payment was in another currency corrupts its balance. Such a payment is
// refused before anything is written.
const { ValidationError } = require('./errors');

const norm = (c) => String(c || 'PKR').trim().toUpperCase() || 'PKR';

// null when the account may move this payment, else the reason it may not.
function accountCurrencyMismatch(account, paymentCurrency) {
  if (!account) return null;
  const acctCur = norm(account.currency);
  const payCur = norm(paymentCurrency);
  if (acctCur === 'PKR' || acctCur === payCur) return null;
  return `This ${acctCur} account can only pay/receive ${acctCur} amounts — choose a PKR account for this ${payCur} amount.`;
}

// Throws a 400 (statusCode and status both set, so every controller's catch
// reads it) when the account cannot move this payment's currency.
function assertAccountCurrency(account, paymentCurrency) {
  const msg = accountCurrencyMismatch(account, paymentCurrency);
  if (!msg) return;
  const e = new ValidationError(msg);
  e.status = 400;
  throw e;
}

module.exports = { accountCurrencyMismatch, assertAccountCurrency };
