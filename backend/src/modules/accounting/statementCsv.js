/**
 * Financial statements as CSV (P4-14): Trial Balance, Profit & Loss, Balance
 * Sheet — flattened from the SAME service payloads the screens render, one row
 * per account plus section totals, so an accountant can open the books in a
 * spreadsheet instead of re-keying them. PKR, Posted journals only (as the
 * statements themselves). Pure: the controller sends them with utils/csv.
 */
const r2 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;

const ACCOUNT_COLUMNS = [
  { label: 'Section', key: 'section' },
  { label: 'Code', key: 'code' },
  { label: 'Account', key: 'name' },
  { label: 'Type', key: 'type' },
  { label: 'Debit (PKR)', key: 'debit' },
  { label: 'Credit (PKR)', key: 'credit' },
  { label: 'Amount (PKR)', key: 'amount' },
];

const acctRow = (section, a, amount) => ({
  section,
  code: a.code,
  name: a.name,
  type: a.type,
  debit: r2(a.debit_total),
  credit: r2(a.credit_total),
  amount: r2(amount),
});
const totalRow = (section, label, amount, extra = {}) => ({ section, code: null, name: label, type: null, debit: null, credit: null, amount: r2(amount), ...extra });

function trialBalanceRows(tb = {}) {
  const rows = (tb.accounts || []).map((a) => acctRow('Trial balance', a, a.balance));
  rows.push(totalRow('Trial balance', 'Total', r2((tb.grand_debit || 0) - (tb.grand_credit || 0)),
    { debit: r2(tb.grand_debit), credit: r2(tb.grand_credit) }));
  return rows;
}

function profitLossRows(pl = {}) {
  const rows = [];
  const section = (label, s) => {
    for (const a of (s && s.accounts) || []) rows.push(acctRow(label, a, a.amount));
    rows.push(totalRow(label, `Total ${label.toLowerCase()}`, s && s.total));
  };
  section('Revenue', pl.revenue);
  section('Cost of goods sold', pl.cogs);
  rows.push(totalRow('Gross profit', 'Gross profit', pl.gross_profit));
  section('Expenses', pl.expenses);
  rows.push(totalRow('Net profit', 'Net profit', pl.net_profit));
  return rows;
}

function balanceSheetRows(bs = {}) {
  const rows = [];
  const section = (label, s) => {
    for (const a of (s && s.accounts) || []) rows.push(acctRow(label, a, a.balance));
    rows.push(totalRow(label, `Total ${label.toLowerCase()}`, s && s.total));
  };
  section('Assets', bs.assets);
  section('Liabilities', bs.liabilities);
  section('Equity', bs.equity);
  rows.push(totalRow('Equity', 'Net income (unclosed)', bs.net_income));
  rows.push(totalRow('Total', 'Total liabilities and equity', bs.total_liabilities_and_equity));
  return rows;
}

module.exports = { ACCOUNT_COLUMNS, trialBalanceRows, profitLossRows, balanceSheetRows };
