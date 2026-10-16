import { useState } from 'react';
import { DollarSign, Wallet, Printer, Banknote, Receipt, HandCoins, FileText, Clock } from 'lucide-react';
import { usePayrollRun, usePayrollReport, usePayrollSchedule, useSavePayrollSchedule } from '../../../../../api/queries';
import { downloadCSV } from '../../../../../utils/csvExport';
import StatusBadge from '../../../../../components/StatusBadge';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { fmtPKR, fmtDate } from '../../../../../shared/utils/format';
import { escapeHtml, escapeFields } from '../../../../../shared/utils/html';
import { printPayslip, printAllPayslips, printPaymentVoucher, printSalaryReceipt, printAllReceipts, downloadBankTransferFile } from './payrollPrint';
import Stat from '../components/Stat';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

export function PayrollScheduleDrawer({ canManage, canPrepare, onClose, onRunNow, runNowBusy, addToast }) {
  const { data: schedule, isLoading } = usePayrollSchedule();
  const saveMut = useSavePayrollSchedule();
  const [form, setForm] = useState(null);
  // The loaded schedule seeds the form (adjusted during render, not in an effect).
  const [formFor, setFormFor] = useState(undefined);
  if (schedule !== undefined && schedule !== formFor) {
    setFormFor(schedule);
    setForm({
      active: schedule?.active ?? false,
      day_of_month: schedule?.dayOfMonth ?? 28,
      pay_method: schedule?.payMethod ?? 'cash',
      notes: schedule?.notes ?? '',
    });
  }
  const f = form || { active: false, day_of_month: 28, pay_method: 'cash', notes: '' };
  const save = async (patch) => {
    const next = { ...f, ...patch };
    setForm(next);
    if (!canManage) return;
    try { await saveMut.mutateAsync(next); addToast('Payroll schedule saved', 'success'); }
    catch (e) { addToast(e.message, 'error'); }
  };
  return (
    <SlideDrawer open onClose={onClose} title="Schedule Monthly Payroll" subtitle="Auto-prepare payroll into the approval queue" icon={Clock} size="md">
      {isLoading || !form ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
            On the chosen day each month the system <span className="font-medium">prepares</span> a payroll run for all active employees and drops it in the approval queue. It never auto-approves or pays — Finance/Owner still <span className="font-medium">Approve → Pay</span>.
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <span className="text-sm font-medium text-gray-800">Auto-prepare each month</span>
            <input type="checkbox" disabled={!canManage} checked={f.active} onChange={e => save({ active: e.target.checked })} className="w-4 h-4 rounded border-gray-300" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prepare on day</label>
              <select disabled={!canManage} value={f.day_of_month} onChange={e => save({ day_of_month: parseInt(e.target.value, 10) })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50">
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}{['1','21'].includes(String(d))?'st':['2','22'].includes(String(d))?'nd':['3','23'].includes(String(d))?'rd':'th'} of the month</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Pay via</label>
              <select disabled value={f.pay_method} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500">
                <option value="cash">Mill Cash</option>
              </select>
            </div>
          </div>

          {schedule?.nextRun && f.active && (
            <div className="text-xs text-gray-500">Next auto-prepare: <span className="font-medium text-gray-700">{fmtDate(schedule.nextRun)}</span>{schedule.lastRun ? ` · last ran ${fmtDate(schedule.lastRun)} (${schedule.lastStatus || '—'})` : ''}</div>
          )}
          {!canManage && <p className="text-[11px] text-amber-600">Only Finance/Owner can change the schedule. You can still prepare now.</p>}

          {canPrepare && (
            <div className="pt-2 border-t border-gray-100">
              <button onClick={onRunNow} disabled={runNowBusy} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                <Wallet className="w-4 h-4" /> {runNowBusy ? 'Preparing…' : 'Prepare this month now'}
              </button>
              <p className="text-[11px] text-gray-400 mt-1.5 text-center">Prepares the current month immediately (skips anyone already in a run).</p>
            </div>
          )}
        </div>
      )}
    </SlideDrawer>
  );
}

