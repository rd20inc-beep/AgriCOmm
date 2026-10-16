import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DollarSign, Users, Plus, UserPlus, Wallet, Receipt, Pencil, Trash2, HandCoins, CalendarDays,
  Power, X, FileText, Inbox, Check, Clock, Landmark, LogOut, History, Banknote, TrendingUp,
} from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { useAuth } from '../../../../../context/AuthContext';
import { useOwnerAuth } from '../../../../../context/OwnerAuthContext';
import {
  useMillWorkers, useCreateMillWorker, useUpdateMillWorker, useDeleteMillWorker, useSetWorkerPortalPin,
  useCreateWorkerAdvance, useApproveAdvance, useRejectAdvance, usePayAdvance, usePendingAdvances,
  usePayrollSummary, useRecordAttendance, usePayrollRuns, usePostPayrollRun, useDeletePayrollRun,
  useApprovePayrollRun, usePayPayrollRun, useVoidPayrollRun, useAccruePayrollRun, useSettlePayrollRun,
  useWorkerRequestsCount, useLeaveRequestsCount, useRunPayrollNow,
} from '../../../../../api/queries';
import StatusBadge from '../../../../../components/StatusBadge';
import SlideDrawer from '../../../../../components/SlideDrawer';
import useConfirm from '../../../../../hooks/useConfirm';
import { todayLocalISO, fmtPKR, fmtDate } from '../../../../../shared/utils/format';
import Stat from '../components/Stat';
import { PKR, WORKER_ROLES, HEAD_OFFICE_ROLES } from '../constants';
import { EmployeeAttendanceGrid } from './attendance';
import { AdvancePayDrawer, WorkerAdvancesPanel, AdjustmentsDrawer } from './advances';
import { PayrollRunDrawer } from './PayrollRunDrawer';
import { StatutoryDeductionsDrawer, TaxStatementDrawer } from './statutory';
import { SalaryRevisionDrawer, PayrollAuditDrawer, FinalSettlementDrawer, LeaveDrawer, WorkerRequestsDrawer } from './people';
import { PayrollScheduleDrawer, PayslipsPanel, PayrollReport } from './runs';
import { EmployeeLedgerDrawer } from './EmployeeLedgerDrawer';

/**
 * The payroll workspace — workers, attendance, runs (prepare → approve → pay),
 * advances, statutory, leave, settlements, reports. Its own workspace (P5-09),
 * not a Mill Finance tab: reached from Mill Finance (?workspace=payroll, Mill
 * scope first) and from Head Office Finance ▸ Payroll (Head Office scope first).
 * Every action keeps its payroll.* permission gate, Owner approval and confirm.
 */
