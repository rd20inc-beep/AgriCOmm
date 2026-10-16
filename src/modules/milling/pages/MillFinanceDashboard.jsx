// Mill Finance (/milling/finance) — P5-09 split the 5,700-line page by job.
// The screens live in ./millFinance/:
//
//   MillFinanceShell        header (period, primary actions, More actions),
//                           section nav, action drawers
//   sections/*              Overview · Transactions · Parties · Performance
//   transactions/*          History · Payables · Expenses · Recurring · Lot costs
//   drawers/*               expense form, pay drawers, party picker, vouchers
//   payroll/*               the payroll workspace and its drawers
//   urlState.js             ?section=… URL state + the old ?tab= mapping
//
// `payrollOnly` is kept for Head Office Finance ▸ Payroll (FinancePayroll),
// which renders the same payroll workspace with Head Office scope first.
import MillFinanceShell from './millFinance/MillFinanceShell';
import PayrollWorkspace from './millFinance/payroll/PayrollWorkspace';

export default function MillFinanceDashboard({ payrollOnly = false }) {
  if (payrollOnly) return <PayrollWorkspace defaultEntity="general" intro />;
  return <MillFinanceShell />;
}
