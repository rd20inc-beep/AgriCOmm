import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  STORAGE_KEY, defaultAccountKey, rememberAccount, readRememberedAccount, resolveDefaultAccount,
  isUsableDefault, useDefaultAccount,
} from '../useDefaultAccount';
import { pickDefaultAccount } from '../../../components/payments/paymentPayload';

/**
 * Account defaults on money forms (Phase 5 owner decision): the last account a
 * user used for a currency + entity is offered next time — only while it is
 * still active, still offered, and can carry the currency. It is a default:
 * shown, editable, never a reason to submit.
 */
const ACCOUNTS = [
  { id: 1, name: 'HO Bank', type: 'bank', entity: 'general', currency: 'PKR', isActive: true },
  { id: 2, name: 'USD Bank', type: 'bank', entity: 'general', currency: 'USD', isActive: true },
  { id: 3, name: 'Mill Cash', type: 'cash', entity: 'mill', currency: 'PKR', isActive: true },
  { id: 4, name: 'Old Bank', type: 'bank', entity: 'general', currency: 'PKR', isActive: false },
  { id: 5, name: 'Starred Bank', type: 'bank', entity: 'general', currency: 'PKR', isActive: true, isFavorite: true },
];

const login = (id) => localStorage.setItem('riceflow_user', JSON.stringify({ id }));

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  login(7);
});

describe('remember / restore', () => {
  it('restores the account used last for the same currency + entity', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 1 });
    expect(readRememberedAccount({ currency: 'PKR', entity: 'general' })).toBe('1');
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'general' })).toBe('1');
  });

  it('is kept per currency and per entity — a USD receipt does not inherit the PKR choice', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 1 });
    rememberAccount({ currency: 'PKR', entity: 'mill', accountId: 3 });
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'USD', entity: 'general' })).toBe('');
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'mill' })).toBe('3');
    expect(defaultAccountKey({ currency: 'usd', entity: 'Export' })).toBe('payment|export|USD');
  });

  it('is kept per user — another login on the same browser starts clean', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 1 });
    login(8);
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'general' })).toBe('');
    login(7);
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'general' })).toBe('1');
  });

  it('a blank account id is never remembered (nothing chosen ≠ a choice)', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 1 });
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: '' });
    expect(readRememberedAccount({ currency: 'PKR', entity: 'general' })).toBe('1');
  });
});

describe('fallback when the remembered account is no longer usable', () => {
  it('an account switched off since is not offered', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 4 });
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'general' })).toBe('');
    expect(isUsableDefault(ACCOUNTS[3], 'PKR')).toBe(false);
  });

  it('an account the form no longer offers (deleted / out of scope) is not offered', () => {
    rememberAccount({ currency: 'PKR', entity: 'mill', accountId: 1 });
    const millOnly = ACCOUNTS.filter((a) => a.entity === 'mill');
    expect(resolveDefaultAccount({ accounts: millOnly, currency: 'PKR', entity: 'mill' })).toBe('');
  });

  it('an account that cannot carry the currency is not offered (USD account for a PKR payment)', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 2 });
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: 'PKR', entity: 'general' })).toBe('');
    // A PKR account takes any currency (the server rule) — so it may default for USD.
    expect(isUsableDefault(ACCOUNTS[0], 'USD')).toBe(true);
    expect(isUsableDefault(ACCOUNTS[1], 'USD')).toBe(true);
  });

  it("the form then falls back to its own rule: the only matching account, else the starred one", () => {
    // Nothing remembered: starred bank.
    expect(pickDefaultAccount({ accounts: ACCOUNTS.filter((a) => a.isActive), method: 'bank_transfer', preferredAccountId: '' })).toBe('5');
    // Remembered and suits the method: it wins over the star.
    expect(pickDefaultAccount({ accounts: ACCOUNTS, method: 'bank_transfer', preferredAccountId: '1' })).toBe('1');
    // Remembered cash account but the method is a bank transfer: not forced onto the wrong kind.
    expect(pickDefaultAccount({ accounts: ACCOUNTS, method: 'bank_transfer', preferredAccountId: '3' })).toBe('5');
    // Cash: the only cash account.
    expect(pickDefaultAccount({ accounts: ACCOUNTS, method: 'cash', preferredAccountId: '' })).toBe('3');
  });
});

describe('transfer ends and reconciliation use their own purpose', () => {
  it("currency '*' accepts any currency, still refuses an inactive account", () => {
    rememberAccount({ currency: '*', entity: 'contra', purpose: 'transfer_from', accountId: 2 });
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: '*', entity: 'contra', purpose: 'transfer_from' })).toBe('2');
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: '*', entity: 'contra', purpose: 'transfer_to' })).toBe('');
    rememberAccount({ currency: '*', entity: 'all', purpose: 'reconcile', accountId: 4 });
    expect(resolveDefaultAccount({ accounts: ACCOUNTS, currency: '*', entity: 'all', purpose: 'reconcile' })).toBe('');
  });
});

describe('the hook', () => {
  it('returns the resolved default and its account', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 5 });
    const seen = [];
    function Probe() { seen.push(useDefaultAccount({ currency: 'PKR', entity: 'general', accounts: ACCOUNTS })); return null; }
    renderToStaticMarkup(<Probe />);
    const out = seen[0];
    expect(out.accountId).toBe('5');
    expect(out.account.name).toBe('Starred Bank');
    expect(typeof out.remember).toBe('function');
  });
});
