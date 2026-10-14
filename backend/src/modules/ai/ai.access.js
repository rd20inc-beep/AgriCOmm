/**
 * Which tables (ai_ro views) the NL→SQL assistant may use for a given user.
 *
 * Payroll is never exposed to the assistant (D-28): there is no ai_ro view over
 * mill_workers / payroll runs / attendance / advances, and a query naming one is
 * refused regardless of the user's permissions.
 *
 * The AI endpoints are open to reports.view_cost or finance.view, but the GL /
 * bank / AR / AP views are finance data; holding reports.view_cost says nothing
 * about finance.view. So those views are dropped from the model's schema AND
 * refused in the generated SQL unless the user holds finance.view.
 * Kept free of db/config so it can be exercised directly in a test.
 */
const PAYROLL_TABLES = ['mill_workers', 'mill_payroll_runs', 'mill_payroll_lines', 'mill_attendance', 'mill_worker_advances', 'mill_salary_revisions'];
const FINANCE_TABLES = ['journal_entries', 'journal_lines', 'bank_accounts', 'bank_transactions', 'payables', 'receivables', 'payments', 'fund_transfers'];

// access = { finance: bool } — whether the user holds finance.view.
function blockedTables(access) {
  return [
    ...PAYROLL_TABLES,
    ...(access && access.finance ? [] : FINANCE_TABLES),
  ];
}

function allowedTables(names, access) {
  const blocked = new Set(blockedTables(access));
  return names.filter((t) => !blocked.has(t));
}

// The first blocked table a generated query references, or null.
function referencesBlocked(sql, access) {
  const blocked = blockedTables(access);
  const m = String(sql).match(new RegExp(`\\b(${blocked.join('|')})\\b`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

module.exports = { PAYROLL_TABLES, FINANCE_TABLES, blockedTables, allowedTables, referencesBlocked };
