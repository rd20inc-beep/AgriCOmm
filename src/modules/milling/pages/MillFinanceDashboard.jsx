import { useState, useMemo, useEffect, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DollarSign, Users, Zap, Shield, TrendingUp, TrendingDown, AlertTriangle,
  Plus, UserPlus, Package, Factory, Wallet, ArrowUpRight, ArrowDownRight, Printer,
  Building2, Banknote, Receipt, Layers, Truck, ExternalLink,
  Pencil, Trash2, HandCoins, CalendarDays, Phone, CreditCard, Power, X, FileText, RefreshCw, Sparkles, ArrowLeftRight, Inbox, Check, ShoppingCart, Clock, Landmark, LogOut, History, ChevronDown, ChevronRight, Paperclip, Percent,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import {
  useMillExpenses, useCreateMillExpense, useRecurringExpenses, useMaterializeRecurring, useRunDueRecurring, useCategorizeExpense, useMillWorkers, useCreateMillWorker,
  useUpdateMillWorker, useDeleteMillWorker, useSetWorkerPortalPin, useCreateWorkerAdvance, useWorkerAdvances, useWorkerLedger,
  useDeleteWorkerAdvance, useAdvanceLedger,
  usePendingAdvances, useApproveAdvance, useRejectAdvance, usePayAdvance,
  useWorkerAdjustments, useCreateWorkerAdjustment, useDeleteWorkerAdjustment,
  usePayrollSummary, useRecordAttendance, useAttendance, useBulkAttendance, useImportAttendance, useAttendanceHolidays, useInventory, useExpenseVendors,
  usePayrollRuns, usePostPayrollRun, useDeletePayrollRun, usePayrollRun, usePayrollReport,
  useApprovePayrollRun, usePayPayrollRun, useVoidPayrollRun, useAccruePayrollRun, useSettlePayrollRun,
  useStatutoryDeductions, useCreateStatutoryDeduction, useUpdateStatutoryDeduction, useDeleteStatutoryDeduction,
  useStatutoryLiabilities, useStatutoryRemittances, useCreateStatutoryRemittance, useDeleteStatutoryRemittance,
  useTaxStatement, useWorkerRequests, useWorkerRequestsCount, useResolveWorkerRequest,
  useLeaveTypes, useLeaveRequests, useLeaveRequestsCount, useCreateLeaveType, useUpdateLeaveType, useDeleteLeaveType,
  useApproveLeaveRequest, useRejectLeaveRequest,
  useFinalSettlement, useFinalizeSettlement, usePayrollAudit, useSalaryRevisions, useReviseSalary,
  usePayrollSchedule, useSavePayrollSchedule, useRunPayrollNow,
  usePayables, useSuppliers, useCustomers, usePurchases, useLocalSalesSummary, useMillCashFlow, useAcceptFundTransfer,
  useMillLotCosts, useLocalSales, useRecordPayment, usePayablePayments, useBankAccounts,
} from '../../../api/queries';
import TransactionDocument from '../../../components/TransactionDocument';
import NewPurchaseDrawer from '../../../components/NewPurchaseDrawer';
import api from '../../../api/client';
import { downloadCSV } from '../../../utils/csvExport';
import StatusBadge from '../../../components/StatusBadge';
import { useCommodityPrices } from '../hooks/useCommodityPrices';
import SlideDrawer from '../../../components/SlideDrawer';
import SearchSelect from '../../../shared/components/SearchSelect';
import MillSupplierStatement from '../components/MillSupplierStatement';
import MillSupplierPayDrawer from '../components/MillSupplierPayDrawer';
import MillCustomerStatement from '../components/MillCustomerStatement';
import MillCustomerPayDrawer from '../components/MillCustomerPayDrawer';
import StatementPayDrawer from '../../finance/components/StatementPayDrawer';
import TransferFundsDrawer from '../../finance/components/TransferFundsDrawer';
import AnomalyWatchCard from '../../ai/components/AnomalyWatchCard';

const PKR = (v) => 'Rs ' + (v || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const COMPACT_PKR = (v) => {
  const n = Math.round(v || 0);
  if (Math.abs(n) >= 10000000) return `Rs ${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `Rs ${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `Rs ${(n / 1000).toFixed(1)}k`;
  return `Rs ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const EXPENSE_CATS = [
  'salaries', 'utilities', 'rent', 'maintenance', 'insurance',
  'transport', 'fuel', 'packaging', 'inspection', 'freight',
  'commission', 'miscellaneous',
];
// Category-specific extra field for the Add Expense drawer → saved to subcategory.
// 'salaries' is special-cased (employee picker), so it's not here.
const CAT_DETAIL = {
  utilities:   { label: 'Utility type', options: ['Electricity', 'Water', 'Gas', 'Internet'] },
  fuel:        { label: 'Vehicle / equipment', placeholder: 'e.g. Generator, Truck LEX-123' },
  rent:        { label: 'Property / location', placeholder: 'e.g. Mill warehouse' },
  transport:   { label: 'Vehicle / route', placeholder: 'e.g. Lahore → Mill' },
  maintenance: { label: 'Asset / equipment', placeholder: 'e.g. Huller #2, boiler' },
  insurance:   { label: 'Policy number', placeholder: 'Policy #' },
  inspection:  { label: 'Inspection / lab', placeholder: 'e.g. SGS moisture test' },
  freight:     { label: 'Shipment / route', placeholder: '' },
  commission:  { label: 'Deal / party', placeholder: '' },
};
const RECURRENCES = ['monthly', 'weekly', 'quarterly', 'yearly'];
const WORKER_ROLES = ['operator', 'laborer', 'supervisor', 'driver', 'guard', 'cleaner'];
// Head Office staff carry different job titles — free-text with these suggestions.
const HEAD_OFFICE_ROLES = ['Manager', 'Accountant', 'Officer', 'Clerk', 'Admin', 'Cashier', 'Executive'];
// VENDOR_OPTIONS used to be a hardcoded map here. It now lives in the
// `expense_vendors` table and is managed via Admin → Expense Vendors.
// The component fetches it through useExpenseVendors() below.

const tabs = [
  { key: 'overview',   label: 'Overview',     icon: DollarSign },
  { key: 'moneyflow',  label: 'Money In/Out', icon: Wallet },
  { key: 'suppliers',  label: 'Suppliers',    icon: Building2 },
  { key: 'customers',  label: 'Customers',    icon: Users },
  { key: 'expenses',   label: 'Expenses',     icon: TrendingDown },
  { key: 'recurring',  label: 'Recurring',    icon: RefreshCw },
  { key: 'addcosts',   label: 'Add. Costs',   icon: Layers },
  { key: 'efficiency', label: 'Efficiency',   icon: TrendingUp },
  { key: 'loss',       label: 'Loss & Theft', icon: Shield },
  { key: 'payroll',    label: 'Payroll',      icon: Users },
  { key: 'utilities',  label: 'Utilities',    icon: Zap },
];

const tabByKey = Object.fromEntries(tabs.map((t) => [t.key, t]));

// Grouped tab bar: primary tabs stay top-level; related detail is tucked into
// dropdowns so the bar is short. Standalone = { key }; group = { label, icon, keys }.
const NAV = [
  { key: 'overview' },
  { key: 'moneyflow' },
  { label: 'Parties',     icon: Building2,     keys: ['suppliers', 'customers'] },
  { label: 'Costs',       icon: TrendingDown,  keys: ['expenses', 'recurring', 'addcosts', 'utilities'] },
  { label: 'Performance', icon: TrendingUp,    keys: ['efficiency', 'loss'] },
  { key: 'payroll' },
];

function Stat({ label, value, sub, tone = 'slate', icon: Icon }) {
  const tones = {
    slate:  'bg-white border-gray-100',
    blue:   'bg-blue-50/40 border-blue-100',
    green:  'bg-emerald-50/40 border-emerald-100',
    red:    'bg-red-50/40 border-red-100',
    amber:  'bg-amber-50/40 border-amber-100',
    purple: 'bg-purple-50/40 border-purple-100',
  };
  const iconTones = {
    slate:  'text-gray-400',
    blue:   'text-blue-500',
    green:  'text-emerald-500',
    red:    'text-red-500',
    amber:  'text-amber-500',
    purple: 'text-purple-500',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={iconTones[tone]} />}
      </div>
      <p className="text-xl font-semibold text-gray-900 mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1 truncate">{sub}</p>}
    </div>
  );
}

// `payrollOnly` renders JUST the Payroll tab (no mill hero/KPIs/fund-transfers or
// #14 — Pay Transporter slider: settles a real transporter payable via
// #14 Phase 1e — WHT + early-payment discount + supporting document, shared by
// every Pay drawer. WHT and discount reduce the CASH paid but not the amount
// cleared against the payable (the vendor's claim is settled in full; the tax is
// remitted to FBR and the discount booked as income). Returns the fields via the
// parent's form + set(); the parent sends wht_amount / wht_rate / discount_amount
// / attachment_url / attachment_name to recordPayment and shows the net cash.
function PaymentExtras({ form, set, gross, addToast }) {
  const [uploading, setUploading] = useState(false);
  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 bg-white';
  const wht = parseFloat(form.whtAmount) || 0;
  const disc = parseFloat(form.discountAmount) || 0;
  const net = Math.max(0, (parseFloat(form.amount) || 0) - wht - disc);

  const onRate = (v) => {
    set('whtRate', v);
    const pct = parseFloat(v);
    if (Number.isFinite(pct) && gross > 0) set('whtAmount', String(Math.round(gross * pct) / 100));
  };

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload('/finance/payments/attachment', fd);
      const d = res?.data || res;
      if (d?.url) { set('attachmentUrl', d.url); set('attachmentName', d.name || file.name); }
      else if (res?._offlineQueued) addToast?.('Offline — the document will upload when the connection returns.', 'info');
      else throw new Error('Upload failed');
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Attachment upload failed', 'error');
    } finally { setUploading(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 bg-gray-50/60">
      <div className="text-xs font-semibold text-gray-600">Tax, discount &amp; document <span className="font-normal text-gray-400">(optional)</span></div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1 inline-flex items-center gap-1"><Percent size={11} /> WHT rate</label>
          <input type="number" step="0.01" min="0" max="100" value={form.whtRate || ''} onChange={(e) => onRate(e.target.value)} placeholder="e.g. 2" className={inp} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">WHT amount</label>
          <input type="number" step="0.01" min="0" value={form.whtAmount || ''} onChange={(e) => set('whtAmount', e.target.value)} placeholder="0" className={inp} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Discount</label>
          <input type="number" step="0.01" min="0" value={form.discountAmount || ''} onChange={(e) => set('discountAmount', e.target.value)} placeholder="0" className={inp} />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs bg-white rounded-md border border-gray-200 px-3 py-2">
        <span className="text-gray-500">Net cash to pay</span>
        <span className="font-semibold text-gray-800 tabular-nums">{PKR(net)}</span>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1 inline-flex items-center gap-1"><Paperclip size={11} /> Supporting document</label>
        {form.attachmentUrl ? (
          <div className="flex items-center justify-between text-xs bg-white rounded-md border border-gray-200 px-3 py-2">
            <span className="text-gray-700 truncate inline-flex items-center gap-1.5"><FileText size={13} className="text-emerald-600" /> {form.attachmentName || 'Attached'}</span>
            <button type="button" onClick={() => { set('attachmentUrl', ''); set('attachmentName', ''); }} className="text-red-500 hover:text-red-600"><X size={14} /></button>
          </div>
        ) : (
          <input type="file" onChange={onFile} disabled={uploading}
            className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" />
        )}
        {uploading && <p className="text-[11px] text-gray-400 mt-1">Uploading…</p>}
      </div>
    </div>
  );
}

// recordPayment (cash/bank mandatory, full or partial) straight from the Mill
// Finance transport breakdown, so the Mill Manager can pay where they see the
// due amount. WHT / early-payment discount / attachment via PaymentExtras (#14 1e).
function PayTransporterDrawer({ payTransport, onClose, addToast }) {
  const { data: bankAccounts = [] } = useBankAccounts();
  const recordMut = useRecordPayment();
  const [form, setForm] = useState({
    amount: String(payTransport.outstanding || ''),
    method: 'bank_transfer',
    bankAccountId: '',
    date: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
    whtRate: '', whtAmount: '', discountAmount: '', attachmentUrl: '', attachmentName: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 bg-white';

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(form.amount) || 0;
    const wht = parseFloat(form.whtAmount) || 0;
    const disc = parseFloat(form.discountAmount) || 0;
    if (!(amt > 0)) { addToast('Enter a positive amount', 'error'); return; }
    if (amt - Number(payTransport.outstanding) > 0.01) { addToast(`Amount exceeds the outstanding ${PKR(payTransport.outstanding)}.`, 'error'); return; }
    if (wht + disc - amt > 0.01) { addToast('WHT + discount cannot exceed the amount.', 'error'); return; }
    if (!form.bankAccountId) { addToast('Select a cash or bank account', 'error'); return; }
    try {
      await recordMut.mutateAsync({
        type: 'payment', linked_payable_id: payTransport.payableId, amount: amt, currency: 'PKR',
        payment_method: form.method, bank_account_id: parseInt(form.bankAccountId, 10),
        bank_reference: form.reference || null, payment_date: form.date,
        notes: form.notes || `Transport payment — ${payTransport.haulerName || ''}`.trim(),
        wht_amount: wht, wht_rate: form.whtRate ? parseFloat(form.whtRate) : null,
        discount_amount: disc, attachment_url: form.attachmentUrl || null, attachment_name: form.attachmentName || null,
      });
      addToast('Transporter paid', 'success');
      onClose();
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Payment failed', 'error');
    }
  }

  return (
    <SlideDrawer open onClose={onClose} title={`Pay ${payTransport.haulerName || 'Transporter'}`}
      subtitle={`${payTransport.lotNo ? `Lot ${payTransport.lotNo} · ` : ''}${PKR(payTransport.outstanding)} due`} icon={Banknote} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" form="pay-transporter-form" disabled={recordMut.isPending}
            className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60">
            {recordMut.isPending ? 'Paying…' : 'Pay Transporter'}
          </button>
        </div>
      )}>
      <form id="pay-transporter-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm flex justify-between">
          <span className="text-gray-500">Outstanding</span>
          <span className="font-semibold text-amber-700">{PKR(payTransport.outstanding)}</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount to pay *</label>
          <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select value={form.method} onChange={(e) => set('method', e.target.value)} className={inp}>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inp} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cash / Bank account *</label>
          <select value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)} className={inp}>
            <option value="">Select account…</option>
            {(bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.bankName ? ` — ${a.bankName}` : ''}{a.type === 'cash' ? ' (Cash)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cheque / Transaction reference</label>
          <input type="text" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Optional" className={inp} />
        </div>
        <PaymentExtras form={form} set={set} gross={parseFloat(form.amount) || 0} addToast={addToast} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Optional" className={inp} />
        </div>
      </form>
    </SlideDrawer>
  );
}

// #14 — pay ANY Money Out payable inline (rice, milling, transport, commission,
// expenses…), from the drilled-down stream in the money-flow tab. Same
// recordPayment path as the transporter/expense drawers (cash/bank mandatory,
// full or partial); settling any payable posts the GL + moves the account.
function PayPayableDrawer({ payTarget, onClose, addToast }) {
  const { data: bankAccounts = [] } = useBankAccounts();
  const recordMut = useRecordPayment();
  const { data: payHistory, isLoading: payHistLoading } = usePayablePayments(payTarget.payableId, !!payTarget.payableId);
  const [form, setForm] = useState({
    amount: String(payTarget.outstanding || ''),
    method: 'bank_transfer',
    bankAccountId: '',
    date: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
    whtRate: '', whtAmount: '', discountAmount: '', attachmentUrl: '', attachmentName: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 bg-white';

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(form.amount) || 0;
    const wht = parseFloat(form.whtAmount) || 0;
    const disc = parseFloat(form.discountAmount) || 0;
    if (!(amt > 0)) { addToast('Enter a positive amount', 'error'); return; }
    if (amt - Number(payTarget.outstanding) > 0.01) { addToast(`Amount exceeds the outstanding ${PKR(payTarget.outstanding)}.`, 'error'); return; }
    if (wht + disc - amt > 0.01) { addToast('WHT + discount cannot exceed the amount.', 'error'); return; }
    if (!form.bankAccountId) { addToast('Select a cash or bank account', 'error'); return; }
    try {
      await recordMut.mutateAsync({
        type: 'payment', linked_payable_id: payTarget.payableId, amount: amt, currency: 'PKR',
        payment_method: form.method, bank_account_id: parseInt(form.bankAccountId, 10),
        bank_reference: form.reference || null, payment_date: form.date,
        notes: form.notes || `${payTarget.stream || 'Payable'} payment — ${payTarget.party || ''}`.trim(),
        wht_amount: wht, wht_rate: form.whtRate ? parseFloat(form.whtRate) : null,
        discount_amount: disc, attachment_url: form.attachmentUrl || null, attachment_name: form.attachmentName || null,
      });
      addToast(`Paid ${payTarget.party || 'payable'}`, 'success');
      onClose();
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Payment failed', 'error');
    }
  }

  return (
    <SlideDrawer open onClose={onClose} title={`Pay ${payTarget.party || 'Payable'}`}
      subtitle={`${payTarget.ref ? `${payTarget.ref} · ` : ''}${PKR(payTarget.outstanding)} due`} icon={Banknote} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" form="pay-payable-form" disabled={recordMut.isPending}
            className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60">
            {recordMut.isPending ? 'Paying…' : 'Record Payment'}
          </button>
        </div>
      )}>
      <form id="pay-payable-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
          {payTarget.stream && (
            <div className="flex justify-between"><span className="text-gray-500">Category</span><span className="text-gray-700">{payTarget.stream}</span></div>
          )}
          <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-semibold text-amber-700">{PKR(payTarget.outstanding)}</span></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount to pay *</label>
          <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select value={form.method} onChange={(e) => set('method', e.target.value)} className={inp}>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inp} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cash / Bank account *</label>
          <select value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)} className={inp}>
            <option value="">Select account…</option>
            {(bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.bankName ? ` — ${a.bankName}` : ''}{a.type === 'cash' ? ' (Cash)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cheque / Transaction reference</label>
          <input type="text" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Optional" className={inp} />
        </div>
        <PaymentExtras form={form} set={set} gross={parseFloat(form.amount) || 0} addToast={addToast} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Optional" className={inp} />
        </div>
        {payTarget.payableId && (
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Payment history</div>
            {payHistLoading ? (
              <div className="text-xs text-gray-400">Loading…</div>
            ) : (payHistory?.payments?.length) ? (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
                {payHistory.payments.map((h, idx) => (
                  <div key={h.id || idx} className="flex justify-between px-2.5 py-1.5">
                    <span className="text-gray-500">{fmtDate(h.paymentDate)} · {h.paymentNo || '—'}</span>
                    <span className="tabular-nums text-emerald-600">{PKR(h.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400">No payments yet.</div>
            )}
          </div>
        )}
      </form>
    </SlideDrawer>
  );
}

// other tabs) so the SAME payroll UI can be surfaced on the Head Office finance
// dashboard (/finance/payroll) — payroll is a single set of mill workers.
export default function MillFinanceDashboard({ payrollOnly = false }) {
  const { millingBatches, addToast, companyProfileData, bankAccountsList } = useApp();
  const cp = useCommodityPrices();
  const DEFAULT_PRICES = { finished: cp.finished, broken: cp.broken, bran: cp.bran, husk: cp.husk };
  const batchPrice = (b, product) => b[`${product}PricePerMT`] || DEFAULT_PRICES[product];
  const { data: directInventory = [] } = useInventory({});
  const inventory = Array.isArray(directInventory) ? directInventory : [];
  const pf = (v) => parseFloat(v) || 0;

  const inventoryValue = useMemo(() => {
    let raw = 0, fin = 0, bp = 0;
    for (const lot of inventory) {
      const qty = pf(lot.availableQty || lot.qty);
      const netKg = pf(lot.netWeightKg) || qty * 1000;
      const costKg = pf(lot.landedCostPerKg) || pf(lot.ratePerKg);
      if (lot.type === 'raw')       raw += (costKg || 150) * netKg;
      else if (lot.type === 'finished')  fin += (costKg || 190) * qty * 1000;
      else if (lot.type === 'byproduct') {
        const name = (lot.itemName || '').toLowerCase();
        const rate = name.includes('broken') ? 38 : name.includes('bran') ? 28 : 8.4;
        bp += (costKg || rate) * qty * 1000;
      }
    }
    return { raw, fin, bp, total: raw + fin + bp };
  }, [inventory]);

  const { data: vendorData } = useExpenseVendors();
  // category → [{ id, name, ... }] for the Provider dropdown
  const VENDOR_OPTIONS = useMemo(() => {
    const map = {};
    const byCat = vendorData?.byCategory || {};
    for (const cat of Object.keys(byCat)) {
      map[cat] = (byCat[cat] || []).map((v) => v.name);
    }
    return map;
  }, [vendorData]);

  const { data: expData } = useMillExpenses();
  const createExpMut = useCreateMillExpense();
  const { data: recurringData } = useRecurringExpenses();
  const recurring = recurringData?.recurring || [];
  const materializeMut = useMaterializeRecurring();
  const runDueMut = useRunDueRecurring();
  const categorizeMut = useCategorizeExpense();

  async function handleSuggestCategory() {
    const description = expForm.description?.trim();
    const vendor_name = expForm.vendor_name?.trim();
    if (!description && !vendor_name) return;
    try {
      const res = await categorizeMut.mutateAsync({ description, vendor_name });
      const d = res?.data || res;
      if (d?.aiEnabled === false) { window.alert(d.message || 'AI is off.'); return; }
      if (d?.category) {
        setExpForm(p => ({
          ...p,
          category: d.category,
          vendor_preset: '', vendor_name: '', employee_id: '',
          subcategory: (d.category !== 'salaries' && d.subcategory) ? d.subcategory : '',
        }));
      }
    } catch (e) { window.alert(`Could not suggest a category: ${e?.message || e}`); }
  }

  async function handleMaterialize(r) {
    try {
      await materializeMut.mutateAsync({ id: r.id, data: {} });
      addToast(`Posted ${r.category} ${PKR(r.amount)} for ${r.nextDue}`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }
  // Head Office ('general') vs Mill ('mill') payroll scope — the toggle. Default
  // to Head Office on the /finance/payroll view, Mill on the mill dashboard.
  const [payrollEntity, setPayrollEntity] = useState(payrollOnly ? 'general' : 'mill');
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

  const { data: lotCosts = { categories: [], grandTotal: 0 } } = useMillLotCosts();

  // ── Money In/Out + Suppliers data ──
  const { data: payablesRaw } = usePayables({});
  const payables = useMemo(() => {
    const arr = Array.isArray(payablesRaw) ? payablesRaw : (payablesRaw?.payables || []);
    return arr.filter((p) => String(p.entity || '').toLowerCase() === 'mill');
  }, [payablesRaw]);
  const { data: suppliers = [] } = useSuppliers();
  const { data: storePurchaseData } = usePurchases();
  const { data: localSalesSummary } = useLocalSalesSummary();
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const { data: localCustomers = [] } = useCustomers({ type: 'local' });
  const { data: allLocalSales = [] } = useLocalSales({ limit: 1000 });
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [payCustomer, setPayCustomer] = useState(null);
  // Pay a supplier with the same drawer the Finance dashboard uses.
  const { hasPermission, user } = useAuth();
  const canPay = hasPermission('finance', 'confirm_payment');
  // Approval workflow: only Owner / Super Admin / Finance Manager approve & pay
  // payroll runs (Mill Manager only prepares).
  // Payroll permission module (Phase 5) — replaces the old role-name checks.
  const canViewPayroll = hasPermission('payroll', 'view');
  const canPreparePayroll = hasPermission('payroll', 'create');
  const canApprovePayroll = hasPermission('payroll', 'approve'); // approve + void + schedule
  const canPayPayroll = hasPermission('payroll', 'pay');
  const canDeletePayroll = hasPermission('payroll', 'delete');
  const canExportPayroll = hasPermission('payroll', 'export');
  const [payParty, setPayParty] = useState(null);
  const [payTransport, setPayTransport] = useState(null); // #14 — Pay Transporter slider target
  const [payPayable, setPayPayable] = useState(null); // #14 — inline pay of any Money Out payable
  const [openStream, setOpenStream] = useState(null); // Money Out: expanded stream drill-down
  const [paySupplier, setPaySupplier] = useState(null);
  const [payExpense, setPayExpense] = useState(null); // pay a specific mill expense
  const [cashEntry, setCashEntry] = useState(null); // view a cash-ledger entry's voucher/receipt
  const [showNewPurchase, setShowNewPurchase] = useState(false); // mill-store purchase drawer

  // ── Cash account: actual money in/out ledger with a period filter ──
  const [cashRange, setCashRange] = useState('all'); // all | month | quarter | ytd
  const cashParams = useMemo(() => {
    if (cashRange === 'all') return {};
    const now = new Date();
    const y = now.getFullYear();
    let from;
    if (cashRange === 'month') from = new Date(y, now.getMonth(), 1);
    else if (cashRange === 'quarter') from = new Date(y, Math.floor(now.getMonth() / 3) * 3, 1);
    else from = new Date(y, 0, 1); // ytd
    return { from_date: from.toISOString().slice(0, 10) };
  }, [cashRange]);
  const { data: cashFlow } = useMillCashFlow(cashParams);
  const cashLedger = useMemo(() => {
    const rows = cashFlow?.ledger || [];
    return rows.reduce((acc, r) => {
      const prev = acc.length ? acc[acc.length - 1].balance : 0;
      acc.push({ ...r, balance: prev + (r.direction === 'in' ? r.amount_pkr : -r.amount_pkr) });
      return acc;
    }, []);
  }, [cashFlow]);
  const cashSummary = cashFlow?.summary || { cashIn: 0, cashOut: 0, net: 0, count: 0 };
  const moneyOutStreams = cashFlow?.moneyOutStreams || [];
  const moneyOutPayables = cashFlow?.moneyOutPayables || [];
  const moneyInSummary = cashFlow?.moneyInSummary || { billed: 0, collected: 0, outstanding: 0 };
  const pendingTransfers = cashFlow?.pendingTransfers || [];
  const pendingTransfersTotal = cashFlow?.pendingTransfersTotal || 0;
  const millCashBalance = cashFlow?.millCashBalance || 0;
  const acceptTransferMut = useAcceptFundTransfer();
  const { requestOwnerApproval } = useOwnerAuth();
  async function handleAcceptTransfer(t) {
    try { await requestOwnerApproval((ownerId) => acceptTransferMut.mutateAsync({ id: t.id, ownerId })); }
    catch (e) { if (e?.message !== 'Owner authorization cancelled') window.alert(e?.response?.data?.message || e?.message || 'Could not accept the transfer.'); }
  }

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
    const reason = window.prompt(`Reject the advance request for ${a.workerName}? Optional reason:`);
    if (reason === null) return;
    try { await rejectAdvanceMut.mutateAsync({ id: a.id, data: { reason } }); addToast('Advance request rejected', 'success'); }
    catch (e) { addToast(e?.response?.data?.message || e?.message || 'Could not reject the advance.', 'error'); }
  }
  async function handlePayAdvance(a) {
    try { await payAdvanceMut.mutateAsync({ id: a.id, data: {} }); addToast(`Advance of ${PKR(a.amount)} paid to ${a.workerName}`, 'success'); }
    catch (e) { addToast(e?.response?.data?.message || e?.message || 'Could not pay the advance.', 'error'); }
  }

  const expenses = expData?.expenses || [];
  const expSummary = expData?.summary || [];
  const totalOverhead = expSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const payrollSummary = payrollData?.summary || [];
  const payrollTotal = payrollData?.grandTotal || 0; // net (gross − advances) — what you pay out now
  const payrollGross = payrollData?.grandGross || 0;
  const payrollAdvances = payrollData?.grandAdvance || 0;
  const advancesOutstandingTotal = workers.reduce((s, w) => s + (parseFloat(w.advanceOutstanding) || 0), 0);
  // Multiple runs per month are allowed (pay employees separately) — track this
  // month's runs, who's still unpaid, and how much was already paid out.
  const monthRuns = payrollRuns.filter(r => r.period === payrollMonth && r.status !== 'voided');
  const isPaidStatus = (s) => s === 'paid' || s === 'posted';
  const paidThisMonth = monthRuns.filter(r => isPaidStatus(r.status)).reduce((s, r) => s + (parseFloat(r.netTotal) || 0), 0);
  const pendingRuns = monthRuns.filter(r => r.status === 'prepared' || r.status === 'approved' || r.status === 'accrued' || r.status === 'partially_paid');
  const paidCount = payrollData?.paidCount || 0;
  const unpaidNet = payrollData?.unpaidNet ?? payrollTotal;
  // "Unpaid" for preparing a NEW run = employees not already in any run this month.
  const unpaidEmployees = payrollSummary.filter(w => !w.committed && w.grossPay > 0);
  const anyUnpaid = unpaidEmployees.length > 0;

  const [activeTab, setActiveTab] = useState(payrollOnly ? 'payroll' : 'overview');
  const [openGroup, setOpenGroup] = useState(null);
  // Deep-link from the Mill Customers/Suppliers pages: ?tab=customers&customer=ID
  // (or tab=suppliers&supplier=ID) opens the right tab with the party selected.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (payrollOnly) return; // locked to the payroll tab
    const tab = searchParams.get('tab');
    if (tab && tabs.some(t => t.key === tab)) setActiveTab(tab);
    const cid = searchParams.get('customer');
    if (cid) { const c = localCustomers.find(x => String(x.id) === String(cid)); if (c) setSelectedCustomer({ id: c.id, name: c.name }); }
    const sid = searchParams.get('supplier');
    if (sid) { const s = suppliers.find(x => String(x.id) === String(sid)); if (s) setSelectedSupplier({ id: s.id, name: s.name }); }
  }, [searchParams, localCustomers, suppliers]);
  const [showExpDrawer, setShowExpDrawer] = useState(false);
  const [showWorkerDrawer, setShowWorkerDrawer] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const EMPTY_EXP = { category: 'salaries', vendor_preset: '', vendor_name: '', subcategory: '', employee_id: '', is_recurring: false, recurrence: 'monthly', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], reference: '', notes: '' };
  const [expForm, setExpForm] = useState(EMPTY_EXP);
  const EMPTY_WORKER = { id: null, name: '', role: '', entity: payrollEntity, department: '', pay_type: 'daily', daily_wage: '', monthly_salary: '', ot_rate_per_hour: '', phone: '', cnic: '', bank_name: '', bank_account_number: '', iban: '', joined_date: new Date().toISOString().split('T')[0], left_date: '', notes: '', portal_enabled: false };
  const [workerForm, setWorkerForm] = useState(EMPTY_WORKER);
  const [advanceTarget, setAdvanceTarget] = useState(null); // worker we're giving an advance to
  const [advanceForm, setAdvanceForm] = useState({ amount: '', advance_date: new Date().toISOString().split('T')[0], payment_method: 'cash', notes: '', recovery_method: 'full_next_salary', recovery_start_period: '', installment_amount: '', installment_count: '', deduction_percent: '' });
  const [deleteWorkerTarget, setDeleteWorkerTarget] = useState(null); // confirm-delete state
  const [advancesPanelWorker, setAdvancesPanelWorker] = useState(null); // view advances drawer
  const [ledgerWorker, setLedgerWorker] = useState(null); // per-employee ledger drawer

  const completed = useMemo(() => millingBatches.filter(b => b.status === 'Completed'), [millingBatches]);

  const RAW_KEYS = new Set(['rawRice', 'raw_rice', 'rawrice']);
  const getRawCost = (costs) => {
    if (!costs) return 0;
    for (const [k, v] of Object.entries(costs)) {
      if (RAW_KEYS.has(k)) return parseFloat(v) || 0;
    }
    return 0;
  };

  // A blend re-mills already-owned finished rice, so its raw_rice cost is the
  // internal value of stock already counted as raw material on its source
  // batches — excluding it stops the raw-material/cost KPIs double-counting.
  const isBlendBatch = (b) => b.processingType === 'blended';

  const kpis = useMemo(() => {
    const totalRaw = completed.reduce((s, b) => s + (isBlendBatch(b) ? 0 : getRawCost(b.costs)), 0);
    const totalOtherCosts = completed.reduce((s, b) => {
      return s + Object.entries(b.costs || {}).reduce((cs, [k, v]) => RAW_KEYS.has(k) ? cs : cs + (parseFloat(v) || 0), 0);
    }, 0);
    // Packing / bags is part of Other costs — split out so it's visible.
    const totalPacking = completed.reduce((s, b) => s + (parseFloat(b.costs?.packaging) || 0), 0);
    // Milling cost = the processing/milling fee (Rs/kg × raw qty). It lives on the
    // batch (milling_fee_per_kg), not as a milling_costs row, so the batch-cost
    // sums above miss it. Own production only — a service-milled batch's fee is
    // revenue (counted in serviceFees), not a cost.
    const totalMilling = completed.reduce((s, b) =>
      s + (b.isServiceMilling ? 0 : (parseFloat(b.millingFeePerKg) || 0) * (parseFloat(b.rawQtyMT) || 0) * 1000), 0);
    // Count only finished output NOT re-milled into a downstream blend (sellable
    // rice) — otherwise the blend's output double-counts its source batches', as
    // that rice can only be sold once.
    const sellableFinishedMT = (b) => Math.max(0, b.actualFinishedMT - (b.finishedConsumedMT || 0));
    const finishedRev = completed.reduce((s, b) => s + sellableFinishedMT(b) * batchPrice(b, 'finished'), 0);
    const byproductRev = completed.reduce((s, b) =>
      s + b.brokenMT * batchPrice(b, 'broken'), 0);
    const totalRev = finishedRev + byproductRev;
    const totalCost = totalRaw + totalMilling + totalOtherCosts + totalOverhead;
    const totalFinishedKg = completed.reduce((s, b) => s + sellableFinishedMT(b) * 1000, 0);
    const costPerKg = totalFinishedKg > 0 ? totalCost / totalFinishedKg : 0;
    return { totalRev, totalRaw, totalMilling, totalOtherCosts, totalPacking, totalCost, netProfit: totalRev - totalCost, costPerKg, finishedRev, byproductRev };
  }, [completed, totalOverhead]);

  const efficiency = useMemo(() => {
    if (completed.length === 0) return { avgYield: 0, avgWastage: 0, costPerKg: 0 };
    const totalRaw = completed.reduce((s, b) => s + b.rawQtyMT, 0);
    const totalFinished = completed.reduce((s, b) => s + b.actualFinishedMT, 0);
    const totalWastage = completed.reduce((s, b) => s + (b.wastageMT || 0), 0);
    return {
      avgYield: totalRaw > 0 ? (totalFinished / totalRaw * 100).toFixed(1) : 0,
      avgWastage: totalRaw > 0 ? (totalWastage / totalRaw * 100).toFixed(1) : 0,
      costPerKg: kpis.costPerKg.toFixed(2),
      totalRaw, totalFinished, totalWastage,
    };
  }, [completed, kpis]);

  const lossData = useMemo(() => {
    return completed.map(b => {
      const expected = b.plannedFinishedMT || b.rawQtyMT * 0.65;
      const actual = b.actualFinishedMT;
      const variance = actual - expected;
      const variancePct = expected > 0 ? (variance / expected * 100).toFixed(1) : 0;
      const flagged = parseFloat(variancePct) < -3;
      return { ...b, expected, variance, variancePct, flagged };
    }).sort((a, b) => a.variancePct - b.variancePct);
  }, [completed]);

  const margin = kpis.totalRev > 0 ? (kpis.netProfit / kpis.totalRev * 100).toFixed(1) : 0;

  // ── Money In / Out streams ──
  // Service-milling fees: batches we milled for outside clients (flagged in
  // notes by the create form). Fee = raw qty (kg) × fee/kg.
  const serviceFees = useMemo(() => millingBatches.reduce((s, b) => {
    if (!String(b.notes || '').includes('[SERVICE MILLING]')) return s;
    return s + (parseFloat(b.millingFeePerKg) || 0) * (parseFloat(b.rawQtyMT) || 0) * 1000;
  }, 0), [millingBatches]);

  // usePurchases() returns totals raw (snake_case); total_pkr spans ALL purchase
  // sources (mill store + export costs + lots), so use by_source.mill_store for
  // the mill-store consumables figure only.
  const storePurchaseTotal = parseFloat(
    storePurchaseData?.totals?.by_source?.mill_store ?? storePurchaseData?.totals?.bySource?.mill_store ?? 0
  ) || 0;
  // useLocalSalesSummary() shape: { all: { total, due }, profit: { revenue, collected } }
  const localSalesRevenue = parseFloat(
    localSalesSummary?.all?.total ?? localSalesSummary?.profit?.revenue ?? 0
  ) || 0;
  const localSalesCollected = parseFloat(localSalesSummary?.profit?.collected ?? 0) || 0;

  const moneyFlow = useMemo(() => {
    const out = {
      paddy: kpis.totalRaw,
      milling: kpis.totalMilling,
      batchCosts: kpis.totalOtherCosts,
      overhead: totalOverhead,
      payroll: payrollTotal,
      store: storePurchaseTotal,
    };
    out.total = out.paddy + out.milling + out.batchCosts + out.overhead + out.payroll + out.store;
    const inc = {
      output: kpis.totalRev,
      finished: kpis.finishedRev,
      byproduct: kpis.byproductRev,
      localSales: localSalesRevenue,
      serviceFees,
    };
    return { out, inc, netProduction: inc.output - out.total };
  }, [kpis, totalOverhead, payrollTotal, storePurchaseTotal, localSalesRevenue, serviceFees]);

  // ── Supplier directory (money owed to mill suppliers) ──
  const supplierRows = useMemo(() => {
    const map = {};
    for (const p of payables) {
      const name = p.supplierName;
      if (!name) continue;
      const key = p.supplierId || name;
      if (!map[key]) map[key] = { id: p.supplierId || null, name, billed: 0, paid: 0, outstanding: 0, count: 0 };
      map[key].billed += parseFloat(p.originalAmount) || 0;
      map[key].paid += parseFloat(p.paidAmount) || 0;
      map[key].outstanding += parseFloat(p.outstanding) || 0;
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [payables]);

  const supplierTotals = useMemo(() => supplierRows.reduce(
    (acc, r) => ({ billed: acc.billed + r.billed, paid: acc.paid + r.paid, outstanding: acc.outstanding + r.outstanding }),
    { billed: 0, paid: 0, outstanding: 0 },
  ), [supplierRows]);

  // ── Customer directory (sales billed / received / outstanding per buyer) ──
  // Mirrors supplierRows from the local-sales list: each registered local
  // customer gets their billed (sales), paid (received) and outstanding (due)
  // totals so the directory shows the money picture without drilling in. Sales
  // are matched by customer_id, or by buyer name for walk-ins that were never
  // linked (same rule the statement uses). Invoice count is distinct sale
  // groups (multi-item sales share one group).
  const customerRows = useMemo(() => {
    const byId = {};
    const byName = {};
    for (const c of localCustomers) {
      const row = { id: c.id, name: c.name, contact: c.contact || c.phone || '', country: c.country || '', billed: 0, paid: 0, outstanding: 0, _inv: new Set() };
      byId[c.id] = row;
      if (c.name) byName[c.name.trim().toLowerCase()] = row;
    }
    for (const s of allLocalSales) {
      const total = parseFloat(s.totalAmount) || 0;
      const due = parseFloat(s.dueAmount) || 0;
      let row = null;
      if (s.customerId != null) row = byId[s.customerId];
      if (!row && s.buyerName) row = byName[s.buyerName.trim().toLowerCase()];
      if (!row) continue; // unregistered walk-in — not in the directory
      row.billed += total;
      row.paid += (total - due);
      row.outstanding += due;
      row._inv.add(s.saleGroupNo || s.saleNo || s.id);
    }
    return Object.values(byId)
      .map((r) => ({ ...r, count: r._inv.size }))
      .sort((a, b) => b.outstanding - a.outstanding || b.billed - a.billed);
  }, [localCustomers, allLocalSales]);

  const customerTotals = useMemo(() => customerRows.reduce(
    (acc, r) => ({ billed: acc.billed + r.billed, paid: acc.paid + r.paid, outstanding: acc.outstanding + r.outstanding }),
    { billed: 0, paid: 0, outstanding: 0 },
  ), [customerRows]);

  function openExpDrawer(prefill) {
    setExpForm({
      ...EMPTY_EXP,
      category: prefill?.category || 'salaries',
      description: prefill?.description || '',
      amount: prefill?.amount != null ? String(prefill.amount) : '',
    });
    setShowExpDrawer(true);
  }

  async function handleAddExpense() {
    if (!expForm.amount) { addToast('Amount required', 'error'); return; }
    // Resolve the vendor: preset wins unless "Other" is picked or the
    // category has no presets, in which case fall back to free-text.
    const vendorName = (expForm.vendor_preset && expForm.vendor_preset !== '__other')
      ? expForm.vendor_preset
      : (expForm.vendor_name || null);
    const empId = (expForm.category === 'salaries' && /^\d+$/.test(expForm.employee_id)) ? Number(expForm.employee_id) : null;
    try {
      await createExpMut.mutateAsync({
        category: expForm.category,
        subcategory: expForm.subcategory || null,
        description: expForm.description,
        amount: expForm.amount,
        expense_date: expForm.expense_date,
        reference: expForm.reference,
        notes: expForm.notes,
        vendor_name: vendorName,
        employee_id: empId,
        is_recurring: !!expForm.is_recurring,
        recurrence: expForm.is_recurring ? expForm.recurrence : null,
      });
      addToast('Expense recorded — also visible on Finance dashboard', 'success');
      setShowExpDrawer(false);
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

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
    setAdvanceForm({ amount: '', advance_date: new Date().toISOString().split('T')[0], payment_method: 'cash', notes: '', recovery_method: 'full_next_salary', recovery_start_period: '', installment_amount: '', installment_count: '', deduction_percent: '' });
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
    if (!run) return;
    try {
      await deleteRunMut.mutateAsync(run.id);
      addToast(`Payroll run for ${run.period} undone — payment reversed, advances restored`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
  }

  function handlePrint() {
    // Same mask pattern as FinanceLayout — toggle body.app-print-mask
    // so the global @media print rule unhides only .print-report.
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  return (
    <div className="space-y-5 pb-4 print-report">
      {payrollOnly && (
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-700 p-5 sm:p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-80 mb-1"><Users size={13} /> Head Office · Payroll</div>
          <div className="text-2xl sm:text-3xl font-bold">Payroll Management</div>
          <div className="text-xs opacity-90 mt-1">Workers, runs, attendance, advances &amp; settlements — the same mill payroll, managed here.</div>
        </div>
      )}
      {!payrollOnly && (<>
      {/* ─── HERO BAND ─────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-700 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-80 mb-1">
              <Factory size={13} /> Mill finance · {curMonth}
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {COMPACT_PKR(kpis.netProfit)}
            </div>
            <div className="text-xs opacity-90 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                {kpis.netProfit >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                Net profit · margin {margin}%
              </span>
              <span className="opacity-70">·</span>
              <span>{completed.length} completed batches</span>
              <span className="opacity-70">·</span>
              <span>Revenue {COMPACT_PKR(kpis.totalRev)}</span>
              <span className="opacity-70">·</span>
              <span>Cost {COMPACT_PKR(kpis.totalCost)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
              title="Print this dashboard"
            >
              <Printer size={13} /> Print
            </button>
            <button
              onClick={() => openExpDrawer()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
            >
              <Plus size={13} /> Add Expense
            </button>
            <button
              onClick={() => setShowNewPurchase(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
              title="Record a mill-store / consumables purchase (bags, fuel, etc.)"
            >
              <ShoppingCart size={13} /> Add Purchase
            </button>
            <button
              onClick={() => setShowWorkerDrawer(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
            >
              <UserPlus size={13} /> Add Employee
            </button>
            <button
              onClick={() => setShowTransfer(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
              title="Send money from the Mill to Head Office"
            >
              <ArrowLeftRight size={13} /> Send to Head Office
            </button>
            <Link
              to="/finance"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <Wallet size={13} /> Finance Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* ─── FUNDS FROM HEAD OFFICE ────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 no-print">
        <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${millCashBalance < 0 ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
          <span className={`text-xs font-medium inline-flex items-center gap-1.5 ${millCashBalance < 0 ? 'text-red-700' : 'text-emerald-800'}`}><Wallet size={14} /> Mill Cash {millCashBalance < 0 ? 'overdrawn' : 'available'}</span>
          <span className={`text-lg font-bold tabular-nums ${millCashBalance < 0 ? 'text-red-700' : 'text-emerald-900'}`}>{PKR(millCashBalance)}</span>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600 inline-flex items-center gap-1.5"><Inbox size={14} className="text-amber-500" /> Awaiting acceptance</span>
          <span className="text-lg font-bold text-gray-900 tabular-nums">{PKR(pendingTransfersTotal)}</span>
        </div>
        <button onClick={() => setShowTransfer(true)}
          className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 flex items-center justify-between hover:bg-blue-100 transition-colors text-left">
          <span className="text-xs font-medium text-blue-800 inline-flex items-center gap-1.5"><ArrowLeftRight size={14} /> Send funds to Head Office</span>
          <span className="text-xs font-semibold text-blue-700">Transfer →</span>
        </button>
      </div>

      {pendingTransfers.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 no-print">
          <div className="flex items-center gap-2 mb-3">
            <Inbox className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">{pendingTransfers.length} fund transfer{pendingTransfers.length === 1 ? '' : 's'} from Head Office awaiting your acceptance</p>
              <p className="text-xs text-amber-700">Total {PKR(pendingTransfersTotal)} — accept to add it to Mill Cash so the mill can use the funds.</p>
            </div>
          </div>
          <div className="space-y-2">
            {pendingTransfers.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2 flex-wrap">
                <div className="text-xs text-gray-700 min-w-0">
                  <span className="font-semibold text-gray-900">{t.transferNo}</span> · <span className="font-medium">{PKR(t.amount)}</span>
                  {t.date && <> · {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</>}
                  <span className="text-gray-400"> · from {t.fromAccount || 'Head Office'} → {t.toAccount || 'Mill Cash'}</span>
                  {t.reference && <span className="text-gray-400"> · Ref {t.reference}</span>}
                </div>
                <button onClick={() => handleAcceptTransfer(t)} disabled={acceptTransferMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0">
                  <Check size={13} /> {acceptTransferMut.isPending ? 'Accepting…' : 'Accept funds'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── TABS — grouped into dropdowns to keep the bar short ──────── */}
      <div className="relative border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-1">
          {NAV.map((item) => {
            const cls = (active) =>
              `px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`;

            // Standalone tab (payroll is permission-gated)
            if (item.key) {
              if (item.key === 'payroll' && !canViewPayroll) return null;
              const t = tabByKey[item.key];
              const Icon = t.icon;
              return (
                <button key={item.key} onClick={() => { setActiveTab(item.key); setOpenGroup(null); }} className={cls(activeTab === item.key)}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            }

            // Dropdown group. Only render children that exist; if a group ends up
            // with a single visible child, show it as a plain tab (not a one-item
            // dropdown) — same behaviour as the Export order detail bar.
            const children = item.keys.filter((k) => tabByKey[k]);
            if (!children.length) return null;
            if (children.length === 1) {
              const t = tabByKey[children[0]];
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => { setActiveTab(t.key); setOpenGroup(null); }} className={cls(activeTab === t.key)}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            }
            const GIcon = item.icon;
            const open = openGroup === item.label;
            const active = children.includes(activeTab);
            return (
              <div key={item.label} className="relative">
                <button type="button" onClick={() => setOpenGroup(open ? null : item.label)} className={cls(active)}>
                  <GIcon className="w-4 h-4" /> {item.label}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="absolute left-0 top-full z-30 min-w-[190px] bg-white border border-gray-200 rounded-b-lg shadow-lg py-1">
                    {children.map((k) => {
                      const ct = tabByKey[k];
                      const CIcon = ct.icon;
                      return (
                        <button key={k} onClick={() => { setActiveTab(k); setOpenGroup(null); }}
                          className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left ${activeTab === k ? 'text-blue-600 bg-blue-50 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                          <CIcon className="w-4 h-4 flex-shrink-0" /> {ct.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {openGroup && <div className="fixed inset-0 z-20" onClick={() => setOpenGroup(null)} />}
      </div>

      </>)}

      {/* ─── OVERVIEW ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Top KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat tone="blue"   icon={TrendingUp}   label="Revenue"        value={PKR(kpis.totalRev)}   sub={`Finished ${COMPACT_PKR(kpis.finishedRev)}`} />
            <Stat tone="red"    icon={TrendingDown} label="Raw Material"   value={PKR(kpis.totalRaw)}   sub="Rice purchase" />
            <Stat tone="purple" icon={Factory}      label="Milling Cost"   value={PKR(kpis.totalMilling)} sub="Processing fee" />
            <Stat tone="amber"  icon={DollarSign}   label="Operating"      value={PKR(kpis.totalOtherCosts + totalOverhead)} sub={`Batch ${COMPACT_PKR(kpis.totalOtherCosts)} · OH ${COMPACT_PKR(totalOverhead)}`} />
            <Stat tone={kpis.netProfit >= 0 ? 'green' : 'red'} icon={TrendingUp} label="Net Profit" value={PKR(kpis.netProfit)} sub={`Margin ${margin}%`} />
            <Stat tone="slate"  icon={DollarSign}   label="Cost/kg"        value={`Rs ${kpis.costPerKg.toFixed(2)}`} sub="All-in" />
            <Stat tone="purple" icon={Package}      label="Inventory"      value={PKR(inventoryValue.total)} sub={`Raw ${COMPACT_PKR(inventoryValue.raw)}`} />
          </div>

          {/* Inventory breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tone="amber"  label="Raw Rice"      value={PKR(inventoryValue.raw)} sub={`${(inventory.filter(i => i.type === 'raw').reduce((s, i) => s + pf(i.qty), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`} />
            <Stat tone="green"  label="Finished Rice" value={PKR(inventoryValue.fin)} sub={`${(inventory.filter(i => i.type === 'finished').reduce((s, i) => s + pf(i.availableQty), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`} />
            <Stat tone="purple" label="Byproducts"    value={PKR(inventoryValue.bp)}  sub={`${(inventory.filter(i => i.type === 'byproduct').reduce((s, i) => s + pf(i.availableQty), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`} />
            <Stat tone="blue"   label="Working Cap."  value={PKR(inventoryValue.total)} sub="Locked in stock" />
          </div>

          {/* Net profit & margin breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">Net Profit &amp; Margin</h3>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${kpis.netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                Margin {margin}%
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-1.5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Revenue</span><span className="tabular-nums text-emerald-600">{PKR(kpis.totalRev)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Finished rice (sellable)</span><span className="tabular-nums">{PKR(kpis.finishedRev)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>By-products</span><span className="tabular-nums">{PKR(kpis.byproductRev)}</span></div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Costs</span><span className="tabular-nums text-red-600">{PKR(kpis.totalCost)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Raw material</span><span className="tabular-nums">−{PKR(kpis.totalRaw)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Milling cost</span><span className="tabular-nums">−{PKR(kpis.totalMilling)}</span></div>
                {(kpis.totalOtherCosts - kpis.totalPacking) > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Batch costs</span><span className="tabular-nums">−{PKR(kpis.totalOtherCosts - kpis.totalPacking)}</span></div>
                )}
                {kpis.totalPacking > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Packing / bags</span><span className="tabular-nums">−{PKR(kpis.totalPacking)}</span></div>
                )}
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Overhead</span><span className="tabular-nums">−{PKR(totalOverhead)}</span></div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Net Profit</span>
              <span className={`text-lg font-bold tabular-nums ${kpis.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{PKR(kpis.netProfit)}</span>
            </div>
            {payrollTotal > 0 && (
              <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                <span>After payroll (−{PKR(payrollTotal)})</span>
                <span className="tabular-nums">{PKR(kpis.netProfit - payrollTotal)}</span>
              </div>
            )}
          </div>

          {/* AI Anomaly Watch */}
          <AnomalyWatchCard />

          {/* Expense breakdown + Payroll summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Expense Breakdown</h3>
                <span className="text-xs text-gray-400">Total {COMPACT_PKR(totalOverhead)}</span>
              </div>
              <div className="space-y-2">
                {expSummary.length === 0 ? (
                  <p className="text-sm text-gray-400">No expenses recorded yet. Click <span className="font-medium text-gray-600">Add Expense</span> on the header.</p>
                ) : (
                  expSummary.map(e => {
                    const pct = totalOverhead > 0 ? (parseFloat(e.total) / totalOverhead * 100) : 0;
                    return (
                      <div key={e.category}>
                        <div className="flex items-center justify-between text-sm mb-0.5">
                          <span className="capitalize text-gray-700">{e.category}</span>
                          <span className="font-medium text-gray-900 tabular-nums">{PKR(parseFloat(e.total))}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Payroll · {curMonth}</h3>
                <span className="text-xs text-gray-400">{payrollSummary.length} employees</span>
              </div>
              {payrollSummary.length === 0 ? (
                <p className="text-sm text-gray-400">No employees added yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm pb-2 border-b border-gray-100">
                    <span className="text-gray-600">Monthly total</span>
                    <span className="font-semibold text-gray-900">{PKR(payrollTotal)}</span>
                  </div>
                  {payrollSummary.slice(0, 5).map(w => (
                    <div key={w.id} className="flex justify-between text-xs text-gray-500">
                      <span>{w.name} <span className="text-gray-400">({w.effectiveDays}d)</span></span>
                      <span className="tabular-nums">{PKR(w.totalPay)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── MONEY IN / OUT ────────────────────────────────────────── */}
      {activeTab === 'moneyflow' && (
        <div className="space-y-5">
          {/* Period filter */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700">Mill cash account — money in &amp; out</h3>
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
              {[['all', 'All'], ['ytd', 'YTD'], ['quarter', 'Quarter'], ['month', 'This month']].map(([k, l]) => (
                <button key={k} onClick={() => setCashRange(k)}
                  className={`px-2.5 py-1 text-xs rounded-md ${cashRange === k ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
              ))}
            </div>
          </div>

          {/* Realized cash summary */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cash in (received)" value={PKR(cashSummary.cashIn)} sub="receipts" tone="green" icon={ArrowDownRight} />
            <Stat label="Cash out (paid)" value={PKR(cashSummary.cashOut)} sub="payments made" tone="red" icon={ArrowUpRight} />
            <Stat label="Net cash flow" value={PKR(cashSummary.net)} sub={`${cashSummary.count} transaction(s)`} tone={cashSummary.net >= 0 ? 'green' : 'red'} icon={Wallet} />
          </div>

          {/* Money OUT — paid vs outstanding */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpRight size={15} className="text-red-500" />
              <h3 className="text-sm font-semibold text-gray-700">Money out — paid vs outstanding</h3>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {moneyOutStreams.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-400">No mill payables.</div>
              ) : moneyOutStreams.map((s) => {
                const pct = s.billed > 0 ? Math.round((s.paid / s.billed) * 100) : 0;
                const rows = moneyOutPayables.filter((p) => p.stream === s.stream);
                const isOpen = openStream === s.stream;
                const canExpand = rows.length > 0;
                return (
                  <div key={s.stream}>
                    <button type="button" disabled={!canExpand}
                      onClick={() => setOpenStream(isOpen ? null : s.stream)}
                      className={`w-full text-left p-3 ${canExpand ? 'hover:bg-gray-50/60 cursor-pointer' : 'cursor-default'}`}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-800 flex items-center gap-1.5">
                          {canExpand && <ChevronRight size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                          {s.stream}
                          {canExpand && <span className="text-[11px] font-normal text-gray-400">({rows.length} unpaid)</span>}
                        </span>
                        <span className="text-gray-500 text-xs">{PKR(s.billed)} billed</span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-amber-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px]">
                        <span className="text-emerald-600">{PKR(s.paid)} paid ({pct}%)</span>
                        <span className="text-amber-600">{PKR(s.outstanding)} outstanding</span>
                      </div>
                    </button>
                    {isOpen && canExpand && (
                      <div className="bg-gray-50/70 border-t border-gray-100 divide-y divide-gray-100">
                        {rows.map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 pl-8 text-sm">
                            <div className="min-w-0">
                              <div className="text-gray-800 truncate">{p.party}</div>
                              <div className="text-[11px] text-gray-400">
                                {p.category}{p.ref ? ` · ${p.ref}` : ''}
                                {p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ''}
                                {p.paid > 0 ? ` · ${PKR(p.paid)} paid` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="tabular-nums text-amber-700 font-medium">{PKR(p.outstanding)}</span>
                              {canPay && (
                                <button type="button"
                                  onClick={() => setPayPayable({ payableId: p.id, party: p.party, outstanding: p.outstanding, ref: p.ref, stream: p.stream })}
                                  className="px-2.5 py-1 text-xs text-white bg-emerald-600 rounded-md hover:bg-emerald-700">Pay</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">Click a stream to see and pay each unpaid bill.</p>
          </div>

          {/* Money IN — local sales collected vs outstanding */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownRight size={15} className="text-emerald-500" />
              <h3 className="text-sm font-semibold text-gray-700">Money in — local sales (collected vs outstanding)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Sales billed" value={COMPACT_PKR(moneyInSummary.billed)} tone="slate" icon={Receipt} />
              <Stat label="Collected" value={COMPACT_PKR(moneyInSummary.collected)} tone="green" icon={Banknote} />
              <Stat label="Outstanding" value={COMPACT_PKR(moneyInSummary.outstanding)} tone={moneyInSummary.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
            </div>
          </div>

          {/* Cash ledger */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Banknote size={15} className="text-indigo-500" />
              <h3 className="text-sm font-semibold text-gray-700">Cash ledger</h3>
              <span className="text-xs text-gray-400">— actual money in &amp; out, running balance</span>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
              {cashLedger.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No cash transactions in this period.</div>
              ) : (
                <table className="w-full text-sm mobile-cards">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-3 py-2">Date</th>
                      <th className="text-left font-medium px-3 py-2">Description</th>
                      <th className="text-left font-medium px-3 py-2">Method</th>
                      <th className="text-right font-medium px-3 py-2">Out</th>
                      <th className="text-right font-medium px-3 py-2">In</th>
                      <th className="text-right font-medium px-3 py-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cashLedger.map((r) => (
                      <tr key={`${r.direction}-${r.id}`} onClick={() => setCashEntry(r)} className="hover:bg-gray-50/60 cursor-pointer" title="View voucher / receipt">
                        <td data-label="Date" className="px-3 py-1.5 whitespace-nowrap text-gray-600">{fmtDate(r.payment_date)}</td>
                        <td data-label="Description" className="px-3 py-1.5">
                          <span className="text-gray-800">{r.counterparty || '—'}</span>
                          <span className="text-[10px] text-gray-400 ml-1.5">{r.category}{r.ref ? ` · ${r.ref}` : ''}</span>
                        </td>
                        <td data-label="Method" className="mob-hide px-3 py-1.5 text-gray-500 capitalize">{r.payment_method || '—'}</td>
                        <td data-label="Out" className="px-3 py-1.5 text-right tabular-nums text-red-600">{r.direction === 'out' ? PKR(r.amount_pkr) : ''}</td>
                        <td data-label="In" className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{r.direction === 'in' ? PKR(r.amount_pkr) : ''}</td>
                        <td data-label="Balance" className={`px-3 py-1.5 text-right tabular-nums ${r.balance < 0 ? 'text-red-700' : 'text-gray-800'}`}>{PKR(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Production value (accrual) — kept separate from cash */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Factory size={15} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-700">Production value <span className="text-xs font-normal text-gray-400">— accrual, not cash</span></h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat label="Output value produced" value={COMPACT_PKR(moneyFlow.inc.output)} sub="finished + byproducts" tone="slate" icon={Wallet} />
              <Stat label="Finished rice value" value={COMPACT_PKR(moneyFlow.inc.finished)} tone="slate" icon={TrendingUp} />
              <Stat label="Byproduct value" value={COMPACT_PKR(moneyFlow.inc.byproduct)} sub="broken, powder, sweeping" tone="slate" icon={Package} />
              <Stat label="Mill costs (accrued)" value={COMPACT_PKR(moneyFlow.out.total)} sub="rice + milling + overhead" tone="slate" icon={Receipt} />
              <Stat label="Net production margin" value={COMPACT_PKR(moneyFlow.netProduction)} sub={`${margin}% margin`} tone={moneyFlow.netProduction >= 0 ? 'green' : 'red'} icon={Factory} />
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Production value is rice produced at confirmed prices (accrual). The cash ledger above is money actually received and paid.
            </p>
          </div>
        </div>
      )}

      {/* ─── SUPPLIERS ─────────────────────────────────────────────── */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Mill suppliers" value={supplierRows.length} sub="with mill payables" tone="slate" icon={Building2} />
            <Stat label="Total billed" value={COMPACT_PKR(supplierTotals.billed)} sub={`${COMPACT_PKR(supplierTotals.paid)} paid`} tone="blue" icon={Receipt} />
            <Stat label="Outstanding" value={COMPACT_PKR(supplierTotals.outstanding)} tone={supplierTotals.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
          </div>

          {/* Pick any supplier to view their statement */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any supplier statement</p>
            <SearchSelect
              value={selectedSupplier?.id || ''}
              onChange={(val) => {
                const s = suppliers.find((x) => String(x.id) === String(val));
                setSelectedSupplier(s ? { id: s.id, name: s.name } : null);
              }}
              options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.location || s.city || s.country || '' }))}
              placeholder="Search suppliers…"
            />
          </div>

          {/* Inline statement */}
          {selectedSupplier?.id && (
            <div className="space-y-2">
              {canPay && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setPaySupplier({ id: selectedSupplier.id, name: selectedSupplier.name })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
                  >
                    <Banknote size={14} /> Record Payment
                  </button>
                </div>
              )}
              <MillSupplierStatement
                supplierId={selectedSupplier.id}
                supplierName={selectedSupplier.name}
                onClose={() => setSelectedSupplier(null)}
              />
            </div>
          )}

          {/* Directory */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Mill supplier directory</h3>
              <p className="text-[11px] text-gray-400">Click a supplier to see its statement of money owed & paid.</p>
            </div>
            <div className="overflow-x-auto">
              {supplierRows.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No mill supplier payables yet.</div>
              ) : (
                <table className="w-full text-sm mobile-cards">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-4 py-2">Supplier</th>
                      <th className="text-right font-medium px-4 py-2">Invoices</th>
                      <th className="text-right font-medium px-4 py-2">Billed</th>
                      <th className="text-right font-medium px-4 py-2">Paid</th>
                      <th className="text-right font-medium px-4 py-2">Outstanding</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierRows.map((r) => (
                      <tr
                        key={r.id || r.name}
                        className={`hover:bg-blue-50/40 ${r.id ? 'cursor-pointer' : ''} ${selectedSupplier?.id === r.id ? 'bg-blue-50/60' : ''}`}
                        onClick={() => r.id && setSelectedSupplier({ id: r.id, name: r.name })}
                      >
                        <td data-label="Supplier" className="px-4 py-2 font-medium text-gray-800">{r.name}</td>
                        <td data-label="Invoices" className="mob-hide px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                        <td data-label="Billed" className="px-4 py-2 text-right tabular-nums text-gray-700">{PKR(r.billed)}</td>
                        <td data-label="Paid" className="mob-hide px-4 py-2 text-right tabular-nums text-emerald-600">{PKR(r.paid)}</td>
                        <td data-label="Outstanding" className={`px-4 py-2 text-right tabular-nums font-medium ${r.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{PKR(r.outstanding)}</td>
                        <td data-label="" className="px-2 py-2 text-right whitespace-nowrap">
                          {canPay && r.id && r.outstanding > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPaySupplier({ id: r.id, name: r.name }); }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium mr-2"
                            >
                              <Banknote size={12} /> Pay
                            </button>
                          )}
                          {r.id && <span className="text-blue-500 text-xs">View →</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── CUSTOMERS (local sales) ────────────────────────────────── */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Local customers" value={localCustomers.length} sub="local-sales buyers" tone="slate" icon={Users} />
            <Stat label="Total billed" value={COMPACT_PKR(customerTotals.billed)} sub={`${COMPACT_PKR(customerTotals.paid)} received`} tone="blue" icon={Receipt} />
            <Stat label="Outstanding" value={COMPACT_PKR(customerTotals.outstanding)} sub="owed to mill" tone={customerTotals.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
          </div>

          {/* Pick any customer to view their statement */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any customer statement</p>
            <SearchSelect
              value={selectedCustomer?.id || ''}
              onChange={(val) => {
                const c = localCustomers.find((x) => String(x.id) === String(val));
                setSelectedCustomer(c ? { id: c.id, name: c.name } : null);
              }}
              options={localCustomers.map((c) => ({ value: c.id, label: c.name, sub: c.country || c.port || '' }))}
              placeholder="Search customers…"
            />
          </div>

          {/* Inline statement */}
          {selectedCustomer?.id && (
            <div className="space-y-2">
              {canPay && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setPayCustomer({ id: selectedCustomer.id, name: selectedCustomer.name })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
                  >
                    <Banknote size={14} /> Record Payment
                  </button>
                </div>
              )}
              <MillCustomerStatement
                customerId={selectedCustomer.id}
                customerName={selectedCustomer.name}
                onClose={() => setSelectedCustomer(null)}
              />
            </div>
          )}

          {/* Directory */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Local customer directory</h3>
              <p className="text-[11px] text-gray-400">Click a customer to see their statement of sales & receipts.</p>
            </div>
            <div className="overflow-x-auto">
              {customerRows.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No local customers yet.</div>
              ) : (
                <table className="w-full text-sm mobile-cards">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-4 py-2">Customer</th>
                      <th className="text-right font-medium px-4 py-2">Invoices</th>
                      <th className="text-right font-medium px-4 py-2">Billed</th>
                      <th className="text-right font-medium px-4 py-2">Received</th>
                      <th className="text-right font-medium px-4 py-2">Outstanding</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customerRows.map((r) => (
                      <tr key={r.id}
                        className={`cursor-pointer hover:bg-blue-50/40 ${selectedCustomer?.id === r.id ? 'bg-blue-50/60' : ''}`}
                        onClick={() => setSelectedCustomer({ id: r.id, name: r.name })}>
                        <td data-label="Customer" className="px-4 py-2 font-medium text-gray-900">
                          {r.name}
                          {(r.contact || r.country) && (
                            <span className="block text-[10px] text-gray-400 font-normal">{[r.contact, r.country].filter(Boolean).join(' · ')}</span>
                          )}
                        </td>
                        <td data-label="Invoices" className="mob-hide px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                        <td data-label="Billed" className="px-4 py-2 text-right tabular-nums text-gray-700">{PKR(r.billed)}</td>
                        <td data-label="Received" className="mob-hide px-4 py-2 text-right tabular-nums text-emerald-600">{PKR(r.paid)}</td>
                        <td data-label="Outstanding" className={`px-4 py-2 text-right tabular-nums font-medium ${r.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{PKR(r.outstanding)}</td>
                        <td data-label="" className="px-2 py-2 text-right whitespace-nowrap">
                          {canPay && r.outstanding > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPayCustomer({ id: r.id, name: r.name }); }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium mr-2"
                            >
                              <Banknote size={12} /> Pay
                            </button>
                          )}
                          <span className="text-blue-500 text-xs">View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── EXPENSES ──────────────────────────────────────────────── */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              All mill expenses flow into the main Finance dashboard, Money Out, and GL.
            </p>
            <button onClick={() => openExpDrawer()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">
              <Plus className="w-3.5 h-3.5" /> Add Expense
            </button>
          </div>
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
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${(e.paymentStatus === 'Paid') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {e.paymentStatus || 'Pending'}
                      </span>
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
        </div>
      )}

      {/* ─── RECURRING ─────────────────────────────────────────────── */}
      {activeTab === 'recurring' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-500">Expenses you marked recurring. These auto-post daily once due (accrued as a payable + GL); use the button below to catch up every missed period now.</p>
            {recurring.some(r => r.due) && (
              <button
                onClick={async () => { const r = await runDueMut.mutateAsync(); window.alert(`Auto-posted ${r?.created ?? r?.processed ?? 0} due recurring expense(s).`); }}
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
                        {fmtDate(r.nextDue)}
                        {r.due && <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-100 text-amber-700 uppercase">Due</span>}
                      </span>
                    </td>
                    <td data-label="Action" className="px-4 py-3 text-right no-print">
                      <button
                        onClick={() => handleMaterialize(r)}
                        disabled={!r.due || materializeMut.isPending}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg ${r.due ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} disabled:opacity-60`}
                      >
                        {r.due ? 'Post now' : 'Not due'}
                      </button>
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
            "Post now" creates the next expense dated at its due date and rolls the schedule forward. A series is keyed by category + payee + cadence; editing an occurrence's amount changes the next one too.
          </p>
        </div>
      )}

      {/* ─── ADDITIONAL COSTS (traceability) ───────────────────────── */}
      {activeTab === 'addcosts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Lot additional costs</h3>
              <p className="text-xs text-gray-500">Transport, labor, unloading, packing, bag &amp; other — itemised and traced to the source lot.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total recorded</p>
              <p className="text-lg font-bold text-gray-900">{PKR(lotCosts.grandTotal)}</p>
            </div>
          </div>

          {(!lotCosts.categories || lotCosts.categories.length === 0) ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">No additional costs recorded on any lot yet.</div>
          ) : (
            <div className="space-y-3">
              {lotCosts.categories.map((cat) => (
                <div key={cat.key} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                      {cat.key === 'transport' ? <Truck size={15} className="text-indigo-500 shrink-0" /> : <Layers size={15} className="text-gray-400 shrink-0" />}
                      <span className="font-semibold text-gray-800 text-sm">{cat.label}</span>
                      <span className="text-[11px] text-gray-400">{cat.count} lot{cat.count === 1 ? '' : 's'}</span>
                      {cat.inCogs
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">in rice cost</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">hauler payable</span>}
                    </div>
                    <span className="font-bold text-gray-900 text-sm tabular-nums">{PKR(cat.total)}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {cat.lots.map((l) => (
                      <div key={l.lotId} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                        <Link to={`/lot-inventory/${l.lotNo}`} className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0">
                          {l.lotNo}<ExternalLink size={11} />
                        </Link>
                        <div className="flex items-center gap-3 min-w-0">
                          {cat.key === 'transport' && (
                            l.unassigned
                              ? <span className="text-[11px] text-amber-600 whitespace-nowrap">no hauler set</span>
                              : <span className="text-[11px] text-gray-500 truncate">{l.haulerName || '—'}{l.outstanding > 0 ? ` · ${PKR(l.outstanding)} due` : ' · paid'}</span>
                          )}
                          {/* #14 — pay the transporter right here (opens a slider that
                              records against the real transporter payable). */}
                          {cat.key === 'transport' && canPay && l.payableId && l.outstanding > 0 && (
                            <button onClick={() => setPayTransport({ payableId: l.payableId, haulerName: l.haulerName, outstanding: l.outstanding, lotNo: l.lotNo })}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium shrink-0">
                              <Banknote size={11} /> Pay
                            </button>
                          )}
                          <span className="font-medium text-gray-900 tabular-nums shrink-0">{PKR(l.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-gray-400">In-rice-cost items are part of finished COGS (inside Raw Material). Transport is a separate payable owed to the hauler.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── EFFICIENCY ────────────────────────────────────────────── */}
      {activeTab === 'efficiency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat tone="green" icon={TrendingUp}    label="Avg Recovery"  value={`${efficiency.avgYield}%`}    sub="Finished / Raw" />
            <Stat tone="red"   icon={AlertTriangle} label="Avg Wastage"   value={`${efficiency.avgWastage}%`}  sub="Waste / Raw" />
            <Stat tone="blue"  icon={DollarSign}    label="Cost per KG"   value={`Rs ${efficiency.costPerKg}`} sub="All-in finished" />
            <Stat tone="slate" icon={Factory}       label="Batches"       value={completed.length}             sub={`${Math.round((efficiency.totalRaw || 0) * 1000).toLocaleString()} kg processed`} />
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm mobile-cards">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Batch</th>
                  <th className="text-right px-4 py-3 font-medium">Raw kg</th>
                  <th className="text-right px-4 py-3 font-medium">Finished kg</th>
                  <th className="text-right px-4 py-3 font-medium">Yield %</th>
                  <th className="text-right px-4 py-3 font-medium">Wastage %</th>
                  <th className="text-right px-4 py-3 font-medium">Cost/KG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {completed.map(b => {
                  const totalCost = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
                  const costKg = b.actualFinishedMT > 0 ? totalCost / (b.actualFinishedMT * 1000) : 0;
                  const wastePct = b.rawQtyMT > 0 ? ((b.wastageMT || 0) / b.rawQtyMT * 100).toFixed(1) : 0;
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td data-label="Batch" className="px-4 py-3 font-medium"><Link to={`/milling/${b.id}`} className="text-blue-600">{b.id}</Link></td>
                      <td data-label="Raw kg" className="mob-hide px-4 py-3 text-right tabular-nums">{Math.round(b.rawQtyKg).toLocaleString()}</td>
                      <td data-label="Finished kg" className="px-4 py-3 text-right tabular-nums">{Math.round(b.actualFinishedKg).toLocaleString()}</td>
                      <td data-label="Yield %" className="px-4 py-3 text-right font-medium tabular-nums">{b.yieldPct}%</td>
                      <td data-label="Wastage %" className="px-4 py-3 text-right text-red-600 tabular-nums">{wastePct}%</td>
                      <td data-label="Cost/KG" className="px-4 py-3 text-right tabular-nums">Rs {costKg.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {completed.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No completed batches yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── LOSS & THEFT ──────────────────────────────────────────── */}
      {activeTab === 'loss' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
            <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Batches flagged when actual output is more than 3% below expected. May indicate loss, theft, or measurement errors.</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm mobile-cards">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Batch</th>
                  <th className="text-right px-4 py-3 font-medium">Raw kg</th>
                  <th className="text-right px-4 py-3 font-medium">Expected</th>
                  <th className="text-right px-4 py-3 font-medium">Actual</th>
                  <th className="text-right px-4 py-3 font-medium">Var kg</th>
                  <th className="text-right px-4 py-3 font-medium">Var %</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lossData.map(b => (
                  <tr key={b.id} className={`hover:bg-gray-50 ${b.flagged ? 'bg-red-50/50' : ''}`}>
                    <td data-label="Batch" className="px-4 py-3 font-medium"><Link to={`/milling/${b.id}`} className="text-blue-600">{b.id}</Link></td>
                    <td data-label="Raw kg" className="mob-hide px-4 py-3 text-right tabular-nums">{Math.round(b.rawQtyKg).toLocaleString()}</td>
                    <td data-label="Expected" className="px-4 py-3 text-right tabular-nums">{Math.round(b.expected * 1000).toLocaleString()}</td>
                    <td data-label="Actual" className="px-4 py-3 text-right tabular-nums">{Math.round(b.actualFinishedKg).toLocaleString()}</td>
                    <td data-label="Var kg" className={`px-4 py-3 text-right font-medium tabular-nums ${b.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{b.variance > 0 ? '+' : ''}{Math.round(b.variance * 1000).toLocaleString()}</td>
                    <td data-label="Var %" className={`px-4 py-3 text-right font-medium tabular-nums ${parseFloat(b.variancePct) < -3 ? 'text-red-600' : 'text-gray-600'}`}>{b.variancePct}%</td>
                    <td data-label="Status" className="px-4 py-3 text-center">
                      {b.flagged
                        ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[11px] font-medium">Investigate</span>
                        : <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[11px] font-medium">Normal</span>}
                    </td>
                  </tr>
                ))}
                {lossData.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No completed batches yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── PAYROLL ───────────────────────────────────────────────── */}
      {activeTab === 'payroll' && (() => {
        const payById = new Map(payrollSummary.map(p => [p.id, p]));
        return (
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
                  <Icon className="w-3.5 h-3.5" /> {label}
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
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${RUN_STATUS_TONE[r.status] || 'bg-amber-100 text-amber-700'}`}>{String(r.status).replace('_', ' ')}</span>
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
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">paid</span>
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
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-blue-100 text-blue-700">Approved</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-amber-100 text-amber-700">Pending approval</span>}
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60"><Banknote className="w-3.5 h-3.5" /> Pay now</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 uppercase">Paid</span>
                        : (p ? PKR(p.netPay) : '—')}
                    </td>
                    <td data-label="Actions" className="px-4 py-3 no-print">
                      <div className="flex items-center justify-end gap-1">
                        {canPreparePayroll && p && !p.committed && p.grossPay > 0 && (
                          <button title="Prepare for this employee" onClick={() => openRunDrawer(w.id)} className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"><Wallet className="w-3.5 h-3.5" /></button>
                        )}
                        {canPreparePayroll && <button title="Give advance" onClick={() => openAdvanceDrawer(w)} className="p-1.5 rounded-md text-amber-600 hover:bg-amber-50"><HandCoins className="w-3.5 h-3.5" /></button>}
                        {canPreparePayroll && <button title="Bonuses & deductions" onClick={() => setAdjustWorker(w)} className="p-1.5 rounded-md text-violet-600 hover:bg-violet-50"><Plus className="w-3.5 h-3.5" /></button>}
                        {canPreparePayroll && <button title="Revise salary" onClick={() => setReviseWorker(w)} className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50"><TrendingUp className="w-3.5 h-3.5" /></button>}
                        {canPreparePayroll && <button title="Edit" onClick={() => openWorkerDrawer(w)} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canPayPayroll && w.isActive && <button title="Final settlement" onClick={() => setSettleWorker(w)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50"><LogOut className="w-3.5 h-3.5" /></button>}
                        {canPreparePayroll && <button title={w.isActive ? 'Deactivate' : 'Reactivate'} onClick={() => handleToggleActive(w)} className={`p-1.5 rounded-md hover:bg-gray-100 ${w.isActive ? 'text-gray-500' : 'text-emerald-600'}`}><Power className="w-3.5 h-3.5" /></button>}
                        {canDeletePayroll && <button title="Delete" onClick={() => setDeleteWorkerTarget(w)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>}
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
        );
      })()}

      {/* ─── UTILITIES ─────────────────────────────────────────────── */}
      {activeTab === 'utilities' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex items-start gap-2">
            <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Track electricity, water, gas, and diesel via the <span className="font-medium">Add Expense</span> action.</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['utilities', 'fuel', 'maintenance', 'rent'].map(cat => {
              const catTotal = expenses.filter(e => e.category === cat).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              return <Stat key={cat} tone="blue" icon={Zap} label={cat.charAt(0).toUpperCase() + cat.slice(1)} value={PKR(catTotal)} sub="Total recorded" />;
            })}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm mobile-cards">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td data-label="Date" className="px-4 py-3 text-gray-600">{e.expenseDate}</td>
                    <td data-label="Category" className="px-4 py-3 capitalize">{e.category}</td>
                    <td data-label="Description" className="mob-hide px-4 py-3 text-gray-600">{e.description || '—'}</td>
                    <td data-label="Amount" className="px-4 py-3 text-right font-medium tabular-nums">{PKR(parseFloat(e.amount))}</td>
                  </tr>
                ))}
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">No utility expenses recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── ADD EXPENSE DRAWER ────────────────────────────────────── */}
      <SlideDrawer
        open={showExpDrawer}
        onClose={() => setShowExpDrawer(false)}
        title="Add Mill Expense"
        subtitle="Flows into Finance Dashboard, Money Out, and GL"
        icon={TrendingDown}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowExpDrawer(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleAddExpense}
              disabled={createExpMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {createExpMut.isPending ? 'Saving…' : 'Save Expense'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
              <select
                value={expForm.category}
                onChange={e => setExpForm(p => ({ ...p, category: e.target.value, vendor_preset: '', vendor_name: '', subcategory: '', employee_id: '' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) *</label>
              <input
                type="number" min="0" step="0.01"
                value={expForm.amount}
                onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
              />
            </div>
          </div>

          {/* ─── Dynamic fields per category ─────────────────────── */}
          {expForm.category === 'salaries' ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">Employee <span className="text-gray-400 font-normal">· who is this salary for?</span></label>
              <select
                value={expForm.employee_id}
                onChange={e => {
                  const id = e.target.value;
                  const w = workers.find(x => String(x.id) === id);
                  setExpForm(p => ({ ...p, employee_id: id, vendor_name: id === '__other' ? '' : (w?.name || '') }));
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                <option value="">Select employee…</option>
                {workers.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}{w.role ? ` · ${w.role}` : ''}</option>)}
                <option value="__other">Other (contractor / batch)</option>
              </select>
              {expForm.employee_id === '__other' && (
                <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                  placeholder="e.g. external contractor / May payroll batch"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" autoFocus />
              )}
              <p className="text-[11px] text-gray-400">For monthly payroll across all staff, use <span className="font-medium">Payroll → Post Payroll Run</span> instead.</p>
            </div>
          ) : (
            <>
              {VENDOR_OPTIONS[expForm.category] ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-600">
                    Provider <span className="text-gray-400 font-normal">· common {expForm.category} providers</span>
                  </label>
                  <select
                    value={expForm.vendor_preset}
                    onChange={e => setExpForm(p => ({ ...p, vendor_preset: e.target.value, vendor_name: '' }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
                  >
                    <option value="">Select a provider…</option>
                    {VENDOR_OPTIONS[expForm.category].map(v => <option key={v} value={v}>{v}</option>)}
                    <option value="__other">Other (specify below)</option>
                  </select>
                  {expForm.vendor_preset === '__other' && (
                    <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                      placeholder="Enter provider name" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" autoFocus />
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Vendor / Payee <span className="text-gray-400 font-normal">· optional</span></label>
                  <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                    placeholder="Who is being paid?" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
                </div>
              )}

              {/* Category-specific detail → subcategory */}
              {CAT_DETAIL[expForm.category] && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{CAT_DETAIL[expForm.category].label} <span className="text-gray-400 font-normal">· optional</span></label>
                  {CAT_DETAIL[expForm.category].options ? (
                    <select value={expForm.subcategory} onChange={e => setExpForm(p => ({ ...p, subcategory: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white">
                      <option value="">Select…</option>
                      {CAT_DETAIL[expForm.category].options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={expForm.subcategory} onChange={e => setExpForm(p => ({ ...p, subcategory: e.target.value }))}
                      placeholder={CAT_DETAIL[expForm.category].placeholder} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
                  )}
                </div>
              )}
            </>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-600">Description</label>
              <button
                type="button"
                onClick={handleSuggestCategory}
                disabled={categorizeMut.isPending || !(expForm.description?.trim() || expForm.vendor_name?.trim())}
                title="Let AI pick the category from the description"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-40"
              >
                <Sparkles className={`w-3 h-3 ${categorizeMut.isPending ? 'animate-pulse' : ''}`} /> {categorizeMut.isPending ? 'Thinking…' : 'Suggest category'}
              </button>
            </div>
            <input
              type="text"
              value={expForm.description}
              onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))}
              placeholder="e.g. March electricity bill"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={expForm.expense_date}
                onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
              <input
                type="text"
                value={expForm.reference}
                onChange={e => setExpForm(p => ({ ...p, reference: e.target.value }))}
                placeholder="Invoice or bill #"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              rows={2}
              value={expForm.notes}
              onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          {/* ─── Recurring ───────────────────────────────────────── */}
          <div className="rounded-lg border border-gray-200 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={expForm.is_recurring} onChange={e => setExpForm(p => ({ ...p, is_recurring: e.target.checked }))} className="rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-gray-400" /> Recurring expense</span>
            </label>
            {expForm.is_recurring && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Repeats</span>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  {RECURRENCES.map(r => (
                    <button key={r} type="button" onClick={() => setExpForm(p => ({ ...p, recurrence: r }))}
                      className={`px-2.5 py-1 text-xs rounded-md capitalize ${expForm.recurrence === r ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>{r}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
            Saving creates a <span className="font-medium">business_expense</span> + <span className="font-medium">payable</span> + journal entry. The expense becomes payable on Money Out.
          </div>
        </div>
      </SlideDrawer>

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
                  placeholder="4–8 digit PIN"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
                />
                <button
                  disabled={!workerForm.cnic || portalPin.length < 4 || setPinMut.isPending}
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

      {/* ─── SEND FUNDS DRAWER (mill can only send to Head Office) ──── */}
      <TransferFundsDrawer open={showTransfer} onClose={() => setShowTransfer(false)} lockDirection="mill_to_ho" />

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
                if (advanceForm.recovery_method === 'full_next_salary') line = `Recovery: full Rs ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from the next payroll.`;
                else if (advanceForm.recovery_method === 'manual') line = 'Recovery: admin enters the deduction manually each payroll.';
                else if (advanceForm.recovery_method === 'fixed_installment') {
                  const inst = parseFloat(advanceForm.installment_amount) || 0;
                  const cnt = parseInt(advanceForm.installment_count, 10) || (inst > 0 ? Math.ceil(amt / inst) : 0);
                  if (inst > 0 && cnt > 0) line = `Recovery: Rs ${inst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per month for ${cnt} month(s)${advanceForm.recovery_start_period ? `, from ${advanceForm.recovery_start_period}` : ''}.`;
                } else if (advanceForm.recovery_method === 'salary_percentage') {
                  const pct = parseFloat(advanceForm.deduction_percent) || 0;
                  if (pct > 0) line = `Recovery: ${pct}% of each salary${advanceForm.recovery_start_period ? `, from ${advanceForm.recovery_start_period}` : ''}, until Rs ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is recovered.`;
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
          onUndo={(run) => { setPayslipsRunId(null); handleDeleteRun(run); }}
          onApprove={async (run) => { try { await approveRunMut.mutateAsync(run.id); addToast('Payroll run approved', 'success'); } catch (e) { addToast(e.message, 'error'); } }}
          onPay={async (run, lineIds) => { try { const res = await payRunMut.mutateAsync(lineIds && lineIds.length ? { id: run.id, lineIds } : run.id); const st = res?.data?.run?.status; addToast(st === 'partially_paid' ? 'Selected employees paid — run partially paid' : `Payroll paid — ${PKR(run.netTotal)}`, 'success'); } catch (e) { addToast(e.message, 'error'); } }}
          onVoid={async (run) => { try { await voidRunMut.mutateAsync({ id: run.id, reason: null }); addToast('Payroll run voided', 'success'); setPayslipsRunId(null); } catch (e) { addToast(e.message, 'error'); } }}
          onAccrue={async (run) => { try { await accrueRunMut.mutateAsync(run.id); addToast(`Payroll accrued — ${PKR(run.netTotal)} booked to Salaries Payable`, 'success'); } catch (e) { addToast(e.message, 'error'); } }}
          onSettle={async (run) => { try { await settleRunMut.mutateAsync(run.id); addToast(`Accrued payroll settled — ${PKR(run.netTotal)} paid`, 'success'); } catch (e) { addToast(e.message, 'error'); } }}
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

      {/* Pay a supplier — same drawer the Finance dashboard uses. */}
      {payParty && (
        <StatementPayDrawer
          mode="supplier"
          party={payParty}
          onClose={() => setPayParty(null)}
        />
      )}

      {/* #14 — Pay Transporter: settle a transporter payable straight from the
          Mill Finance cost breakdown (cash/bank, full or partial). */}
      {payTransport && (
        <PayTransporterDrawer
          payTransport={payTransport}
          onClose={() => setPayTransport(null)}
          addToast={addToast}
        />
      )}

      {/* Inline-pay any Money Out payable drilled down from a stream. */}
      {payPayable && (
        <PayPayableDrawer
          payTarget={payPayable}
          onClose={() => setPayPayable(null)}
          addToast={addToast}
        />
      )}

      {/* Record a customer receipt against a specific invoice. */}
      {payCustomer && (
        <MillCustomerPayDrawer
          customer={payCustomer}
          onClose={() => setPayCustomer(null)}
        />
      )}

      {/* Pay a supplier against a specific invoice. */}
      {paySupplier && (
        <MillSupplierPayDrawer
          supplier={paySupplier}
          onClose={() => setPaySupplier(null)}
        />
      )}

      {/* Pay a specific mill expense (electricity, fuel, salaries, …). */}
      <ExpensePayDrawer expense={payExpense} bankAccounts={bankAccountsList} companyProfile={companyProfileData} addToast={addToast} onClose={() => setPayExpense(null)} />

      {/* View a cash-ledger entry's voucher (out) or receipt (in), downloadable. */}
      <CashEntryDrawer entry={cashEntry} companyProfile={companyProfileData} onClose={() => setCashEntry(null)} />

      {/* Record a mill-store / consumables purchase (bags, fuel, …). */}
      <NewPurchaseDrawer open={showNewPurchase} onClose={() => setShowNewPurchase(false)} />
    </div>
  );
}

// Pay a single mill expense — mirrors the Finance → Money Out payable drawer:
// amount summary, details, payments-made history, a printable voucher/invoice
// (TransactionDocument), and the payment form. Pays the expense's linked payable
// via recordPayment (which also marks the business_expense Paid + moves the bank).
const EXP_METHOD_LABEL = { bank_transfer: 'Bank Transfer', cheque: 'Cheque', cash: 'Cash', online: 'Online', mobile: 'Mobile' };
function ExpensePayDrawer({ expense, bankAccounts = [], companyProfile, addToast, onClose }) {
  const recordMut = useRecordPayment();
  const payableId = expense?.payableId || null;
  const { data: payHistory, isLoading: payHistLoading } = usePayablePayments(payableId, !!payableId);
  const total = expense ? (parseFloat(expense.payableOriginal) || parseFloat(expense.amount) || 0) : 0;
  const paid = expense ? (parseFloat(expense.payablePaid) || 0) : 0;
  const outstanding = expense ? (expense.payableOutstanding != null ? parseFloat(expense.payableOutstanding) : Math.max(0, total - paid)) : 0;
  const status = expense?.payableStatus || expense?.paymentStatus || 'Pending';
  const [form, setForm] = useState({ amount: '', bankAccountId: '', paymentMethod: 'cash', paymentDate: new Date().toISOString().split('T')[0], chequeNo: '', dueDate: '', notes: '' });
  useEffect(() => {
    if (expense) setForm({ amount: String(Math.round(outstanding) || ''), bankAccountId: '', paymentMethod: 'cash', paymentDate: new Date().toISOString().split('T')[0], chequeNo: '', dueDate: '', notes: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense]);
  if (!expense) return null;
  const PKR = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Mill cash payments are drawn from the dedicated Mill Cash account so they
  // reduce "Mill Cash available" on the dashboard (and go negative when the mill
  // has spent more than it holds — a signal it needs funding from Head Office).
  const millCash = bankAccounts.find(a => a.type === 'cash' && a.entity === 'mill')
    || bankAccounts.find(a => a.type === 'cash');

  // Voucher/invoice payload (same shape TransactionDocument uses on Money Out).
  const voucher = {
    payNo: expense.payNo || expense.expenseNo, category: expense.category, entity: expense.payableEntity || 'mill',
    originalAmount: total, paidAmount: paid, outstanding, supplierId: expense.payableSupplierId || expense.supplierId,
    supplierName: expense.vendorName || expense.supplierName || expense.employeeName || expense.linkedRef,
    linkedRef: expense.linkedRef, currency: 'PKR', status, description: expense.description, date: expense.expenseDate,
  };

  async function pay(e) {
    e?.preventDefault?.();
    const amt = parseFloat(form.amount);
    if (!(amt > 0)) { addToast?.('Enter a valid amount', 'error'); return; }
    if (!payableId) { addToast?.('This expense has no payable to settle.', 'error'); return; }
    try {
      // Mill Finance pays only from Mill Cash — never from a Head Office bank account.
      await recordMut.mutateAsync({
        type: 'payment', amount: amt, currency: 'PKR',
        payment_method: 'cash', payment_date: form.paymentDate,
        bank_account_id: millCash?.id || null, bank_reference: null,
        due_date: form.dueDate || null, linked_payable_id: payableId,
        notes: form.notes || `Payment for ${voucher.payNo} — ${expense.description || expense.category}`,
      });
      addToast?.(`Payment of ${PKR(amt)} recorded — ${expense.description || expense.category}`, 'success');
      onClose();
    } catch (err) { addToast?.(`Failed: ${err?.data?.message || err.message || 'Payment failed'}`, 'error'); }
  }

  const footer = status !== 'Paid' && outstanding > 0 ? (
    <div className="flex justify-end gap-2">
      <button onClick={onClose} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
      <button onClick={pay} disabled={recordMut.isPending} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
        <Banknote className="w-4 h-4" /> {recordMut.isPending ? 'Recording…' : 'Record Payment'}
      </button>
    </div>
  ) : null;

  return (
    <SlideDrawer open={!!expense} onClose={onClose} title={voucher.payNo || 'Pay Expense'} subtitle={expense.description || expense.category} icon={Banknote} size="lg" footer={footer}>
      <div className="space-y-4">
        {/* Amount summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Original</p><p className="text-sm font-semibold">{PKR(total)}</p></div>
          <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Paid</p><p className="text-sm font-semibold text-emerald-700">{PKR(paid)}</p></div>
          <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Outstanding</p><p className="text-sm font-semibold text-red-700">{PKR(outstanding)}</p></div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Category</p><p className="capitalize">{expense.category}</p></div>
          <div><p className="text-xs text-gray-500">Vendor / Ref</p><p>{voucher.supplierName || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Date</p><p>{expense.expenseDate || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={status} /></div>
        </div>

        {/* Payments made */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Payments Made</h3>
          {payHistLoading ? <p className="text-xs text-gray-400 py-2">Loading payments…</p>
            : (payHistory?.payments?.length ? (
              <div className="space-y-2">
                {payHistory.payments.map((p, idx) => {
                  let from = [p.accountName, p.bankName].filter(Boolean).join(' · ');
                  if (!from) from = p.paymentMethod === 'cash' ? 'Cash (in hand)' : '—';
                  return (
                    <div key={p.id || idx} className="border border-gray-200 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-emerald-700">{PKR(p.amount)}</span>
                        <span className="text-xs text-gray-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                        <span>Method: <span className="font-medium text-gray-700">{EXP_METHOD_LABEL[p.paymentMethod] || p.paymentMethod || '—'}</span></span>
                        <span>From: <span className="font-medium text-gray-700">{from}</span></span>
                        {p.bankReference && <span>Ref: <span className="font-medium text-gray-700">{p.bankReference}</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-400 py-2">No payments recorded yet.</p>)}
        </div>

        {/* Printable voucher / invoice */}
        <div className="pt-2 border-t border-gray-100">
          <TransactionDocument kind="voucher" data={voucher} companyProfile={companyProfile} />
        </div>

        {/* Payment form */}
        {status !== 'Paid' && outstanding > 0 && (
          <form onSubmit={pay} className="pt-3 border-t border-gray-200 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Banknote size={15} /> Record Payment</h3>
            <div className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-800">
              Paid from <span className="font-semibold">{millCash?.name || 'Mill Cash'}</span>
              {millCash ? <> · balance {PKR(millCash.currentBalance)}</> : null}
              {millCash && (parseFloat(millCash.currentBalance) || 0) - (parseFloat(form.amount) || 0) < 0 && (
                <span className="block text-amber-700 mt-0.5">This will overdraw Mill Cash — fund it from Head Office to clear the negative.</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Amount (Rs)</label>
                <input type="number" step="0.01" required value={form.amount} max={outstanding} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Payment Date</label>
                <input type="date" required value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" /></div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          </form>
        )}
      </div>
    </SlideDrawer>
  );
}

// View a single cash-ledger entry (money in/out) as a downloadable voucher
// (payment) or receipt (money in). Read-only — these are settled cash movements.
function CashEntryDrawer({ entry, companyProfile, onClose }) {
  if (!entry) return null;
  const PKR = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isIn = entry.direction === 'in';
  const amount = parseFloat(entry.amount_pkr) || 0;
  // Build the doc model TransactionDocument expects (voucher for out, receipt for in).
  const docData = isIn
    ? { recvNo: entry.ref || entry.payment_no, customerName: entry.counterparty, type: entry.category, currency: 'PKR', dueDate: entry.payment_date, expectedAmount: amount, receivedAmount: amount, outstanding: 0, status: 'Received', items: entry.items || [] }
    : { payNo: entry.ref || entry.payment_no, supplierName: entry.counterparty, category: entry.category, linkedRef: entry.linked_ref || entry.ref, entity: 'mill', currency: 'PKR', dueDate: entry.payment_date, originalAmount: amount, paidAmount: amount, outstanding: 0, status: 'Paid', items: entry.items || [] };
  return (
    <SlideDrawer open={!!entry} onClose={onClose} title={isIn ? 'Money In' : 'Money Out'} subtitle={entry.counterparty || entry.category} icon={isIn ? ArrowDownRight : ArrowUpRight} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Date</p><p>{entry.payment_date ? new Date(entry.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</p></div>
          <div><p className="text-xs text-gray-500">{isIn ? 'Received from' : 'Paid to'}</p><p className="font-medium">{entry.counterparty || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Category</p><p className="capitalize">{entry.category || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Method</p><p className="capitalize">{entry.payment_method || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Reference</p><p>{entry.ref || entry.payment_no || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Amount</p><p className={`font-semibold ${isIn ? 'text-emerald-700' : 'text-red-600'}`}>{isIn ? '+' : '−'}{PKR(amount)}</p></div>
        </div>
        <div className="pt-2 border-t border-gray-100">
          <TransactionDocument kind={isIn ? 'receipt' : 'voucher'} data={docData} companyProfile={companyProfile} />
        </div>
      </div>
    </SlideDrawer>
  );
}

// Monthly attendance register — rows = active employees, columns = each day of
// the month. Click a cell to cycle Present → Half-day → Leave → Absent. Feeds the
// payroll summary's effective-days math. Posts via the existing /attendance upsert.
const ATT_ORDER = ['present', 'half_day', 'leave', 'absent', 'off'];
const ATT_LETTER = { present: 'P', half_day: 'H', leave: 'L', absent: 'A', off: 'O' };
const ATT_STYLE = {
  present: 'bg-emerald-500 text-white',
  half_day: 'bg-amber-400 text-white',
  leave: 'bg-sky-400 text-white',
  absent: 'bg-red-400 text-white',
  off: 'bg-slate-400 text-white',
};
const ATT_LABEL = { present: 'Present', half_day: 'Half day', leave: 'Leave', absent: 'Absent', off: 'Off / holiday' };
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function EmployeeAttendanceGrid({ month, employees, recordAttMut, addToast }) {
  const { data: records = [], isLoading } = useAttendance({ month });
  const bulkMut = useBulkAttendance();
  const { data: holidays = [] } = useAttendanceHolidays(month);
  const [optimistic, setOptimistic] = useState({}); // `${id}|${date}` → status ('' = cleared) until refetch
  const [selDays, setSelDays] = useState(() => new Set());   // selected date columns
  const [selEmps, setSelEmps] = useState(() => new Set());   // selected employee rows (empty = all)
  const [showHolidays, setShowHolidays] = useState(false);
  const [holExcluded, setHolExcluded] = useState(() => new Set()); // holiday dates the user unticked
  const [showImport, setShowImport] = useState(false);

  const active = employees.filter(e => e.isActive);
  const activeIds = active.map(e => e.id);
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const dow = (d) => new Date(`${d}T00:00:00`).getDay();
  const isSunday = (d) => dow(d) === 0;
  const holidayByDate = {};
  for (const h of holidays) holidayByDate[String(h.date).slice(0, 10)] = h;

  const fetchedMap = {};
  for (const r of records) {
    const d = String(r.date).slice(0, 10);
    fetchedMap[`${r.workerId}|${d}`] = { status: r.status, overtimeHours: r.overtimeHours };
  }
  const statusOf = (id, date) => optimistic[`${id}|${date}`] ?? fetchedMap[`${id}|${date}`]?.status ?? null;

  async function cycle(emp, date) {
    const cur = statusOf(emp.id, date);
    const next = cur ? ATT_ORDER[(ATT_ORDER.indexOf(cur) + 1) % ATT_ORDER.length] : 'present';
    const key = `${emp.id}|${date}`;
    setOptimistic(o => ({ ...o, [key]: next }));
    try {
      await recordAttMut.mutateAsync({
        worker_id: emp.id, date, status: next,
        hours_worked: next === 'half_day' ? 4 : next === 'present' ? 8 : 0,
        overtime_hours: fetchedMap[key]?.overtimeHours || 0,
      });
      setOptimistic(o => { const n = { ...o }; delete n[key]; return n; });
    } catch (e) {
      setOptimistic(o => { const n = { ...o }; delete n[key]; return n; });
      addToast(e.message, 'error');
    }
  }

  // Apply one status across (dates × employees) in a single bulk call.
  async function bulkApply(targetDates, targetEmpIds, status, label) {
    const ds = [...targetDates], ids = targetEmpIds.length ? targetEmpIds : activeIds;
    if (!ds.length || !ids.length) return;
    const records2 = [], optim = {};
    for (const id of ids) for (const d of ds) {
      records2.push({ worker_id: id, date: d, status });
      optim[`${id}|${d}`] = status === 'clear' ? '' : status;
    }
    setOptimistic(o => ({ ...o, ...optim }));
    try {
      await bulkMut.mutateAsync({ records: records2 });
      setOptimistic(o => { const n = { ...o }; for (const k of Object.keys(optim)) delete n[k]; return n; });
      addToast(label || `${records2.length} cell(s) updated`, 'success');
    } catch (e) {
      setOptimistic(o => { const n = { ...o }; for (const k of Object.keys(optim)) delete n[k]; return n; });
      addToast(e.message, 'error');
    }
  }

  const toggleDay = (d) => setSelDays(s => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const toggleEmp = (id) => setSelEmps(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => { setSelDays(new Set()); setSelEmps(new Set()); };

  function applySelected(status) {
    const empIds = [...selEmps];
    bulkApply([...selDays], empIds, status,
      `${selDays.size} day(s)${empIds.length ? ` × ${empIds.length} emp` : ' · all'} → ${status === 'clear' ? 'cleared' : ATT_LABEL[status]}`);
    clearSel();
  }
  function markSundaysOff() {
    bulkApply(dates.filter(isSunday), activeIds, 'off', 'Sundays marked off');
  }
  function applyHolidays() {
    const pick = holidays.map(h => String(h.date).slice(0, 10)).filter(d => !holExcluded.has(d));
    if (!pick.length) { addToast('No holidays selected', 'error'); return; }
    bulkApply(pick, activeIds, 'off', `${pick.length} holiday(s) marked off`);
    setShowHolidays(false);
  }

  const effectiveDays = (emp) => dates.reduce((s, d) => {
    const st = statusOf(emp.id, d);
    return s + (st === 'present' ? 1 : st === 'half_day' ? 0.5 : 0);
  }, 0);
  // Total OT hours logged this month for an employee (from saved attendance).
  const otHours = (emp) => dates.reduce((s, d) => s + (parseFloat(fetchedMap[`${emp.id}|${d}`]?.overtimeHours) || 0), 0);
  const [otWorker, setOtWorker] = useState(null); // open the OT editor for this worker

  // Aggregate attendance stats for the summary strip.
  const stat = active.reduce((a, emp) => {
    for (const d of dates) { const st = statusOf(emp.id, d); if (st === 'present') a.present += 1; else if (st === 'half_day') a.half += 1; else if (st === 'absent') a.absent += 1; else if (st === 'leave') a.leave += 1; }
    a.ot += otHours(emp); return a;
  }, { present: 0, half: 0, absent: 0, leave: 0, ot: 0 });
  const markedCells = stat.present + stat.half + stat.absent + stat.leave;
  const attendanceRate = markedCells > 0 ? Math.round(((stat.present + stat.half * 0.5) / markedCells) * 100) : 0;

  if (active.length === 0) {
    return <div className="bg-white rounded-xl border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">No active employees to mark attendance for.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Attendance summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Sm label="Employees" value={String(active.length)} />
        <Sm label="Present days" value={String(stat.present)} tone="emerald" />
        <Sm label="Half days" value={String(stat.half)} tone="amber" />
        <Sm label="Absent / leave" value={`${stat.absent} / ${stat.leave}`} tone="rose" />
        <Sm label="Attendance %" value={`${attendanceRate}%`} />
        <Sm label="Overtime hrs" value={`${Math.round(stat.ot * 10) / 10}`} tone="amber" />
      </div>

      {/* Toolbar: quick actions + legend */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={markSundaysOff} disabled={bulkMut.isPending} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            <CalendarDays className="w-3.5 h-3.5" /> Mark Sundays Off
          </button>
          <button onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
            <FileText className="w-3.5 h-3.5" /> Import CSV
          </button>
          <div className="relative">
            <button onClick={() => setShowHolidays(s => !s)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
              <Receipt className="w-3.5 h-3.5" /> 🇵🇰 Pakistan Holidays{holidays.length ? ` (${holidays.length})` : ''}
            </button>
            {showHolidays && (
              <div className="absolute z-30 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
                <div className="font-medium text-gray-700 mb-1.5">Federal holidays · {month}</div>
                {holidays.length === 0 ? (
                  <p className="text-gray-400 py-2">No federal holidays this month. Mark any day off via the grid or selection.</p>
                ) : (<>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {holidays.map(h => {
                      const d = String(h.date).slice(0, 10);
                      const checked = !holExcluded.has(d);
                      return (
                        <label key={d} className="flex items-center gap-2 py-0.5 cursor-pointer">
                          <input type="checkbox" checked={checked} onChange={() => setHolExcluded(s => { const n = new Set(s); checked ? n.add(d) : n.delete(d); return n; })} className="rounded border-gray-300" />
                          <span className="text-gray-700">{d.slice(8)} · {h.name}{h.approximate ? <span className="text-amber-500"> ~</span> : ''}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">~ Islamic dates are moon-sighting — verify the announced date.</p>
                  <button onClick={applyHolidays} disabled={bulkMut.isPending} className="mt-2 w-full px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Mark selected as Off</button>
                </>)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-gray-500 flex-wrap">
          {ATT_ORDER.map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`w-3.5 h-3.5 rounded-sm inline-flex items-center justify-center text-[9px] font-bold ${ATT_STYLE[s]}`}>{ATT_LETTER[s]}</span>
              {ATT_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Click a cell to cycle status. Click <span className="font-medium">date headers</span> (and optionally <span className="font-medium">employee names</span>) to select, then apply a status to many at once.</p>

      {/* Bulk action bar — appears when day columns are selected */}
      {selDays.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between flex-wrap gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-xs text-blue-800 font-medium">
            {selDays.size} day{selDays.size > 1 ? 's' : ''} {selEmps.size ? `× ${selEmps.size} employee${selEmps.size > 1 ? 's' : ''}` : '· all employees'} selected
          </span>
          <div className="flex items-center gap-1">
            {ATT_ORDER.map(s => (
              <button key={s} onClick={() => applySelected(s)} disabled={bulkMut.isPending}
                className={`px-2 py-1 rounded text-[11px] font-bold ${ATT_STYLE[s]} disabled:opacity-50`} title={ATT_LABEL[s]}>{ATT_LETTER[s]}</button>
            ))}
            <button onClick={() => applySelected('clear')} disabled={bulkMut.isPending} className="px-2 py-1 rounded text-[11px] font-medium bg-white text-gray-600 border border-gray-300 hover:bg-gray-50">Clear</button>
            <button onClick={clearSel} className="ml-1 p-1 text-blue-400 hover:text-blue-700"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">Loading attendance…</p>
        ) : (
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 font-medium min-w-[150px]">Employee</th>
              {dates.map(d => {
                const sel = selDays.has(d);
                const hol = holidayByDate[d];
                return (
                  <th key={d} className={`px-0 py-1 font-medium text-center w-7 ${sel ? 'bg-blue-100' : isSunday(d) ? 'bg-red-50' : ''}`}>
                    <button onClick={() => toggleDay(d)} title={`${d}${hol ? ` · ${hol.name}` : ''} — click to select`} className={`w-full leading-tight ${sel ? 'text-blue-700' : isSunday(d) || hol ? 'text-red-500' : 'text-gray-400'}`}>
                      <div className="text-[8px]">{WEEKDAY[dow(d)]}</div>
                      <div className="text-[10px] font-semibold">{d.slice(8)}</div>
                      {hol && <div className="text-[7px] leading-none text-amber-500">★</div>}
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2 font-medium text-right min-w-[64px]">Days</th>
              <th className="px-3 py-2 font-medium text-right min-w-[64px] no-print">OT hrs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {active.map(emp => {
              const empSel = selEmps.has(emp.id);
              return (
              <tr key={emp.id} className={`hover:bg-gray-50/50 ${empSel ? 'bg-blue-50/40' : ''}`}>
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                  <button onClick={() => toggleEmp(emp.id)} title="Click to select this employee for bulk actions" className={`font-medium ${empSel ? 'text-blue-700' : 'text-gray-800 hover:text-blue-600'}`}>
                    {empSel ? '☑ ' : ''}{emp.name}
                  </button>
                </td>
                {dates.map(d => {
                  const st = statusOf(emp.id, d);
                  const colSel = selDays.has(d);
                  return (
                    <td key={d} className={`px-0 py-1 text-center ${colSel ? 'bg-blue-50' : isSunday(d) ? 'bg-red-50/40' : ''}`}>
                      <button
                        onClick={() => cycle(emp, d)}
                        title={`${emp.name} · ${d}${st ? ` · ${ATT_LABEL[st]}` : ''}`}
                        className={`w-6 h-6 rounded text-[10px] font-bold transition ${st ? ATT_STYLE[st] : 'bg-gray-100 text-gray-300 hover:bg-gray-200'}`}
                      >
                        {st ? ATT_LETTER[st] : ''}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-800">{effectiveDays(emp)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums no-print">
                  <button onClick={() => setOtWorker(emp)} title="Log overtime hours" className={`px-1.5 py-0.5 rounded text-xs font-medium ${otHours(emp) > 0 ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-blue-600 hover:bg-blue-50'}`}>
                    {otHours(emp) > 0 ? `${Math.round(otHours(emp) * 10) / 10}h` : '+ OT'}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
      {otWorker && (
        <OvertimeEditor worker={otWorker} dates={dates} statusOf={statusOf}
          otFor={(d) => parseFloat(fetchedMap[`${otWorker.id}|${d}`]?.overtimeHours) || 0}
          recordAttMut={recordAttMut} addToast={addToast} onClose={() => setOtWorker(null)} />
      )}
      {showImport && (
        <AttendanceImportDrawer employees={active} month={month} addToast={addToast} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}

// Bulk CSV attendance import (Phase 21). Parses a CSV client-side, matches each
// row to a worker (CNIC, else name), validates date+status, previews matched vs
// errored rows, then upserts via /attendance/import (status + hours + OVERTIME).
const ATT_STATUS_MAP = { p: 'present', present: 'present', a: 'absent', absent: 'absent', h: 'half_day', half: 'half_day', half_day: 'half_day', 'half day': 'half_day', hd: 'half_day', l: 'leave', leave: 'leave', o: 'off', off: 'off', holiday: 'off' };
function parseCsv(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = []; let cur = ''; let q = false;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (q) { if (c === '"' && raw[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((s) => s.trim()));
  }
  return rows;
}
function normalizeDate(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}
function AttendanceImportDrawer({ employees, month, addToast, onClose }) {
  const importMut = useImportAttendance();
  const [parsed, setParsed] = useState(null); // { valid:[], errors:[] }
  const [fileName, setFileName] = useState('');

  const byCnic = new Map(employees.filter((e) => e.cnic).map((e) => [String(e.cnic).replace(/\s/g, ''), e]));
  const byName = new Map(employees.map((e) => [String(e.name).trim().toLowerCase(), e]));

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(reader.result);
      if (!rows.length) { setParsed({ valid: [], errors: [] }); return; }
      // header detection
      const header = rows[0].map((h) => h.toLowerCase());
      const col = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
      const ci = { cnic: col('cnic'), name: col('name', 'employee', 'worker'), date: col('date'), status: col('status', 'attendance'), ot: col('overtime', 'ot') };
      const hasHeader = ci.date >= 0 || ci.status >= 0 || ci.cnic >= 0;
      const body = hasHeader ? rows.slice(1) : rows;
      if (!hasHeader) { ci.cnic = 0; ci.name = 1; ci.date = 2; ci.status = 3; ci.ot = 4; }
      const valid = []; const errors = [];
      body.forEach((r, idx) => {
        const rowNo = (hasHeader ? idx + 2 : idx + 1);
        const cnicV = ci.cnic >= 0 ? String(r[ci.cnic] || '').replace(/\s/g, '') : '';
        const nameV = ci.name >= 0 ? String(r[ci.name] || '').trim().toLowerCase() : '';
        const w = (cnicV && byCnic.get(cnicV)) || (nameV && byName.get(nameV)) || null;
        const date = normalizeDate(r[ci.date]);
        const status = ATT_STATUS_MAP[String(r[ci.status] || '').trim().toLowerCase()];
        const ot = Math.max(0, parseFloat(r[ci.ot]) || 0);
        if (!w) { errors.push({ row: rowNo, reason: `No match for "${r[ci.cnic] || r[ci.name] || '?'}"` }); return; }
        if (!date) { errors.push({ row: rowNo, reason: `Bad date "${r[ci.date] || ''}"` }); return; }
        if (!status) { errors.push({ row: rowNo, reason: `Bad status "${r[ci.status] || ''}"` }); return; }
        valid.push({ row: rowNo, worker_id: w.id, workerName: w.name, date, status, overtime_hours: ot });
      });
      setParsed({ valid, errors });
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!parsed?.valid.length) return;
    try {
      const res = await importMut.mutateAsync({ records: parsed.valid.map(({ row, worker_id, date, status, overtime_hours }) => ({ row, worker_id, date, status, overtime_hours })) });
      const d = res?.data || res;
      addToast(`Imported ${d.imported} row(s)${d.skipped ? `, ${d.skipped} skipped` : ''}`, d.skipped ? 'info' : 'success');
      onClose();
    } catch (e) { addToast(e.message, 'error'); }
  }

  function downloadTemplate() {
    const sample = employees.slice(0, 2);
    const rows = [['CNIC', 'Name', 'Date', 'Status', 'Overtime']];
    sample.forEach((e) => rows.push([e.cnic || '', e.name, `${month}-01`, 'present', '0']));
    if (!sample.length) rows.push(['35201-0000000-0', 'Worker Name', `${month}-01`, 'present', '2']);
    const csv = rows.map((r) => r.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `attendance-template-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <SlideDrawer open onClose={onClose} title="Import attendance (CSV)" subtitle="Status + overtime for many employees at once" icon={FileText} size="lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          CSV columns: <b>CNIC</b> (or Name), <b>Date</b> (YYYY-MM-DD or DD/MM/YYYY), <b>Status</b> (present / absent / half_day / leave / off — P/A/H/L/O also work), <b>Overtime</b> (hours). Existing days are updated; overtime is set per row.
          <button onClick={downloadTemplate} className="ml-1 underline font-medium">Download template</button>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files[0])} className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-900 file:text-white hover:file:bg-gray-700" />
          {fileName && <span className="text-[11px] text-gray-400">{fileName}</span>}
        </label>

        {parsed && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-50 p-2.5"><div className="text-[10px] uppercase text-emerald-500">Ready to import</div><div className="text-lg font-bold text-emerald-700">{parsed.valid.length}</div></div>
              <div className="rounded-lg bg-red-50 p-2.5"><div className="text-[10px] uppercase text-red-500">Errors (skipped)</div><div className="text-lg font-bold text-red-700">{parsed.errors.length}</div></div>
            </div>
            {parsed.valid.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs mobile-cards">
                  <thead><tr className="bg-gray-50 text-gray-500"><th className="text-left px-3 py-1.5">Employee</th><th className="text-left px-3 py-1.5">Date</th><th className="text-left px-3 py-1.5">Status</th><th className="text-right px-3 py-1.5">OT</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsed.valid.slice(0, 60).map((v, i) => (
                      <tr key={i}><td data-label="OT" data-label="Status" data-label="Date" data-label="Employee" className="px-3 py-1 text-gray-800">{v.workerName}</td><td className="px-3 py-1 text-gray-500">{v.date}</td><td className="px-3 py-1 capitalize">{v.status.replace('_', ' ')}</td><td className="px-3 py-1 text-right tabular-nums">{v.overtime_hours || ''}</td></tr>
                    ))}
                  </tbody>
                </table>
                {parsed.valid.length > 60 && <div className="px-3 py-1.5 text-[11px] text-gray-400">+ {parsed.valid.length - 60} more…</div>}
              </div>
            )}
            {parsed.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-700 space-y-0.5 max-h-40 overflow-auto">
                {parsed.errors.slice(0, 30).map((e, i) => <div key={i}>Row {e.row}: {e.reason}</div>)}
                {parsed.errors.length > 30 && <div className="text-red-400">+ {parsed.errors.length - 30} more…</div>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={doImport} disabled={!parsed.valid.length || importMut.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Import {parsed.valid.length} row(s)</button>
            </div>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}

// Per-employee overtime editor — set OT hours on the month's present/half days
// (with a "set all" quick action). Posts via the attendance upsert; OT pay is
// valued at the worker's ot_rate_per_hour (or 1.5× hourly) in payroll.
function OvertimeEditor({ worker, dates, statusOf, otFor, recordAttMut, addToast, onClose }) {
  const workDays = dates.filter(d => ['present', 'half_day'].includes(statusOf(worker.id, d)));
  const [otMap, setOtMap] = useState(() => Object.fromEntries(workDays.map(d => [d, String(otFor(d) || '')])));
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);
  const dailyWage = parseFloat(worker.dailyWage) || (parseFloat(worker.monthlySalary) || 0) / 26;
  const otRate = parseFloat(worker.otRatePerHour) > 0 ? parseFloat(worker.otRatePerHour) : (dailyWage / 8 * 1.5);
  const totalOt = Object.values(otMap).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const setAll = () => { const v = bulk; setOtMap(Object.fromEntries(workDays.map(d => [d, v]))); };

  async function save() {
    setSaving(true);
    try {
      for (const d of workDays) {
        const v = Math.max(0, parseFloat(otMap[d]) || 0);
        if (v === (otFor(d) || 0)) continue; // unchanged
        await recordAttMut.mutateAsync({ worker_id: worker.id, date: d, status: statusOf(worker.id, d), hours_worked: statusOf(worker.id, d) === 'half_day' ? 4 : 8, overtime_hours: v });
      }
      addToast(`Overtime saved for ${worker.name}`, 'success'); onClose();
    } catch (e) { addToast(e.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <SlideDrawer open onClose={onClose} title="Overtime" subtitle={`${worker.name} · ${worker.role || ''}`} icon={CalendarDays} size="md"
      footer={<div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500">{Math.round(totalOt * 10) / 10}h × {PKR(otRate)}/h ≈ <span className="font-semibold text-amber-700">{PKR(totalOt * otRate)}</span></span>
        <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save overtime'}</button></div></div>}>
      <div className="space-y-3">
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">Enter overtime hours per worked day. OT is valued at {PKR(otRate)}/hour ({parseFloat(worker.otRatePerHour) > 0 ? 'fixed rate' : '1.5× hourly'}) and added to gross pay when the run is prepared.</div>
        {workDays.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No present/half days this month — mark attendance first.</p> : (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="block text-[11px] text-gray-500 mb-1">Set all worked days to</label><input type="number" min="0" value={bulk} onChange={e => setBulk(e.target.value)} placeholder="hours" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums" /></div>
              <button onClick={setAll} className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">Apply to all</button>
            </div>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {workDays.map(d => (
                <div key={d} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-sm text-gray-700">{new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}<span className="text-[10px] text-gray-400 ml-1 capitalize">{statusOf(worker.id, d) === 'half_day' ? 'half' : 'present'}</span></span>
                  <input type="number" min="0" value={otMap[d] || ''} onChange={e => setOtMap(m => ({ ...m, [d]: e.target.value }))} placeholder="0" className="w-20 border border-gray-200 rounded px-2 py-1 text-right text-sm tabular-nums" />
                </div>
              ))}
            </div>
          </>
        )}
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
function WorkerAdvancesPanel({ worker, onClose, onGiveAdvance, addToast }) {
  const { data: advances = [], isLoading } = useWorkerAdvances(worker.id);
  const deleteAdvanceMut = useDeleteWorkerAdvance();
  const [confirmId, setConfirmId] = useState(null);
  const [ledgerId, setLedgerId] = useState(null);
  const outstanding = advances
    .filter(a => a.status === 'outstanding')
    .reduce((s, a) => s + ((parseFloat(a.amount) || 0) - (parseFloat(a.recoveredAmount) || 0)), 0);

  async function handleDelete(id) {
    try {
      await deleteAdvanceMut.mutateAsync(id);
      addToast('Advance deleted and cash-out reversed', 'success');
      setConfirmId(null);
    } catch (e) { addToast(e.message, 'error'); }
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
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">Pending approval</span>
                  ) : a.approvalStatus === 'approved' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700">Approved · unpaid</span>
                  ) : a.approvalStatus === 'rejected' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500">Rejected</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${a.status === 'outstanding' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {a.status === 'outstanding' ? `${PKR(out)} due` : 'Recovered'}
                    </span>
                  )}
                  {confirmId === a.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => handleDelete(a.id)} disabled={deleteAdvanceMut.isPending} className="px-2 py-1 text-[11px] text-white bg-red-600 rounded hover:bg-red-700">Confirm</button>
                      <button onClick={() => setConfirmId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ) : (
                    <button title="Delete & reverse" onClick={() => setConfirmId(a.id)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
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
    </SlideDrawer>
  );
}

// Bonuses & deductions for one worker. bonus → +gross, deduction → −net.
// One-off (a month) or recurring (every month).
function AdjustmentsDrawer({ worker, month, onClose, addToast }) {
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
        <button onClick={async () => { try { await delMut.mutateAsync(a.id); addToast('Removed', 'success'); } catch (e) { addToast(e.message, 'error'); } }} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
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
function AdvanceLedgerDrawer({ advanceId, onClose }) {
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

// Open a printable A4 payslip for one employee's line in a posted run.
// Net pay in words (Pakistani numbering: crore / lakh / thousand).
function amountInWords(value) {
  let num = Math.round(Math.abs(parseFloat(value) || 0));
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? ones[n] : (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
  const three = (n) => (Math.floor(n / 100) ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  let w = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) w += three(crore) + ' Crore ';
  if (lakh) w += two(lakh) + ' Lakh ';
  if (thousand) w += two(thousand) + ' Thousand ';
  if (num) w += three(num);
  return w.trim();
}

const PAYSLIP_CSS = `@page{size:A4 portrait;margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  body{font-family:'Segoe UI',Tahoma,sans-serif;color:#1f2937;margin:0;font-size:12px}
  .slip{padding:0 0 8px}.slip+.slip{page-break-before:always}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px}
  .co{font-size:18px;font-weight:800;color:#1e3a5f}.muted{color:#6b7280;font-size:10.5px}
  .doc{font-size:15px;font-weight:800;text-transform:uppercase;text-align:right}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:12px 0 4px}
  .k{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af}.v{font-size:12.5px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
  th{text-align:left;font-size:9px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:4px 0}
  td{padding:5px 0}.r{text-align:right;font-variant-numeric:tabular-nums}
  .sec{font-size:10px;text-transform:uppercase;color:#374151;font-weight:700;margin-top:14px;border-bottom:1px solid #e5e7eb;padding-bottom:3px}
  .net{display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-top:12px}
  .net b{font-size:16px;color:#065f46}.words{font-size:10.5px;color:#6b7280;font-style:italic;margin-top:4px}
  .sign{display:flex;justify-content:space-between;margin-top:42px;font-size:10px;color:#6b7280}
  .sign div{text-align:center}.sign .l{width:150px;border-top:1px solid #9ca3af;padding-top:3px;margin-top:24px}`;

function periodLabel(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return period || '';
  const d = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// One slip's HTML body — shared by single + bulk printing.
function payslipBody(run, line, company) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const logo = co.logo ? (String(co.logo).startsWith('http') ? co.logo : `${typeof location !== 'undefined' ? location.origin : ''}${co.logo}`) : null;
  const rs = (v) => 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const payDate = run.payDate ? new Date(run.payDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const ot = parseFloat(line.otPay) || 0; const adv = parseFloat(line.advanceDeducted) || 0;
  const advBal = parseFloat(line.advanceOutstanding) || 0;
  const bonus = parseFloat(line.bonusTotal) || 0; const otherDed = parseFloat(line.deductionTotal) || 0;
  const statTotal = parseFloat(line.statutoryTotal) || 0;
  let statLines = line.statutoryJson;
  if (typeof statLines === 'string') { try { statLines = JSON.parse(statLines); } catch { statLines = []; } }
  if (!Array.isArray(statLines)) statLines = [];
  return `<div class="slip">
    <div class="hd">
      <div>${logo ? `<img src="${logo}" style="height:40px;max-width:170px;object-fit:contain;display:block;margin-bottom:5px"/>` : ''}<div class="co">${name}</div>${co.address ? `<div class="muted" style="max-width:300px">${co.address}</div>` : ''}${co.ntn ? `<div class="muted">NTN ${co.ntn}</div>` : ''}</div>
      <div><div class="doc">Salary Slip</div><div class="muted" style="text-align:right">${periodLabel(run.period)}</div><div class="muted" style="text-align:right">Run #${run.id || ''} · ${String(run.status || 'paid')}</div></div>
    </div>
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${line.workerName || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${line.role || '—'} · ${line.payType === 'monthly' ? 'Monthly salary' : 'Daily wage'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${line.cnic || '—'}</div></span>
      <span><div class="k">Phone</div><div class="v">${line.phone || '—'}</div></span>
      <span><div class="k">Pay period</div><div class="v">${periodLabel(run.period)}</div></span>
      <span><div class="k">Pay date · method</div><div class="v">${payDate} · ${method}</div></span>
    </div>

    <div class="sec">Earnings</div>
    <table><tbody>
      <tr><td>Basic pay${line.payType !== 'monthly' ? ` (${line.effectiveDays || 0} day${(line.effectiveDays || 0) === 1 ? '' : 's'})` : (line.employedDays != null && line.daysInMonth != null && line.employedDays < line.daysInMonth ? ` (prorated ${line.employedDays}/${line.daysInMonth} days)` : '')}</td><td class="r">${rs(line.basicPay)}</td></tr>
      ${ot > 0 ? `<tr><td>Overtime${parseFloat(line.otHours) ? ` (${line.otHours} hrs)` : ''}</td><td class="r">${rs(line.otPay)}</td></tr>` : ''}
      ${bonus > 0 ? `<tr><td>Bonuses &amp; allowances</td><td class="r">${rs(bonus)}</td></tr>` : ''}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Gross pay</td><td class="r" style="font-weight:700;padding-top:7px">${rs((parseFloat(line.grossPay) || 0) + bonus)}</td></tr>
    </tbody></table>

    ${(adv > 0 || otherDed > 0 || statTotal > 0) ? `<div class="sec">Deductions</div>
    <table><tbody>
      ${adv > 0 ? `<tr><td>Advance recovered</td><td class="r">− ${rs(adv)}</td></tr>` : ''}
      ${statLines.map((s) => `<tr><td>${s.name || 'Statutory'}</td><td class="r">− ${rs(s.amount)}</td></tr>`).join('')}
      ${otherDed > 0 ? `<tr><td>Other deductions</td><td class="r">− ${rs(otherDed)}</td></tr>` : ''}
    </tbody></table>` : ''}

    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Paid</div><b>${rs(line.netPay)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(line.netPay)} Only</div></div></div>

    <div class="sec">Attendance &amp; advance</div>
    <table><tbody>
      <tr><td>Effective days worked</td><td class="r">${line.effectiveDays || 0}${line.payType === 'monthly' ? ' (salary fixed)' : ''}</td></tr>
      <tr><td>Overtime hours</td><td class="r">${line.otHours || 0}</td></tr>
      <tr><td>Advance recovered this month</td><td class="r">${rs(adv)}</td></tr>
      <tr><td>Advance balance remaining</td><td class="r">${rs(advBal)}</td></tr>
    </tbody></table>

    <div class="sign"><div><div class="l">Received By</div></div><div><div class="l">Prepared By</div></div><div><div class="l">Authorized By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary slip — ${name}.</div>
  </div>`;
}

function openPayslipWindow(title, inner) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title><style>${PAYSLIP_CSS}</style></head>
    <body>${inner}<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},300)});</script></body></html>`;
  const w = window.open('', '_blank', 'width=840,height=1120');
  if (!w) return false;
  w.document.write(html); w.document.close(); return true;
}

function printPayslip(run, line, company) {
  return openPayslipWindow(`Payslip ${line.workerName} ${run.period}`, payslipBody(run, line, company));
}

// Bulk: one print job, a page per employee.
function printAllPayslips(run, lines, company) {
  if (!lines || !lines.length) return false;
  return openPayslipWindow(`Payslips ${run.period}`, lines.map((l) => payslipBody(run, l, company)).join(''));
}

// Shared A4 document header (logo + company + a doc title with up to two
// right-aligned sub-lines). Used by the payment voucher + salary receipt.
function docHeaderHtml(company, docTitle, sub1, sub2) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const logo = co.logo ? (String(co.logo).startsWith('http') ? co.logo : `${typeof location !== 'undefined' ? location.origin : ''}${co.logo}`) : null;
  return `<div class="hd">
    <div>${logo ? `<img src="${logo}" style="height:40px;max-width:170px;object-fit:contain;display:block;margin-bottom:5px"/>` : ''}<div class="co">${name}</div>${co.address ? `<div class="muted" style="max-width:300px">${co.address}</div>` : ''}${co.ntn ? `<div class="muted">NTN ${co.ntn}</div>` : ''}</div>
    <div><div class="doc">${docTitle}</div>${sub1 ? `<div class="muted" style="text-align:right">${sub1}</div>` : ''}${sub2 ? `<div class="muted" style="text-align:right">${sub2}</div>` : ''}</div>
  </div>`;
}

const rsAmt = (v) => 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docDate = (x) => x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
// Derived (un-stored) document numbers — the run id + period make them stable
// and unique without a vouchers table (mirrors the "sale row = invoice" model).
const voucherNo = (run) => `PV/${run.period}/${String(run.id || 0).padStart(4, '0')}`;
const receiptNo = (run, line) => `SR/${run.period}/${String(run.id || 0).padStart(4, '0')}/${line.id || ''}`;

// PAYMENT VOUCHER — the formal cash/bank disbursement record for a PAID run.
function paymentVoucherBody(run, lines, company) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const account = run.payMethod === 'bank' ? (run.bankName || 'Bank') : 'Mill Cash';
  const net = parseFloat(run.netTotal) || 0;
  const statTotal = (lines || []).reduce((s, l) => s + (parseFloat(l.statutoryTotal) || 0), 0);
  const vno = voucherNo(run);
  const rows = (lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${l.workerName || '—'}</td><td style="text-transform:capitalize">${l.role || '—'}</td><td class="r">${rsAmt(l.netPay)}</td></tr>`).join('');
  return `<div class="slip">
    ${docHeaderHtml(company, 'Payment Voucher', vno, periodLabel(run.period))}
    <div class="meta">
      <span><div class="k">Voucher No</div><div class="v">${vno}</div></span>
      <span><div class="k">Pay date</div><div class="v">${docDate(run.payDate)}</div></span>
      <span><div class="k">Paid from</div><div class="v">${account}</div></span>
      <span><div class="k">Payment method</div><div class="v">${method}</div></span>
      <span><div class="k">Paid to</div><div class="v">Mill staff payroll · ${(lines && lines.length) || run.employeeCount || 0} employee(s)</div></span>
      <span><div class="k">For period</div><div class="v">${periodLabel(run.period)}</div></span>
    </div>
    <div class="sec">Payment breakdown</div>
    <table><thead><tr><th style="width:24px">#</th><th>Employee</th><th>Designation</th><th class="r">Net paid</th></tr></thead><tbody>${rows}
      <tr style="border-top:1px solid #e5e7eb"><td colspan="3" style="font-weight:700;padding-top:7px">Total disbursed</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(net)}</td></tr>
    </tbody></table>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Total Paid</div><b>${rsAmt(net)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(net)} Only</div></div></div>
    <div class="sec">Accounting</div>
    <table><tbody>
      <tr><td>Dr 6135 Salaries &amp; Wages</td><td class="r">${rsAmt(net)}</td></tr>
      <tr><td>Cr 1000 Cash &amp; Bank (${account})</td><td class="r">${rsAmt(net)}</td></tr>
      ${statTotal > 0 ? `<tr><td style="color:#6b7280">Statutory withheld (held as payable to authority)</td><td class="r" style="color:#6b7280">${rsAmt(statTotal)}</td></tr>` : ''}
    </tbody></table>
    <div class="meta" style="margin-top:10px">
      <span><div class="k">Prepared by</div><div class="v">${run.preparedByName || '—'}</div></span>
      <span><div class="k">Approved by</div><div class="v">${run.approvedByName || '—'}</div></span>
      ${run.accruedByName ? `<span><div class="k">Accrued by</div><div class="v">${run.accruedByName}</div></span>` : ''}
      <span><div class="k">Paid by</div><div class="v">${run.paidByName || '—'}</div></span>
    </div>
    <div class="sign"><div><div class="l">Prepared By</div></div><div><div class="l">Checked By</div></div><div><div class="l">Approved By</div></div><div><div class="l">Received By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated payment voucher — ${name}.</div>
  </div>`;
}

// SALARY RECEIPT — per-employee acknowledgment of net pay received.
function salaryReceiptBody(run, line, company) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const method = run.payMethod === 'bank' ? (run.bankName || 'Bank transfer') : 'Cash';
  const net = parseFloat(line.netPay) || 0;
  const rno = receiptNo(run, line);
  return `<div class="slip">
    ${docHeaderHtml(company, 'Salary Receipt', rno, periodLabel(run.period))}
    <div class="meta">
      <span><div class="k">Receipt No</div><div class="v">${rno}</div></span>
      <span><div class="k">Date</div><div class="v">${docDate(run.payDate)}</div></span>
      <span><div class="k">Employee</div><div class="v">${line.workerName || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${line.cnic || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${line.role || '—'}</div></span>
      <span><div class="k">Payment method</div><div class="v">${method}</div></span>
    </div>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Net Received</div><b>${rsAmt(net)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(net)} Only</div></div></div>
    <p style="margin-top:16px;font-size:12px;line-height:1.7">Received with thanks from <b>${name}</b> the sum of <b>${rsAmt(net)}</b> (Rupees ${amountInWords(net)} Only), being the net salary due to me for the month of <b>${periodLabel(run.period)}</b>, paid via ${method}, in full and final settlement. I acknowledge that I have no further claim for the said period.</p>
    <div class="sign"><div><div class="l">Employee Signature / Thumb</div></div><div><div class="l">Date</div></div><div><div class="l">Paid By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Salary acknowledgment receipt — ${name}.</div>
  </div>`;
}

function printPaymentVoucher(run, lines, company) {
  return openPayslipWindow(`Payment Voucher ${run.period}`, paymentVoucherBody(run, lines, company));
}
function printSalaryReceipt(run, line, company) {
  return openPayslipWindow(`Salary Receipt ${line.workerName} ${run.period}`, salaryReceiptBody(run, line, company));
}
function printAllReceipts(run, lines, company) {
  if (!lines || !lines.length) return false;
  return openPayslipWindow(`Salary Receipts ${run.period}`, lines.map((l) => salaryReceiptBody(run, l, company)).join(''));
}

// SALARY & TAX-DEDUCTION CERTIFICATE — per-employee annual statement for a
// Pakistani tax year (1 Jul – 30 Jun). Built from the tax-statement aggregation.
function taxYearLabel(meta) {
  const y = parseInt(String(meta.taxYear || '').slice(0, 4), 10);
  return Number.isFinite(y) ? `1 July ${y} – 30 June ${y + 1}` : (meta.taxYear || '');
}
function taxCertificateBody(emp, meta, company) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const monthName = (p) => periodLabel(p);
  const rows = (emp.months || []).map((m) => `<tr><td>${monthName(m.period)}</td><td class="r">${rsAmt(m.gross)}</td><td class="r">${rsAmt(m.statutory)}</td><td class="r">${rsAmt(m.net)}</td></tr>`).join('');
  const t = emp.totals || {};
  const breakdown = Object.entries(t.byStatutory || {}).filter(([, v]) => (parseFloat(v) || 0) > 0)
    .map(([k, v]) => `<tr><td>${k}</td><td class="r">${rsAmt(v)}</td></tr>`).join('');
  return `<div class="slip">
    ${docHeaderHtml(company, 'Salary &amp; Tax Certificate', `Tax year ${meta.taxYear || ''}`, taxYearLabel(meta))}
    <div class="meta">
      <span><div class="k">Employee</div><div class="v">${emp.name || '—'}</div></span>
      <span><div class="k">Designation</div><div class="v" style="text-transform:capitalize">${emp.role || '—'}</div></span>
      <span><div class="k">CNIC</div><div class="v">${emp.cnic || '—'}</div></span>
      <span><div class="k">Tax year</div><div class="v">${taxYearLabel(meta)}</div></span>
    </div>
    <p style="margin:12px 0 4px;font-size:11.5px;color:#374151">This is to certify that the following salary was paid to the above employee and the amounts shown were deducted during the tax year, withheld under section 149 of the Income Tax Ordinance, 2001.</p>
    <table><thead><tr><th>Month</th><th class="r">Gross paid</th><th class="r">Statutory deducted</th><th class="r">Net paid</th></tr></thead><tbody>${rows}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Total (${t.monthsPaid || 0} month${(t.monthsPaid || 0) === 1 ? '' : 's'})</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.gross)}</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.statutory)}</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.net)}</td></tr>
    </tbody></table>
    ${breakdown ? `<div class="sec">Statutory deductions withheld</div><table><tbody>${breakdown}
      <tr style="border-top:1px solid #e5e7eb"><td style="font-weight:700;padding-top:7px">Total deducted</td><td class="r" style="font-weight:700;padding-top:7px">${rsAmt(t.statutory)}</td></tr></tbody></table>` : ''}
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Total Gross Paid</div><b>${rsAmt(t.gross)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(t.gross)} Only · tax/statutory deducted ${rsAmt(t.statutory)}</div></div></div>
    <div class="sign"><div><div class="l">Employee</div></div><div><div class="l">Prepared By</div></div><div><div class="l">Authorized Signatory</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary &amp; tax certificate — ${name}. Tax deducted u/s 149, Income Tax Ordinance 2001.</div>
  </div>`;
}
function printTaxCertificate(emp, meta, company) {
  return openPayslipWindow(`Tax Certificate ${emp.name} ${meta.taxYear}`, taxCertificateBody(emp, meta, company));
}
function printAllTaxCertificates(employees, meta, company) {
  if (!employees || !employees.length) return false;
  return openPayslipWindow(`Tax Certificates ${meta.taxYear}`, employees.map((e) => taxCertificateBody(e, meta, company)).join(''));
}

// STATUTORY REMITTANCE CHALLAN / PAYMENT VOUCHER — proof of a tax/EOBI payment
// to the authority (the one payroll money-out that lacked a document).
function statutoryRemittanceBody(r, company) {
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const amt = parseFloat(r.amount) || 0;
  const method = r.payMethod === 'bank' ? (r.bankName || 'Bank transfer') : 'Cash';
  const acctName = r.accountName || r.liabilityAccountCode || 'Statutory liability';
  const period = r.periodFrom ? (r.periodTo && r.periodTo !== r.periodFrom ? `${periodLabel(r.periodFrom)} – ${periodLabel(r.periodTo)}` : periodLabel(r.periodFrom)) : '—';
  return `<div class="slip">
    ${docHeaderHtml(company, 'Statutory Remittance', r.remittanceNo || '', r.authority ? `To: ${r.authority}` : '')}
    <div class="meta">
      <span><div class="k">Remittance No</div><div class="v">${r.remittanceNo || '—'}</div></span>
      <span><div class="k">Date</div><div class="v">${docDate(r.remitDate)}</div></span>
      <span><div class="k">Authority</div><div class="v">${r.authority || '—'}</div></span>
      <span><div class="k">Challan / CPR ref</div><div class="v">${r.reference || '—'}</div></span>
      <span><div class="k">Liability settled</div><div class="v">${r.liabilityAccountCode || ''} ${acctName}</div></span>
      <span><div class="k">Paid via</div><div class="v">${method}</div></span>
      <span><div class="k">For period</div><div class="v">${period}</div></span>
    </div>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Amount Remitted</div><b>${rsAmt(amt)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(amt)} Only</div></div></div>
    <div class="sec">Accounting</div>
    <table><tbody>
      <tr><td>Dr ${r.liabilityAccountCode || ''} ${acctName}</td><td class="r">${rsAmt(amt)}</td></tr>
      <tr><td>Cr 1000 Cash &amp; Bank (${method})</td><td class="r">${rsAmt(amt)}</td></tr>
    </tbody></table>
    ${r.notes ? `<div class="sec">Notes</div><div style="font-size:11.5px;color:#374151">${r.notes}</div>` : ''}
    <div class="sign"><div><div class="l">Prepared By</div></div><div><div class="l">Approved By</div></div><div><div class="l">Received (Authority)</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated statutory remittance voucher — ${name}.</div>
  </div>`;
}
function printStatutoryRemittance(r, company) {
  return openPayslipWindow(`Remittance ${r.remittanceNo || ''}`, statutoryRemittanceBody(r, company));
}

// Bank bulk-transfer (disbursement) file — one beneficiary row per payslip line,
// for upload to the bank's payroll portal. Generic CSV with the common columns.
function downloadBankTransferFile(run, lines, addToast) {
  if (!lines || !lines.length) { if (addToast) addToast('No employees in this run', 'error'); return; }
  const rows = lines.map((l, i) => ({
    sno: i + 1,
    name: l.workerName || '',
    cnic: l.cnic || '',
    bank: l.bankName || '',
    account: l.bankAccountNumber || '',
    iban: l.iban || '',
    amount: Math.round(parseFloat(l.netPay) || 0),
    narration: `Salary ${periodLabel(run.period)}`,
  }));
  const cols = [
    { key: 'sno', label: 'S.No' },
    { key: 'name', label: 'Beneficiary Name' },
    { key: 'cnic', label: 'CNIC' },
    { key: 'bank', label: 'Bank Name' },
    { key: 'account', label: 'Account Number' },
    { key: 'iban', label: 'IBAN' },
    { key: 'amount', label: 'Amount (PKR)' },
    { key: 'narration', label: 'Narration' },
  ];
  downloadCSV(rows, cols, `bank-transfer-${run.period}-run${run.id || ''}.csv`);
  if (addToast) {
    const missing = rows.filter((r) => !r.account && !r.iban).length;
    if (missing) addToast(`Exported ${rows.length} rows — ${missing} missing bank details`, 'info');
    else addToast(`Bank transfer file: ${rows.length} beneficiaries`, 'success');
  }
}

// Drawer to post a payroll run: review the per-employee breakdown, then pay it
// out from Mill Cash. Server recomputes the figures on submit.
function PayrollRunDrawer({ month, entity = 'mill', employees, preselectId, bankAccounts = [], onClose, onPosted, postRunMut, addToast }) {
  const [form, setForm] = useState({ pay_method: 'cash', bank_account_id: '', pay_date: new Date().toISOString().split('T')[0] });
  // Banks the mill can pay salaries from (cash is the dedicated Mill Cash float).
  const payBanks = (bankAccounts || []).filter(a => a.type !== 'cash');
  // One editable row per unpaid employee: include, advance-to-clear, and the
  // amount actually being paid (defaults to gross − advance, both overridable).
  const [rows, setRows] = useState(() => employees.map(w => {
    // Default deduction = the SCHEDULED amount for this month (recovery plan),
    // not the full outstanding. Admin can still reduce / skip / enter manually.
    const scheduled = Math.round(w.advanceScheduled != null ? w.advanceScheduled : Math.min(w.advanceOutstanding || 0, w.grossPay || 0));
    const bonus = Math.round(w.bonusTotal || 0); const deduction = Math.round(w.deductionTotal || 0);
    const statutory = Math.round(w.statutoryTotal || 0);
    return {
      id: w.id, name: w.name, role: w.role, gross: w.grossPay || 0, bonus, deduction, statutory,
      prorated: !!w.prorated, employedDays: w.employedDays, daysInMonth: w.daysInMonth,
      outstanding: Math.round(w.advanceOutstanding || 0),
      scheduled,
      include: preselectId ? w.id === preselectId : true,
      advance: scheduled, net: Math.max(0, (w.grossPay || 0) + bonus - scheduled - deduction - statutory), reason: '',
    };
  }));

  const netOf = (r, advance) => Math.max(0, r.gross + r.bonus - advance - r.deduction - (r.statutory || 0));
  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  // Changing the advance-to-clear re-derives the net (still editable afterwards).
  const onAdvance = (r, raw) => {
    const advance = Math.max(0, Math.min(Math.round(parseFloat(raw) || 0), r.outstanding, r.gross));
    setRow(r.id, { advance, net: netOf(r, advance) });
  };
  const onNet = (r, raw) => setRow(r.id, { net: Math.max(0, Math.round(parseFloat(raw) || 0)) });
  const useScheduled = (r) => setRow(r.id, { advance: r.scheduled, net: netOf(r, r.scheduled), reason: '' });
  const skipRow = (r) => setRow(r.id, { advance: 0, net: netOf(r, 0) });

  const included = rows.filter(r => r.include);
  const totalNet = included.reduce((s, r) => s + r.net, 0);
  const totalAdvance = included.reduce((s, r) => s + r.advance, 0);
  // A reason is required where the deduction was changed away from the schedule.
  const needsReason = included.filter(r => Math.round(r.advance) !== Math.round(r.scheduled) && !String(r.reason || '').trim());

  async function post() {
    if (!included.length) { addToast('Select at least one employee to pay', 'error'); return; }
    if (needsReason.length) { addToast(`Add a reason for the changed deduction: ${needsReason.map(r => r.name).join(', ')}`, 'error'); return; }
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account to pay from', 'error'); return; }
    try {
      const res = await postRunMut.mutateAsync({
        month,
        entity,
        pay_method: form.pay_method,
        bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null,
        pay_date: form.pay_date,
        lines: included.map(r => ({ worker_id: r.id, net_pay: r.net, advance_deducted: r.advance, skip_reason: Math.round(r.advance) !== Math.round(r.scheduled) ? (r.reason || null) : null })),
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
                <option key={a.id} value={`bank:${a.id}`}>{a.name}{a.bank_name ? ` · ${a.bank_name}` : ''}</option>
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
                          <button onClick={() => useScheduled(r)} className="text-[10px] text-blue-600 hover:underline">Use scheduled</button>
                          <button onClick={() => skipRow(r)} className="text-[10px] text-red-600 hover:underline">Skip this month</button>
                        </div>
                      )}
                    </td>
                    <td data-label="Gross" className="px-3 py-1.5 text-right tabular-nums text-gray-600">{PKR(r.gross)}</td>
                    <td data-label="Advance out" className="mob-hide px-3 py-1.5 text-right tabular-nums text-amber-700">{r.outstanding > 0 ? PKR(r.outstanding) : '—'}</td>
                    <td data-label="Scheduled" className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.outstanding > 0 ? PKR(r.scheduled) : '—'}</td>
                    <td data-label="Deducting" className="px-3 py-1.5 text-right">
                      {r.outstanding > 0 ? (
                        <input type="number" min="0" max={Math.min(r.outstanding, r.gross)} value={r.advance} disabled={!r.include}
                          onChange={e => onAdvance(r, e.target.value)}
                          className={`w-24 border rounded px-2 py-1 text-right tabular-nums focus:outline-none focus:border-gray-900 disabled:bg-gray-50 ${changed ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} />
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td data-label="Paying now" className="px-3 py-1.5 text-right">
                      <input type="number" min="0" value={r.net} disabled={!r.include}
                        onChange={e => onNet(r, e.target.value)}
                        className="w-28 border border-gray-200 rounded px-2 py-1 text-right tabular-nums font-medium focus:outline-none focus:border-gray-900 disabled:bg-gray-50" />
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
        <p className="text-[11px] text-gray-400">Prepares a payroll run for the ticked employees — it must then be <span className="font-medium">Approved</span> and <span className="font-medium">Paid</span> (by Finance/Owner) before any cash/GL posts. Advances are only recovered when the run is paid.</p>
      </div>
    </SlideDrawer>
  );
}

// Schedule monthly payroll auto-prepare. The scheduler PREPARES a run on the
// chosen day each month into the approval queue — it never auto-approves/pays.
// Manage org-level statutory deduction RULES (income tax, EOBI, …) that apply
// automatically to every eligible employee at payroll time.
function StatutoryDeductionsDrawer({ canPay, entity = 'mill', bankAccounts = [], company, onClose, addToast }) {
  const [tab, setTab] = useState('rules');
  const { data: rules = [], isLoading } = useStatutoryDeductions();
  const createMut = useCreateStatutoryDeduction();
  const updateMut = useUpdateStatutoryDeduction();
  const deleteMut = useDeleteStatutoryDeduction();
  const blank = { name: '', calc_method: 'percent', rate: '', fixed_amount: '', base: 'gross', min_gross: '', applies_to: 'all', liability_account_code: '2050', slabs: [] };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // Slab editor helpers (progressive annual brackets: threshold/rate/base).
  const slabs = Array.isArray(form.slabs) ? form.slabs : [];
  const setSlab = (i, patch) => set({ slabs: slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSlab = () => set({ slabs: [...slabs, { threshold: '', rate: '', base: '' }] });
  const rmSlab = (i) => set({ slabs: slabs.filter((_, j) => j !== i) });

  const startEdit = (r) => {
    setEditId(r.id);
    setForm({ name: r.name, calc_method: r.calcMethod, rate: r.rate || '', fixed_amount: r.fixedAmount || '', base: r.base, min_gross: r.minGross || '', applies_to: r.appliesTo, liability_account_code: r.liabilityAccountCode || '2050', slabs: Array.isArray(r.slabs) ? r.slabs : [] });
  };
  const reset = () => { setEditId(null); setForm(blank); };

  async function save() {
    if (!String(form.name).trim()) { addToast('Name is required', 'error'); return; }
    if (form.calc_method === 'percent' && !(parseFloat(form.rate) > 0)) { addToast('Enter a rate %', 'error'); return; }
    if (form.calc_method === 'fixed' && !(parseFloat(form.fixed_amount) > 0)) { addToast('Enter a fixed amount', 'error'); return; }
    if (form.calc_method === 'slab' && !slabs.some((s) => parseFloat(s.threshold) >= 0 && (parseFloat(s.rate) > 0 || parseFloat(s.base) > 0))) { addToast('Add at least one tax slab', 'error'); return; }
    const payload = {
      ...form, rate: parseFloat(form.rate) || 0, fixed_amount: parseFloat(form.fixed_amount) || 0, min_gross: parseFloat(form.min_gross) || 0,
      slabs: form.calc_method === 'slab'
        ? slabs.filter((s) => s.threshold !== '' || s.rate !== '' || s.base !== '')
          .map((s) => ({ threshold: parseFloat(s.threshold) || 0, rate: parseFloat(s.rate) || 0, base: parseFloat(s.base) || 0 }))
          .sort((a, b) => a.threshold - b.threshold)
        : undefined,
    };
    try {
      if (editId) { await updateMut.mutateAsync({ id: editId, data: payload }); addToast('Rule updated', 'success'); }
      else { await createMut.mutateAsync(payload); addToast('Rule added', 'success'); }
      reset();
    } catch (e) { addToast(e.message, 'error'); }
  }
  async function toggleActive(r) {
    try { await updateMut.mutateAsync({ id: r.id, data: { is_active: !r.isActive, calc_method: r.calcMethod, rate: r.rate, fixed_amount: r.fixedAmount } }); } catch (e) { addToast(e.message, 'error'); }
  }
  async function remove(r) {
    try { await deleteMut.mutateAsync(r.id); addToast('Rule removed', 'success'); } catch (e) { addToast(e.message, 'error'); }
  }
  const describe = (r) => r.calcMethod === 'percent' ? `${parseFloat(r.rate)}% of ${r.base}` : r.calcMethod === 'fixed' ? `${PKR(r.fixedAmount)} fixed` : `Income tax slabs (${Array.isArray(r.slabs) ? r.slabs.length : 0} bracket${(Array.isArray(r.slabs) ? r.slabs.length : 0) === 1 ? '' : 's'}) on ${r.base}`;

  return (
    <SlideDrawer open onClose={onClose} title="Statutory deductions" subtitle="Tax / EOBI rules + remit withheld liabilities to the authority" icon={Landmark} size="lg">
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setTab('rules')} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === 'rules' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Deduction rules</button>
        <button onClick={() => setTab('remit')} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === 'remit' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Remit liabilities</button>
      </div>
      {tab === 'remit' ? (
        <StatutoryRemittancePanel canPay={canPay} entity={entity} bankAccounts={bankAccounts} company={company} addToast={addToast} />
      ) : (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-600">{editId ? 'Edit rule' : 'Add a deduction rule'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-gray-500 mb-1">Name</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Income Tax, EOBI" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Method</label>
              <select value={form.calc_method} onChange={(e) => set({ calc_method: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="percent">Percent of pay</option>
                <option value="fixed">Fixed amount</option>
                <option value="slab">Income tax slabs (annual)</option>
              </select>
            </div>
            {form.calc_method === 'percent' ? (
              <>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Rate %</label>
                  <input type="number" step="0.01" value={form.rate} onChange={(e) => set({ rate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Applied to</label>
                  <select value={form.base} onChange={(e) => set({ base: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="gross">Gross pay</option>
                    <option value="basic">Basic pay</option>
                  </select>
                </div>
              </>
            ) : form.calc_method === 'fixed' ? (
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Fixed amount (Rs)</label>
                <input type="number" value={form.fixed_amount} onChange={(e) => set({ fixed_amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ) : (
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Applied to (annualised)</label>
                <select value={form.base} onChange={(e) => set({ base: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="gross">Gross pay</option>
                  <option value="basic">Basic pay</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Only when gross ≥</label>
              <input type="number" value={form.min_gross} onChange={(e) => set({ min_gross: e.target.value })} placeholder="0 = always" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Employees</label>
              <select value={form.applies_to} onChange={(e) => set({ applies_to: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="all">All staff</option>
                <option value="monthly">Salaried only</option>
                <option value="daily">Daily-wage only</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Liability account</label>
              <select value={form.liability_account_code} onChange={(e) => set({ liability_account_code: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="2050">2050 Tax Payable</option>
                <option value="2055">2055 EOBI Payable</option>
              </select>
            </div>
          </div>
          {form.calc_method === 'slab' && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-600">Annual income-tax slabs (FBR)</span>
                <button onClick={addSlab} className="text-[11px] text-blue-700 font-medium hover:underline">+ Add bracket</button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 text-[9px] uppercase text-gray-400 px-1">
                <span>Annual income over (Rs)</span><span>Rate % above</span><span>Fixed tax at this point (Rs)</span><span></span>
              </div>
              {!slabs.length ? <p className="text-[11px] text-gray-400 px-1">No brackets yet — add the FBR salary slabs (lowest first).</p> : slabs.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
                  <input type="number" value={s.threshold} onChange={(e) => setSlab(i, { threshold: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <input type="number" step="0.01" value={s.rate} onChange={(e) => setSlab(i, { rate: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <input type="number" value={s.base} onChange={(e) => setSlab(i, { base: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <button onClick={() => rmSlab(i)} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">Tax = <em>fixed tax at the bracket</em> + <em>rate%</em> × (annual income − <em>bracket threshold</em>), then ÷12 for the month. Income is the chosen base × 12. Enter brackets lowest-threshold first.</p>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            {editId && <button onClick={reset} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>}
            <button onClick={save} disabled={createMut.isPending || updateMut.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{editId ? 'Save rule' : 'Add rule'}</button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Active &amp; inactive rules</div>
          {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !rules.length ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">No statutory deductions configured yet. Withholding is off until you add a rule.</p>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <div key={r.id} className={`rounded-lg border p-3 flex items-center justify-between ${r.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{r.name} <span className="text-[10px] font-normal text-gray-400">{r.code}</span></div>
                    <div className="text-xs text-gray-500">{describe(r)}{parseFloat(r.minGross) > 0 ? ` · only if gross ≥ ${PKR(r.minGross)}` : ''} · {r.appliesTo === 'all' ? 'all staff' : r.appliesTo === 'monthly' ? 'salaried' : 'daily-wage'} · → {r.liabilityAccountCode}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleActive(r)} className={`px-2 py-1 text-[11px] rounded-md ${r.isActive ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'}`}>{r.isActive ? 'Active' : 'Inactive'}</button>
                    <button onClick={() => startEdit(r)} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(r)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-400">Statutory amounts are withheld from each employee's net pay and booked to the chosen liability account (payable to the authority). They appear on payslips and reduce the cash paid out — the salary expense still reflects the full gross.</p>
      </div>
      )}
    </SlideDrawer>
  );
}

// Printable salary increment / revision letter.
function incrementLetterBody(w, rev, company) {
  const co = company || {};
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
    <p style="font-size:12px;line-height:1.7">We are pleased to inform you that, effective <b>${docDate(rev.effectiveDate)}</b>, your ${unit} has been revised from <b>${rsAmt(oldAmt)}</b> to <b>${rsAmt(newAmt)}</b>${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}.${rev.reason ? ` Reason: ${rev.reason}.` : ''}</p>
    <div class="net"><div><div style="font-size:10px;text-transform:uppercase;color:#047857">Revised ${unit}</div><b>${rsAmt(newAmt)}</b></div>
      <div style="text-align:right;max-width:55%"><div class="words">Rupees ${amountInWords(newAmt)} Only${monthly ? ' per month' : ' per day'}</div></div></div>
    <div class="sign"><div><div class="l">Employee</div></div><div><div class="l">Authorized By</div></div></div>
    <div class="muted" style="text-align:center;margin-top:14px">Computer-generated salary revision letter — ${name}.</div>
  </div>`;
}
function printIncrementLetter(w, rev, company) { return openPayslipWindow(`Salary Revision ${w.name}`, incrementLetterBody(w, rev, company)); }

// Per-employee salary revision — record a pay change (old→new) with effective
// date + reason; lists the history with a printable increment letter per change.
function SalaryRevisionDrawer({ worker, company, onClose, addToast }) {
  const { data: revisions = [], isLoading } = useSalaryRevisions(worker.id);
  const reviseMut = useReviseSalary();
  const monthly = worker.payType === 'monthly';
  const curAmt = monthly ? worker.monthlySalary : worker.dailyWage;
  const [form, setForm] = useState({ amount: '', effective_date: new Date().toISOString().slice(0, 10), reason: '' });
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  async function submit() {
    if (!(parseFloat(form.amount) > 0)) { addToast('Enter the new amount', 'error'); return; }
    try {
      const data = { pay_type: worker.payType, effective_date: form.effective_date, reason: form.reason, [monthly ? 'monthly_salary' : 'daily_wage']: parseFloat(form.amount) };
      await reviseMut.mutateAsync({ workerId: worker.id, data });
      addToast('Salary revised', 'success'); setForm({ amount: '', effective_date: new Date().toISOString().slice(0, 10), reason: '' });
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
function PayrollAuditDrawer({ onClose }) {
  const [filters, setFilters] = useState({ action: '', date_from: '', date_to: '' });
  const [limit, setLimit] = useState(50);
  const params = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), limit };
  const { data, isLoading } = usePayrollAudit(params);
  const logs = data?.logs || []; const actions = data?.actions || []; const total = data?.total || 0;
  const fmtTs = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
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
  const co = company || {};
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
function FinalSettlementDrawer({ worker, bankAccounts = [], company, onClose, addToast }) {
  const { data: calc, isLoading } = useFinalSettlement(worker.id);
  const finalizeMut = useFinalizeSettlement();
  const payBanks = (bankAccounts || []).filter((a) => a.type !== 'cash');
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (calc) setForm({
      final_salary: calc.finalSalary, leave_encashment: calc.leaveEncashment, gratuity: calc.gratuity,
      advances_deducted: calc.advancesOutstanding, other_deductions: 0,
      pay_method: 'cash', bank_account_id: '', left_date: calc.left, settlement_date: calc.today, service_years: calc.serviceYears, notes: '',
    });
  }, [calc]);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const n = (v) => parseFloat(v) || 0;
  const net = form ? Math.max(0, n(form.final_salary) + n(form.leave_encashment) + n(form.gratuity) - n(form.advances_deducted) - n(form.other_deductions)) : 0;

  async function finalize() {
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account', 'error'); return; }
    if (!window.confirm(`Pay ${PKR(net)} and deactivate ${worker.name}? This closes their employment.`)) return;
    try {
      const res = await finalizeMut.mutateAsync({ workerId: worker.id, data: { ...form, bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null, breakdown: { leaveLines: calc.leaveLines } } });
      const s = res?.data || res;
      addToast(`Final settlement paid — ${PKR(s.net_amount)}`, 'success');
      printSettlement(worker, { ...s, role: worker.role, cnic: worker.cnic }, company);
      onClose();
    } catch (e) { addToast(e.message, 'error'); }
  }

  return (
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
            <Field label="Final salary (prorated)" value={form.final_salary} onChange={(v) => set({ final_salary: v })} />
            <Field label="Leave encashment" value={form.leave_encashment} onChange={(v) => set({ leave_encashment: v })} hint={calc.leaveLines.length ? calc.leaveLines.map((l) => `${l.name} ${l.days}d`).join(', ') : 'no unused paid leave'} />
            <Field label="Gratuity" value={form.gratuity} onChange={(v) => set({ gratuity: v })} hint={`${calc.completedYears} completed yr(s)`} />
            <Field label="Advances recovered (−)" value={form.advances_deducted} onChange={(v) => set({ advances_deducted: v })} />
            <Field label="Other deductions (−)" value={form.other_deductions} onChange={(v) => set({ other_deductions: v })} />
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Last working day</label>
              <input type="date" value={form.left_date} onChange={(e) => set({ left_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Pay via</label>
              <select value={form.pay_method === 'bank' ? `bank:${form.bank_account_id}` : 'cash'} onChange={(e) => { const v = e.target.value; if (v === 'cash') set({ pay_method: 'cash', bank_account_id: '' }); else set({ pay_method: 'bank', bank_account_id: v.replace('bank:', '') }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="cash">Mill Cash</option>
                {payBanks.map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Settlement date</label>
              <input type="date" value={form.settlement_date} onChange={(e) => set({ settlement_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-gray-400">Pays the net via a salaries expense (DR 6135 / CR Cash &amp; Bank), recovers the outstanding advances, sets the last working day and deactivates the employee. A settlement voucher prints on confirm.</p>
        </div>
      )}
    </SlideDrawer>
  );
}
function Field({ label, value, onChange, hint }) {
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
function LeaveDrawer({ canManage, workers = [], onClose, addToast }) {
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
              <button onClick={addType} className="px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">Add</button>
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
                  <button onClick={async () => { try { await deleteType.mutateAsync(t.id); addToast('Removed', 'success'); } catch (e) { addToast(e.message, 'error'); } }} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
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
function WorkerRequestsDrawer({ canResolve, onClose, addToast }) {
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

// Year-end tax statements — per-employee annual salary + tax-withheld summary
// for a Pakistani tax year, with printable salary/tax certificates (u/s 149).
function TaxStatementDrawer({ company, entity = 'mill', onClose, addToast }) {
  // Build a few recent tax-year options (current FY first).
  const now = new Date();
  const curStart = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const years = [0, 1, 2].map((d) => { const y = curStart - d; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });
  const [taxYear, setTaxYear] = useState(years[0]);
  const { data, isLoading } = useTaxStatement({ tax_year: taxYear, entity });
  const meta = { taxYear: data?.taxYear || taxYear, periodFrom: data?.periodFrom, periodTo: data?.periodTo };
  const employees = data?.employees || [];
  const grand = data?.grand || { gross: 0, statutory: 0, net: 0 };

  return (
    <SlideDrawer open onClose={onClose} title="Year-end tax statements" subtitle="Annual salary & tax-deduction certificates (u/s 149)" icon={FileText} size="lg"
      footer={employees.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{employees.length} employee(s) · gross {PKR(grand.gross)} · tax/statutory {PKR(grand.statutory)}</span>
          <button onClick={() => printAllTaxCertificates(employees, meta, company)} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
            <Printer className="w-3.5 h-3.5" /> Print all certificates ({employees.length})
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Tax year</label>
          <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {years.map((y) => <option key={y} value={y}>{y} (Jul {y.slice(0, 4)} – Jun {parseInt(y.slice(0, 4), 10) + 1})</option>)}
          </select>
        </div>
        {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !employees.length ? (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No paid salaries in this tax year.</p>
        ) : (
          <div className="space-y-2">
            {employees.map((e) => (
              <div key={e.workerId} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{e.name}{e.cnic ? <span className="text-[10px] font-normal text-gray-400"> · {e.cnic}</span> : ''}</div>
                    <div className="text-xs text-gray-500">{e.totals.monthsPaid} month(s) · gross {PKR(e.totals.gross)} · <span className="text-violet-700">tax/statutory {PKR(e.totals.statutory)}</span> · net {PKR(e.totals.net)}</div>
                    {Object.keys(e.totals.byStatutory || {}).length > 0 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{Object.entries(e.totals.byStatutory).map(([k, v]) => `${k} ${PKR(v)}`).join(' · ')}</div>
                    )}
                  </div>
                  <button onClick={() => printTaxCertificate(e, meta, company)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                    <Printer className="w-3.5 h-3.5" /> Certificate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400">Built from paid payroll runs in the tax year (1 July – 30 June). Each certificate states the salary paid and tax/statutory withheld under section 149 of the Income Tax Ordinance, 2001.</p>
      </div>
    </SlideDrawer>
  );
}

// Remit accrued statutory liabilities (2050 Tax Payable / 2055 EOBI Payable) to
// the authority — shows each account's outstanding GL balance, records a payment
// (DR liability / CR Cash & Bank), and lists remittance history.
function StatutoryRemittancePanel({ canPay, entity = 'mill', bankAccounts = [], company, addToast }) {
  const { data: liabilities = [], isLoading: loadingLiab } = useStatutoryLiabilities({ entity });
  const { data: history = [], isLoading: loadingHist } = useStatutoryRemittances({ entity });
  const createMut = useCreateStatutoryRemittance();
  const deleteMut = useDeleteStatutoryRemittance();
  const payBanks = (bankAccounts || []).filter((a) => a.type !== 'cash');
  const owed = liabilities.filter((l) => parseFloat(l.outstanding) > 0);
  const blank = { liability_account_code: '', amount: '', pay_method: 'cash', bank_account_id: '', remit_date: new Date().toISOString().slice(0, 10), reference: '', authority: '', period_from: '', period_to: '', notes: '' };
  const [form, setForm] = useState(blank);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const pickAccount = (code) => {
    const l = liabilities.find((x) => x.code === code);
    const authority = code === '2055' ? 'EOBI' : code === '2050' ? 'FBR' : '';
    set({ liability_account_code: code, amount: l ? Math.round(parseFloat(l.outstanding) || 0) : '', authority });
  };

  async function remit() {
    if (!form.liability_account_code) { addToast('Pick a liability to remit', 'error'); return; }
    if (!(parseFloat(form.amount) > 0)) { addToast('Enter an amount', 'error'); return; }
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account', 'error'); return; }
    try {
      await createMut.mutateAsync({ ...form, entity, amount: parseFloat(form.amount), bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null });
      addToast(`Remitted ${PKR(form.amount)}`, 'success');
      setForm(blank);
    } catch (e) { addToast(e.message, 'error'); }
  }
  async function reverse(r) {
    try { await deleteMut.mutateAsync(r.id); addToast('Remittance reversed', 'success'); } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <div className="space-y-4">
      {/* Outstanding balances */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">Outstanding statutory liabilities</div>
        {loadingLiab ? <p className="text-sm text-gray-400">Loading…</p> : !liabilities.length ? (
          <p className="text-sm text-gray-400">No statutory liability accounts.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {liabilities.map((l) => (
              <div key={l.code} className={`rounded-lg border p-3 ${parseFloat(l.outstanding) > 0 ? 'border-violet-200 bg-violet-50' : 'border-gray-200'}`}>
                <div className="text-[10px] uppercase text-gray-400">{l.code} {l.name}</div>
                <div className={`text-sm font-semibold tabular-nums ${parseFloat(l.outstanding) > 0 ? 'text-violet-700' : 'text-gray-500'}`}>{PKR(l.outstanding)}</div>
                {parseFloat(l.outstanding) > 0 && canPay && (
                  <button onClick={() => pickAccount(l.code)} className="mt-1 text-[11px] text-violet-700 font-medium hover:underline">Remit →</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Record remittance */}
      {canPay ? (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-600">Record a remittance</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Liability</label>
              <select value={form.liability_account_code} onChange={(e) => pickAccount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select…</option>
                {(owed.length ? owed : liabilities).map((l) => <option key={l.code} value={l.code}>{l.code} {l.name} ({PKR(l.outstanding)})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Amount (Rs)</label>
              <input type="number" value={form.amount} onChange={(e) => set({ amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Pay via</label>
              <select value={form.pay_method === 'bank' ? `bank:${form.bank_account_id}` : 'cash'} onChange={(e) => { const v = e.target.value; if (v === 'cash') set({ pay_method: 'cash', bank_account_id: '' }); else set({ pay_method: 'bank', bank_account_id: v.replace('bank:', '') }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="cash">Mill Cash</option>
                {payBanks.map((a) => <option key={a.id} value={`bank:${a.id}`}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Date</label>
              <input type="date" value={form.remit_date} onChange={(e) => set({ remit_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Authority</label>
              <input value={form.authority} onChange={(e) => set({ authority: e.target.value })} placeholder="FBR / EOBI" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Challan / CPR ref</label>
              <input value={form.reference} onChange={(e) => set({ reference: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={remit} disabled={createMut.isPending} className="px-4 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">Record remittance</button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">You don't have permission to record remittances (needs payroll Pay).</p>
      )}

      {/* History */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">Remittance history</div>
        {loadingHist ? <p className="text-sm text-gray-400">Loading…</p> : !history.length ? (
          <p className="text-sm text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">No remittances recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{r.remittanceNo} · {PKR(r.amount)} <span className="text-[10px] font-normal text-gray-400">{r.accountName}</span></div>
                  <div className="text-xs text-gray-500">{fmtDate(r.remitDate)} · {r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash'}{r.authority ? ` · ${r.authority}` : ''}{r.reference ? ` · ${r.reference}` : ''}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => printStatutoryRemittance(r, company)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100" title="Print remittance voucher"><Receipt className="w-3.5 h-3.5" /> Voucher</button>
                  {canPay && <button onClick={() => reverse(r)} disabled={deleteMut.isPending} className="p-1.5 rounded-md text-red-500 hover:bg-red-50" title="Reverse remittance"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PayrollScheduleDrawer({ canManage, canPrepare, onClose, onRunNow, runNowBusy, addToast }) {
  const { data: schedule, isLoading } = usePayrollSchedule();
  const saveMut = useSavePayrollSchedule();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (schedule !== undefined) setForm({
      active: schedule?.active ?? false,
      day_of_month: schedule?.dayOfMonth ?? 28,
      pay_method: schedule?.payMethod ?? 'cash',
      notes: schedule?.notes ?? '',
    });
  }, [schedule]);
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
const RUN_STATUS_TONE = { prepared: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', accrued: 'bg-violet-100 text-violet-700', partially_paid: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700', posted: 'bg-emerald-100 text-emerald-700', voided: 'bg-gray-100 text-gray-500' };
function PayslipsPanel({ runId, companyProfile, canApprove, canPay, canDelete, addToast, onClose, onUndo, onApprove, onPay, onVoid, onAccrue, onSettle, deleteRunMut, approveRunMut, payRunMut, voidRunMut, accrueRunMut, settleRunMut }) {
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
  useEffect(() => { setSelected(new Set()); }, [runId, st]);
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
            {canSelectPay && selected.size > 0 && <button onClick={() => onPay(run, [...selected])} disabled={busy} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Pay selected {PKR(selectedTotal)}</button>}
            {canSelectPay && selected.size === 0 && unpaidLines.length > 0 && <button onClick={() => onPay(run)} disabled={busy} className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{isPartial ? 'Pay remaining' : 'Pay all'} {PKR(unpaidTotal)}</button>}
            {canApprove && st === 'approved' && <button onClick={() => onAccrue(run)} disabled={busy} className="px-4 py-2 text-sm text-violet-700 bg-violet-50 rounded-lg hover:bg-violet-100 disabled:opacity-50">Accrue (pay later)</button>}
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
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${RUN_STATUS_TONE[st] || 'bg-gray-100 text-gray-600'}`}>{st}</span>
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
                    {linePaid && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700 uppercase">paid</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                    Gross {PKR(l.grossPay)}{parseFloat(l.advanceDeducted) > 0 ? ` · advance −${PKR(l.advanceDeducted)}` : ''} · <span className="text-emerald-700 font-medium">net {PKR(l.netPay)}</span>
                  </div>
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
  const co = company || {};
  const name = co.legalName || co.name || 'AGRI COMMODITIES';
  const rs = (v) => 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (x) => x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
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
function PayrollReport({ companyProfile, entity = 'mill', onOpenRun }) {
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
        <Stat tone="slate" icon={DollarSign} label="Gross"        value={PKR(totals.grossTotal)} sub="All runs" />
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

// ─── Per-employee ledger: every amount paid to a worker (advances + payroll net
// pay + other salary disbursements), newest first, with the period total. ───
const LEDGER_TYPE_STYLE = {
  advance: 'bg-amber-100 text-amber-700',
  payroll: 'bg-emerald-100 text-emerald-700',
  other: 'bg-gray-100 text-gray-600',
};
// Compact labelled stat for the employee-ledger summary grid.
function Sm({ label, value, tone = 'gray' }) {
  const t = { gray: 'text-gray-900 border-gray-200 bg-gray-50', amber: 'text-amber-700 border-amber-200 bg-amber-50', emerald: 'text-emerald-700 border-emerald-200 bg-emerald-50', rose: 'text-red-600 border-red-200 bg-red-50' }[tone] || 'text-gray-900 border-gray-200 bg-gray-50';
  return (
    <div className={`rounded-lg border p-2.5 ${t}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function EmployeeLedgerDrawer({ worker, onClose }) {
  const { data, isLoading } = useWorkerLedger(worker?.id);
  const rs = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
                      <td data-label="Date" className="px-3 py-2 whitespace-nowrap text-gray-600">{e.date ? new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
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
          <p className="text-[11px] text-gray-400">Debit = paid to employee (advance / net salary); Credit = salary earned (gross). Balance &gt; 0 → salary still payable; balance &lt; 0 → employee owes the company (outstanding advance).</p>
        </div>
        );
      })()}
    </SlideDrawer>
  );
}
