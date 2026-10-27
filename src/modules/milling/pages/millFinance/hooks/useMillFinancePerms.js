import { useAuth } from '../../../../../context/AuthContext';

/**
 * Every gate on the Mill Finance screens, in one place, mirroring the server:
 *
 *  - canFinance   finance.view — Head Office balances (read).
 *  - canFinanceDashboard  finance.view_dashboard — links into the Finance module.
 *  - canPay       finance.confirm_payment, or milling.edit for the mill's own
 *                 rows (the Mill Operator). recordPayment refuses anything else.
 *  - canTransfer  the contra-transfer route's canMoveMoney — the same pair.
 *  - canAcceptTransfer  a transfer TO the mill is accepted with milling.edit.
 *  - canRecordExpense   POST /milling/expenses — milling.create.
 *  - canStorePurchase   POST /mill-store/purchases — mill_store.create_purchase.
 *  - payroll.*    the payroll permission module.
 */
export default function useMillFinancePerms() {
  const { hasPermission } = useAuth();
  const canFinance = hasPermission('finance', 'view');
  const canPay = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit');
  return {
    canFinance,
    canFinanceDashboard: hasPermission('finance', 'view_dashboard'),
    canPay,
    canTransfer: canPay,
    canAcceptTransfer: hasPermission('milling', 'edit'),
    canRecordExpense: hasPermission('milling', 'create'),
    canStorePurchase: hasPermission('mill_store', 'create_purchase'),
    canViewReports: hasPermission('reports', 'view'),
    canViewPayroll: hasPermission('payroll', 'view'),
    canPreparePayroll: hasPermission('payroll', 'create'),
  };
}
