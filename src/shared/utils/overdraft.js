// Overdraft is allowed with a warning everywhere (owner decision B2): a payment
// or a contra transfer that takes more than an account holds still goes
// through, and the account then shows as overdrawn. Forms warn before submit.
import { fmtMoney } from './format';

const balanceOf = (a) => {
  const raw = a?.currentBalance ?? a?.current_balance;
  if (raw === null || raw === undefined || raw === '') return null; // hidden from this role
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * What taking `amount` (in the account's own currency) out of `account` would
 * leave it overdrawn by, or null when it stays at or above zero — or when the
 * balance is not known to this screen, or `currency` is not the account's.
 * Returns { overdrawnBy, balanceAfter, currency, message }.
 */
export function overdraftWarning({ account, amount, currency } = {}) {
  if (!account) return null;
  const out = Number(amount);
  if (!Number.isFinite(out) || out <= 0) return null;
  const cur = String(account.currency || 'PKR').toUpperCase();
  if (currency && String(currency).toUpperCase() !== cur) return null;
  const bal = balanceOf(account);
  if (bal === null) return null;
  const after = Math.round((bal - out) * 100) / 100;
  if (after > -0.005) return null;
  const by = Math.round(-after * 100) / 100;
  return {
    overdrawnBy: by,
    balanceAfter: after,
    currency: cur,
    message: `This will overdraw ${account.name || 'the account'} by ${fmtMoney(by, cur, { decimals: 2 })}.`,
  };
}
