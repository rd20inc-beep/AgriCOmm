import { useMemo } from 'react';
import {
  usePayables, useMillPayables, useReceivables, useMillReceivables,
  useSuppliers, useCustomers, useLocalSales,
} from '../../../../../api/queries';
import { UNASSIGNED, isStoredPayable, isSupplierDebt } from '../../../utils/payableBuckets';
import { buildCustomerRows } from '../../../utils/customerDirectory';
import useMillFinancePerms from './useMillFinancePerms';

const sumTotals = (rows) => rows.reduce(
  (acc, r) => ({ billed: acc.billed + r.billed, paid: acc.paid + r.paid, outstanding: acc.outstanding + r.outstanding }),
  { billed: 0, paid: 0, outstanding: 0 },
);

/**
 * Money owed to mill suppliers, per supplier. Only loaded where it is shown
 * (Parties ▸ Suppliers, the Pay Supplier picker) — never on the Overview.
 *
 * Finance holders read the company feeds (filtered to the mill here). A mill
 * role without finance.view — the Mill Operator — reads the mill-only feed.
 */
export function useSupplierDirectory() {
  const { canFinance } = useMillFinancePerms();
  const { data: financePayables, isLoading: l1 } = usePayables({}, { enabled: canFinance });
  const { data: millPayables, isLoading: l2 } = useMillPayables({}, { enabled: !canFinance });
  const { data: suppliers = [] } = useSuppliers();
  const payablesRaw = canFinance ? financePayables : millPayables;
  const rows = useMemo(() => {
    const arr = Array.isArray(payablesRaw) ? payablesRaw : (payablesRaw?.payables || []);
    const map = {};
    for (const p of arr) {
      if (String(p.entity || '').toLowerCase() !== 'mill') continue;
      const name = p.supplierName;
      // A bill with no supplier on it is still a bill (fuel, lunch, a one-off
      // transport run…) — those collect under one Unassigned row.
      const key = name ? (p.supplierId || name) : (isStoredPayable(p) ? UNASSIGNED : null);
      // Cost-derived rows (MC-/EC-/ME-) are NOT debts — paying the allocation
      // as well as the store purchase would pay for the same bags twice.
      if (!key || !isSupplierDebt(p)) continue;
      if (!map[key]) {
        map[key] = {
          id: name ? (p.supplierId || null) : UNASSIGNED,
          name: name || 'Unassigned — no supplier on the bill',
          billed: 0, paid: 0, outstanding: 0, count: 0,
        };
      }
      map[key].billed += parseFloat(p.originalAmount) || 0;
      map[key].paid += parseFloat(p.paidAmount) || 0;
      map[key].outstanding += parseFloat(p.outstanding) || 0;
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [payablesRaw]);
  const totals = useMemo(() => sumTotals(rows), [rows]);
  return { rows, totals, suppliers, isLoading: canFinance ? l1 : l2 };
}

/**
 * Local customers with billed / received / outstanding. Receivables that are
 * NOT local sales (opening balances…) are folded in; the endpoint returns both
 * kinds and buildCustomerRows takes only the former, so no sale counts twice.
 */
export function useCustomerDirectory() {
  const { canFinance } = useMillFinancePerms();
  const { data: localCustomers = [], isLoading } = useCustomers({ type: 'local' });
  const { data: allLocalSales = [] } = useLocalSales(); // every page (P4-11)
  const { data: financeReceivables } = useReceivables({ limit: 500 }, { enabled: canFinance });
  const { data: millReceivables } = useMillReceivables({ limit: 500 }, { enabled: !canFinance });
  const rows = useMemo(
    () => buildCustomerRows(localCustomers, allLocalSales, (canFinance ? financeReceivables : millReceivables) || []),
    [localCustomers, allLocalSales, canFinance, financeReceivables, millReceivables],
  );
  const totals = useMemo(() => sumTotals(rows), [rows]);
  return { rows, totals, customers: localCustomers, isLoading };
}
