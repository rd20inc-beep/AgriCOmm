import { RefreshCw, CalendarDays, DollarSign } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { useRecurringExpenses, useMaterializeRecurring, useRunDueRecurring, useStopRecurring } from '../../../../../api/queries';
import useConfirm from '../../../../../hooks/useConfirm';
import { fmtDate } from '../../../../../shared/utils/format';
import Stat from '../components/Stat';
import { PKR } from '../constants';

/**
 * Recurring expense schedules. Nothing posts by itself: a due period is posted
 * here (accrued as a payable + GL) by an explicit click, and a series can be
 * stopped (confirmed, with the amount shown).
 */
export default function RecurringView() {
  const { addToast } = useApp();
  const [confirm, confirmDialog] = useConfirm();
  const { data: recurringData } = useRecurringExpenses();
  const recurring = recurringData?.recurring || [];
  const materializeMut = useMaterializeRecurring();
  const runDueMut = useRunDueRecurring();
  const stopRecurringMut = useStopRecurring();

  async function handleMaterialize(r) {
    try {
      await materializeMut.mutateAsync({ id: r.id, data: {} });
      addToast(`Posted ${r.category} ${PKR(r.amount)} for ${r.nextDue}`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }
  async function handleStopRecurring(r) {
    const ok = await confirm({
      title: `Stop the recurring ${r.category} for ${r.payee || 'this payee'}?`,
      consequence: 'No occurrence after today is posted. Occurrences already posted stay as they are.',
      amount: PKR(r.amount),
      confirmLabel: 'Stop series',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try { await stopRecurringMut.mutateAsync({ id: r.id, data: {} }); addToast('Recurring series stopped', 'success'); }
    catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <div className="space-y-4" data-testid="mf-recurring">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">Expenses you marked recurring. Nothing posts by itself — when a period is due, post it here (accrued as a payable + GL). A stopped series posts nothing after its end date.</p>
        {recurring.some(r => r.due) && (
          <button
            onClick={async () => { try { const r = await runDueMut.mutateAsync(); addToast(`Auto-posted ${r?.created ?? r?.processed ?? 0} due recurring expense(s).`, 'success'); } catch (e) { addToast(e?.message || 'Could not post the due expenses.', 'error'); } }}
            disabled={runDueMut.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runDueMut.isPending ? 'animate-spin' : ''}`} /> Post all due ({recurring.filter(r => r.due).length})
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat tone="blue"  icon={RefreshCw} label="Recurring Lines" value={String(recurring.length)} sub="Active schedules" />
        <Stat tone="red"   icon={CalendarDays} label="Due Now" value={String(recurring.filter(r => r.due).length)} sub="Ready to post" />
        <Stat tone="slate" icon={DollarSign} label="Monthly-equiv." value={PKR(recurring.reduce((s, r) => { const a = parseFloat(r.amount) || 0; return s + (r.recurrence === 'weekly' ? a * 4.33 : r.recurrence === 'quarterly' ? a / 3 : r.recurrence === 'yearly' ? a / 12 : a); }, 0))} sub="Approx run-rate" />
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm mobile-cards">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Payee / detail</th>
              <th className="text-left px-4 py-3 font-medium">Repeats</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Last paid</th>
              <th className="text-left px-4 py-3 font-medium">Next due</th>
              <th className="text-right px-4 py-3 font-medium no-print">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {recurring.map(r => (
              <tr key={r.id} className={`hover:bg-gray-50 ${r.due ? 'bg-amber-50/40' : ''}`}>
                <td data-label="Category" className="px-4 py-3 capitalize font-medium text-gray-800">{r.category}</td>
                <td data-label="Payee / detail" className="px-4 py-3 text-gray-600">{r.payee || r.subcategory || '—'}</td>
                <td data-label="Repeats" className="mob-hide px-4 py-3 capitalize text-gray-600">{r.recurrence}</td>
                <td data-label="Amount" className="px-4 py-3 text-right tabular-nums">{PKR(r.amount)}</td>
                <td data-label="Last paid" className="mob-hide px-4 py-3 text-gray-500">{fmtDate(r.lastDate)}</td>
                <td data-label="Next due" className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 ${r.due ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                    {r.payrollOnly ? 'Paid through Payroll' : r.ended ? `Ended ${fmtDate(r.endDate)}` : fmtDate(r.nextDue)}
                    {r.due && <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-100 text-amber-700 uppercase">Due</span>}
                  </span>
                </td>
                <td data-label="Action" className="px-4 py-3 text-right no-print">
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      onClick={() => handleMaterialize(r)}
                      disabled={!r.due || materializeMut.isPending}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg ${r.due ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} disabled:opacity-60`}
                    >
                      {r.due ? 'Post now' : r.ended ? 'Stopped' : 'Not due'}
                    </button>
                    {!r.ended && !r.payrollOnly && (
                      <button onClick={() => handleStopRecurring(r)} disabled={stopRecurringMut.isPending}
                        className="px-2 py-1 text-xs font-medium rounded-lg text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-60">Stop</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {recurring.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No recurring expenses yet — tick <span className="font-medium">Recurring</span> when adding an expense.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <RefreshCw className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400" />
        "Post now" creates the next expense dated at its due date — only once it is due, and never twice for the same date. A series is keyed by category + payee + cadence. To change the amount, stop the series and start a new recurring expense.
      </p>
      {confirmDialog}
    </div>
  );
}
