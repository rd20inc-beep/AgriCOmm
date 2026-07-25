import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle,
  PauseCircle,
  CreditCard,
  Banknote,
  FileText,
  TrendingUp,
  ArrowRight,
  Receipt,
  Mail,
  Landmark,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { useAuth } from '../../../context/AuthContext';
import { useUpdateOrderStatus, useRecordExportReceipt, usePendingExportReceipts, useConfirmExportReceipt, useRejectExportReceipt, useReceivables } from '../../../api/queries';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import EmailComposer from '../../../components/EmailComposer';

function formatCurrency(value) {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPKR(value) {
  return 'Rs ' + (parseFloat(value) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daysSince(dateStr) {
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

export default function FinanceConfirmations() {
  const { exportOrders, addToast, settings, bankAccountsList } = useApp();
  const { requestOwnerApproval } = useOwnerAuth();
  const { hasPermission } = useAuth();
  // Finance (payments-only) can't open export order pages — render order numbers
  // as plain text for them instead of an /export link that lands on Access Denied.
  const canViewExport = hasPermission('export_orders', 'view');
  const orderRef = (id, cls = 'font-semibold text-blue-600 hover:text-blue-800') =>
    (canViewExport
      ? <Link to={`/export/${id}`} className={cls}>{id}</Link>
      : <span className="font-semibold text-gray-700">{id}</span>);

  // Receivables are finance-accessible (masked) — the export orders list is not.
  // Use them to drive the KPI cards so Finance sees real, current figures (in PKR)
  // that reflect a just-confirmed receipt, instead of the export-order summary
  // (which is empty/zero for payments-only Finance).
  const { data: receivables = [] } = useReceivables();
  const financeSummary = useMemo(() => {
    let expected = 0, received = 0;
    receivables.forEach((r) => {
      const expPkr = parseFloat(r.baseAmountPkr) || 0; // expected, in PKR
      const expCur = parseFloat(r.expectedAmount) || 0;
      const frac = expCur > 0 ? Math.min(1, (parseFloat(r.receivedAmount) || 0) / expCur) : 0;
      expected += expPkr;
      received += expPkr * frac;
    });
    return { expected, received, outstanding: Math.max(0, expected - received) };
  }, [receivables]);

  const recordReceiptMut = useRecordExportReceipt();
  const updateStatusMut = useUpdateOrderStatus();
  // Item 14 — pending export receipts inbox (Finance verifies FX + confirms).
  const { data: pendingReceipts = [] } = usePendingExportReceipts();
  const confirmReceiptMut = useConfirmExportReceipt();
  const rejectReceiptMut = useRejectExportReceipt();
  const [fxByPayment, setFxByPayment] = useState({});

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [milestoneType, setMilestoneType] = useState('advance');
  const [formData, setFormData] = useState({
    receivedAmount: 0,
    date: new Date().toISOString().split('T')[0],
    paymentMethod: 'Bank Transfer',
    bankAccount: '',
    bankReference: '',
    notes: '',
  });
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [emailOrder, setEmailOrder] = useState(null);
  const [emailType, setEmailType] = useState('advance');

  // === COMPUTED LISTS ===

  const pendingAdvance = useMemo(() => {
    return exportOrders.filter(
      (o) => o.advanceReceived < o.advanceExpected && o.status === 'Awaiting Advance'
    );
  }, [exportOrders]);

  const pendingBalance = useMemo(() => {
    return exportOrders.filter(
      (o) => o.balanceReceived < o.balanceExpected && o.status === 'Awaiting Balance'
    );
  }, [exportOrders]);

  const overdueCollections = useMemo(() => {
    return exportOrders.filter(
      (o) => o.status === 'Awaiting Advance' && daysSince(o.createdAt) > (settings.paymentReminderDays * 2)
    );
  }, [exportOrders, settings.paymentReminderDays]);

  // Partial payments — orders with some payment but not full
  const partialPayments = useMemo(() => {
    return exportOrders.filter(o => {
      const advPartial = o.advanceReceived > 0 && o.advanceReceived < o.advanceExpected;
      const balPartial = o.balanceReceived > 0 && o.balanceReceived < o.balanceExpected;
      return advPartial || balPartial;
    });
  }, [exportOrders]);

  // === FINANCIAL SUMMARY KPIs ===

  const summary = useMemo(() => {
    let totalReceivables = 0;
    let totalReceived = 0;
    let totalOutstanding = 0;
    let totalContractValue = 0;

    exportOrders.forEach(o => {
      if (o.status === 'Cancelled') return;
      totalContractValue += o.contractValue;
      totalReceivables += o.advanceExpected + o.balanceExpected;
      totalReceived += o.advanceReceived + o.balanceReceived;
      const outstanding = (o.advanceExpected - o.advanceReceived) + (o.balanceExpected - o.balanceReceived);
      if (outstanding > 0) totalOutstanding += outstanding;
    });

    return { totalReceivables, totalReceived, totalOutstanding, totalContractValue };
  }, [exportOrders]);

  // === MODAL HANDLERS ===

  function openModal(order, type) {
    setSelectedOrder(order);
    setMilestoneType(type);
    const expectedAmount = type === 'advance'
      ? order.advanceExpected - order.advanceReceived
      : order.balanceExpected - order.balanceReceived;
    setFormData({
      receivedAmount: Math.max(0, expectedAmount),
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'Bank Transfer',
      bankAccount: '',
      bankAccountId: '',
      bankReference: '',
      notes: '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedOrder(null);
  }

  function recordPayment(orderId, type, amount, method, reference, bankAccount) {
    setPaymentHistory(prev => [{
      id: Date.now(),
      orderId,
      type,
      amount,
      method,
      reference,
      bankAccount,
      date: formData.date,
      timestamp: new Date().toLocaleString(),
    }, ...prev]);
  }

  // Recording a receipt (full or partial) now SUBMITS a pending receipt; Finance
  // confirms it below with the actual FX rate (item 14).
  async function submitPendingReceipt(amount) {
    if (!selectedOrder) return;
    if (isNaN(amount) || amount <= 0) { addToast('Please enter a valid amount', 'error'); return; }
    const orderId = selectedOrder.dbId || selectedOrder.id;
    try {
      await recordReceiptMut.mutateAsync({
        id: orderId,
        data: {
          kind: milestoneType,
          amount,
          payment_date: formData.date,
          payment_method: formData.paymentMethod,
          bank_account_id: formData.bankAccountId || null,
          notes: formData.notes,
        },
      });
      addToast(`${milestoneType === 'advance' ? 'Advance' : 'Balance'} of ${formatCurrency(amount)} submitted — pending confirmation`);
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Failed to submit receipt', 'error');
    }
    closeModal();
  }
  function handleConfirmReceipt() { return submitPendingReceipt(parseFloat(formData.receivedAmount)); }
  function handleMarkPartial() { return submitPendingReceipt(parseFloat(formData.receivedAmount)); }

  // Finance confirms a PENDING receipt with the actual FX rate → posts it.
  async function confirmPending(p) {
    const isForeign = (p.currency || 'USD') !== 'PKR';
    const fx = parseFloat(fxByPayment[p.id]) || parseFloat(p.fxRate) || 0;
    if (isForeign && fx <= 0) { addToast('Enter the FX rate the bank applied', 'error'); return; }
    try {
      await requestOwnerApproval((ownerId) => confirmReceiptMut.mutateAsync({
        paymentId: p.id, data: { fx_rate: isForeign ? fx : 1, authorized_by_owner_id: ownerId },
      }));
      addToast(`${p.receiptType} receipt for ${p.orderNo} confirmed & posted`);
    } catch (err) {
      if (err?.message !== 'Owner authorization cancelled') addToast(err?.data?.message || err?.message || 'Confirmation failed', 'error');
    }
  }
  async function rejectPending(p) {
    const reason = window.prompt(`Reject the ${p.receiptType} receipt for ${p.orderNo}? Enter a reason:`);
    if (reason === null) return;
    try {
      await rejectReceiptMut.mutateAsync({ paymentId: p.id, data: { reason } });
      addToast('Receipt marked as not received', 'warning');
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Reject failed', 'error');
    }
  }

  async function handlePutOnHold() {
    if (!selectedOrder) return;
    try {
      await updateStatusMut.mutateAsync({
        id: selectedOrder.dbId || selectedOrder.id,
        data: { status: 'Cancelled', notes: `Put on hold by Finance. Reason: ${formData.notes || 'Payment issue'}` },
      });
      addToast(`${selectedOrder.id} cancelled due to payment hold`, 'warning');
    } catch (err) {
      addToast(`Failed to update order: ${err.message || 'Server error'}`, 'error');
    }
    closeModal();
  }

  // === ROW RENDERER ===

  function renderOrderRow(order, type) {
    const expected = type === 'advance' ? order.advanceExpected : order.balanceExpected;
    const received = type === 'advance' ? order.advanceReceived : order.balanceReceived;
    const remaining = expected - received;
    const pctReceived = expected > 0 ? (received / expected) * 100 : 0;
    const isOverdue = type === 'advance' && daysSince(order.createdAt) > (settings.paymentReminderDays * 2);

    return (
      <div
        key={`${order.id}-${type}`}
        className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border ${
          isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'
        } hover:shadow-sm transition-shadow`}
      >
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            type === 'advance' ? 'bg-amber-100' : 'bg-amber-100'
          }`}>
            {type === 'advance' ? (
              <Banknote size={20} className="text-amber-600" />
            ) : (
              <CreditCard size={20} className="text-amber-600" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {orderRef(order.id, 'text-sm font-semibold text-blue-600 hover:text-blue-800')}
              <span className="text-xs text-gray-400">|</span>
              <span className="text-sm text-gray-600 truncate"><PartyLink type="customer" id={order.customerId} name={order.customerName} /></span>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-xs text-gray-500">{order.country}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-500 capitalize">
                {type === 'advance' ? `Advance ${order.advancePct}%` : `Balance ${100 - order.advancePct}%`}
              </span>
              {/* Progress bar */}
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${pctReceived >= 100 ? 'bg-emerald-500' : pctReceived > 0 ? 'bg-amber-500' : 'bg-gray-300'}`}
                  style={{ width: `${Math.min(pctReceived, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400">{pctReceived.toFixed(0)}%</span>
              {isOverdue && (
                <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                  <AlertTriangle size={12} />
                  {daysSince(order.createdAt)}d overdue
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <div className="text-sm font-semibold text-gray-900">
              {formatCurrency(remaining)}
            </div>
            <div className="text-xs text-gray-400">
              of {formatCurrency(expected)}
            </div>
          </div>
          <StatusBadge status={order.status} />
          <button
            onClick={() => { setEmailOrder(order); setEmailType(type); }}
            className="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Send Payment Reminder"
          >
            <Mail size={14} />
          </button>
          <button
            onClick={() => openModal(order, type)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <CheckCircle size={14} />
            Confirm
          </button>
        </div>
      </div>
    );
  }

  // Card figures: Owner/Export get the order-level summary ($); payments-only
  // Finance gets the receivables-based summary (Rs), which is populated for them.
  const cards = canViewExport
    ? { fmt: formatCurrency, receivables: summary.totalReceivables, received: summary.totalReceived, outstanding: summary.totalOutstanding, subCount: exportOrders.filter((o) => o.status !== 'Cancelled').length }
    : { fmt: fmtPKR, receivables: financeSummary.expected, received: financeSummary.received, outstanding: financeSummary.outstanding, subCount: receivables.length };
  const cardRate = cards.receivables > 0 ? (cards.received / cards.receivables) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance & Collections</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage advance, balance payments and accounts receivable
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canViewExport && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
            <Clock size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              {pendingAdvance.length} advances
            </span>
          </div>
          )}
          {canViewExport && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
            <DollarSign size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              {pendingBalance.length} balances
            </span>
          </div>
          )}
          {canViewExport && overdueCollections.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-700">
                {overdueCollections.length} overdue
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Pending export receipts — Finance verifies FX + confirms (item 14) */}
      <div className="bg-white rounded-xl shadow-sm p-5 border border-amber-200">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Pending Finance Confirmation</h2>
          <span className="ml-auto text-xs text-gray-400">{pendingReceipts.length} receipt{pendingReceipts.length !== 1 ? 's' : ''}</span>
        </div>
        {pendingReceipts.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">No receipts awaiting confirmation.</div>
        ) : (
          <div className="space-y-2">
            {pendingReceipts.map((p) => {
              const isForeign = (p.currency || 'USD') !== 'PKR';
              const fx = parseFloat(fxByPayment[p.id]) || parseFloat(p.fxRate) || 0;
              const pkr = (parseFloat(p.amount) || 0) * (isForeign ? fx : 1);
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border border-gray-100 rounded-lg p-3 bg-amber-50/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      {p.orderId && canViewExport
                        ? <Link to={`/export/${p.orderId}`} className="font-semibold text-blue-600 hover:text-blue-800">{p.orderNo}</Link>
                        : <span className="font-semibold text-gray-700">{p.orderNo}</span>}
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-700"><PartyLink type="customer" id={p.customerId} name={p.customerName} /></span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{p.receiptType}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {p.currency} {Number(p.amount).toLocaleString()} · recorded by {p.recordedByName || '—'} · {p.paymentDate ? String(p.paymentDate).slice(0, 10) : ''}
                    </div>
                    <div className="text-xs mt-0.5 inline-flex items-center gap-1 text-emerald-700">
                      <Landmark size={12} className="flex-shrink-0" />
                      {p.bankAccountName
                        ? <>Receiving in <span className="font-medium">{p.bankAccountName}</span>{p.bankName ? ` (${p.bankName})` : ''}</>
                        : <span className="text-amber-600">Receiving account not set</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isForeign && (
                      <div className="text-right">
                        <label className="block text-[10px] text-gray-400 uppercase">FX rate</label>
                        <input type="number" step="0.0001" value={fxByPayment[p.id] ?? (p.fxRate || '')}
                          onChange={(e) => setFxByPayment((s) => ({ ...s, [p.id]: e.target.value }))}
                          placeholder="rate" className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right" />
                      </div>
                    )}
                    <div className="text-right text-xs text-gray-500 w-28">
                      <span className="block text-[10px] uppercase text-gray-400">PKR</span>
                      Rs {pkr.toLocaleString('en-PK', { maximumFractionDigits: 0 })}
                    </div>
                    <button onClick={() => confirmPending(p)} disabled={confirmReceiptMut.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle size={14} /> Confirm
                    </button>
                    <button onClick={() => rejectPending(p)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50">
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Financial Summary KPIs */}
      <div className="kpi-grid">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Receivables</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{cards.fmt(cards.receivables)}</p>
          <p className="text-xs text-gray-400 mt-0.5">across {cards.subCount} {canViewExport ? 'orders' : 'receivables'}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-emerald-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Received</span>
          </div>
          <p className="text-xl font-bold text-emerald-700">{cards.fmt(cards.received)}</p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
            <div
              className="h-1.5 rounded-full bg-emerald-500"
              style={{ width: `${cards.receivables > 0 ? Math.min((cards.received / cards.receivables) * 100, 100) : 0}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-amber-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Outstanding</span>
          </div>
          <p className="text-xl font-bold text-amber-700">{cards.fmt(cards.outstanding)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {cards.receivables > 0 ? ((cards.outstanding / cards.receivables) * 100).toFixed(1) : 0}% of receivables
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-purple-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Collection Rate</span>
          </div>
          <p className="text-xl font-bold text-purple-700">{cardRate.toFixed(1)}%</p>
          <p className="text-xs text-gray-400 mt-0.5">{cards.fmt(cards.received)} of {cards.fmt(cards.receivables)}</p>
        </div>
      </div>

      {/* Order-level collections tracking — needs the export orders list, which
          payments-only Finance can't load, so it's shown only to export/owner. */}
      {canViewExport && (<>
      {/* Overdue Collections */}
      {overdueCollections.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Overdue Collections
            </h2>
            <span className="ml-auto text-xs text-red-500 font-medium">
              {overdueCollections.length} order{overdueCollections.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-3">
            {overdueCollections.map((order) => renderOrderRow(order, 'advance'))}
          </div>
        </div>
      )}

      {/* Pending Advance Confirmations */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Banknote size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Pending Advance Confirmations
          </h2>
          <span className="ml-auto text-xs text-gray-400">
            {pendingAdvance.length} order{pendingAdvance.length !== 1 ? 's' : ''}
          </span>
        </div>
        {pendingAdvance.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No pending advance confirmations</div>
        ) : (
          <div className="space-y-3">
            {pendingAdvance.map((order) => renderOrderRow(order, 'advance'))}
          </div>
        )}
      </div>

      {/* Pending Balance Confirmations */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Pending Balance Confirmations
          </h2>
          <span className="ml-auto text-xs text-gray-400">
            {pendingBalance.length} order{pendingBalance.length !== 1 ? 's' : ''}
          </span>
        </div>
        {pendingBalance.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No pending balance confirmations</div>
        ) : (
          <div className="space-y-3">
            {pendingBalance.map((order) => renderOrderRow(order, 'balance'))}
          </div>
        )}
      </div>

      {/* Partial Payments */}
      {partialPayments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt size={16} className="text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Partial Payments
            </h2>
            <span className="ml-auto text-xs text-gray-400">
              {partialPayments.length} order{partialPayments.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="table-container mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Order</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Adv Expected</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Adv Received</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Bal Expected</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Bal Received</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {partialPayments.map(o => {
                  const outstanding = (o.advanceExpected - o.advanceReceived) + (o.balanceExpected - o.balanceReceived);
                  const advPartial = o.advanceReceived > 0 && o.advanceReceived < o.advanceExpected;
                  return (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td data-label="Order" className="py-2.5 px-3">
                        {orderRef(o.id)}
                      </td>
                      <td data-label="Customer" className="py-2.5 px-3 text-gray-600 truncate max-w-[150px]"><PartyLink type="customer" id={o.customerId} name={o.customerName} /></td>
                      <td data-label="Adv Expected" className="mob-hide py-2.5 px-3 text-right text-gray-700">{formatCurrency(o.advanceExpected)}</td>
                      <td data-label="Adv Received" className={`py-2.5 px-3 text-right font-medium ${o.advanceReceived >= o.advanceExpected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {formatCurrency(o.advanceReceived)}
                      </td>
                      <td data-label="Bal Expected" className="mob-hide py-2.5 px-3 text-right text-gray-700">{formatCurrency(o.balanceExpected)}</td>
                      <td data-label="Bal Received" className={`py-2.5 px-3 text-right font-medium ${o.balanceReceived >= o.balanceExpected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {formatCurrency(o.balanceReceived)}
                      </td>
                      <td data-label="Outstanding" className="py-2.5 px-3 text-right font-bold text-red-600">{formatCurrency(outstanding)}</td>
                      <td data-label="Action" className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => openModal(o, advPartial ? 'advance' : 'balance')}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Confirm More
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Accounts Receivable Summary */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={16} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Accounts Receivable — All Orders
          </h2>
        </div>
        <div className="table-container mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">Order</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-600">Customer</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-gray-600">Contract Value</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-gray-600">Total Received</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-gray-600">Outstanding</th>
                <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-600">Status</th>
                <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-600">Days</th>
              </tr>
            </thead>
            <tbody>
              {exportOrders
                .filter(o => o.status !== 'Cancelled' && o.status !== 'Draft')
                .sort((a, b) => {
                  const aOut = (a.advanceExpected - a.advanceReceived) + (a.balanceExpected - a.balanceReceived);
                  const bOut = (b.advanceExpected - b.advanceReceived) + (b.balanceExpected - b.balanceReceived);
                  return bOut - aOut;
                })
                .map(o => {
                  const totalReceived = o.advanceReceived + o.balanceReceived;
                  const outstanding = o.contractValue - totalReceived;
                  const days = daysSince(o.createdAt);
                  return (
                    <tr key={o.id} className={`border-b border-gray-50 hover:bg-gray-50 ${outstanding > 0 ? '' : 'opacity-60'}`}>
                      <td data-label="Order" className="py-2 px-3">
                        {orderRef(o.id)}
                      </td>
                      <td data-label="Customer" className="py-2 px-3 text-gray-600 truncate max-w-[150px]"><PartyLink type="customer" id={o.customerId} name={o.customerName} /></td>
                      <td data-label="Contract Value" className="mob-hide py-2 px-3 text-right text-gray-700">{formatCurrency(o.contractValue)}</td>
                      <td data-label="Total Received" className="py-2 px-3 text-right text-emerald-600 font-medium">{formatCurrency(totalReceived)}</td>
                      <td data-label="Outstanding" className={`py-2 px-3 text-right font-bold ${outstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {outstanding > 0 ? formatCurrency(outstanding) : 'Paid'}
                      </td>
                      <td data-label="Status" className="py-2 px-3 text-center"><StatusBadge status={o.status} /></td>
                      <td data-label="Days" className={`mob-hide py-2 px-3 text-center text-xs font-medium ${days > 60 ? 'text-red-600' : days > 30 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {days}d
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment History Log */}
      {paymentHistory.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt size={16} className="text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Payment History (This Session)
            </h2>
            <span className="ml-auto text-xs text-gray-400">{paymentHistory.length} transaction{paymentHistory.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {paymentHistory.map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle size={16} className="text-emerald-500" />
                  <div>
                    <span className="font-semibold text-gray-900">{p.orderId}</span>
                    <span className="text-gray-400 mx-2">—</span>
                    <span className="text-gray-600 capitalize">{p.type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-bold text-emerald-700">{formatCurrency(p.amount)}</span>
                  <span className="text-xs text-gray-500">{p.method}</span>
                  {p.bankAccount && <span className="text-xs text-gray-400">{p.bankAccount}</span>}
                  {p.reference && <span className="text-xs text-gray-400 font-mono">Ref: {p.reference}</span>}
                  <span className="text-xs text-gray-400">{p.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}

      {/* Confirm Receipt Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={`Confirm ${milestoneType === 'advance' ? 'Advance' : 'Balance'} Receipt — ${selectedOrder?.id || ''}`}
        size="md"
      >
        {selectedOrder && (
          <div className="space-y-4">
            {/* Order Summary */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Customer:</span>{' '}
                  <span className="font-medium text-gray-900"><PartyLink type="customer" id={selectedOrder.customerId} name={selectedOrder.customerName} /></span>
                </div>
                <div>
                  <span className="text-gray-500">Contract:</span>{' '}
                  <span className="font-medium text-gray-900">{formatCurrency(selectedOrder.contractValue)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Expected:</span>{' '}
                  <span className="font-medium text-gray-900">
                    {formatCurrency(milestoneType === 'advance' ? selectedOrder.advanceExpected : selectedOrder.balanceExpected)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Received so far:</span>{' '}
                  <span className="font-medium text-emerald-600">
                    {formatCurrency(milestoneType === 'advance' ? selectedOrder.advanceReceived : selectedOrder.balanceReceived)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Remaining:</span>{' '}
                  <span className="font-bold text-amber-700">
                    {formatCurrency(
                      (milestoneType === 'advance' ? selectedOrder.advanceExpected - selectedOrder.advanceReceived : selectedOrder.balanceExpected - selectedOrder.balanceReceived)
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Country:</span>{' '}
                  <span className="font-medium text-gray-900">{selectedOrder.country}</span>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Received Amount (USD)</label>
              <input
                type="number"
                value={formData.receivedAmount}
                onChange={(e) => setFormData({ ...formData, receivedAmount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="wire">Wire</option>
                  <option value="lc">Letter of Credit</option>
                  <option value="tt">Telegraphic Transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Receiving Bank Account</label>
              <select
                value={formData.bankAccountId}
                onChange={(e) => {
                  const acct = bankAccountsList.find(a => String(a.id) === e.target.value);
                  setFormData({ ...formData, bankAccountId: e.target.value, bankAccount: acct ? acct.name : '' });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                <option value="">Select account...</option>
                {(bankAccountsList || []).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency}) — {a.bankName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Reference / TXN ID</label>
              <input
                type="text"
                value={formData.bankReference}
                onChange={(e) => setFormData({ ...formData, bankReference: e.target.value })}
                placeholder="e.g. TXN-20260317-001"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                placeholder="Additional notes..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              />
            </div>

            {/* Accounting Impact Preview */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Accounting Impact</h4>
              <div className="font-mono text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-700">DR: {formData.bankAccount || 'Bank Account'}</span>
                  <span className="text-gray-900 font-medium">{formatCurrency(parseFloat(formData.receivedAmount) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">CR: Accounts Receivable — {selectedOrder.customerName}</span>
                  <span className="text-gray-900 font-medium">{formatCurrency(parseFloat(formData.receivedAmount) || 0)}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={handleConfirmReceipt}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <CheckCircle size={16} />
                Submit for confirmation
              </button>
              <button
                onClick={handlePutOnHold}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors"
              >
                <PauseCircle size={16} />
                Hold
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Email Composer for Payment Reminders */}
      {emailOrder && (
        <EmailComposer
          isOpen={!!emailOrder}
          onClose={() => setEmailOrder(null)}
          defaultTo=""
          defaultSubject={emailType === 'advance'
            ? `Advance Payment Required - Order ${emailOrder.id}`
            : `Balance Payment Due - Order ${emailOrder.id}`
          }
          defaultBody={emailType === 'advance'
            ? `Dear Customer,\n\nThis is a reminder regarding the advance payment for Order ${emailOrder.id}.\n\nAdvance Expected: ${formatCurrency(emailOrder.advanceExpected)}\nAdvance Received: ${formatCurrency(emailOrder.advanceReceived)}\nRemaining: ${formatCurrency(emailOrder.advanceExpected - emailOrder.advanceReceived)}\n\nPlease arrange the payment at your earliest convenience.\n\nBest regards,\nAGRI COMMODITIES`
            : `Dear Customer,\n\nThis is a reminder regarding the balance payment for Order ${emailOrder.id}.\n\nBalance Expected: ${formatCurrency(emailOrder.balanceExpected)}\nBalance Received: ${formatCurrency(emailOrder.balanceReceived)}\nRemaining: ${formatCurrency(emailOrder.balanceExpected - emailOrder.balanceReceived)}\n\nPlease arrange the payment at your earliest convenience.\n\nBest regards,\nAGRI COMMODITIES`
          }
        />
      )}
    </div>
  );
}
