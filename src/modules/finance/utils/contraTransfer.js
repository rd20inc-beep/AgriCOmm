// Contra transfer — pure helpers shared by the drawer, the Cash page history and
// their tests. Mirrors the server rules in backend fundTransfers.service.js:
//
//   * fx_rate is always quoted as PKR per 1 unit of the foreign currency
//     (USD→PKR @ 280), whichever side the foreign currency is on:
//       foreign → PKR : converted = amount × rate
//       PKR → foreign : converted = amount ÷ rate
//   * two different foreign currencies (USD → EUR) are not supported;
//   * same entity → settles now ('internal'); Head Office ⇄ Mill → the
//     two-phase transfer the receiving side must accept.

import { overdraftWarning } from '../../../shared/utils/overdraft';

const ENTITY_LABEL = { general: 'Head Office', mill: 'Mill', export: 'Export' };

export const cur = (a) => String(a?.currency || 'PKR').toUpperCase();
export const ent = (a) => String(a?.entity || 'general').toLowerCase();
export const entityLabel = (e) => ENTITY_LABEL[String(e || 'general').toLowerCase()] || e;

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

/** 'same' | 'internal' | 'cross_entity' | 'unsupported' | null (incomplete). */
export function classifyTransfer(fromAcct, toAcct) {
  if (!fromAcct || !toAcct) return null;
  if (String(fromAcct.id) === String(toAcct.id)) return 'same';
  const f = ent(fromAcct); const t = ent(toAcct);
  if (f === t) return 'internal';
  if ((f === 'general' && t === 'mill') || (f === 'mill' && t === 'general')) return 'cross_entity';
  return 'unsupported';
}

export function isCrossCurrency(fromAcct, toAcct) {
  return !!fromAcct && !!toAcct && cur(fromAcct) !== cur(toAcct);
}

/** The foreign currency the rate is quoted for (null when both are PKR). */
export function foreignCurrency(fromCur, toCur) {
  if (fromCur !== 'PKR') return fromCur;
  if (toCur !== 'PKR') return toCur;
  return null;
}

/** Converted (destination) amount, 2 dp. NaN when it can't be computed. */
export function convertAmount(amount, rate, fromCur, toCur) {
  const a = Number(amount); const r = Number(rate);
  if (!(a > 0)) return NaN;
  if (fromCur === toCur) return round(a, 2);
  if (!(r > 0)) return NaN;
  return round(fromCur === 'PKR' ? a / r : a * r, 2);
}

/** Back-compute the rate (6 dp) from a typed converted amount. */
export function rateFromConverted(amount, converted, fromCur, toCur) {
  const a = Number(amount); const c = Number(converted);
  if (!(a > 0) || !(c > 0) || fromCur === toCur) return NaN;
  return round(fromCur === 'PKR' ? a / c : c / a, 6);
}

/** Field problems before the request is sent (the server checks again). */
export function validateContra({ fromAcct, toAcct, amount, rate, converted, reference, charges }) {
  const fe = {};
  if (!fromAcct) fe.from = 'Pick the account the money leaves.';
  if (!toAcct) fe.to = 'Pick the account the money goes to.';
  const kind = classifyTransfer(fromAcct, toAcct);
  if (kind === 'same') fe.to = 'From and To must be different accounts.';
  if (kind === 'unsupported') fe.to = `Money can't move from ${entityLabel(ent(fromAcct))} to ${entityLabel(ent(toAcct))} — pick accounts of the same entity, or Head Office ⇄ Mill.`;
  const a = Number(amount);
  if (!(a > 0)) fe.amount = 'Enter an amount greater than zero.';
  if (!String(reference || '').trim()) fe.reference = 'Enter the reference / transaction number.';
  const ch = Number(charges || 0);
  if (ch < 0) fe.charges = 'Bank charges cannot be negative.';
  if (fromAcct && toAcct && kind !== 'same') {
    const fc = cur(fromAcct); const tc = cur(toAcct);
    if (fc !== tc) {
      if (kind === 'cross_entity') fe.to = 'Head Office ⇄ Mill transfers are PKR only.';
      else if (fc !== 'PKR' && tc !== 'PKR') fe.to = `${fc} → ${tc} isn't supported — go through a PKR account.`;
      else if (!(Number(rate) > 0)) fe.rate = 'Enter the exchange rate.';
      else if (!(Number(converted) > 0)) fe.converted = 'Enter the converted amount.';
    }
    // More than the source holds is NOT an error (B2: overdraft is allowed
    // with a warning) — see contraOverdraft.
  }
  return fe;
}

/**
 * The source / destination a new transfer starts on (W08–W10): what is already
 * chosen wins; then the account this user last used there (if still offered);
 * a direction-locked transfer (Mill → Head Office) falls back to the first
 * account on each side. Never the same account on both ends.
 */
export function transferDefaults({ fromId = '', toId = '', fromAccounts = [], toAccounts = [], lastFrom = '', lastTo = '', locked = false }) {
  const offered = (list, id) => !!id && list.some((a) => String(a.id) === String(id));
  const from = fromId || (offered(fromAccounts, lastFrom) ? String(lastFrom) : '') || (locked && fromAccounts[0] ? String(fromAccounts[0].id) : '');
  const firstOther = locked ? toAccounts.find((a) => String(a.id) !== String(from)) : null;
  const to = toId
    || (offered(toAccounts, lastTo) && String(lastTo) !== String(from) ? String(lastTo) : '')
    || (firstOther ? String(firstOther.id) : '');
  return { fromId: from, toId: to };
}

/**
 * The non-blocking warning when the transfer (amount + bank charges) takes
 * the source below zero, or null. `returning` — on an edit, what the reversal
 * gives back first. A balance this role may not see (null) gives no warning.
 */
export function contraOverdraft({ fromAcct, amount, charges, returning = 0 }) {
  if (!fromAcct || fromAcct.currentBalance == null) return null;
  const ch = Number(charges) > 0 ? Number(charges) : 0;
  return overdraftWarning({
    account: { ...fromAcct, currentBalance: Number(fromAcct.currentBalance) + (Number(returning) || 0) },
    amount: (Number(amount) || 0) + ch,
  });
}

/** "CONTRA · HO Cash → HO Bank" for a bank-transaction row of a transfer. */
export function transferRowLabel(row) {
  const dir = row?.ftDirection;
  if (!dir) return null;
  const from = row.ftFromAccountName || '—';
  const to = row.ftToAccountName || '—';
  const kind = dir === 'internal' ? 'CONTRA' : (dir === 'ho_to_mill' ? 'HO → MILL' : 'MILL → HO');
  const suffix = /charges/i.test(row.category || '') ? ' · bank charges' : (/reversal/i.test(row.category || '') ? ' · reversal' : '');
  return `${kind} · ${from} → ${to}${suffix}`;
}

export function transferStatusLabel(t) {
  if (!t) return '';
  if (t.status === 'reversed') return 'Reversed';
  if (t.status === 'completed') return t.direction === 'internal' ? 'Completed' : 'Received';
  return 'Pending';
}

export const DIRECTION_LABEL ={ internal: 'Contra', ho_to_mill: 'HO → Mill', mill_to_ho: 'Mill → HO' };

export function newClientRef() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
