/**
 * The NL→SQL assistant is open to reports.view_cost OR finance.view, but its
 * curated schema includes payroll and GL/bank tables. A user without
 * payroll.view / finance.view must not get those tables in the model's schema,
 * and a generated query that reads them anyway must be refused.
 */
const { allowedTables, referencesBlocked } = require('../modules/ai/ai.access');

const PAYROLL = ['mill_workers', 'mill_payroll_runs', 'mill_payroll_lines', 'mill_attendance', 'mill_worker_advances'];
const FINANCE = ['journal_entries', 'journal_lines', 'payables', 'payments', 'bank_accounts', 'bank_transactions', 'fund_transfers'];
const OPERATIONAL = ['inventory_lots', 'milling_batches', 'local_sales', 'suppliers', 'chart_of_accounts', 'business_expenses'];
const CURATED = [...OPERATIONAL, ...FINANCE, ...PAYROLL];

describe('allowedTables', () => {
  it('keeps everything for a user with payroll.view and finance.view', () => {
    expect(allowedTables(CURATED, { payroll: true, finance: true })).toEqual(CURATED);
  });

  it('drops payroll and finance tables for a cost-only user', () => {
    expect(allowedTables(CURATED, { payroll: false, finance: false })).toEqual(OPERATIONAL);
  });

  it('drops only payroll for a finance user without payroll.view', () => {
    expect(allowedTables(CURATED, { payroll: false, finance: true })).toEqual([...OPERATIONAL, ...FINANCE]);
  });

  it('drops only finance for a payroll user without finance.view', () => {
    expect(allowedTables(CURATED, { payroll: true, finance: false })).toEqual([...OPERATIONAL, ...PAYROLL]);
  });
});

describe('referencesBlocked', () => {
  const none = { payroll: false, finance: false };

  it('refuses a query that reads a hidden table', () => {
    expect(referencesBlocked('SELECT name, salary FROM mill_workers LIMIT 200', none)).toBe('mill_workers');
    expect(referencesBlocked('SELECT SUM(l.debit) FROM journal_lines l', none)).toBe('journal_lines');
    expect(referencesBlocked('select * from BANK_ACCOUNTS', none)).toBe('bank_accounts');
  });

  it('allows operational queries and tables the user may see', () => {
    expect(referencesBlocked('SELECT lot_no FROM inventory_lots', none)).toBeNull();
    expect(referencesBlocked('SELECT * FROM payables', { payroll: false, finance: true })).toBeNull();
  });

  it('does not match a table name inside a longer identifier', () => {
    expect(referencesBlocked('SELECT payments_count FROM inventory_lots', none)).toBeNull();
  });
});
