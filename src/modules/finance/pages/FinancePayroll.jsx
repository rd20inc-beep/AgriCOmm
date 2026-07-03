// Head Office finance dashboard → Payroll. Payroll is a single set of mill
// workers, so this renders the exact same management UI as the Mill Finance
// dashboard's Payroll tab (workers, runs, attendance, advances, settlements)
// via MillFinanceDashboard's `payrollOnly` mode — no duplicated logic.
import MillFinanceDashboard from '../../milling/pages/MillFinanceDashboard';

export default function FinancePayroll() {
  return <MillFinanceDashboard payrollOnly />;
}
