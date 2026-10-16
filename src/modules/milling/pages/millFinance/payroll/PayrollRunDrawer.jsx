import { useState, Fragment } from 'react';
import { Wallet } from 'lucide-react';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { favStar } from '../../../../../shared/utils/favorites';
import { accountsForCurrency } from '../../../../../shared/utils/accountCurrency';
import { todayLocalISO, fmtPKR } from '../../../../../shared/utils/format';
import { isNetLowered, rowsMissingNetReason, netOverrideReasonFor } from '../../../utils/payrollNet';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Drawer to post a payroll run: review the per-employee breakdown, then pay it
// out from Mill Cash. Server recomputes the figures on submit.
export function PayrollRunDrawer({ month, entity = 'mill', employees, preselectId, bankAccounts = [], onClose, onPosted, postRunMut, addToast }) {
  const [form, setForm] = useState({ pay_method: 'cash', bank_account_id: '', pay_date: todayLocalISO() });
  // Banks the mill can pay salaries from (cash is the dedicated Mill Cash float).
  // Mill payments are PKR — a non-PKR (e.g. USD) account cannot carry them.
  const payBanks = accountsForCurrency((bankAccounts || []).filter(a => a.type !== 'cash'), 'PKR');
  // One editable row per unpaid employee: include, advance-to-clear, and the
  // amount actually being paid. Net is DERIVED (gross + bonus − advance −
  // deductions − tax); "Paying now" can only be lowered from it, never raised —
  // the server recomputes the net and rejects anything above it.
  const [rows, setRows] = useState(() => employees.map(w => {
    // Default deduction = the SCHEDULED amount for this month (recovery plan),
    // not the full outstanding. Admin can still reduce / skip / enter manually.
    const scheduled = Math.round(w.advanceScheduled != null ? w.advanceScheduled : Math.min(w.advanceOutstanding || 0, w.grossPay || 0));
    const bonus = Math.round(w.bonusTotal || 0); const deduction = Math.round(w.deductionTotal || 0);
    const statutory = Math.round(w.statutoryTotal || 0);
    // Most the advance can recover: pay left after tax and other deductions.
    const cap = Math.max(0, (w.grossPay || 0) + bonus - deduction - statutory);
    return {
      id: w.id, name: w.name, role: w.role, gross: w.grossPay || 0, bonus, deduction, statutory, cap,
      prorated: !!w.prorated, employedDays: w.employedDays, daysInMonth: w.daysInMonth,
      outstanding: Math.round(w.advanceOutstanding || 0),
      scheduled,
      include: preselectId ? w.id === preselectId : true,
      advance: scheduled, net: Math.max(0, (w.grossPay || 0) + bonus - scheduled - deduction - statutory), reason: '', netReason: '',
    };
  }));

  const netOf = (r, advance) => Math.max(0, r.gross + r.bonus - advance - r.deduction - (r.statutory || 0));
  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  // Changing the advance-to-clear re-derives the net (which can then only be lowered).
  const onAdvance = (r, raw) => {
    const advance = Math.max(0, Math.min(Math.round(parseFloat(raw) || 0), r.outstanding, r.cap));
    setRow(r.id, { advance, net: netOf(r, advance) });
  };
  const onNet = (r, raw) => setRow(r.id, { net: Math.min(netOf(r, r.advance), Math.max(0, Math.round(parseFloat(raw) || 0))) });
  const applyScheduled = (r) => setRow(r.id, { advance: r.scheduled, net: netOf(r, r.scheduled), reason: '' });
  const skipRow = (r) => setRow(r.id, { advance: 0, net: netOf(r, 0) });

  const included = rows.filter(r => r.include);
  const totalNet = included.reduce((s, r) => s + r.net, 0);
  const totalAdvance = included.reduce((s, r) => s + r.advance, 0);
  // A reason is required where the deduction was changed away from the schedule.
  const needsReason = included.filter(r => Math.round(r.advance) !== Math.round(r.scheduled) && !String(r.reason || '').trim());
  // Paying less than the net needs its own reason (B3) — kept on the line.
  const needsNetReason = rowsMissingNetReason(included, netOf);

  async function post() {
    if (!included.length) { addToast('Select at least one employee to pay', 'error'); return; }
    if (needsReason.length) { addToast(`Add a reason for the changed deduction: ${needsReason.map(r => r.name).join(', ')}`, 'error'); return; }
    if (needsNetReason.length) { addToast(`Add a reason for paying less than the net: ${needsNetReason.map(r => r.name).join(', ')}`, 'error'); return; }
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account to pay from', 'error'); return; }
    try {
      const res = await postRunMut.mutateAsync({
        month,
        entity,
        pay_method: form.pay_method,
        bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null,
        pay_date: form.pay_date,
        lines: included.map(r => ({
          worker_id: r.id, net_pay: r.net, advance_deducted: r.advance,
          skip_reason: Math.round(r.advance) !== Math.round(r.scheduled) ? (r.reason || null) : null,
          net_override_reason: netOverrideReasonFor(r, netOf(r, r.advance)),
        })),
      });
      const raw = res?.data?.run || {};
      onPosted({ id: raw.id, period: raw.period, netTotal: raw.net_total });
    } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <SlideDrawer
      open
      onClose={onClose}
      title="Prepare Payroll Run"
      subtitle={`Prepare ${month} payroll for approval`}
      icon={Wallet}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{included.length} selected · advance cleared {PKR(totalAdvance)}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={post} disabled={postRunMut.isPending || !included.length} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {postRunMut.isPending ? 'Preparing…' : `Prepare run · ${PKR(totalNet)}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Pay via</label>
            <select
              value={form.pay_method === 'bank' ? `bank:${form.bank_account_id}` : 'cash'}
              onChange={e => {
                const v = e.target.value;
                if (v === 'cash') setForm(f => ({ ...f, pay_method: 'cash', bank_account_id: '' }));
                else setForm(f => ({ ...f, pay_method: 'bank', bank_account_id: v.replace('bank:', '') }));
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
            >
              <option value="cash">Mill Cash</option>
              {payBanks.map(a => (
                <option key={a.id} value={`bank:${a.id}`}>{favStar(a)}{a.name}{a.bank_name ? ` · ${a.bank_name}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Pay date</label>
            <input type="date" value={form.pay_date} onChange={e => setForm(f => ({ ...f, pay_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">Employees · tick who to pay, adjust each amount</span>
            <span className="text-[11px] text-gray-400">{rows.length} unpaid</span>
          </div>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-xs mobile-cards">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Employee</th>
                  <th className="text-right px-3 py-2">Gross</th>
                  <th className="text-right px-3 py-2">Advance out</th>
                  <th className="text-right px-3 py-2">Scheduled</th>
                  <th className="text-right px-3 py-2">Deducting</th>
                  <th className="text-right px-3 py-2">Paying now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const changed = Math.round(r.advance) !== Math.round(r.scheduled);
                  const lowered = r.include && isNetLowered(r.net, netOf(r, r.advance));
                  return (
                  <Fragment key={r.id}>
                  <tr className={r.include ? '' : 'opacity-40'}>
                    <td data-label="" className="mob-hide px-3 py-1.5">
                      <input type="checkbox" checked={r.include} onChange={e => setRow(r.id, { include: e.target.checked })} className="rounded border-gray-300" />
                    </td>
                    <td data-label="Employee" className="px-3 py-1.5">
                      <div className="text-gray-800 font-medium">{r.name}</div>
                      {(r.bonus > 0 || r.deduction > 0 || r.statutory > 0 || r.prorated) && (
                        <div className="text-[10px] mt-0.5">
                          {r.prorated && <span className="text-amber-600 mr-2">prorated {r.employedDays}/{r.daysInMonth} days</span>}
                          {r.bonus > 0 && <span className="text-emerald-600 mr-2">+ bonus {PKR(r.bonus)}</span>}
                          {r.deduction > 0 && <span className="text-red-600 mr-2">− deduction {PKR(r.deduction)}</span>}
                          {r.statutory > 0 && <span className="text-violet-600">− tax/statutory {PKR(r.statutory)}</span>}
                        </div>
                      )}
                      {r.include && r.outstanding > 0 && (
                        <div className="flex gap-2 mt-0.5">
                          <button onClick={() => applyScheduled(r)} className="text-[10px] text-blue-600 hover:underline">Use scheduled</button>
                          <button onClick={() => skipRow(r)} className="text-[10px] text-red-600 hover:underline">Skip this month</button>
                        </div>
                      )}
                    </td>
                    <td data-label="Gross" className="px-3 py-1.5 text-right tabular-nums text-gray-600">{PKR(r.gross)}</td>
                    <td data-label="Advance out" className="mob-hide px-3 py-1.5 text-right tabular-nums text-amber-700">{r.outstanding > 0 ? PKR(r.outstanding) : '—'}</td>
                    <td data-label="Scheduled" className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.outstanding > 0 ? PKR(r.scheduled) : '—'}</td>
                    <td data-label="Deducting" className="px-3 py-1.5 text-right">
                      {r.outstanding > 0 ? (
                        <input type="number" min="0" max={Math.min(r.outstanding, r.cap)} value={r.advance} disabled={!r.include}
                          onChange={e => onAdvance(r, e.target.value)}
                          className={`w-24 border rounded px-2 py-1 text-right tabular-nums focus:outline-none focus:border-gray-900 disabled:bg-gray-50 ${changed ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} />
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td data-label="Paying now" className="px-3 py-1.5 text-right">
                      <input type="number" min="0" max={netOf(r, r.advance)} value={r.net} disabled={!r.include}
                        onChange={e => onNet(r, e.target.value)}
                        aria-label={`Paying now for ${r.name} (at most ${PKR(netOf(r, r.advance))})`}
                        title="Net pay = gross + bonus − advance − deductions − tax. You can pay less, not more."
                        className={`w-28 border rounded px-2 py-1 text-right tabular-nums font-medium focus:outline-none focus:border-gray-900 disabled:bg-gray-50 ${r.include && r.net < netOf(r, r.advance) ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} />
                      {r.include && r.net < netOf(r, r.advance) && (
                        <div className="text-[10px] text-amber-700 mt-0.5">of net {PKR(netOf(r, r.advance))}</div>
                      )}
                    </td>
                  </tr>
                  {r.include && changed && (
                    <tr>
                      <td></td>
                      <td colSpan={6} className="px-3 pb-2">
                        <input type="text" value={r.reason} placeholder="Reason for changed/skipped deduction (required)"
                          onChange={e => setRow(r.id, { reason: e.target.value })}
                          className="w-full border border-amber-300 bg-amber-50/40 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500" />
                      </td>
                    </tr>
                  )}
                  {lowered && (
                    <tr>
                      <td></td>
                      <td colSpan={6} className="px-3 pb-2">
                        <input type="text" value={r.netReason} data-testid={`net-reason-${r.id}`}
                          placeholder={`Reason for paying ${PKR(r.net)} instead of ${PKR(netOf(r, r.advance))} (required)`}
                          aria-label={`Reason for paying ${r.name} less than the net`}
                          onChange={e => setRow(r.id, { netReason: e.target.value })}
                          className="w-full border border-amber-300 bg-amber-50/40 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500" />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ); })}
                {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Everyone is already paid for this month, or no one has pay due — mark attendance / set salaries first.</td></tr>}
              </tbody>
              {included.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-semibold text-gray-800">
                    <td></td><td className="mob-full px-3 py-2">Total ({included.length})</td>
                    <td></td><td></td><td></td>
                    <td data-label="Advance out" className="px-3 py-2 text-right tabular-nums text-amber-700">{totalAdvance ? `−${PKR(totalAdvance)}` : '—'}</td>
                    <td data-label="Paying now" className="px-3 py-2 text-right tabular-nums">{PKR(totalNet)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        <p className="text-[11px] text-gray-400">Prepares a payroll run for the ticked employees — it must then be <span className="font-medium">Approved</span> and <span className="font-medium">Paid</span> (by Finance/Owner) before any cash/GL posts. Advances are only recovered when the run is paid. "Paying now" can be lowered but not raised above the net, and a lowered amount needs a reason (kept on the payslip); it is not carried forward — the employee counts as paid for the month.</p>
      </div>
    </SlideDrawer>
  );
}
