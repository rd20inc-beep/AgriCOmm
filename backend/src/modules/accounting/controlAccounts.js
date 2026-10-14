/**
 * Control accounts — the GL accounts a MANUAL journal may not touch (owner
 * decision D-2, 2026-10-15).
 *
 * Each of these is the GL side of a sub-ledger: bank and cash balances, export
 * and local receivables, customer advances, supplier and salary payables, and
 * stock. They change only through their own documents (a payment, a sale, a
 * purchase, a payroll run, a stock movement), so the sub-ledger and the GL
 * always agree. A manual journal on one of them moves the GL with no document
 * behind it — "GL-only money" that no statement, bank balance or stock report
 * can see.
 *
 * Covered:
 *   - Cash & Bank: 1000, every account under it (1000–1099 and its children),
 *     and every account a bank_accounts row posts to (its own GL)
 *   - Receivables: 1100, 1110 Export AR, 1120 Local AR; 1310 Customer Advances
 *   - Payables: 2000, 2010 Supplier Payable, 2040 Salaries Payable
 *   - Stock: every 12xx account except 1290 Suspense (which is cleared by
 *     manual reclassification by design)
 */
const { cashGroupAccountIds } = require('../../shared/accountGl');
const { LedgerPostingError } = require('../../shared/errors');

const FIXED_CODES = new Set(['1100', '1110', '1120', '1310', '2000', '2010', '2040']);
const NOT_CONTROL = new Set(['1290']);

function isControlCode(code) {
  const c = String(code || '');
  if (NOT_CONTROL.has(c)) return false;
  if (FIXED_CODES.has(c)) return true;
  if (/^10\d\d$/.test(c)) return true; // Cash & Bank group
  if (/^12\d\d$/.test(c)) return true; // Stock
  return false;
}

/** The control accounts among `accountIds` (chart_of_accounts rows). */
async function controlAccountsIn(knex, accountIds) {
  const ids = [...new Set((accountIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const [rows, cashIds, bankGlIds] = await Promise.all([
    knex('chart_of_accounts').whereIn('id', ids).select('id', 'code', 'name'),
    cashGroupAccountIds(knex),
    knex('bank_accounts').whereNotNull('gl_account_id').pluck('gl_account_id'),
  ]);
  const cash = new Set([...cashIds, ...bankGlIds].map(Number));
  return rows.filter((r) => cash.has(Number(r.id)) || isControlCode(r.code));
}

/**
 * Refuse a manual journal whose lines touch a control account. Throws a
 * LedgerPostingError (400, reason 'control_account') naming the accounts.
 */
async function assertNoControlAccounts(knex, lines, what = 'A manual journal') {
  const hit = await controlAccountsIn(knex, (lines || []).map((l) => l.account_id));
  if (!hit.length) return;
  const names = hit.map((a) => `${a.code} ${a.name}`).join(', ');
  throw new LedgerPostingError(
    `${what} cannot post to a control account (${names}). Bank, receivable, advance, payable and stock balances change only through their own documents — record the payment, sale, purchase or stock movement instead.`,
    'control_account',
    { accounts: hit.map((a) => a.code) },
  );
}

module.exports = { isControlCode, controlAccountsIn, assertNoControlAccounts };
