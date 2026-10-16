import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Banknote, FileText, Zap } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { useMillExpenses } from '../../../../../api/queries';
import StatusBadge from '../../../../../components/StatusBadge';
import Stat from '../components/Stat';
import ExpensePayDrawer from '../drawers/ExpensePayDrawer';
import useMillFinancePerms from '../hooks/useMillFinancePerms';
import { PKR, UTILITY_CATS } from '../constants';
import { mfHref } from '../urlState';
import { useBankAccountsList, useCompanyProfile } from '../../../../../shared/hooks/useMasterData';

/**
 * Mill expenses — every one, with its payable status, a Pay / voucher drawer
 * per row. `cat=utilities` narrows to the running-cost heads (electricity,
 * fuel, maintenance, rent) the old Utilities tab showed, with its per-head
 * totals.
 */
export default function ExpensesView({ period, cat }) {
  const { addToast } = useApp();
  const companyProfileData = useCompanyProfile();
  const { data: bankAccountsList } = useBankAccountsList();
  const { canPay, canRecordExpense } = useMillFinancePerms();
  const { data: expData } = useMillExpenses();
  const allExpenses = expData?.expenses || [];
  const utilitiesOnly = cat === 'utilities';
  const expenses = utilitiesOnly ? allExpenses.filter((e) => UTILITY_CATS.includes(e.category)) : allExpenses;
  const [payExpense, setPayExpense] = useState(null);
  return (
    <div className="space-y-4" data-testid="mf-expenses">
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Expense heads">
        <Link to={mfHref({ section: 'transactions', view: 'expenses' }, period)} aria-current={!utilitiesOnly ? 'true' : undefined}
          className={`px-2.5 py-1 text-xs rounded-md ${!utilitiesOnly ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>All heads</Link>
        <Link to={mfHref({ section: 'transactions', view: 'expenses', cat: 'utilities' }, period)} aria-current={utilitiesOnly ? 'true' : undefined}
          className={`px-2.5 py-1 text-xs rounded-md inline-flex items-center gap-1 ${utilitiesOnly ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}><Zap size={12} aria-hidden="true" /> Utilities &amp; running costs</Link>
      </div>
      {utilitiesOnly && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {UTILITY_CATS.map(head => {
          const catTotal = expenses.filter(e => e.category === head).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
          return <Stat key={head} tone="blue" icon={Zap} label={head.charAt(0).toUpperCase() + head.slice(1)} value={PKR(catTotal)} sub="Total recorded" />;
        })}
      </div>
      )}
      <p className="text-xs text-gray-500">
        All mill expenses flow into the main Finance dashboard, Money Out, and GL.{canRecordExpense ? ' Record a new one with Record Expense at the top.' : ''}
      </p>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm mobile-cards">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Description</th>
              <th className="text-left px-4 py-3 font-medium">Reference</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              {canPay && <th className="text-right px-4 py-3 font-medium no-print">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {expenses.map(e => (
              <tr key={e.id} onClick={() => setPayExpense(e)} className="hover:bg-gray-50 cursor-pointer" title="View voucher / pay">
                <td data-label="Date" className="px-4 py-3 text-gray-600">{e.expenseDate}</td>
                <td data-label="Category" className="px-4 py-3">
                  <span className="capitalize">{e.category}</span>
                  {e.isRecurring && <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-100 text-violet-700 uppercase"><RefreshCw className="w-2.5 h-2.5" />{e.recurrence || 'recurring'}</span>}
                </td>
                <td data-label="Description" className="mob-hide px-4 py-3 text-gray-600">
                  {e.description || '—'}
                  {(e.employeeName || e.subcategory) && <span className="block text-[10px] text-gray-400">{e.employeeName || e.subcategory}</span>}
                </td>
                <td data-label="Reference" className="mob-hide px-4 py-3 text-gray-500 text-xs">{e.reference || e.invoiceReference || '—'}</td>
                <td data-label="Status" className="px-4 py-3">
                  <StatusBadge status={e.paymentStatus || 'Pending'} />
                </td>
                <td data-label="Amount" className="px-4 py-3 text-right font-medium tabular-nums">{PKR(parseFloat(e.amount))}</td>
                {canPay && (
                  <td data-label="Action" className="px-4 py-3 text-right no-print">
                    {(e.paymentStatus !== 'Paid') ? (
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setPayExpense(e); }}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium"
                      >
                        <Banknote size={12} /> Pay
                      </button>
                    ) : <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1"><FileText size={12} /> Voucher</span>}
                  </td>
                )}
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr><td colSpan={canPay ? 7 : 6} className="px-4 py-10 text-center text-gray-400">No expenses recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <ExpensePayDrawer expense={payExpense} bankAccounts={bankAccountsList} companyProfile={companyProfileData} canPay={canPay} addToast={addToast} onClose={() => setPayExpense(null)} />
    </div>
  );
}
