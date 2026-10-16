import { useState } from 'react';
import { TrendingUp, Printer, Trash2, CalendarDays, Inbox, LogOut, History } from 'lucide-react';
import { useWorkerRequests, useResolveWorkerRequest, useLeaveTypes, useLeaveRequests, useCreateLeaveType, useUpdateLeaveType, useDeleteLeaveType, useApproveLeaveRequest, useRejectLeaveRequest, useFinalSettlement, useFinalizeSettlement, usePayrollAudit, useSalaryRevisions, useReviseSalary } from '../../../../../api/queries';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { favStar } from '../../../../../shared/utils/favorites';
import { accountsForCurrency } from '../../../../../shared/utils/accountCurrency';
import useConfirm from '../../../../../hooks/useConfirm';
import { todayLocalISO, fmtPKR, fmtDate, fmtDateTime } from '../../../../../shared/utils/format';
import { escapeHtml, escapeFields } from '../../../../../shared/utils/html';
import { amountInWords, openPayslipWindow, docHeaderHtml, rsAmt, docDate } from './payrollPrint';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Printable salary increment / revision letter.
function incrementLetterBody(w, rev, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  w = escapeFields(w || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const monthly = rev.newPayType === 'monthly';
  const oldAmt = monthly ? rev.prevMonthlySalary : rev.prevDailyWage;
  const newAmt = monthly ? rev.newMonthlySalary : rev.newDailyWage;
  const pct = (parseFloat(oldAmt) || 0) > 0 ? Math.round(((newAmt - oldAmt) / oldAmt) * 1000) / 10 : null;
  const unit = monthly ? 'monthly salary' : 'daily wage';
  return `<div class="slip">
    ${docHeaderHtml(company, 'Salary Revision', `Effective ${docDate(rev.effectiveDate)}`)}
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${w.name || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${w.role || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${w.cnic || '—'}</div></span>
      <span><div class="k">Effective date</div><div class="v">${docDate(rev.effectiveDate)}</div></span>
    </div>
    <p style="margin:14px 0;font-size:12px;line-height:1.7">Dear <b>${w.name}</b>,</p>
    <p style="font-size:12px;line-height:1.7">We are pleased to inform you that, effective <b>${docDate(rev.effectiveDate)}</b>, your ${unit} has been revised from <b>${rsAmt(oldAmt)}</b> to <b>${rsAmt(newAmt)}</b>${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}.${rev.reason ? ` Reason: ${escapeHtml(rev.reason)}.` : ''}</p>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Revised ${unit}</div><b>${rsAmt(newAmt)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(newAmt)} Only${monthly ? ' per month' : ' per day'}</div></div></div>
    <div class="sign"><div><div class="l">Employee</div></div><div><div class="l">Authorized By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary revision letter — ${name}.</div>
  </div>`;
}
function printIncrementLetter(w, rev, company) { return openPayslipWindow(`Salary Revision ${w.name}`, incrementLetterBody(w, rev, company)); }

// Per-employee salary revision — record a pay change (old→new) with effective
// date + reason; lists the history with a printable increment letter per change.
export function SalaryRevisionDrawer({ worker, company, onClose, addToast }) {
  const { data: revisions = [], isLoading } = useSalaryRevisions(worker.id);
  const reviseMut = useReviseSalary();
  const monthly = worker.payType === 'monthly';
  const curAmt = monthly ? worker.monthlySalary : worker.dailyWage;
  const [form, setForm] = useState({ amount: '', effective_date: todayLocalISO(), reason: '' });
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  async function submit() {
    if (!(parseFloat(form.amount) > 0)) { addToast('Enter the new amount', 'error'); return; }
    try {
      const data = { pay_type: worker.payType, effective_date: form.effective_date, reason: form.reason, [monthly ? 'monthly_salary' : 'daily_wage']: parseFloat(form.amount) };
      await reviseMut.mutateAsync({ workerId: worker.id, data });
      addToast('Salary revised', 'success'); setForm({ amount: '', effective_date: todayLocalISO(), reason: '' });
    } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <SlideDrawer open onClose={onClose} title="Revise salary" subtitle={`${worker.name} · current ${monthly ? 'monthly' : 'daily'} ${PKR(curAmt)}`} icon={TrendingUp} size="lg">
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-600">New {monthly ? 'monthly salary' : 'daily wage'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] text-gray-500 mb-1">New amount (Rs)</label><input type="number" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={String(Math.round(parseFloat(curAmt) || 0))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-[11px] text-gray-500 mb-1">Effective date</label><input type="date" value={form.effective_date} onChange={(e) => set({ effective_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="block text-[11px] text-gray-500 mb-1">Reason</label><input value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Annual increment, promotion" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          {parseFloat(form.amount) > 0 && parseFloat(curAmt) > 0 && (
            <div className="text-[11px] text-gray-500">{PKR(curAmt)} → <span className="font-semibold text-gray-800">{PKR(form.amount)}</span> ({(parseFloat(form.amount) - curAmt) >= 0 ? '+' : ''}{Math.round(((parseFloat(form.amount) - curAmt) / curAmt) * 1000) / 10}%)</div>
          )}
          <div className="flex justify-end">
            <button onClick={submit} disabled={reviseMut.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Apply revision</button>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Revision history</div>
          {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !revisions.length ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">No revisions yet.</p>
          ) : (
            <div className="space-y-2">
              {revisions.map((r) => {
                const m = r.newPayType === 'monthly';
                const oldA = m ? r.prevMonthlySalary : r.prevDailyWage; const newA = m ? r.newMonthlySalary : r.newDailyWage;
                return (
                  <div key={r.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{PKR(oldA)} → {PKR(newA)} <span className="text-[10px] font-normal text-gray-400">{m ? '/mo' : '/day'}</span></div>
                      <div className="text-xs text-gray-500">eff {fmtDate(r.effectiveDate)}{r.reason ? ` · ${r.reason}` : ''}{r.createdByName ? ` · ${r.createdByName}` : ''}</div>
                    </div>
                    <button onClick={() => printIncrementLetter(worker, r, company)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"><Printer className="w-3.5 h-3.5" /> Letter</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SlideDrawer>
  );
}

// Payroll activity / audit log — a payroll-scoped slice of the audit trail.
const AUDIT_ENTITY_LABEL = { mill_payroll_run: 'Payroll run', statutory_remittance: 'Statutory remittance', mill_final_settlement: 'Final settlement', mill_leave_request: 'Leave request', mill_leave_type: 'Leave type', mill_worker: 'Employee', mill_worker_advance: 'Advance', mill_worker_request: 'Request', mill_statutory_deduction: 'Statutory rule' };
const AUDIT_ACTION_TONE = { pay: 'bg-emerald-100 text-emerald-700', settle: 'bg-emerald-100 text-emerald-700', approve: 'bg-blue-100 text-blue-700', accrue: 'bg-violet-100 text-violet-700', prepare: 'bg-amber-100 text-amber-700', remit: 'bg-indigo-100 text-indigo-700', void: 'bg-red-100 text-red-700', reject: 'bg-red-100 text-red-700', delete: 'bg-red-100 text-red-700', advance_delete: 'bg-red-100 text-red-700', create: 'bg-slate-100 text-slate-700', update: 'bg-slate-100 text-slate-700', advance_given: 'bg-amber-100 text-amber-700' };
function auditSummary(l) {
  let d = l.details; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  const r = d?.result || {}; const b = d?.body || {};
  const run = r.run || r;
  if (l.entity_type === 'mill_payroll_run' && run?.period) return `${run.period} · ${PKR(run.net_total ?? run.netTotal)}`;
  if (l.entity_type === 'mill_final_settlement') return `net ${PKR(r.net_amount ?? b.final_salary)}`;
  if (l.entity_type === 'statutory_remittance') return `${r.remittance_no || ''} · ${PKR(r.amount ?? b.amount)}`;
  if (l.entity_type === 'mill_worker') return r.worker?.name || b.name || '';
  if (l.entity_type === 'mill_worker_advance') return PKR(b.amount);
  if (l.entity_type === 'mill_leave_request') return `${r.from_date ? String(r.from_date).slice(0, 10) : ''}${r.days ? ` · ${r.days}d` : ''}`;
  return '';
}
export function PayrollAuditDrawer({ onClose }) {
  const [filters, setFilters] = useState({ action: '', date_from: '', date_to: '' });
  const [limit, setLimit] = useState(50);
  const params = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), limit };
  const { data, isLoading } = usePayrollAudit(params);
  const logs = data?.logs || []; const actions = data?.actions || []; const total = data?.total || 0;
  const fmtTs = (t) => (t ? fmtDateTime(t) : '');
  const set = (p) => setFilters((f) => ({ ...f, ...p }));

  return (
    <SlideDrawer open onClose={onClose} title="Payroll activity" subtitle="Every prepare / approve / pay / accrue / settle / void / leave / advance action" icon={History} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="block text-[11px] text-gray-500 mb-1">Action</label>
            <select value={filters.action} onChange={(e) => set({ action: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{String(a).replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div><label className="block text-[11px] text-gray-500 mb-1">From</label><input type="date" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1">To</label><input type="date" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          {(filters.action || filters.date_from || filters.date_to) && <button onClick={() => setFilters({ action: '', date_from: '', date_to: '' })} className="text-xs text-blue-600 hover:underline pb-2">Clear</button>}
          <span className="text-[11px] text-gray-400 pb-2 ml-auto">{total} action(s)</span>
        </div>
        {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !logs.length ? (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No payroll activity for these filters.</p>
        ) : (
          <div className="space-y-1.5">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${AUDIT_ACTION_TONE[l.action] || 'bg-gray-100 text-gray-600'}`}>{String(l.action).replace(/_/g, ' ')}</span>
                <span className="text-gray-700 font-medium">{AUDIT_ENTITY_LABEL[l.entity_type] || l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</span>
                <span className="text-gray-500 truncate">{auditSummary(l)}</span>
                <span className="ml-auto text-gray-400 whitespace-nowrap">{l.user_name || '—'} · {fmtTs(l.created_at)}</span>
              </div>
            ))}
            {logs.length >= limit && total > limit && (
              <button onClick={() => setLimit((n) => n + 50)} className="w-full mt-1 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">Load more ({total - limit} older)</button>
            )}
          </div>
        )}
      </div>
    </SlideDrawer>
  );
}

// Printable end-of-service settlement voucher.
function settlementVoucherBody(w, s, company) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  w = escapeFields(w || {}); s = escapeFields(s || {});
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const rows = [
    ['Final salary (prorated)', s.final_salary],
    ['Leave encashment', s.leave_encashment],
    ['Gratuity', s.gratuity],
  ].filter(([, v]) => (parseFloat(v) || 0) !== 0).map(([k, v]) => `<tr><td>${k}</td><td class="r">${rsAmt(v)}</td></tr>`).join('');
  const ded = [
    ['Advances recovered', s.advances_deducted],
    ['Other deductions', s.other_deductions],
  ].filter(([, v]) => (parseFloat(v) || 0) !== 0).map(([k, v]) => `<tr><td>${k}</td><td class="r">− ${rsAmt(v)}</td></tr>`).join('');
  return `<div class="slip">
    ${docHeaderHtml(company, 'Final Settlement', `S-${s.id || ''}`, `Settled ${docDate(s.settlement_date)}`)}
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${w.name || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${w.role || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${w.cnic || '—'}</div></span>
      <span><div class="k">Last working day</div><div class="v">${docDate(s.left_date)}</div></span>
      <span><div class="k">Service</div><div class="v">${s.service_years != null ? `${s.service_years} yrs` : '—'}</div></span>
      <span><div class="k">Paid via</div><div class="v">${s.pay_method === 'bank' ? 'Bank transfer' : 'Cash'}</div></span>
    </div>
    <div class="sec">Earnings</div><table><tbody>${rows}</tbody></table>
    ${ded ? `<div class="sec">Deductions</div><table><tbody>${ded}</tbody></table>` : ''}
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Settlement</div><b>${rsAmt(s.net_amount)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(s.net_amount)} Only</div></div></div>
    <p style="margin-top:14px;font-size:11.5px;line-height:1.6">Received the above sum in full and final settlement of all my dues with <b>${name}</b> up to my last working day. I have no further claim.</p>
    <div class="sign"><div><div class="l">Employee Signature</div></div><div><div class="l">Prepared By</div></div><div><div class="l">Authorized By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated final settlement — ${name}.</div>
  </div>`;
}
function printSettlement(w, s, company) { return openPayslipWindow(`Final Settlement ${w.name}`, settlementVoucherBody(w, s, company)); }

// End-of-service final settlement — computes prorated salary + leave encashment
// + gratuity − advances (all editable), pays the net out (6135/cash GL), clears
// advances, and deactivates the worker.
export function FinalSettlementDrawer({ worker, bankAccounts = [], company, onClose, addToast }) {
  // The server recomputes the final salary + leave encashment for the chosen
  // last day; a figure above it is refused, a lower one needs a reason (P2-11).
  const [leftDate, setLeftDate] = useState(null);
  const { data: calc, isLoading } = useFinalSettlement(worker.id, leftDate);
  const finalizeMut = useFinalizeSettlement();
  // Mill payments are PKR — a non-PKR (e.g. USD) account cannot carry them.
  const payBanks = accountsForCurrency((bankAccounts || []).filter((a) => a.type !== 'cash'), 'PKR');
  const [confirm, confirmDialog] = useConfirm();
  const [form, setForm] = useState(null);
  // A fresh calculation re-seeds the form (adjusted during render, not in an effect).
  const [formFor, setFormFor] = useState(null);
  if (calc && calc !== formFor) {
    setFormFor(calc);
    setForm({
      final_salary: calc.finalSalary, leave_encashment: calc.leaveEncashment, gratuity: calc.gratuity,
      advances_deducted: calc.advancesOutstanding, other_deductions: 0, adjustment_reason: '',
      pay_method: 'cash', bank_account_id: '', left_date: calc.left, settlement_date: calc.today, service_years: calc.serviceYears, notes: '',
    });
  }
  const lowered = form && calc && ((parseFloat(form.final_salary) || 0) < calc.finalSalary - 1 || (parseFloat(form.leave_encashment) || 0) < calc.leaveEncashment - 1);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const n = (v) => parseFloat(v) || 0;
  const net = form ? Math.max(0, n(form.final_salary) + n(form.leave_encashment) + n(form.gratuity) - n(form.advances_deducted) - n(form.other_deductions)) : 0;

  async function finalize() {
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account', 'error'); return; }
    if (lowered && !String(form.adjustment_reason || '').trim()) { addToast('Give a reason for paying less than the computed figures', 'error'); return; }
    if (!await confirm({
      title: `Pay the final settlement and deactivate ${worker.name}?`,
      consequence: 'The net is paid out (DR 6135 / CR Cash & Bank), the advances entered are recovered (any rest stays outstanding), the last working day is set and the employee is deactivated.',
      amount: PKR(net),
      confirmLabel: 'Pay & close employment',
    })) return;
    try {
      const res = await finalizeMut.mutateAsync({ workerId: worker.id, data: { ...form, bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null, breakdown: { leaveLines: calc.leaveLines } } });
      const s = res?.data || res;
      addToast(`Final settlement paid — ${PKR(s.net_amount)}`, 'success');
      printSettlement(worker, { ...s, role: worker.role, cnic: worker.cnic }, company);
      onClose();
    } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <>
    <SlideDrawer open onClose={onClose} title="Final settlement" subtitle={`End-of-service payout for ${worker.name}`} icon={LogOut} size="lg"
      footer={form && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-gray-500">Net settlement <span className="font-semibold text-gray-900">{PKR(net)}</span></span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={finalize} disabled={finalizeMut.isPending} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">Pay &amp; close employment</button>
          </div>
        </div>
      )}
    >
      {isLoading || !form ? <p className="text-sm text-gray-400">Computing…</p> : (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-gray-600">
            <div className="font-semibold text-gray-800">{worker.name} · <span className="capitalize">{worker.role}</span></div>
            <div>Joined {fmtDate(calc.worker.joinedDate)} · last day {fmtDate(form.left_date)} · <span className="font-medium">{calc.serviceYears} yrs service ({calc.completedYears} completed)</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Final salary (prorated)" value={form.final_salary} onChange={(v) => set({ final_salary: v })} hint={calc.monthAlreadyPaid ? 'This month is already in a payroll run' : `${PKR(calc.dailyRate)}/day (${calc.dailyRateRule})`} />
            <Field label="Leave encashment" value={form.leave_encashment} onChange={(v) => set({ leave_encashment: v })} hint={calc.leaveLines.length ? calc.leaveLines.map((l) => `${l.name} ${l.days}d`).join(', ') : 'no unused paid leave'} />
            <Field label="Gratuity" value={form.gratuity} onChange={(v) => set({ gratuity: v })} hint={`${calc.completedYears} completed yr(s) · suggested at 30 days/yr — formula pending the accountant`} />
            <Field label="Advances recovered (−)" value={form.advances_deducted} onChange={(v) => set({ advances_deducted: v })} />
            <Field label="Other deductions (−)" value={form.other_deductions} onChange={(v) => set({ other_deductions: v })} />
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Last working day</label>
              <input type="date" value={form.left_date} onChange={(e) => { set({ left_date: e.target.value }); if (e.target.value) setLeftDate(e.target.value); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Pay via</label>
              <select value={form.pay_method === 'bank' ? `bank:${form.bank_account_id}` : 'cash'} onChange={(e) => { const v = e.target.value; if (v === 'cash') set({ pay_method: 'cash', bank_account_id: '' }); else set({ pay_method: 'bank', bank_account_id: v.replace('bank:', '') }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="cash">Mill Cash</option>
                {payBanks.map((a) => <option key={a.id} value={`bank:${a.id}`}>{favStar(a)}{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Settlement date</label>
              <input type="date" value={form.settlement_date} onChange={(e) => set({ settlement_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {lowered && (
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Reason for paying less than computed</label>
              <input value={form.adjustment_reason} onChange={(e) => set({ adjustment_reason: e.target.value })} className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-gray-400">Pays the net via a salaries expense (DR 6135 / CR Cash &amp; Bank), recovers exactly the advances entered, sets the last working day and deactivates the employee. The final salary and leave encashment are the system's figures for that last day — you may pay less with a reason, not more. A settlement voucher prints on confirm.</p>
        </div>
      )}
    </SlideDrawer>
    {confirmDialog}
    </>
  );
}
export function Field({ label, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums" />
      {hint && <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// Leave management (admin) — approve/reject leave requests + manage leave types.
// Approved leave feeds payroll (unpaid docks monthly, paid pays daily-wage).
export function LeaveDrawer({ canManage, workers = [], onClose, addToast }) {
  const [tab, setTab] = useState('requests');
  const { data: requests = [], isLoading } = useLeaveRequests(tab === 'requests' ? 'pending' : null);
  const { data: allReq = [] } = useLeaveRequests(null);
  const { data: types = [] } = useLeaveTypes();
  const approveMut = useApproveLeaveRequest(); const rejectMut = useRejectLeaveRequest();
  const createType = useCreateLeaveType(); const updateType = useUpdateLeaveType(); const deleteType = useDeleteLeaveType();
  const [typeForm, setTypeForm] = useState({ name: '', paid: true, annual_quota: '', accrues: false });
  const list = tab === 'requests' ? requests : allReq;
  const TONE = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' };
  const act = async (mut, id, label) => { try { await mut.mutateAsync(id); addToast(`Leave ${label}`, 'success'); } catch (e) { addToast(e.message, 'error'); } };
  const addType = async () => {
    if (!typeForm.name.trim()) { addToast('Name required', 'error'); return; }
    try { await createType.mutateAsync({ ...typeForm, annual_quota: typeForm.annual_quota === '' ? null : parseFloat(typeForm.annual_quota) }); setTypeForm({ name: '', paid: true, annual_quota: '', accrues: false }); addToast('Leave type added', 'success'); } catch (e) { addToast(e.message, 'error'); }
  };

  return (
    <SlideDrawer open onClose={onClose} title="Leave management" subtitle="Approve leave + manage leave types (feeds payroll: unpaid docks, paid pays daily staff)" icon={CalendarDays} size="lg">
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {[['requests', 'Pending requests'], ['all', 'All requests'], ['types', 'Leave types']].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>{lbl}</button>
        ))}
      </div>
      {tab === 'types' ? (
        <div className="space-y-3">
          {canManage && (
            <div className="rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]"><label className="block text-[11px] text-gray-500 mb-1">New leave type</label><input value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Bereavement" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-[11px] text-gray-500 mb-1">Paid?</label><select value={typeForm.paid ? 'y' : 'n'} onChange={(e) => setTypeForm((f) => ({ ...f, paid: e.target.value === 'y' }))} className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white"><option value="y">Paid</option><option value="n">Unpaid</option></select></div>
              <div><label className="block text-[11px] text-gray-500 mb-1">Days/yr</label><input type="number" value={typeForm.annual_quota} onChange={(e) => setTypeForm((f) => ({ ...f, annual_quota: e.target.value }))} placeholder="∞" className="w-20 border border-gray-200 rounded-lg px-2 py-2 text-sm" /></div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2.5"><input type="checkbox" checked={typeForm.accrues} onChange={(e) => setTypeForm((f) => ({ ...f, accrues: e.target.checked }))} className="rounded border-gray-300" /> Accrues monthly</label>
              <button onClick={addType} disabled={createType.isPending} className="px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">Add</button>
            </div>
          )}
          <div className="space-y-2">
            {types.map((t) => (
              <div key={t.id} className={`rounded-lg border p-3 flex items-center justify-between ${t.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                <div><div className="text-sm font-semibold text-gray-900">{t.name} <span className="text-[10px] font-normal text-gray-400">{t.code}</span></div>
                  <div className="text-xs text-gray-500">{t.paid ? 'Paid' : 'Unpaid'} · {t.annualQuota != null ? `${parseFloat(t.annualQuota)} days/yr` : 'unlimited'} · {t.accrues ? 'accrues monthly' : 'full quota up-front'}</div></div>
                {canManage && <div className="flex items-center gap-1.5">
                  {t.annualQuota != null && <button onClick={async () => { try { await updateType.mutateAsync({ id: t.id, data: { accrues: !t.accrues } }); addToast(t.accrues ? 'Now full-quota' : 'Now accrues monthly', 'success'); } catch (e) { addToast(e.message, 'error'); } }} className={`px-2 py-1 text-[11px] rounded-md ${t.accrues ? 'text-violet-700 bg-violet-50' : 'text-gray-500 bg-gray-100'}`}>{t.accrues ? 'Accrual' : 'Up-front'}</button>}
                  <button onClick={async () => { try { await updateType.mutateAsync({ id: t.id, data: { is_active: !t.isActive } }); } catch (e) { addToast(e.message, 'error'); } }} className={`px-2 py-1 text-[11px] rounded-md ${t.isActive ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 bg-gray-100'}`}>{t.isActive ? 'Active' : 'Inactive'}</button>
                  <button aria-label="Remove leave type" onClick={async () => { try { await deleteType.mutateAsync(t.id); addToast('Removed', 'success'); } catch (e) { addToast(e.message, 'error'); } }} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>}
              </div>
            ))}
          </div>
        </div>
      ) : isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !list.length ? (
        <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No {tab === 'requests' ? 'pending ' : ''}leave requests.</p>
      ) : (
        <div className="space-y-2">
          {list.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{r.workerName} <span className="text-[10px] font-normal text-gray-400">· {r.typeName || 'Leave'} · {parseFloat(r.days)}d {r.paid ? '(paid)' : '(unpaid)'}</span></div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${TONE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{String(r.fromDate).slice(0, 10)} → {String(r.toDate).slice(0, 10)}{r.reason ? ` · ${r.reason}` : ''}</div>
              {canManage && r.status === 'pending' && (
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => act(approveMut, r.id, 'approved')} disabled={approveMut.isPending} className="px-2.5 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Approve</button>
                  <button onClick={() => act(rejectMut, r.id, 'rejected')} disabled={rejectMut.isPending} className="px-2.5 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SlideDrawer>
  );
}

// Employee self-service requests inbox (admin side) — workers raise leave /
// advance / correction / query requests from the portal; payroll responds.
export function WorkerRequestsDrawer({ canResolve, onClose, addToast }) {
  const [tab, setTab] = useState('pending');
  const { data: requests = [], isLoading } = useWorkerRequests(tab === 'all' ? null : 'pending');
  const resolveMut = useResolveWorkerRequest();
  const [replyId, setReplyId] = useState(null);
  const [reply, setReply] = useState('');

  async function act(r, status) {
    try { await resolveMut.mutateAsync({ id: r.id, data: { status, response: reply || null } }); setReplyId(null); setReply(''); addToast(`Request ${status}`, 'success'); }
    catch (e) { addToast(e.message, 'error'); }
  }
  const TONE = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700', resolved: 'bg-blue-100 text-blue-700' };

  return (
    <SlideDrawer open onClose={onClose} title="Employee requests" subtitle="Leave / advance / correction / query requests from the self-service portal" icon={Inbox} size="lg">
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {['pending', 'all'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px capitalize ${tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>{t}</button>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !requests.length ? (
        <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No {tab === 'pending' ? 'pending ' : ''}requests.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{r.workerName} <span className="text-[10px] font-normal text-gray-400 capitalize">· {r.type}{r.subject ? ` · ${r.subject}` : ''}</span></div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${TONE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              </div>
              {r.message && <div className="text-xs text-gray-600 mt-1">{r.message}</div>}
              {r.fromDate && <div className="text-[11px] text-gray-400 mt-0.5">{String(r.fromDate).slice(0, 10)}{r.toDate ? ` → ${String(r.toDate).slice(0, 10)}` : ''}</div>}
              {r.response && <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mt-1.5">Reply: {r.response}{r.handledByName ? ` — ${r.handledByName}` : ''}</div>}
              {canResolve && r.status === 'pending' && (
                replyId === r.id ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply (optional)" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs" />
                    <div className="flex gap-1.5">
                      <button onClick={() => act(r, 'approved')} disabled={resolveMut.isPending} className="px-2.5 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">Approve</button>
                      <button onClick={() => act(r, 'rejected')} disabled={resolveMut.isPending} className="px-2.5 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100">Reject</button>
                      <button onClick={() => act(r, 'resolved')} disabled={resolveMut.isPending} className="px-2.5 py-1.5 text-xs text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">Mark resolved</button>
                      <button onClick={() => { setReplyId(null); setReply(''); }} className="px-2.5 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-lg">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setReplyId(r.id); setReply(''); }} className="mt-2 text-xs font-medium text-blue-700 hover:underline">Respond →</button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </SlideDrawer>
  );
}
