import { useCallback, useMemo, useState } from 'react';
import { accountTakesCurrency } from '../utils/accountCurrency';

/**
 * The last cash / bank account a user picked for a currency + entity, offered
 * as the default the next time a money form opens.
 *
 *   const { accountId, account } = useDefaultAccount({ currency: 'PKR', entity: 'mill', accounts });
 *   …after a successful submit…
 *   rememberAccount({ currency: 'PKR', entity: 'mill', accountId: form.bankAccountId });
 *
 * Rules (owner decision, Phase 5 — "account defaults on money forms"):
 *  - per user, per currency, per entity (and per purpose: a transfer's source is
 *    remembered apart from a payment's account);
 *  - offered only while the account is still active, still in the list the form
 *    is allowed to offer, and can carry the currency (a PKR account takes any
 *    currency, a USD account only USD — the server rule, accountCurrency.js);
 *  - a default only: the form shows it, the user can change it, and nothing is
 *    ever submitted because of it.
 *
 * Stored in localStorage (no per-user preference table exists); keyed by the
 * signed-in user's id so two people sharing a browser do not inherit each
 * other's choice.
 */

export const STORAGE_KEY = 'riceflow_default_accounts_v1';

const norm = (v, fallback) => String(v || fallback).trim().toLowerCase() || fallback;

function storage() {
  try { return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null; } catch { return null; }
}

/** The signed-in user's id, as AuthContext caches it. */
function currentUserId() {
  try {
    const u = JSON.parse(storage()?.getItem('riceflow_user') || 'null');
    return u?.id != null ? String(u.id) : 'anon';
  } catch { return 'anon'; }
}

export function defaultAccountKey({ currency, entity, purpose = 'payment' } = {}) {
  return `${norm(purpose, 'payment')}|${norm(entity, 'general')}|${String(currency || 'PKR').trim().toUpperCase() || 'PKR'}`;
}

function readAll() {
  try { return JSON.parse(storage()?.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}

/** The remembered account id ('' when none) — not yet checked against any list. */
export function readRememberedAccount({ currency, entity, purpose, userId } = {}) {
  const all = readAll();
  const v = all?.[userId != null ? String(userId) : currentUserId()]?.[defaultAccountKey({ currency, entity, purpose })];
  return v != null ? String(v) : '';
}

/** Remember the account a user just used successfully. A blank id is ignored. */
export function rememberAccount({ currency, entity, accountId, purpose, userId } = {}) {
  if (accountId === undefined || accountId === null || accountId === '') return;
  const s = storage();
  if (!s) return;
  const uid = userId != null ? String(userId) : currentUserId();
  const all = readAll();
  all[uid] = { ...(all[uid] || {}), [defaultAccountKey({ currency, entity, purpose })]: String(accountId) };
  try { s.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* storage full / blocked — a default is optional */ }
}

/**
 * Whether an account may still be offered as the default for this currency.
 * currency '*' — a transfer end, whose own currency decides the transfer's.
 */
export function isUsableDefault(account, currency) {
  if (!account) return false;
  if (account.isActive === false || account.is_active === false) return false;
  if (currency === '*') return true;
  return accountTakesCurrency(account, currency);
}

/**
 * Pure resolution: the remembered account if it is still in `accounts`, active
 * and currency-matched; otherwise '' (the form falls back to its own rule —
 * the only matching account, else the starred one).
 */
export function resolveDefaultAccount({ accounts = [], currency, entity, purpose, userId } = {}) {
  const id = readRememberedAccount({ currency, entity, purpose, userId });
  if (!id) return '';
  const acct = (accounts || []).find((a) => String(a.id) === id);
  return isUsableDefault(acct, currency) ? id : '';
}

/**
 * Hook form. `accounts` is the list the form offers (already scoped to what the
 * user may use). Returns { accountId, account, remember(accountId) }.
 */
export function useDefaultAccount({ currency = 'PKR', entity = 'general', purpose = 'payment', accounts = [], userId } = {}) {
  // Bumped by remember() so a still-mounted form re-reads the new default.
  const [version, setVersion] = useState(0);
  const accountKey = (accounts || []).map((a) => `${a.id}:${a.isActive === false ? 0 : 1}:${a.currency || ''}`).join(',');
  const accountId = useMemo(
    () => resolveDefaultAccount({ accounts, currency, entity, purpose, userId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountKey, currency, entity, purpose, userId, version],
  );
  const account = accountId ? (accounts || []).find((a) => String(a.id) === accountId) || null : null;
  const remember = useCallback((id) => {
    rememberAccount({ currency, entity, purpose, accountId: id, userId });
    setVersion((v) => v + 1);
  }, [currency, entity, purpose, userId]);
  return { accountId, account, remember };
}

export default useDefaultAccount;
