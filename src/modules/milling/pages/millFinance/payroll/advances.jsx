import { useState, useEffect } from 'react';
import { Plus, Banknote, Trash2, HandCoins, CalendarDays, X } from 'lucide-react';
import { useOwnerAuth } from '../../../../../context/OwnerAuthContext';
import { useWorkerAdvances, useDeleteWorkerAdvance, useVoidWorkerAdvance, useAdvanceLedger, useWorkerAdjustments, useCreateWorkerAdjustment, useDeleteWorkerAdjustment } from '../../../../../api/queries';
import StatusBadge from '../../../../../components/StatusBadge';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { favStar } from '../../../../../shared/utils/favorites';
import { accountsForCurrency } from '../../../../../shared/utils/accountCurrency';
import useConfirm from '../../../../../hooks/useConfirm';
import { todayLocalISO, fmtPKR, fmtDate } from '../../../../../shared/utils/format';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Pay an approved salary advance (P2-09): the method, the account it is paid
// from and the payment date are chosen here; the payout is booked to 1330 Staff
// Advances on that date (D-11) and recovered from salary later.
export function AdvancePayDrawer({ advance, bankAccounts = [], payMut, addToast, onClose }) {
  const entity = advance.workerEntity === 'general' ? 'general' : 'mill';
  const cashAccounts = accountsForCurrency((bankAccounts || []).filter((a) => a.type === 'cash'), 'PKR');
  const banks = accountsForCurrency((bankAccounts || []).filter((a) => a.type !== 'cash'), 'PKR');
  const defaultCash = cashAccounts.find((a) => a.entity === entity) || cashAccounts[0];
  const [form, setForm] = useState({ method: 'cash', accountId: defaultCash ? String(defaultCash.id) : '', payDate: todayLocalISO(), reference: '' });
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const choices = form.method === 'cash' ? cashAccounts : banks;
  async function submit() {
    if (!form.accountId) { addToast('Choose the account the advance is paid from', 'error'); return; }
    if (!form.payDate) { addToast('Enter the payment date', 'error'); return; }
    try {
      await payMut.mutateAsync({ id: advance.id, data: { payment_method: form.method, bank_account_id: Number(form.accountId), pay_date: form.payDate, payment_reference: form.reference || null } });
      addToast(`Advance of ${PKR(advance.amount)} paid to ${advance.workerName}`, 'success');
      onClose();
    } catch (e) { addToast(e?.data?.message || e?.message || 'Could not pay the advance.', 'error'); }
  }
  return (
    <SlideDrawer open onClose={onClose} title="Pay salary advance" subtitle={`${advance.workerName || 'Worker'} · ${PKR(advance.amount)}`} icon={Banknote}
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={payMut.isPending} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
            <Banknote className="w-4 h-4" /> {payMut.isPending ? 'Paying…' : `Pay ${PKR(advance.amount)}`}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Method</label>
            <select value={form.method} onChange={(e) => { const m = e.target.value; const first = (m === 'cash' ? (defaultCash || cashAccounts[0]) : banks[0]); set({ method: m, accountId: first ? String(first.id) : '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Payment date</label>
            <input type="date" value={form.payDate} max={todayLocalISO()} onChange={(e) => set({ payDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] text-gray-500 mb-1">Paid from</label>
            <select value={form.accountId} onChange={(e) => set({ accountId: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Choose an account…</option>
              {choices.map((a) => <option key={a.id} value={a.id}>{favStar(a)}{a.name}{a.currentBalance != null ? ` · ${PKR(a.currentBalance)}` : ''}</option>)}
            </select>
          </div>
          {form.method !== 'cash' && (
            <div className="col-span-2">
              <label className="block text-[11px] text-gray-500 mb-1">Reference (optional)</label>
              <input value={form.reference} onChange={(e) => set({ reference: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-400">Booked as a staff advance (DR 1330 Staff Advances / CR the account above) on the payment date, then recovered from salary — each recovery moves it to Salaries &amp; Wages.</p>
      </div>
    </SlideDrawer>
  );
}

// Human label for an advance's recovery plan (camelCase from the API layer).
const RECOVERY_LABELS = {
  full_next_salary: 'Full next salary', fixed_installment: 'Fixed installments',
  salary_percentage: 'Percentage of salary', manual: 'Manual deduction',
};
function recoveryPlanLine(a) {
  const m = a.recoveryMethod || a.recovery_method || 'full_next_salary';
  if (m === 'fixed_installment') {
    const inst = a.installmentAmount || a.installment_amount; const cnt = a.installmentCount || a.installment_count;
    return `Fixed installments${inst ? ` · ${PKR(inst)}/mo` : ''}${cnt ? ` × ${cnt}` : ''}`;
  }
  if (m === 'salary_percentage') { const p = a.deductionPercent || a.deduction_percent; return `Percentage of salary${p ? ` · ${p}%` : ''}`; }
  if (m === 'manual') return 'Manual deduction';
  return 'Full next salary';
}

// Right-side panel listing a worker's advances, with a delete (unwind) action.
export function WorkerAdvancesPanel({ worker, onClose, onGiveAdvance, addToast }) {
  const { data: advances = [], isLoading } = useWorkerAdvances(worker.id);
  const deleteAdvanceMut = useDeleteWorkerAdvance();
  const voidAdvanceMut = useVoidWorkerAdvance();
  const { requestOwnerApproval } = useOwnerAuth();
  const [confirm, confirmDialog] = useConfirm();
  const [confirmId, setConfirmId] = useState(null);
  const [ledgerId, setLedgerId] = useState(null);
  const outstanding = advances
    .filter(a => a.status === 'outstanding')
    .reduce((s, a) => s + ((parseFloat(a.amount) || 0) - (parseFloat(a.recoveredAmount) || 0)), 0);

  // A request that was never paid is deleted. A PAID advance is voided (D-23):
  // its payout is reversed and the advance kept — a payment reversal, so it
  // needs a reason and the Owner. Once any of it is recovered from salary the
  // server refuses (409).
  async function handleDelete(a) {
    try {
      if (a.approvalStatus === 'paid') {
        setConfirmId(null);
        const ok = await confirm({
          title: `Void this ${PKR(a.amount)} advance?`,
          consequence: 'The payout is reversed back into the account it was paid from. The advance stays on record as voided. The Owner must authorize it.',
          amount: PKR(a.amount),
          reason: 'required',
          confirmLabel: 'Void advance',
          cancelLabel: 'Go back',
        });
        if (!ok) return;
        await requestOwnerApproval((ownerId) => voidAdvanceMut.mutateAsync({ id: a.id, data: { reason: ok.reason, authorized_by_owner_id: ownerId } }));
        addToast('Advance voided and payout reversed', 'success');
        return;
      }
      await deleteAdvanceMut.mutateAsync(a.id);
      addToast('Advance request deleted', 'success');
      setConfirmId(null);
    } catch (e) { if (e?.message !== 'Owner authorization cancelled') addToast(e?.data?.message || e.message, 'error'); }
  }

  return (
    <SlideDrawer
      open
      onClose={onClose}
      title="Salary Advances"
      subtitle={`${worker.name} · ${PKR(outstanding)} outstanding`}
      icon={HandCoins}
      footer={
        <div className="flex justify-between gap-2">
          <button onClick={onGiveAdvance} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700">
            <HandCoins className="w-4 h-4" /> Give Advance
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
        </div>
      }
    >
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : advances.length === 0 ? (
        <p className="text-sm text-gray-400">No advances recorded for this worker.</p>
      ) : (
        <div className="space-y-2">
          {advances.map(a => {
            const out = (parseFloat(a.amount) || 0) - (parseFloat(a.recoveredAmount) || 0);
            return (
            <div key={a.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 tabular-nums">{PKR(a.amount)}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(a.advanceDate)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {a.approvalStatus === 'pending' ? (
                    <StatusBadge status="Pending Approval" />
                  ) : a.approvalStatus === 'approved' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700">Approved · unpaid</span>
                  ) : a.approvalStatus === 'rejected' ? (
                    <StatusBadge status="Rejected" />
                  ) : a.approvalStatus === 'voided' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500" title={a.voidReason || ''}>Voided</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${a.status === 'outstanding' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {a.status === 'outstanding' ? `${PKR(out)} due` : 'Recovered'}
                    </span>
                  )}
                  {a.approvalStatus === 'voided' || (parseFloat(a.recoveredAmount) || 0) > 0 ? null : confirmId === a.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => handleDelete(a)} disabled={deleteAdvanceMut.isPending || voidAdvanceMut.isPending} className="px-2 py-1 text-[11px] text-white bg-red-600 rounded hover:bg-red-700">{a.approvalStatus === 'paid' ? 'Void…' : 'Confirm'}</button>
                      <button aria-label="Cancel" onClick={() => setConfirmId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ) : (
                    <button aria-label={a.approvalStatus === 'paid' ? 'Void & reverse payout' : 'Delete request'} title={a.approvalStatus === 'paid' ? 'Void & reverse payout' : 'Delete request'} onClick={() => setConfirmId(a.id)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-gray-500">{recoveryPlanLine(a)}</span>
                <button onClick={() => setLedgerId(a.id)} className="text-[11px] text-blue-600 hover:underline">Advance ledger →</button>
              </div>
              {a.notes && <div className="text-xs text-gray-500 mt-1">{a.notes}</div>}
            </div>
            );
          })}
        </div>
      )}
      {ledgerId && <AdvanceLedgerDrawer advanceId={ledgerId} onClose={() => setLedgerId(null)} />}
      {confirmDialog}
    </SlideDrawer>
  );
}

// Bonuses & deductions for one worker. bonus → +gross, deduction → −net.
// One-off (a month) or recurring (every month).
export function AdjustmentsDrawer({ worker, month, onClose, addToast }) {
  const { data: rows = [], isLoading } = useWorkerAdjustments(worker.id);
  const createMut = useCreateWorkerAdjustment();
  const delMut = useDeleteWorkerAdjustment();
  const [form, setForm] = useState({ type: 'bonus', label: '', amount: '', recurring: false, period: month });
  useEffect(() => { setForm(f => ({ ...f, period: month })); }, [month]);
  const submit = async () => {
    if (!form.label.trim()) { addToast('Enter a label', 'error'); return; }
    if (!(parseFloat(form.amount) > 0)) { addToast('Enter a positive amount', 'error'); return; }
    try {
      await createMut.mutateAsync({ id: worker.id, data: { type: form.type, label: form.label.trim(), amount: form.amount, recurring: form.recurring, period: form.recurring ? null : form.period } });
      addToast(`${form.type === 'bonus' ? 'Bonus' : 'Deduction'} added`, 'success');
      setForm(f => ({ ...f, label: '', amount: '' }));
    } catch (e) { addToast(e.message, 'error'); }
  };
  const bonuses = rows.filter(r => r.type === 'bonus');
  const deductions = rows.filter(r => r.type === 'deduction');
  const Row = (a) => (
    <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
      <div>
        <span className="font-medium text-gray-800">{a.label}</span>
        <span className="text-[11px] text-gray-400 ml-2">{a.recurring ? 'every month' : a.period}{a.isActive ? '' : ' · inactive'}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`tabular-nums font-semibold ${a.type === 'bonus' ? 'text-emerald-700' : 'text-red-600'}`}>{a.type === 'bonus' ? '+' : '−'}{PKR(a.amount)}</span>
        <button aria-label="Remove" onClick={async () => { try { await delMut.mutateAsync(a.id); addToast('Removed', 'success'); } catch (e) { addToast(e.message, 'error'); } }} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
  return (
    <SlideDrawer open onClose={onClose} title="Bonuses & Deductions" subtitle={`${worker.name} · ${worker.role || ''}`} icon={Plus} size="md"
      footer={<div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button></div>}>
      <div className="space-y-4">
        {/* Add form */}
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[['bonus', 'Bonus / Allowance'], ['deduction', 'Deduction']].map(([v, l]) => (
              <button key={v} onClick={() => setForm(f => ({ ...f, type: v }))} className={`px-3 py-1.5 font-medium ${form.type === v ? (v === 'bonus' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'bg-white text-gray-600'}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-xs text-gray-600 mb-1">Label</label><input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder={form.type === 'bonus' ? 'e.g. Eid bonus, Travel allowance' : 'e.g. Late fine, Loan repayment'} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Amount (PKR)</label><input type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Applies</label>
              <select value={form.recurring ? 'recurring' : 'once'} onChange={e => setForm(f => ({ ...f, recurring: e.target.value === 'recurring' }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="once">One month</option><option value="recurring">Every month</option>
              </select>
            </div>
            {!form.recurring && <div className="col-span-2"><label className="block text-xs text-gray-600 mb-1">Month</label><input type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>}
          </div>
          <button onClick={submit} disabled={createMut.isPending} className={`w-full px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${form.type === 'bonus' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>{createMut.isPending ? 'Adding…' : `Add ${form.type === 'bonus' ? 'bonus' : 'deduction'}`}</button>
        </div>

        {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : (
          <>
            <div>
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Bonuses / allowances (+gross)</p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">{bonuses.length ? bonuses.map(Row) : <p className="px-3 py-3 text-xs text-gray-400">None.</p>}</div>
            </div>
            <div>
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Deductions (−net)</p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">{deductions.length ? deductions.map(Row) : <p className="px-3 py-3 text-xs text-gray-400">None.</p>}</div>
            </div>
            <p className="text-[11px] text-gray-400">Bonuses add to gross; deductions subtract from net (after advance recovery). Recurring items apply every month; one-off items only their month. Net never goes below zero.</p>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}

// One advance's recovery plan, schedule and debit/credit ledger.
export function AdvanceLedgerDrawer({ advanceId, onClose }) {
  const { data, isLoading } = useAdvanceLedger(advanceId);
  const a = data?.advance || {};
  const schedule = data?.schedule || [];
  const entries = data?.entries || [];
  const out = data?.outstanding != null ? data.outstanding : Math.max(0, (parseFloat(a.amount) || 0) - (parseFloat(a.recovered_amount) || 0));
  const SCH_TONE = { pending: 'bg-gray-100 text-gray-600', partially_recovered: 'bg-amber-100 text-amber-700', recovered: 'bg-emerald-100 text-emerald-700', skipped: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400' };
  return (
    <SlideDrawer open onClose={onClose} title="Advance Ledger" subtitle={a.worker_name || ''} icon={HandCoins} size="lg">
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-[11px] uppercase tracking-wider text-gray-400">Advance</p><p className="font-medium">{PKR(a.amount)}</p></div>
            <div><p className="text-[11px] uppercase tracking-wider text-gray-400">Date</p><p className="font-medium">{fmtDate(a.advance_date)}</p></div>
            <div><p className="text-[11px] uppercase tracking-wider text-gray-400">Recovery</p><p className="font-medium">{RECOVERY_LABELS[a.recovery_method] || a.recovery_method || '—'}</p></div>
            <div><p className="text-[11px] uppercase tracking-wider text-gray-400">Outstanding</p><p className={`font-medium ${out > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{PKR(out)}</p></div>
          </div>

          {schedule.length > 0 && (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 text-xs font-semibold text-gray-700">Recovery schedule</div>
              <table className="w-full text-xs mobile-cards">
                <thead className="text-gray-500"><tr><th className="text-left px-3 py-1.5">Period</th><th className="text-right px-3 py-1.5">Scheduled</th><th className="text-right px-3 py-1.5">Recovered</th><th className="text-left px-3 py-1.5">Status</th><th className="text-left px-3 py-1.5">Run</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {schedule.map(s => (
                    <tr key={s.id}>
                      <td data-label="Period" className="px-3 py-1.5">{s.period}</td>
                      <td data-label="Scheduled" className="px-3 py-1.5 text-right tabular-nums">{PKR(s.scheduled_amount)}</td>
                      <td data-label="Recovered" className="px-3 py-1.5 text-right tabular-nums">{PKR(s.recovered_amount)}</td>
                      <td data-label="Status" className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SCH_TONE[s.status] || 'bg-gray-100 text-gray-600'}`}>{String(s.status || '').replace('_', ' ')}</span>{s.skip_reason ? <span className="ml-1 text-[10px] text-gray-400" title={s.skip_reason}>ⓘ</span> : null}</td>
                      <td data-label="Run" className="px-3 py-1.5 text-gray-500">{s.payroll_run_id ? `PR-${s.payroll_run_id}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-xs font-semibold text-gray-700">Transactions</div>
            <table className="w-full text-xs mobile-cards">
              <thead className="text-gray-500"><tr><th className="text-left px-3 py-1.5">Date</th><th className="text-left px-3 py-1.5">Description</th><th className="text-right px-3 py-1.5">Debit</th><th className="text-right px-3 py-1.5">Credit</th><th className="text-right px-3 py-1.5">Balance</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td data-label="Date" className="px-3 py-1.5">{fmtDate(e.date)}</td>
                    <td data-label="Description" className="px-3 py-1.5">{e.description}{e.ref ? <span className="text-gray-400"> · {e.ref}</span> : ''}</td>
                    <td data-label="Debit" className="px-3 py-1.5 text-right tabular-nums">{e.debit ? PKR(e.debit) : '—'}</td>
                    <td data-label="Credit" className="px-3 py-1.5 text-right tabular-nums">{e.credit ? PKR(e.credit) : '—'}</td>
                    <td data-label="Balance" className="px-3 py-1.5 text-right tabular-nums font-medium">{PKR(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">Debit = advance paid out; Credit = recovered from salary. Balance = remaining advance.</p>
        </div>
      )}
    </SlideDrawer>
  );
}
