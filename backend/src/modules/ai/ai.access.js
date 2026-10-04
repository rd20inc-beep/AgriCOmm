/**
 * Which tables the NL→SQL assistant may use for a given user.
 *
 * The AI endpoints are open to anyone with reports.view_cost or finance.view,
 * but the curated schema also holds payroll (wages, advances) and GL/bank
 * tables, and holding one of those two permissions says nothing about the
 * other or about payroll.view. So those groups are dropped from the model's
 * schema AND refused in the generated SQL unless the user holds the permission
 * behind them. Kept free of db/config so it can be exercised directly in a test.
 */
const PAYROLL_TABLES = ['mill_workers', 'mill_payroll_runs', 'mill_payroll_lines', 'mill_attendance', 'mill_worker_advances'];
const FINANCE_TABLES = ['journal_entries', 'journal_lines', 'bank_accounts', 'bank_transactions', 'payables', 'receivables', 'payments', 'fund_transfers'];

// access = { payroll: bool, finance: bool } — whether the user holds payroll.view / finance.view.
function blockedTables(access) {
  return [
    ...(access.payroll ? [] : PAYROLL_TABLES),
    ...(access.finance ? [] : FINANCE_TABLES),
  ];
}

function allowedTables(names, access) {
  const blocked = new Set(blockedTables(access));
  return names.filter((t) => !blocked.has(t));
}

// The first blocked table a generated query references, or null.
function referencesBlocked(sql, access) {
  const blocked = blockedTables(access);
  if (!blocked.length) return null;
  const m = String(sql).match(new RegExp(`\\b(${blocked.join('|')})\\b`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

module.exports = { PAYROLL_TABLES, FINANCE_TABLES, blockedTables, allowedTables, referencesBlocked };
