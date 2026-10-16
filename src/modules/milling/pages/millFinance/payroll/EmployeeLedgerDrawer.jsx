import { Users } from 'lucide-react';
import { useWorkerLedger } from '../../../../../api/queries';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { fmtPKR, fmtDate } from '../../../../../shared/utils/format';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// ─── Per-employee ledger: every amount paid to a worker (advances + payroll net
// pay + other salary disbursements), newest first, with the period total. ───
const LEDGER_TYPE_STYLE = {
  advance: 'bg-amber-100 text-amber-700',
  payroll: 'bg-emerald-100 text-emerald-700',
  other: 'bg-gray-100 text-gray-600',
};
// Compact labelled stat for the employee-ledger summary grid.
export function Sm({ label, value, tone = 'gray' }) {
  const t = { gray: 'text-gray-900 border-gray-200 bg-gray-50', amber: 'text-amber-700 border-amber-200 bg-amber-50', emerald: 'text-emerald-700 border-emerald-200 bg-emerald-50', rose: 'text-red-600 border-red-200 bg-red-50' }[tone] || 'text-gray-900 border-gray-200 bg-gray-50';
  return (
    <div className={`rounded-lg border p-2.5 ${t}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function EmployeeLedgerDrawer({ worker, onClose }) {
  const { data, isLoading } = useWorkerLedger(worker?.id);
  const rs = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });
  const entries = data?.entries || [];
  return (
    <SlideDrawer
      open={!!worker}
      onClose={onClose}
      title="Employee Ledger"
      subtitle={worker ? `${worker.name}${worker.role ? ` · ${worker.role}` : ''}` : ''}
      icon={Users}
      size="lg"
    >
      {!worker ? null : isLoading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : (() => {
        const sm = data?.summary || {};
        const bal = data?.currentBalance != null ? data.currentBalance : (sm.currentBalance || 0);
        return (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Sm label="Salary earned" value={rs(sm.salaryEarned)} />
            <Sm label="Salary paid" value={rs(sm.salaryPaid)} />
            <Sm label="Advances taken" value={rs(sm.advancesTaken)} />
            <Sm label="Advance deducted" value={rs(sm.advanceDeducted)} />
            <Sm label="Bonus" value={rs(sm.bonus)} />
            <Sm label="Tax / deductions withheld" value={rs((sm.statutoryWithheld || 0) + (sm.deductions || 0))} />
            <Sm label="Accrued, not yet paid" value={rs(sm.accruedUnpaid)} />
            <Sm label="Advance outstanding" value={rs(sm.advanceOutstanding)} tone="amber" />
            <Sm label={bal >= 0 ? 'Salary payable' : 'Owes company'} value={rs(Math.abs(bal))} tone={bal > 0 ? 'emerald' : bal < 0 ? 'rose' : 'gray'} />
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No payments recorded for this employee yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm mobile-cards">
                <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Debit</th>
                    <th className="text-right px-3 py-2">Credit</th>
                    <th className="text-right px-3 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((e, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td data-label="Date" className="px-3 py-2 whitespace-nowrap text-gray-600">{fmtDate(e.date)}</td>
                      <td data-label="Description" className="px-3 py-2 text-gray-700">{e.label}{e.note ? <span className="text-gray-400 text-xs"> · {e.note}</span> : ''}</td>
                      <td data-label="Debit" className="px-3 py-2 text-right tabular-nums text-red-600">{e.debit ? rs(e.debit) : '—'}</td>
                      <td data-label="Credit" className="px-3 py-2 text-right tabular-nums text-emerald-600">{e.credit ? rs(e.credit) : '—'}</td>
                      <td data-label="Balance" className={`px-3 py-2 text-right tabular-nums font-medium ${e.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{rs(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sm.pendingLines > 0 && <p className="text-xs text-gray-500">{sm.pendingLines} payslip(s) awaiting approval / payment ({rs(sm.pendingNet)} net) — not on the ledger until accrued or paid.</p>}
          <p className="text-[11px] text-gray-400">Debit = paid to or withheld for the employee (advance, net salary, tax / deductions); Credit = salary earned (gross + bonus, once accrued or paid). Balance &gt; 0 → salary still payable; balance &lt; 0 → employee owes the company (outstanding advance). Amounts in PKR.</p>
        </div>
        );
      })()}
    </SlideDrawer>
  );
}

