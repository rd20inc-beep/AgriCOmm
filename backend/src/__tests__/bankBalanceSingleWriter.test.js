/**
 * P2-17: bank_accounts.current_balance has ONE writer, shared/bankBalance.js,
 * which writes the bank_transactions row in the same call. This test fails the
 * build when any other file increments, decrements or updates the balance or
 * inserts a bank row directly.
 *
 * Allowed exceptions, each with its reason:
 *   - admin/dangerZone.controller.js — Super-Admin hard-delete / Reset to 0,
 *     which remove history by design (D-23 exempts the Danger Zone);
 *   - exportOrders/unwindReceipts.js — export-order cancel; being rebuilt as a
 *     refund / customer credit under D-7 (never delete receipts), which will
 *     go through the helper.
 */
const fs = require('fs');
const path = require('path');
const { postBankTransaction, deleteBankTransaction, overdraftWarning, signedAmount } = require('../shared/bankBalance');
const { fakeKnex } = require('./helpers/fakeKnex');

const SRC = path.join(__dirname, '..');
const ALLOWED = new Set([
  'shared/bankBalance.js',
  'modules/admin/dangerZone.controller.js',
  'modules/exportOrders/unwindReceipts.js',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const BALANCE_WRITE = [
  /(increment|decrement)\(\s*['"]current_balance['"]/,
  /\.update\(\s*\{[^}]*\bcurrent_balance\s*:/,
  /SET\s+current_balance/i,
];
const BT_INSERT = /\(\s*['"]bank_transactions['"]\s*\)\s*\.insert\(/;

describe('one writer for current_balance (P2-17)', () => {
  const files = walk(SRC).map((f) => [path.relative(SRC, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);

  test('no file outside the helper moves a balance', () => {
    const offenders = files
      .filter(([rel]) => !ALLOWED.has(rel))
      .filter(([, src]) => BALANCE_WRITE.some((re) => re.test(src)))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  test('no file outside the helper inserts a bank_transactions row', () => {
    const offenders = files
      .filter(([rel]) => rel !== 'shared/bankBalance.js')
      .filter(([, src]) => BT_INSERT.test(src))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});

describe('postBankTransaction / deleteBankTransaction', () => {
  const seed = () => fakeKnex({ bank_accounts: [{ id: 7, name: 'ZZ Bank', currency: 'PKR', current_balance: 100 }], bank_transactions: [] });

  test('a credit moves the balance up and writes a posted row with the running balance', async () => {
    const db = seed();
    const row = await postBankTransaction(db, { accountId: 7, type: 'credit', amount: 50.004, transactionNo: 'BT-1', source: 'x' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(150);
    expect(db.tables.bank_transactions[0]).toMatchObject({ bank_account_id: 7, type: 'credit', amount: 50, status: 'posted', currency: 'PKR', running_balance: 150, source: 'x' });
    expect(row.overdraft).toBeNull();
  });

  test('a debit below zero carries the overdraft warning', async () => {
    const db = seed();
    const row = await postBankTransaction(db, { accountId: 7, type: 'debit', amount: 130, transactionNo: 'BT-2' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(-30);
    expect(row.overdraft).toMatchObject({ account_id: 7, overdrawn_by: 30, balance_after: -30 });
  });

  test('refuses a missing account, a bad type, a negative amount and a non-posted status', async () => {
    const db = seed();
    await expect(postBankTransaction(db, { type: 'credit', amount: 1 })).rejects.toThrow(/account is required/);
    await expect(postBankTransaction(db, { accountId: 7, type: 'in', amount: 1 })).rejects.toThrow(/credit or a debit/);
    await expect(postBankTransaction(db, { accountId: 7, type: 'credit', amount: -1 })).rejects.toThrow(/negative/);
    await expect(postBankTransaction(db, { accountId: 7, type: 'credit', amount: 1, status: 'pending' })).rejects.toThrow(/posted rows only/);
    await expect(postBankTransaction(db, { accountId: 99, type: 'credit', amount: 1, transactionNo: 'BT-9' })).rejects.toThrow(/not found/);
  });

  test('deleting a posted row backs its amount out; a reversed row moved nothing', async () => {
    const db = seed();
    await deleteBankTransaction(db, { id: 1, bank_account_id: 7, type: 'credit', amount: 40, status: 'posted' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(60);
    await deleteBankTransaction(db, { id: 2, bank_account_id: 7, type: 'debit', amount: 10, status: 'posted' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(70);
    await deleteBankTransaction(db, { id: 3, bank_account_id: 7, type: 'debit', amount: 10, status: 'reversed' });
    expect(db.tables.bank_accounts[0].current_balance).toBe(70);
  });

  test('pure helpers', () => {
    expect(signedAmount({ type: 'credit', amount: '5' })).toBe(5);
    expect(signedAmount({ type: 'debit', amount: '5' })).toBe(-5);
    expect(overdraftWarning({ id: 1, name: 'A' }, 0)).toBeNull();
    expect(overdraftWarning({ id: 1, name: 'A', currency: 'usd' }, -2.5)).toMatchObject({ currency: 'USD', overdrawn_by: 2.5 });
  });
});
