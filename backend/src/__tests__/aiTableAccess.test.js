/**
 * The NL→SQL assistant is open to reports.view_cost OR finance.view. Payroll is
 * never in its schema (D-28 — no ai_ro view exists for it), and the GL / bank /
 * AR / AP views are dropped from the model's schema and refused in generated
 * SQL unless the user holds finance.view.
 */
const { allowedTables, referencesBlocked, PAYROLL_TABLES } = require('../modules/ai/ai.access');

const FINANCE = ['journal_entries', 'journal_lines', 'payables', 'receivables', 'payments', 'bank_accounts', 'bank_transactions', 'fund_transfers'];
const OPERATIONAL = ['inventory_lots', 'milling_batches', 'local_sales', 'suppliers', 'chart_of_accounts', 'business_expenses'];
const CURATED = [...OPERATIONAL, ...FINANCE, ...PAYROLL_TABLES];

describe('allowedTables', () => {
  it('never includes payroll, even for a payroll + finance user', () => {
    expect(allowedTables(CURATED, { payroll: true, finance: true })).toEqual([...OPERATIONAL, ...FINANCE]);
  });

  it('drops finance tables for a cost-only user', () => {
    expect(allowedTables(CURATED, { payroll: false, finance: false })).toEqual(OPERATIONAL);
  });
});

describe('referencesBlocked', () => {
  const none = { finance: false };

  it('refuses a query that reads a hidden table', () => {
    expect(referencesBlocked('SELECT name, salary FROM mill_workers LIMIT 200', { finance: true })).toBe('mill_workers');
    expect(referencesBlocked('SELECT * FROM mill_salary_revisions', { finance: true })).toBe('mill_salary_revisions');
    expect(referencesBlocked('SELECT SUM(l.debit) FROM journal_lines l', none)).toBe('journal_lines');
    expect(referencesBlocked('select * from BANK_ACCOUNTS', none)).toBe('bank_accounts');
  });

  it('allows operational queries and tables the user may see', () => {
    expect(referencesBlocked('SELECT lot_no FROM inventory_lots', none)).toBeNull();
    expect(referencesBlocked('SELECT * FROM payables', { finance: true })).toBeNull();
  });

  it('does not match a table name inside a longer identifier', () => {
    expect(referencesBlocked('SELECT payments_count FROM inventory_lots', none)).toBeNull();
  });
});