// Run panel: review a run's payslip lines, see its approval status, and (for
// Finance/Owner) Approve → Pay → or Void. Paid runs can be Undone (reversed).
export function PayslipsPanel({ runId, companyProfile, canApprove, canPay, canDelete, addToast, onClose, onUndo, onApprove, onPay, onVoid, onAccrue, onSettle, deleteRunMut, approveRunMut, payRunMut, voidRunMut, accrueRunMut, settleRunMut }) {
  const { data, isLoading } = usePayrollRun(runId);
  const run = data?.run;
  const lines = data?.lines || [];
  const st = run?.status;
  const isPaid = st === 'paid' || st === 'posted';
  const isAccrued = st === 'accrued';
  const isPartial = st === 'partially_paid';
  const busy = approveRunMut?.isPending || payRunMut?.isPending || voidRunMut?.isPending || deleteRunMut?.isPending || accrueRunMut?.isPending || settleRunMut?.isPending;
  // Partial pay: pick which unpaid employees to pay now.
  const canSelectPay = canPay && (st === 'approved' || st === 'partially_paid');
  const unpaidLines = lines.filter((l) => !l.paidAt);
  const paidCount = lines.length - unpaidLines.length;
  const [selected, setSelected] = useState(() => new Set());
  // Another run, or the same run in a new status, starts with nothing ticked.
  const selKey = `${runId}|${st}`;
  const [selFor, setSelFor] = useState(selKey);
  if (selFor !== selKey) { setSelFor(selKey); setSelected(new Set()); }
  const toggleSel = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedUnpaid = unpaidLines.filter((l) => selected.has(l.id));
  const selectedTotal = selectedUnpaid.reduce((s, l) => s + (parseFloat(l.netPay) || 0), 0);
  const unpaidTotal = unpaidLines.reduce((s, l) => s + (parseFloat(l.netPay) || 0), 0);
  return (
    <SlideDrawer
      open
      onClose={onClose}
      title={isPaid ? 'Payslips' : 'Payroll Run'}
      subtitle={run ? `${run.period} · ${PKR(run.netTotal)} · ${run.payMethod === 'bank' ? (run.bankName || 'bank') : 'cash'}` : ''}
      icon={Receipt}
      size="lg"
      footer={run && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-2">
            {/* Workflow actions (Finance/Owner only) */}
            {canApprove && st === 'prepared' && <button onClick={() => onApprove(run)} disabled={busy} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Approve</button>}
            {canSelectPay && selected.size > 0 && <button onClick={() => onPay(run, selectedUnpaid.map(l => l.id), selectedTotal, selectedUnpaid.length)} disabled={busy || !selectedUnpaid.length} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Pay selected {PKR(selectedTotal)}</button>}
            {canSelectPay && selected.size === 0 && unpaidLines.length > 0 && <button onClick={() => onPay(run, null, unpaidTotal, unpaidLines.length)} disabled={busy} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{isPartial ? 'Pay remaining' : 'Pay all'} {PKR(unpaidTotal)}</button>}
            {canPay && st === 'approved' && <button onClick={() => onAccrue(run)} disabled={busy} className="px-4 py-2 text-sm text-violet-700 bg-violet-50 rounded-lg hover:bg-violet-100 disabled:opacity-50">Accrue (pay later)</button>}
            {canPay && isAccrued && <button onClick={() => onSettle(run)} disabled={busy} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Settle {PKR(run.netTotal)}</button>}
            {canApprove && (st === 'prepared' || st === 'approved') && <button onClick={() => onVoid(run)} disabled={busy} className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">Void</button>}
            {canDelete && (isPaid || isAccrued || isPartial) && <button onClick={() => onUndo(run)} disabled={busy} className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">{isAccrued ? 'Reverse accrual' : 'Undo run'}</button>}
          </div>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
        </div>
      )}
    >
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !run ? <p className="text-sm text-gray-400">Run not found.</p> : (
        <div className="space-y-3">
          {/* Status + workflow trail */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <StatusBadge status={st} />
            <div className="text-[11px] text-gray-400">
              {run.preparedByName ? `Prepared by ${run.preparedByName}` : ''}
              {run.approvedByName ? ` · Approved by ${run.approvedByName}` : ''}
              {run.accruedByName ? ` · Accrued by ${run.accruedByName}` : ''}
              {run.paidByName ? ` · Paid by ${run.paidByName}` : ''}
            </div>
          </div>
          {isAccrued && <div className="rounded-lg bg-violet-50 border border-violet-200 p-2.5 text-xs text-violet-800">Accrued — salary expense &amp; <span className="font-semibold">Salaries Payable</span> liability are booked and advances recovered, but no cash has moved. Settle to pay it out.{!canPay ? ' Finance/Owner must settle this.' : ''}</div>}
          {isPartial && <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800"><span className="font-semibold">Partially paid</span> — {paidCount} of {lines.length} employee(s) paid, {unpaidLines.length} still owed ({PKR(unpaidTotal)}). Tick employees and Pay remaining when ready.{!canPay ? ' Finance/Owner must complete this.' : ''}</div>}
          {!isPaid && !isAccrued && !isPartial && <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">{st === 'prepared' ? 'Pending approval — no cash/GL has posted yet.' : 'Approved — pending payment. Pay all/selected (cash + GL) or Accrue (book the liability, pay later).'}{!canApprove ? ' Finance/Owner must complete this.' : ''}</div>}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-gray-50 p-2.5"><div className="text-[10px] text-gray-400 uppercase">Gross</div><div className="text-sm font-semibold tabular-nums">{PKR(run.grossTotal)}</div></div>
            <div className="rounded-lg bg-amber-50 p-2.5"><div className="text-[10px] text-amber-500 uppercase">Advances</div><div className="text-sm font-semibold tabular-nums text-amber-700">−{PKR(run.advanceTotal)}</div></div>
            <div className="rounded-lg bg-emerald-50 p-2.5"><div className="text-[10px] text-emerald-500 uppercase">{isPaid ? 'Net paid' : 'Net to pay'}</div><div className="text-sm font-semibold tabular-nums text-emerald-700">{PKR(run.netTotal)}</div></div>
          </div>
          {lines.length > 0 && (run.payMethod === 'bank' || !isPaid) && (
            <button onClick={() => downloadBankTransferFile(run, lines, addToast)} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100">
              <Banknote className="w-3.5 h-3.5" /> Bank transfer file (CSV) · {lines.length}
            </button>
          )}
          {isPaid && lines.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => printPaymentVoucher(run, lines, companyProfile)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100">
                <Receipt className="w-3.5 h-3.5" /> Payment voucher
              </button>
              <button onClick={() => printAllPayslips(run, lines, companyProfile)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                <Printer className="w-3.5 h-3.5" /> Payslips ({lines.length})
              </button>
              <button onClick={() => printAllReceipts(run, lines, companyProfile)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100">
                <Printer className="w-3.5 h-3.5" /> Receipts ({lines.length})
              </button>
            </div>
          )}
          {lines.map(l => {
            const linePaid = !!l.paidAt;
            return (
            <div key={l.id} className={`rounded-lg border p-3 flex items-center justify-between ${canSelectPay && !linePaid && selected.has(l.id) ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2.5">
                {canSelectPay && !linePaid && (
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} className="rounded border-gray-300" />
                )}
                <div>
                  <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                    {l.workerName}
                    {linePaid && <StatusBadge status="Paid" />}
                  </div>
                  <div className="text-xs text-gray-400">
                    Gross {PKR(l.grossPay)}{parseFloat(l.advanceDeducted) > 0 ? ` · advance −${PKR(l.advanceDeducted)}` : ''} · <span className="text-emerald-700 font-medium">net {PKR(l.netPay)}</span>
                  </div>
                  {l.netOverrideReason && (
                    <div className="text-[11px] text-amber-700 mt-0.5" data-testid="net-override-reason">Paid less than the net — {l.netOverrideReason}</div>
                  )}
                </div>
              </div>
              {linePaid && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => printPayslip(run, l, companyProfile)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                    <Printer className="w-3.5 h-3.5" /> Payslip
                  </button>
                  <button onClick={() => printSalaryReceipt(run, l, companyProfile)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100">
                    <Receipt className="w-3.5 h-3.5" /> Receipt
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </SlideDrawer>
  );
}

// Printable A4 payroll report — every run + its payslip lines, with grand totals.
function printPayrollReport(runs, totals, company, range) {
  // P1-09: every user-entered string is HTML-escaped before it is interpolated.
  runs = escapeFields(runs || []); range = range ? escapeHtml(range) : range;
  const co = escapeFields(company || {});
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const rs = (v) => fmtPKR(parseFloat(v) || 0, { decimals: 2 });
  const d = (x) => (x ? fmtDate(x) : '');
  const runBlocks = runs.map((r) => `
    <div style="margin-top:18px;break-inside:avoid">
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #cbd5e1;padding-bottom:4px">
        <div style="font-weight:600">${r.period} · ${d(r.payDate)} · ${r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash'}</div>
        <div style="color:#6b7280">${r.employeeCount} emp · net <b>${rs(r.netTotal)}</b></div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px">
        <thead><tr style="color:#6b7280;text-align:left">
          <th style="padding:3px 0">Employee</th><th style="text-align:right">Gross</th><th style="text-align:right">Advance</th><th style="text-align:right">Net</th>
        </tr></thead>
        <tbody>${(r.lines || []).map((l) => `<tr>
          <td style="padding:2px 0">${l.workerName}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${rs(l.grossPay)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${parseFloat(l.advanceDeducted) ? '−' + rs(l.advanceDeducted) : '—'}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${rs(l.netPay)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payroll Report</title>
    <style>@page{size:A4 portrait;margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;margin:0}
    .hd{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:8px}
    .t{font-size:18px;font-weight:700;color:#1e3a5f;text-transform:uppercase}
    .kpis{display:flex;gap:16px;margin-top:12px;font-size:13px}
    .kpi{background:#f9fafb;border-radius:8px;padding:8px 12px}</style></head><body>
    <div class="hd"><div class="t">${name}</div>
    <div style="text-align:right"><div style="font-size:15px;font-weight:700;text-transform:uppercase">Payroll Report</div>
    <div style="font-size:12px;color:#6b7280">${range || 'All periods'}</div></div></div>
    <div class="kpis">
      <div class="kpi">Runs<br/><b>${totals.runs}</b></div>
      <div class="kpi">Gross<br/><b>${rs(totals.grossTotal)}</b></div>
      <div class="kpi">Advances recovered<br/><b>${rs(totals.advanceTotal)}</b></div>
      <div class="kpi">Net paid<br/><b>${rs(totals.netTotal)}</b></div>
    </div>
    ${runBlocks || '<p style="color:#9ca3af;margin-top:24px">No payroll runs in this period.</p>'}
    <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},250)});</script>
    </body></html>`;
  const w = window.open('', '_blank', 'width=820,height=1100');
  if (!w) return;
  w.document.write(html); w.document.close();
}

// Payroll Reports view — all runs with their payslips, totals, period filter,
// per-payslip print and a printable whole-report.
export function PayrollReport({ companyProfile, entity = 'mill', onOpenRun }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, isLoading } = usePayrollReport({ ...(range.from || range.to ? range : {}), entity });
  const runs = data?.runs || [];
  const totals = data?.totals || { runs: 0, grossTotal: 0, advanceTotal: 0, netTotal: 0 };
  const [expanded, setExpanded] = useState(null);
  const rangeLabel = range.from || range.to ? `${range.from || '…'} → ${range.to || '…'}` : 'All periods';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>From</span>
          <input type="month" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gray-900" />
          <span>to</span>
          <input type="month" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gray-900" />
          {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="text-gray-400 hover:text-gray-700">clear</button>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const rows = runs.flatMap(r => (r.lines || []).map(l => ({ ...l, period: r.period, payDate: r.payDate, payMethod: r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash', runStatus: r.status })));
            downloadCSV(rows, [
              { label: 'Month', key: 'period' }, { label: 'Pay date', accessor: r => fmtDate(r.payDate) },
              { label: 'Employee', key: 'workerName' }, { label: 'Role', key: 'role' },
              { label: 'Pay type', accessor: r => r.payType === 'monthly' ? 'Monthly' : 'Daily' },
              { label: 'Effective days', key: 'effectiveDays' }, { label: 'OT hours', key: 'otHours' },
              { label: 'Basic', accessor: r => Math.round(r.basicPay) }, { label: 'Overtime', accessor: r => Math.round(r.otPay) },
              { label: 'Gross', accessor: r => Math.round(r.grossPay) }, { label: 'Advance recovered', accessor: r => Math.round(r.advanceDeducted) },
              { label: 'Net pay', accessor: r => Math.round(r.netPay) }, { label: 'Mode', key: 'payMethod' }, { label: 'Status', key: 'runStatus' },
            ], `payroll-report_${(rangeLabel || 'all').replace(/[^\w-]+/g, '_')}.csv`);
          }} disabled={!runs.length} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
            <FileText className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={() => printPayrollReport(runs, totals, companyProfile, rangeLabel)} disabled={!runs.length} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            <Printer className="w-3.5 h-3.5" /> Print Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat tone="blue"  icon={FileText}   label="Payroll Runs" value={String(totals.runs)} sub={rangeLabel} />
        <Stat tone="slate" icon={DollarSign} label="Gross"        value={PKR(totals.grossTotal)} sub="Paid payslips only" />
        <Stat tone="amber" icon={HandCoins}  label="Advances Recovered" value={PKR(totals.advanceTotal)} sub="Cleared" />
        <Stat tone="green" icon={Wallet}     label="Net Paid"     value={PKR(totals.netTotal)} sub="Cash + bank" />
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">No payroll runs yet{(range.from || range.to) ? ' in this period' : ''}.</div>
      ) : (
        <div className="space-y-2">
          {runs.map(r => {
            const open = expanded === r.id;
            return (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button onClick={() => setExpanded(open ? null : r.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold bg-gray-100 text-gray-700 rounded px-2 py-0.5">{r.period}</span>
                  <span className="text-sm text-gray-700">{fmtDate(r.payDate)} · {r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash'} · {r.employeeCount} emp</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {parseFloat(r.advanceTotal) > 0 && <span className="text-amber-700 tabular-nums hidden sm:inline">adv −{PKR(r.advanceTotal)}</span>}
                  <span className="font-semibold tabular-nums">{PKR(r.netTotal)}</span>
                  <span className="text-gray-400">{open ? '▾' : '▸'}</span>
                </div>
              </button>
              {open && (
                <div className="border-t border-gray-100 px-4 py-2">
                  <table className="w-full text-xs mobile-cards">
                    <thead><tr className="text-gray-500"><th className="text-left py-1.5">Employee</th><th className="text-right">Days</th><th className="text-right">Gross</th><th className="text-right">Advance</th><th className="text-right">Net</th><th className="text-right no-print">Payslip</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {(r.lines || []).map(l => (
                        <tr key={l.id}>
                          <td data-label="Employee" className="py-1.5 text-gray-800">{l.workerName}<span className="text-gray-400 capitalize"> · {l.payType === 'monthly' ? 'salary' : 'daily'}</span></td>
                          <td data-label="Days" className="mob-hide py-1.5 text-right tabular-nums text-gray-500">{l.effectiveDays} d{parseFloat(l.otHours) ? ` · ${l.otHours}h OT` : ''}</td>
                          <td data-label="Gross" className="py-1.5 text-right tabular-nums">{PKR(l.grossPay)}</td>
                          <td data-label="Advance" className="mob-hide py-1.5 text-right tabular-nums text-amber-700">{parseFloat(l.advanceDeducted) ? `−${PKR(l.advanceDeducted)}` : '—'}</td>
                          <td data-label="Net" className="py-1.5 text-right tabular-nums font-semibold">{PKR(l.netPay)}</td>
                          <td data-label="Payslip" className="py-1.5 text-right no-print"><button onClick={() => printPayslip(r, l, companyProfile)} className="text-blue-700 hover:underline">print</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end pt-2 no-print">
                    <button onClick={() => onOpenRun(r.id)} className="text-xs text-emerald-700 font-medium hover:underline">Open run →</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