export default function PayrollWorkspace({ defaultEntity = 'mill', intro = false }) {
  const { addToast, companyProfileData, bankAccountsList } = useApp();
  const [confirm, confirmDialog] = useConfirm();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Head Office ('general') vs Mill ('mill') payroll scope — the toggle. Default
  // to Head Office on the /finance/payroll view, Mill on the mill dashboard.
  const [payrollEntity, setPayrollEntity] = useState(defaultEntity === 'general' ? 'general' : 'mill');
  const { data: workers = [] } = useMillWorkers({ entity: payrollEntity });
  const createWorkerMut = useCreateMillWorker();
  const updateWorkerMut = useUpdateMillWorker();
  const setPinMut = useSetWorkerPortalPin();
  const [portalPin, setPortalPin] = useState('');
  const deleteWorkerMut = useDeleteMillWorker();
  const createAdvanceMut = useCreateWorkerAdvance();
  const approveAdvanceMut = useApproveAdvance();
  const rejectAdvanceMut = useRejectAdvance();
  const payAdvanceMut = usePayAdvance();
  const curMonth = new Date().toISOString().slice(0, 7);
  const [payrollMonth, setPayrollMonth] = useState(curMonth);
  const [payrollView, setPayrollView] = useState('payroll'); // 'payroll' | 'attendance'
  const { data: payrollData } = usePayrollSummary({ month: payrollMonth, entity: payrollEntity });
  const recordAttMut = useRecordAttendance();
  const { data: payrollRuns = [] } = usePayrollRuns({ entity: payrollEntity });
  const postRunMut = usePostPayrollRun();
  const deleteRunMut = useDeletePayrollRun();
  const approveRunMut = useApprovePayrollRun();
  const payRunMut = usePayPayrollRun();
  const voidRunMut = useVoidPayrollRun();
  const accrueRunMut = useAccruePayrollRun();
  const settleRunMut = useSettlePayrollRun();
  const [showRunDrawer, setShowRunDrawer] = useState(false);
  const [runPreselect, setRunPreselect] = useState(null); // worker id to pre-select in the run drawer (per-row Pay)
  const [payslipsRunId, setPayslipsRunId] = useState(null); // open the payslips panel for a run
  const [showScheduleDrawer, setShowScheduleDrawer] = useState(false);
  const [showStatutoryDrawer, setShowStatutoryDrawer] = useState(false);
  const [showTaxDrawer, setShowTaxDrawer] = useState(false);
  const [showRequestsDrawer, setShowRequestsDrawer] = useState(false);
  const { data: pendingRequestCount = 0 } = useWorkerRequestsCount();
  const [showLeaveDrawer, setShowLeaveDrawer] = useState(false);
  const { data: pendingLeaveCount = 0 } = useLeaveRequestsCount();
  const [settleWorker, setSettleWorker] = useState(null);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [reviseWorker, setReviseWorker] = useState(null);
  const [adjustWorker, setAdjustWorker] = useState(null); // open adjustments drawer for this worker
  const runNowMut = useRunPayrollNow();

  function openRunDrawer(preselectId = null) { setRunPreselect(preselectId); setShowRunDrawer(true); }

  // Payroll permission module (Phase 5) — replaces the old role-name checks.
  const canViewPayroll = hasPermission('payroll', 'view');
  const canPreparePayroll = hasPermission('payroll', 'create');
  const canApprovePayroll = hasPermission('payroll', 'approve'); // approve + void + schedule
  const canPayPayroll = hasPermission('payroll', 'pay');
  const canDeletePayroll = hasPermission('payroll', 'delete');

  const { requestOwnerApproval } = useOwnerAuth();
  // Salary-advance approval inbox (Batch 6 · item 8): request → Owner approves →
  // Finance pays. Shown across both entities so nothing is hidden by the toggle.
  const { data: pendingAdvances = [] } = usePendingAdvances(canViewPayroll);
  async function handleApproveAdvance(a) {
    try {
      await requestOwnerApproval((ownerId) => approveAdvanceMut.mutateAsync({ id: a.id, data: { authorized_by_owner_id: ownerId } }));
      addToast(`Advance for ${a.workerName} approved — ready for Finance to pay`, 'success');
    } catch (e) { if (e?.message !== 'Owner authorization cancelled') addToast(e?.response?.data?.message || e?.message || 'Could not approve the advance.', 'error'); }
  }
  async function handleRejectAdvance(a) {
    const ok = await confirm({
      title: `Reject the advance request for ${a.workerName}?`,
      consequence: 'The request is closed as rejected. Nothing is paid and no recovery schedule is created.',
      amount: PKR(a.amount),
      reason: 'optional',
      confirmLabel: 'Reject request',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try { await rejectAdvanceMut.mutateAsync({ id: a.id, data: { reason: ok.reason || null } }); addToast('Advance request rejected', 'success'); }
    catch (e) { addToast(e?.response?.data?.message || e?.message || 'Could not reject the advance.', 'error'); }
  }
  // Pay opens a drawer: the method, the account and the payment date are
  // chosen there (P2-09) — the payout used to take the request date and Mill Cash.
  const [payAdvanceRow, setPayAdvanceRow] = useState(null);
  function handlePayAdvance(a) { setPayAdvanceRow(a); }

  const payrollSummary = payrollData?.summary || [];
  const payrollTotal = payrollData?.grandTotal || 0; // net (gross − advances) — what you pay out now
  const payrollGross = payrollData?.grandGross || 0;
  const payrollAdvances = payrollData?.grandAdvance || 0;
  const advancesOutstandingTotal = workers.reduce((s, w) => s + (parseFloat(w.advanceOutstanding) || 0), 0);
  // Multiple runs per month are allowed (pay employees separately) — track this
  // month's runs, who's still unpaid, and how much was already paid out.
  const monthRuns = payrollRuns.filter(r => r.period === payrollMonth && r.status !== 'voided' && r.status !== 'reversed');
  const isPaidStatus = (s) => s === 'paid' || s === 'posted';
  const paidThisMonth = monthRuns.filter(r => isPaidStatus(r.status)).reduce((s, r) => s + (parseFloat(r.netTotal) || 0), 0);
  const pendingRuns = monthRuns.filter(r => r.status === 'prepared' || r.status === 'approved' || r.status === 'accrued' || r.status === 'partially_paid');
  const paidCount = payrollData?.paidCount || 0;
  const unpaidNet = payrollData?.unpaidNet ?? payrollTotal;
  // "Unpaid" for preparing a NEW run = employees not already in any run this month.
  const unpaidEmployees = payrollSummary.filter(w => !w.committed && w.grossPay > 0);
  const anyUnpaid = unpaidEmployees.length > 0;

  const EMPTY_WORKER = { id: null, name: '', role: '', entity: payrollEntity, department: '', pay_type: 'daily', daily_wage: '', monthly_salary: '', ot_rate_per_hour: '', phone: '', cnic: '', bank_name: '', bank_account_number: '', iban: '', joined_date: todayLocalISO(), left_date: '', notes: '', portal_enabled: false };
  const [workerForm, setWorkerForm] = useState(EMPTY_WORKER);
  const [advanceTarget, setAdvanceTarget] = useState(null); // worker we're giving an advance to
  const [advanceForm, setAdvanceForm] = useState({ amount: '', advance_date: todayLocalISO(), payment_method: 'cash', notes: '', recovery_method: 'full_next_salary', recovery_start_period: '', installment_amount: '', installment_count: '', deduction_percent: '' });
  const [deleteWorkerTarget, setDeleteWorkerTarget] = useState(null); // confirm-delete state
  const [advancesPanelWorker, setAdvancesPanelWorker] = useState(null); // view advances drawer
  const [ledgerWorker, setLedgerWorker] = useState(null); // per-employee ledger drawer

  function openWorkerDrawer(worker) {
    if (worker) {
      setWorkerForm({
        id: worker.id, name: worker.name || '', role: worker.role || '', entity: worker.entity || 'mill', department: worker.department || '',
        pay_type: worker.payType || 'daily',
        daily_wage: worker.dailyWage != null ? String(worker.dailyWage) : '',
        monthly_salary: worker.monthlySalary != null ? String(worker.monthlySalary) : '',
        ot_rate_per_hour: worker.otRatePerHour != null ? String(worker.otRatePerHour) : '',
        phone: worker.phone || '', cnic: worker.cnic || '',
        bank_name: worker.bankName || '', bank_account_number: worker.bankAccountNumber || '', iban: worker.iban || '',
        joined_date: worker.joinedDate ? String(worker.joinedDate).slice(0, 10) : '',
        left_date: worker.leftDate ? String(worker.leftDate).slice(0, 10) : '',
        notes: worker.notes || '',
        portal_enabled: !!worker.portalEnabled,
      });
    } else {
      setWorkerForm(EMPTY_WORKER);
    }
    setPortalPin('');
    setShowWorkerDrawer(true);
  }

  async function handleSaveWorker() {
    if (!workerForm.name.trim()) { addToast('Name is required', 'error'); return; }
    if (workerForm.pay_type === 'monthly' && !(parseFloat(workerForm.monthly_salary) > 0)) { addToast('Monthly salary is required', 'error'); return; }
    if (workerForm.pay_type === 'daily' && !(parseFloat(workerForm.daily_wage) > 0)) { addToast('Daily wage is required', 'error'); return; }
    const payload = {
      name: workerForm.name.trim(), role: workerForm.role || null, entity: workerForm.entity === 'general' ? 'general' : 'mill', department: workerForm.department || null, pay_type: workerForm.pay_type,
      daily_wage: workerForm.daily_wage || null, monthly_salary: workerForm.monthly_salary || null,
      ot_rate_per_hour: workerForm.ot_rate_per_hour || null,
      phone: workerForm.phone || null, cnic: workerForm.cnic || null,
      bank_name: workerForm.bank_name || null, bank_account_number: workerForm.bank_account_number || null, iban: workerForm.iban || null,
      joined_date: workerForm.joined_date || null, left_date: workerForm.left_date || null, notes: workerForm.notes || null,
    };
    try {
      if (workerForm.id) {
        await updateWorkerMut.mutateAsync({ id: workerForm.id, data: payload });
        addToast('Employee updated', 'success');
      } else {
        await createWorkerMut.mutateAsync(payload);
        addToast('Employee added', 'success');
      }
      setShowWorkerDrawer(false);
      setWorkerForm(EMPTY_WORKER);
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  async function handleToggleActive(worker) {
    try {
      await updateWorkerMut.mutateAsync({ id: worker.id, data: { is_active: !worker.isActive } });
      addToast(worker.isActive ? 'Employee deactivated' : 'Employee reactivated', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }

  async function handleDeleteWorker() {
    if (!deleteWorkerTarget) return;
    try {
      await deleteWorkerMut.mutateAsync(deleteWorkerTarget.id);
      addToast('Employee deleted', 'success');
      setDeleteWorkerTarget(null);
    } catch (e) { addToast(e.message, 'error'); }
  }

  function openAdvanceDrawer(worker) {
    setAdvanceTarget(worker);
    setAdvanceForm({ amount: '', advance_date: todayLocalISO(), payment_method: 'cash', notes: '', recovery_method: 'full_next_salary', recovery_start_period: '', installment_amount: '', installment_count: '', deduction_percent: '' });
  }

  async function handleGiveAdvance() {
    if (!(parseFloat(advanceForm.amount) > 0)) { addToast('Enter an advance amount', 'error'); return; }
    try {
      await createAdvanceMut.mutateAsync({ id: advanceTarget.id, data: advanceForm });
      addToast(`Advance request of ${PKR(parseFloat(advanceForm.amount))} submitted for ${advanceTarget.name} — awaiting Owner approval`, 'success');
      setAdvanceTarget(null);
    } catch (e) { addToast(e.message, 'error'); }
  }

  async function handleDeleteRun(run) {
    if (!run) return false;
    const posted = ['paid', 'posted', 'accrued', 'partially_paid'].includes(run.status);
    const ok = await confirm({
      title: posted ? `Undo the ${run.period} payroll run?` : `Delete the ${run.period} payroll run?`,
      consequence: posted
        ? 'Reversing entries cancel the salary payment and its GL entries (the originals stay on record), the cash/bank balance is restored, recovered advances go back to outstanding, and the run is kept marked Reversed. Refused if its withheld tax/EOBI has already been remitted. This cannot be undone.'
        : 'The run and its payslip lines are deleted. Nothing was posted, so no money moves.',
      amount: PKR(run.netTotal),
      confirmLabel: posted ? 'Undo run' : 'Delete run',
      cancelLabel: 'Go back',
    });
    if (!ok) return false;
    try {
      await deleteRunMut.mutateAsync(run.id);
      addToast(posted ? `Payroll run for ${run.period} reversed — payment reversed, advances restored` : `Payroll run for ${run.period} deleted`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
    return true;
  }
  // Opened with ?add=employee (Mill Finance ▸ More actions ▸ Add employee):
  // the Add Employee drawer starts open — for payroll preparers only.
  const [showWorkerDrawer, setShowWorkerDrawerState] = useState(
    () => searchParams.get('add') === 'employee' && hasPermission('payroll', 'create'),
  );
  function setShowWorkerDrawer(open) {
    setShowWorkerDrawerState(open);
    if (!open && searchParams.get('add')) {
      setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('add'); return p; }, { replace: true });
    }
  }
  const payById = new Map(payrollSummary.map(p => [p.id, p]));

  return (
    <div className="space-y-5 pb-4 print-report" data-testid="payroll-workspace">
      {intro && (
        // Inside Finance the header already titles this "Payroll"; a one-line
        // intro replaces the old gradient banner.
        <p className="flex items-center gap-2 text-sm text-gray-600" data-testid="payroll-intro">
          <Users size={15} className="text-gray-400 shrink-0" aria-hidden="true" />
          <span>{defaultEntity === 'general' ? 'Head Office' : 'Mill'} · Payroll — workers, runs, attendance, advances &amp; settlements; one payroll, managed here.</span>
        </p>
      )}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {[['payroll', 'Payroll', Wallet], ['attendance', 'Attendance', CalendarDays], ['reports', 'Reports', FileText]].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setPayrollView(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition ${payrollView === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />} {label}
              </button>
            ))}
          </div>
          {/* Head Office | Mill payroll scope toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {[['general', 'Head Office'], ['mill', 'Mill']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPayrollEntity(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${payrollEntity === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          </div>
          <div className="flex items-center gap-2">
            {payrollView !== 'reports' && (
              <input
                type="month"
                value={payrollMonth}
                max={curMonth}
                onChange={e => setPayrollMonth(e.target.value || curMonth)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-gray-900"
              />
            )}
            {payrollView === 'payroll' && anyUnpaid && canPreparePayroll && (
              <button
                onClick={() => openRunDrawer(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Wallet className="w-3.5 h-3.5" /> {monthRuns.length ? 'Prepare Remaining' : 'Prepare Payroll Run'}
              </button>
            )}
            {payrollView === 'payroll' && (canApprovePayroll || canPreparePayroll) && (
              <button onClick={() => setShowScheduleDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <Clock className="w-3.5 h-3.5" /> Schedule
              </button>
            )}
            {payrollView === 'payroll' && canApprovePayroll && (
              <button onClick={() => setShowStatutoryDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <Landmark className="w-3.5 h-3.5" /> Statutory
              </button>
            )}
            {payrollView === 'payroll' && canViewPayroll && (
              <button onClick={() => setShowTaxDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <FileText className="w-3.5 h-3.5" /> Tax statements
              </button>
            )}
            {payrollView === 'payroll' && canViewPayroll && (
              <button onClick={() => setShowAuditDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <History className="w-3.5 h-3.5" /> Activity
              </button>
            )}
            {payrollView === 'payroll' && canViewPayroll && (
              <button onClick={() => setShowRequestsDrawer(true)} className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <Inbox className="w-3.5 h-3.5" /> Requests
                {pendingRequestCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{pendingRequestCount}</span>}
              </button>
            )}
            {payrollView === 'payroll' && canViewPayroll && (
              <button onClick={() => setShowLeaveDrawer(true)} className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                <CalendarDays className="w-3.5 h-3.5" /> Leave
                {pendingLeaveCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{pendingLeaveCount}</span>}
              </button>
            )}
            {canPreparePayroll && (
              <button onClick={() => openWorkerDrawer(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">
                <UserPlus className="w-3.5 h-3.5" /> Add Employee
              </button>
            )}
          </div>
        </div>

        {payrollView === 'attendance' ? (
          <EmployeeAttendanceGrid
            month={payrollMonth}
            entity={payrollEntity}
            employees={workers}
            recordAttMut={recordAttMut}
            addToast={addToast}
          />
        ) : payrollView === 'reports' ? (
          <PayrollReport companyProfile={companyProfileData} entity={payrollEntity} onOpenRun={(id) => setPayslipsRunId(id)} />
        ) : (<>
        {pendingRuns.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <Clock className="w-4 h-4" />
              <span><span className="font-semibold">{pendingRuns.length} payroll run{pendingRuns.length > 1 ? 's' : ''} pending</span> approval/payment ({PKR(pendingRuns.reduce((s, r) => s + (parseFloat(r.netTotal) || 0), 0))}).{!canApprovePayroll ? ' Finance/Owner must approve & pay.' : ''}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingRuns.map(r => (
                <div key={r.id} className="inline-flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2.5 py-1 text-xs">
                  <StatusBadge status={r.status} />
                  <span className="text-gray-600">{r.employeeCount} emp · <span className="font-semibold tabular-nums">{PKR(r.netTotal)}</span> · {fmtDate(r.payDate)}</span>
                  <button onClick={() => setPayslipsRunId(r.id)} className="text-blue-700 font-medium hover:underline">{r.status === 'accrued' ? 'settle' : r.status === 'partially_paid' ? 'continue' : 'review'}</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {monthRuns.some(r => isPaidStatus(r.status)) && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <Receipt className="w-4 h-4" />
              <span><span className="font-semibold">{PKR(paidThisMonth)} paid</span> to {paidCount} employee(s) this month{anyUnpaid ? ` · ${unpaidEmployees.length} still to prepare` : ''}.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {monthRuns.filter(r => isPaidStatus(r.status)).map(r => (
                <div key={r.id} className="inline-flex items-center gap-2 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 text-xs">
                  <StatusBadge status={r.status} />
                  <span className="text-gray-600">{r.employeeCount} emp · <span className="font-semibold tabular-nums">{PKR(r.netTotal)}</span> · {r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash'} · {fmtDate(r.payDate)}</span>
                  <button onClick={() => setPayslipsRunId(r.id)} className="text-emerald-700 font-medium hover:underline">payslips</button>
                  {canDeletePayroll && <button onClick={() => handleDeleteRun(r)} disabled={deleteRunMut.isPending} className="text-red-500 hover:text-red-700 disabled:opacity-50">undo</button>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat tone="blue"  icon={Users}      label="Active Employees"  value={payrollSummary.length} sub={`${workers.length} total`} />
          <Stat tone="slate" icon={DollarSign} label="Gross Payroll"   value={PKR(payrollGross)} sub={payrollMonth} />
          <Stat tone="amber" icon={HandCoins}  label="Advances Outstanding" value={PKR(advancesOutstandingTotal)} sub="To recover" />
          <Stat tone={anyUnpaid ? 'red' : 'green'} icon={Wallet} label={anyUnpaid ? 'Net Remaining' : 'Net Paid'} value={PKR(anyUnpaid ? unpaidNet : paidThisMonth)} sub={anyUnpaid ? `${unpaidEmployees.length} unpaid` : 'All paid'} />
        </div>

        {/* Advance approvals inbox (Batch 6 · item 8): Owner approves → Finance pays. */}
        {canViewPayroll && pendingAdvances.length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
              <Inbox className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-900">Advance approvals</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-200 text-amber-800">{pendingAdvances.length}</span>
              <span className="text-xs text-amber-700 ml-auto">Owner approves, then Finance pays.</span>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingAdvances.map(a => (
                <div key={a.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 flex items-center gap-2">
                      {a.workerName || 'Worker'}
                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-gray-100 text-gray-500">{a.workerEntity === 'general' ? 'Head Office' : 'Mill'}</span>
                      {a.approvalStatus === 'approved'
                        ? <StatusBadge status="Approved" />
                        : <StatusBadge status="Pending Approval" />}
                    </div>
                    <div className="text-xs text-gray-400">{fmtDate(a.advanceDate)}{a.notes ? ` · ${a.notes}` : ''}</div>
                  </div>
                  <div className="tabular-nums font-semibold text-gray-900">{PKR(a.amount)}</div>
                  <div className="flex items-center gap-2">
                    {a.approvalStatus === 'pending' && canApprovePayroll && (
                      <>
                        <button onClick={() => handleApproveAdvance(a)} disabled={approveAdvanceMut.isPending}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Approve</button>
                        <button onClick={() => handleRejectAdvance(a)} disabled={rejectAdvanceMut.isPending}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-60"><X className="w-3.5 h-3.5" /> Reject</button>
                      </>
                    )}
                    {a.approvalStatus === 'approved' && canPayPayroll && (
                      <button onClick={() => handlePayAdvance(a)} disabled={payAdvanceMut.isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60"><Banknote className="w-3.5 h-3.5" /> Pay…</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {payAdvanceRow && (
          <AdvancePayDrawer advance={payAdvanceRow} bankAccounts={bankAccountsList} payMut={payAdvanceMut} addToast={addToast} onClose={() => setPayAdvanceRow(null)} />
        )}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Pay basis</th>
                <th className="text-right px-4 py-3 font-medium">Days / OT</th>
                <th className="text-right px-4 py-3 font-medium">Gross</th>
                <th className="text-right px-4 py-3 font-medium">Advance</th>
                <th className="text-right px-4 py-3 font-medium">Net pay</th>
                <th className="text-right px-4 py-3 font-medium no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {workers.map(w => {
                const p = payById.get(w.id);
                const adv = parseFloat(w.advanceOutstanding) || 0;
                const monthly = w.payType === 'monthly';
                return (
                <tr key={w.id} className={`hover:bg-gray-50 ${!w.isActive ? 'opacity-50' : ''}`}>
                  <td data-label="Employee" className="px-4 py-3">
                    <div className="font-medium text-gray-900 flex items-center gap-2">
                      <button type="button" onClick={() => setLedgerWorker(w)} className="text-blue-600 hover:underline text-left" title="View ledger — all amounts paid to this employee">{w.name}</button>
                      {!w.isActive && <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-200 text-gray-600 uppercase">Inactive</span>}
                    </div>
                    <div className="text-xs text-gray-400 capitalize">{w.role}{w.phone ? ` · ${w.phone}` : ''}</div>
                  </td>
                  <td data-label="Pay basis" className="mob-hide px-4 py-3">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase mr-1.5 ${monthly ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>{monthly ? 'Salary' : 'Daily'}</span>
                    <span className="tabular-nums text-gray-700">{monthly ? `${PKR(w.monthlySalary)}/mo` : `${PKR(w.dailyWage)}/day`}</span>
                  </td>
                  <td data-label="Days / OT" className="mob-hide px-4 py-3 text-right tabular-nums text-gray-600">
                    {p ? `${p.effectiveDays} d` : '—'}{p && p.totalOT ? ` · ${p.totalOT}h OT` : ''}
                    {p && monthly && <span className="block text-[10px] text-gray-300">salary fixed</span>}
                  </td>
                  <td data-label="Gross" className="px-4 py-3 text-right tabular-nums">{p ? PKR(p.grossPay) : '—'}</td>
                  <td data-label="Advance" className="mob-hide px-4 py-3 text-right tabular-nums">
                    {adv > 0
                      ? <button onClick={() => setAdvancesPanelWorker(w)} className="text-amber-700 font-medium hover:underline">−{PKR(adv)}</button>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td data-label="Net pay" className="px-4 py-3 text-right font-semibold tabular-nums">
                    {p?.paid
                      ? <StatusBadge status="Paid" />
                      : (p ? PKR(p.netPay) : '—')}
                  </td>
                  <td data-label="Actions" className="px-4 py-3 no-print">
                    <div className="flex items-center justify-end gap-1">
                      {canPreparePayroll && p && !p.committed && p.grossPay > 0 && (
                        <button aria-label="Prepare for this employee" title="Prepare for this employee" onClick={() => openRunDrawer(w.id)} className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"><Wallet className="w-3.5 h-3.5" /></button>
                      )}
                      {canPreparePayroll && <button aria-label="Give advance" title="Give advance" onClick={() => openAdvanceDrawer(w)} className="p-1.5 rounded-md text-amber-600 hover:bg-amber-50"><HandCoins className="w-3.5 h-3.5" /></button>}
                      {canPreparePayroll && <button aria-label="Bonuses & deductions" title="Bonuses & deductions" onClick={() => setAdjustWorker(w)} className="p-1.5 rounded-md text-violet-600 hover:bg-violet-50"><Plus className="w-3.5 h-3.5" /></button>}
                      {canPreparePayroll && <button aria-label="Revise salary" title="Revise salary" onClick={() => setReviseWorker(w)} className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50"><TrendingUp className="w-3.5 h-3.5" /></button>}
                      {hasPermission('payroll', 'edit') && <button aria-label="Edit" title="Edit" onClick={() => openWorkerDrawer(w)} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil className="w-3.5 h-3.5" /></button>}
                      {canPayPayroll && w.isActive && <button aria-label="Final settlement" title="Final settlement" onClick={() => setSettleWorker(w)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50"><LogOut className="w-3.5 h-3.5" /></button>}
                      {canPreparePayroll && <button aria-label={w.isActive ? 'Deactivate' : 'Reactivate'} title={w.isActive ? 'Deactivate' : 'Reactivate'} onClick={() => handleToggleActive(w)} className={`p-1.5 rounded-md hover:bg-gray-100 ${w.isActive ? 'text-gray-500' : 'text-emerald-600'}`}><Power className="w-3.5 h-3.5" /></button>}
                      {canDeletePayroll && <button aria-label="Delete" title="Delete" onClick={() => setDeleteWorkerTarget(w)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>}
                      {!canPreparePayroll && !canDeletePayroll && <span className="text-[11px] text-gray-300">—</span>}
                    </div>
                  </td>
                </tr>
                );
              })}
              {workers.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No employees added yet — click <span className="font-medium">Add Employee</span> to start.</td></tr>
              )}
              {payrollSummary.length > 0 && (
                <tr className="bg-gray-50 font-semibold text-gray-800">
                  <td colSpan={3} className="px-4 py-3 text-right">Grand Total</td>
                  <td data-label="Gross" className="px-4 py-3 text-right tabular-nums">{PKR(payrollGross)}</td>
                  <td data-label="Advance" className="px-4 py-3 text-right tabular-nums text-amber-700">−{PKR(payrollAdvances)}</td>
                  <td data-label="Net pay" className="px-4 py-3 text-right tabular-nums">{PKR(payrollTotal)}</td>
                  <td className="no-print" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 flex items-start gap-1.5">
          <HandCoins className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
          Advances are paid out as cash now (Money Out / GL) and auto-deducted from net pay. <span className="font-medium text-gray-500">Post Payroll Run</span> pays the month's net salaries (cash/bank + GL), generates a payslip per employee, and closes out the advances it recovered — so they're never deducted twice.
        </p>
        </>)}
      </div>

      {/* ─── ADD / EDIT WORKER DRAWER ──────────────────────────────── */}
      <SlideDrawer
        open={showWorkerDrawer}
        onClose={() => setShowWorkerDrawer(false)}
        title={`${workerForm.id ? 'Edit' : 'Add'} ${workerForm.entity === 'general' ? 'Head Office' : 'Mill'} Employee`}
        subtitle="Daily-wage or salaried — drives attendance & monthly payroll"
        icon={UserPlus}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowWorkerDrawer(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleSaveWorker}
              disabled={createWorkerMut.isPending || updateWorkerMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {(createWorkerMut.isPending || updateWorkerMut.isPending) ? 'Saving…' : workerForm.id ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Head Office vs Mill payroll */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payroll</label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              {[['general', 'Head Office'], ['mill', 'Mill']].map(([key, label]) => (
                <button key={key} type="button" onClick={() => setWorkerForm(p => ({ ...p, entity: key, role: '' }))}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${workerForm.entity === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                type="text"
                value={workerForm.name}
                onChange={e => setWorkerForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <input
                list="worker-role-options"
                value={workerForm.role}
                onChange={e => setWorkerForm(p => ({ ...p, role: e.target.value }))}
                placeholder={workerForm.entity === 'general' ? 'e.g. Accountant' : 'e.g. Operator'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              />
              <datalist id="worker-role-options">
                {(workerForm.entity === 'general' ? HEAD_OFFICE_ROLES : WORKER_ROLES).map(r => (
                  <option key={r} value={r.charAt(0).toUpperCase() + r.slice(1)} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Department / cost-center <span className="text-gray-400 font-normal">(for cost breakdown)</span></label>
            <input
              list="mill-departments" value={workerForm.department}
              onChange={e => setWorkerForm(p => ({ ...p, department: e.target.value }))}
              placeholder="e.g. Milling, Packing, Admin"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
            <datalist id="mill-departments">
              {[...new Set((workers || []).map(x => x.department).filter(Boolean))].map(d => <option key={d} value={d} />)}
            </datalist>
          </div>

          {/* Pay type toggle — daily wage vs monthly salary */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Pay basis *</label>
            <div className="grid grid-cols-2 gap-2">
              {[['daily', 'Daily Wage', 'Paid per day worked'], ['monthly', 'Monthly Salary', 'Flat monthly figure']].map(([val, lbl, hint]) => (
                <button
                  key={val} type="button"
                  onClick={() => setWorkerForm(p => ({ ...p, pay_type: val }))}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition ${workerForm.pay_type === val ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}
                >
                  <div className="font-medium">{lbl}</div>
                  <div className={`text-[11px] ${workerForm.pay_type === val ? 'text-gray-300' : 'text-gray-400'}`}>{hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {workerForm.pay_type === 'monthly' ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monthly Salary (PKR) *</label>
                <input
                  type="number" min="0"
                  value={workerForm.monthly_salary}
                  onChange={e => setWorkerForm(p => ({ ...p, monthly_salary: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
                />
                <p className="text-[11px] text-gray-400 mt-1">≈ {PKR((parseFloat(workerForm.monthly_salary) || 0) / 26)}/day for overtime math</p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Daily Wage (PKR) *</label>
                <input
                  type="number" min="0"
                  value={workerForm.daily_wage}
                  onChange={e => setWorkerForm(p => ({ ...p, daily_wage: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Overtime rate / hour (PKR)</label>
              <input
                type="number" min="0"
                placeholder="Default: 1.5× hourly"
                value={workerForm.ot_rate_per_hour}
                onChange={e => setWorkerForm(p => ({ ...p, ot_rate_per_hour: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
              />
              <p className="text-[11px] text-gray-400 mt-1">Leave blank to use 1.5× the daily hourly rate.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input
                type="text"
                value={workerForm.phone}
                onChange={e => setWorkerForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CNIC</label>
              <input
                type="text" placeholder="00000-0000000-0"
                value={workerForm.cnic}
                onChange={e => setWorkerForm(p => ({ ...p, cnic: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Joined Date</label>
              <input
                type="date"
                value={workerForm.joined_date}
                onChange={e => setWorkerForm(p => ({ ...p, joined_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Last working day <span className="text-gray-400 font-normal">(optional — prorates the final month's salary)</span></label>
            <input
              type="date"
              value={workerForm.left_date}
              onChange={e => setWorkerForm(p => ({ ...p, left_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Bank details (for salary transfer)</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bank name</label>
                <input type="text" placeholder="e.g. HBL, Meezan" value={workerForm.bank_name}
                  onChange={e => setWorkerForm(p => ({ ...p, bank_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Account number</label>
                <input type="text" value={workerForm.bank_account_number}
                  onChange={e => setWorkerForm(p => ({ ...p, bank_account_number: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
              <input type="text" placeholder="PK00XXXX0000000000000000" value={workerForm.iban}
                onChange={e => setWorkerForm(p => ({ ...p, iban: e.target.value.toUpperCase() }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              rows={2}
              value={workerForm.notes}
              onChange={e => setWorkerForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          {workerForm.id && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Self-service portal</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${workerForm.portal_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{workerForm.portal_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <p className="text-[11px] text-gray-400">The employee logs in at <span className="font-mono">/portal</span> with their CNIC + this PIN to view payslips, tax certificate &amp; advance balance.{!workerForm.cnic ? ' Add a CNIC above first.' : ''}</p>
              <div className="flex gap-2">
                <input
                  type="text" inputMode="numeric" maxLength={8} value={portalPin}
                  onChange={e => setPortalPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="6–8 digit PIN"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
                />
                <button
                  disabled={!workerForm.cnic || portalPin.length < 6 || setPinMut.isPending}
                  onClick={async () => { try { await setPinMut.mutateAsync({ id: workerForm.id, data: { pin: portalPin, enabled: true } }); setPortalPin(''); setWorkerForm(p => ({ ...p, portal_enabled: true })); addToast('Self-service PIN set', 'success'); } catch (e) { addToast(e.message, 'error'); } }}
                  className="px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >{workerForm.portal_enabled ? 'Reset PIN' : 'Set PIN & enable'}</button>
              </div>
              {workerForm.portal_enabled && (
                <button
                  onClick={async () => { try { await setPinMut.mutateAsync({ id: workerForm.id, data: { enabled: false } }); setWorkerForm(p => ({ ...p, portal_enabled: false })); addToast('Self-service disabled', 'success'); } catch (e) { addToast(e.message, 'error'); } }}
                  className="text-[11px] text-red-600 hover:underline"
                >Disable self-service</button>
              )}
            </div>
          )}
        </div>
      </SlideDrawer>

      {/* ─── EMPLOYEE LEDGER DRAWER ────────────────────────────────── */}
      <EmployeeLedgerDrawer worker={ledgerWorker} onClose={() => setLedgerWorker(null)} />

      {/* ─── GIVE ADVANCE DRAWER ───────────────────────────────────── */}
      <SlideDrawer
        open={!!advanceTarget}
        onClose={() => setAdvanceTarget(null)}
        title="Request Salary Advance"
        subtitle={advanceTarget ? `Advance for ${advanceTarget.name}` : ''}
        icon={HandCoins}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdvanceTarget(null)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleGiveAdvance}
              disabled={createAdvanceMut.isPending}
              className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60"
            >
              {createAdvanceMut.isPending ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        }
      >
        {advanceTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
              <HandCoins className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>This <span className="font-medium">requests</span> an advance for <span className="font-medium">{advanceTarget.name}</span>. No cash moves yet — an Owner must approve it, then Finance pays it out (posting to Money Out / GL) and it auto-deducts from their next payroll. Current outstanding: <span className="font-medium">{PKR(advanceTarget.advanceOutstanding || 0)}</span>.</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) *</label>
                <input
                  type="number" min="0" autoFocus
                  value={advanceForm.amount}
                  onChange={e => setAdvanceForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  value={advanceForm.advance_date}
                  onChange={e => setAdvanceForm(p => ({ ...p, advance_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason / Notes</label>
              <textarea
                rows={2}
                value={advanceForm.notes}
                onChange={e => setAdvanceForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>

            {/* Recovery plan — deduct over multiple salaries */}
            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recovery plan</p>
              <div className="space-y-1.5">
                {[
                  ['full_next_salary', 'Deduct full amount from next salary'],
                  ['fixed_installment', 'Fixed monthly installments'],
                  ['salary_percentage', 'Percentage of salary'],
                  ['manual', 'Manual deduction during payroll'],
                ].map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="recovery_method" checked={advanceForm.recovery_method === val}
                      onChange={() => setAdvanceForm(p => ({ ...p, recovery_method: val }))} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              {(advanceForm.recovery_method === 'fixed_installment' || advanceForm.recovery_method === 'salary_percentage') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Recovery start month</label>
                    <input type="month" value={advanceForm.recovery_start_period}
                      onChange={e => setAdvanceForm(p => ({ ...p, recovery_start_period: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
                  </div>
                  {advanceForm.recovery_method === 'fixed_installment' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Installment (PKR)</label>
                        <input type="number" min="0" value={advanceForm.installment_amount}
                          onChange={e => setAdvanceForm(p => ({ ...p, installment_amount: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1"># Installments</label>
                        <input type="number" min="1" value={advanceForm.installment_count}
                          onChange={e => setAdvanceForm(p => ({ ...p, installment_count: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums" />
                      </div>
                    </>
                  )}
                  {advanceForm.recovery_method === 'salary_percentage' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Deduction %</label>
                      <input type="number" min="0" max="100" value={advanceForm.deduction_percent}
                        onChange={e => setAdvanceForm(p => ({ ...p, deduction_percent: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums" />
                    </div>
                  )}
                </div>
              )}

              {/* Preview */}
              {(() => {
                const amt = parseFloat(advanceForm.amount) || 0;
                if (!amt) return null;
                let line = null;
                if (advanceForm.recovery_method === 'full_next_salary') line = `Recovery: full ${fmtPKR(amt, { decimals: 2 })} from the next payroll.`;
                else if (advanceForm.recovery_method === 'manual') line = 'Recovery: admin enters the deduction manually each payroll.';
                else if (advanceForm.recovery_method === 'fixed_installment') {
                  const inst = parseFloat(advanceForm.installment_amount) || 0;
                  const cnt = parseInt(advanceForm.installment_count, 10) || (inst > 0 ? Math.ceil(amt / inst) : 0);
                  if (inst > 0 && cnt > 0) line = `Recovery: ${fmtPKR(inst, { decimals: 2 })} per month for ${cnt} month(s)${advanceForm.recovery_start_period ? `, from ${advanceForm.recovery_start_period}` : ''}.`;
                } else if (advanceForm.recovery_method === 'salary_percentage') {
                  const pct = parseFloat(advanceForm.deduction_percent) || 0;
                  if (pct > 0) line = `Recovery: ${pct}% of each salary${advanceForm.recovery_start_period ? `, from ${advanceForm.recovery_start_period}` : ''}, until ${fmtPKR(amt, { decimals: 2 })} is recovered.`;
                }
                return line ? <div className="rounded-md bg-blue-50 border border-blue-100 p-2 text-xs text-blue-800">{line}</div> : null;
              })()}
            </div>
          </div>
        )}
      </SlideDrawer>

      {/* ─── WORKER ADVANCES PANEL ─────────────────────────────────── */}
      {advancesPanelWorker && (
        <WorkerAdvancesPanel
          worker={advancesPanelWorker}
          onClose={() => setAdvancesPanelWorker(null)}
          onGiveAdvance={() => { const w = advancesPanelWorker; setAdvancesPanelWorker(null); openAdvanceDrawer(w); }}
          addToast={addToast}
        />
      )}

      {/* ─── POST PAYROLL RUN DRAWER ───────────────────────────────── */}
      {showRunDrawer && (
        <PayrollRunDrawer
          month={payrollMonth}
          entity={payrollEntity}
          employees={unpaidEmployees}
          preselectId={runPreselect}
          bankAccounts={bankAccountsList}
          onClose={() => { setShowRunDrawer(false); setRunPreselect(null); }}
          onPosted={(run) => { setShowRunDrawer(false); setRunPreselect(null); addToast(`Payroll run prepared — ${PKR(run.netTotal)} pending approval`, 'success'); setPayslipsRunId(run.id); }}
          postRunMut={postRunMut}
          addToast={addToast}
        />
      )}

      {/* ─── PAYROLL SCHEDULE DRAWER ───────────────────────────────── */}
      {showScheduleDrawer && (
        <PayrollScheduleDrawer
          canManage={canApprovePayroll}
          canPrepare={canPreparePayroll}
          onClose={() => setShowScheduleDrawer(false)}
          onRunNow={async () => {
            try {
              const res = await runNowMut.mutateAsync({ month: payrollMonth });
              const r = res?.data || res;
              if (r?.prepared && r?.run) { addToast(`Prepared payroll for ${r.run.period || payrollMonth}`, 'success'); setShowScheduleDrawer(false); setPayslipsRunId(r.run.id); }
              else addToast(r?.message || 'Everyone is already in a run this month.', 'info');
            } catch (e) { addToast(e.message, 'error'); }
          }}
          runNowBusy={runNowMut.isPending}
          addToast={addToast}
        />
      )}

      {/* ─── STATUTORY DEDUCTIONS DRAWER ───────────────────────────── */}
      {showStatutoryDrawer && (
        <StatutoryDeductionsDrawer canPay={canPayPayroll} entity={payrollEntity} bankAccounts={bankAccountsList} company={companyProfileData} onClose={() => setShowStatutoryDrawer(false)} addToast={addToast} />
      )}

      {/* ─── YEAR-END TAX STATEMENTS DRAWER ────────────────────────── */}
      {showTaxDrawer && (
        <TaxStatementDrawer company={companyProfileData} entity={payrollEntity} onClose={() => setShowTaxDrawer(false)} addToast={addToast} />
      )}

      {/* ─── EMPLOYEE REQUESTS DRAWER ──────────────────────────────── */}
      {showRequestsDrawer && (
        <WorkerRequestsDrawer canResolve={canPreparePayroll} onClose={() => setShowRequestsDrawer(false)} addToast={addToast} />
      )}

      {/* ─── LEAVE MANAGEMENT DRAWER ───────────────────────────────── */}
      {showLeaveDrawer && (
        <LeaveDrawer canManage={canApprovePayroll} workers={workers} onClose={() => setShowLeaveDrawer(false)} addToast={addToast} />
      )}

      {/* ─── FINAL SETTLEMENT DRAWER ───────────────────────────────── */}
      {settleWorker && (
        <FinalSettlementDrawer worker={settleWorker} bankAccounts={bankAccountsList} company={companyProfileData} onClose={() => setSettleWorker(null)} addToast={addToast} />
      )}

      {/* ─── PAYROLL ACTIVITY / AUDIT DRAWER ───────────────────────── */}
      {showAuditDrawer && (
        <PayrollAuditDrawer onClose={() => setShowAuditDrawer(false)} />
      )}

      {/* ─── SALARY REVISION DRAWER ────────────────────────────────── */}
      {reviseWorker && (
        <SalaryRevisionDrawer worker={reviseWorker} company={companyProfileData} onClose={() => setReviseWorker(null)} addToast={addToast} />
      )}

      {/* ─── BONUSES & DEDUCTIONS DRAWER ───────────────────────────── */}
      {adjustWorker && <AdjustmentsDrawer worker={adjustWorker} month={payrollMonth} onClose={() => setAdjustWorker(null)} addToast={addToast} />}

      {/* ─── PAYSLIPS / RUN PANEL ──────────────────────────────────── */}
      {payslipsRunId && (
        <PayslipsPanel
          runId={payslipsRunId}
          companyProfile={companyProfileData}
          canApprove={canApprovePayroll}
          canPay={canPayPayroll}
          canDelete={canDeletePayroll}
          addToast={addToast}
          onClose={() => setPayslipsRunId(null)}
          onUndo={async (run) => { if (await handleDeleteRun(run)) setPayslipsRunId(null); }}
          onApprove={async (run) => { try { await approveRunMut.mutateAsync(run.id); addToast('Payroll run approved', 'success'); } catch (e) { addToast(e.message, 'error'); } }}
          onPay={async (run, lineIds, amount, count) => {
            const partial = !!(lineIds && lineIds.length);
            const ok = await confirm({
              title: partial ? `Pay ${count} selected employee(s) for ${run.period}?` : `Pay the ${run.period} payroll${run.status === 'partially_paid' ? ' (remaining employees)' : ''}?`,
              consequence: `Pays ${count} employee(s) from ${run.payMethod === 'bank' ? (run.bankName || 'the bank account') : 'cash'}: posts the salary expense to Money Out and the GL, and recovers their scheduled advances.`,
              amount: PKR(amount),
              confirmLabel: 'Pay',
              cancelLabel: 'Go back',
            });
            if (!ok) return;
            try {
              const res = await payRunMut.mutateAsync(partial ? { id: run.id, lineIds } : run.id);
              const st = res?.data?.run?.status;
              addToast(st === 'partially_paid' ? `${PKR(amount)} paid — run partially paid` : `Payroll paid — ${PKR(amount)}`, 'success');
            } catch (e) { addToast(e.message, 'error'); }
          }}
          onVoid={async (run) => {
            const ok = await confirm({ title: `Void the ${run.period} payroll run?`, consequence: 'The run is cancelled and its employees are freed to be prepared again. Nothing was posted, so no money moves.', amount: PKR(run.netTotal), reason: 'required', confirmLabel: 'Void run', cancelLabel: 'Go back' });
            if (!ok) return;
            try { await voidRunMut.mutateAsync({ id: run.id, reason: ok.reason }); addToast('Payroll run voided', 'success'); setPayslipsRunId(null); } catch (e) { addToast(e.message, 'error'); }
          }}
          onAccrue={async (run) => {
            const ok = await confirm({ title: `Accrue the ${run.period} payroll?`, consequence: 'Books the salary expense and a Salaries Payable liability and recovers scheduled advances now. No cash moves until the run is Settled.', amount: PKR(run.netTotal), confirmLabel: 'Accrue', cancelLabel: 'Go back' });
            if (!ok) return;
            try { await accrueRunMut.mutateAsync(run.id); addToast(`Payroll accrued — ${PKR(run.netTotal)} booked to Salaries Payable`, 'success'); } catch (e) { addToast(e.message, 'error'); }
          }}
          onSettle={async (run) => {
            const ok = await confirm({ title: `Settle the accrued ${run.period} payroll?`, consequence: `Pays the Salaries Payable from ${run.payMethod === 'bank' ? (run.bankName || 'the bank account') : 'cash'} and clears the liability.`, amount: PKR(run.netTotal), confirmLabel: 'Settle', cancelLabel: 'Go back' });
            if (!ok) return;
            try { await settleRunMut.mutateAsync(run.id); addToast(`Accrued payroll settled — ${PKR(run.netTotal)} paid`, 'success'); } catch (e) { addToast(e.message, 'error'); }
          }}
          deleteRunMut={deleteRunMut}
          approveRunMut={approveRunMut}
          payRunMut={payRunMut}
          voidRunMut={voidRunMut}
          accrueRunMut={accrueRunMut}
          settleRunMut={settleRunMut}
        />
      )}

      {/* ─── DELETE WORKER CONFIRM ─────────────────────────────────── */}
      {deleteWorkerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteWorkerTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Delete {deleteWorkerTarget.name}?</h3>
                <p className="text-sm text-gray-500 mt-1">
                  This permanently removes the employee, their attendance, and their advances.
                  {(parseFloat(deleteWorkerTarget.advanceOutstanding) || 0) > 0 && (
                    <> Any advance cash-outs ({PKR(deleteWorkerTarget.advanceOutstanding)} outstanding) will be reversed from Money Out / GL.</>
                  )}{' '}
                  To keep history instead, use <span className="font-medium">Deactivate</span>.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setDeleteWorkerTarget(null)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleDeleteWorker} disabled={deleteWorkerMut.isPending} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60">
                {deleteWorkerMut.isPending ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
