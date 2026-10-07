// Which bank / cash accounts may carry a payment in a given currency. Mirrors
// backend/src/shared/accountCurrency.js: a PKR account takes any currency (the
// bank converts, the account moves by the stamped PKR figure); a non-PKR
// account (e.g. USD) only its own currency. The server refuses the rest.

const norm = (c) => String(c || 'PKR').trim().toUpperCase() || 'PKR';

export function accountTakesCurrency(account, paymentCurrency) {
  if (!account) return false;
  const acct = norm(account.currency);
  return acct === 'PKR' || acct === norm(paymentCurrency);
}

export function accountsForCurrency(accounts, paymentCurrency) {
  return (accounts || []).filter((a) => accountTakesCurrency(a, paymentCurrency));
}
