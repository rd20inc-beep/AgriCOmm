import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import api from '../../api/client';
import { transformBankAccount } from '../../api/transforms';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import EmailComposer from '../../components/EmailComposer';

function formatCurrency(value) {
  return '$' + value.toLocaleString('en-US');
}

function daysSince(dateStr) {
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

export default function FinanceConfirmations() {
  const { exportOrders, addToast, settings, bankAccountsList: contextBankAccounts, refreshFromApi } = useApp();

  // Fetch bank accounts directly — bypasses TanStack Query caching issues
  const [bankAccountsList, setBankAccountsList] = useState([]);
  useEffect(() => {
    api.get('/api/finance/bank-accounts')
      .then(res => {
        const raw = res?.data?.accounts || res?.data?.bank_accounts || [];
        setBankAccountsList(raw.map(transformBankAccount));
      })
      .catch(() => { if (contextBankAccounts?.length > 0) setBankAccountsList(contextBankAccounts); });
  }, []);

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

  async function handleConfirmReceipt() {
    if (!selectedOrder) return;
    const amount = parseFloat(formData.receivedAmount);
    if (isNaN(amount) || amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }

    // Backend-first: call API, then update UI only on success
    try {
      const endpoint = milestoneType === 'advance' ? 'confirm-advance' : 'confirm-balance';
      await api.post(`/api/export-orders/${selectedOrder.dbId || selectedOrder.id}/${endpoint}`, {
        amount,
        payment_date: formData.date,
        payment_method: formData.paymentMethod,
        bank_account_id: formData.bankAccountId || null,
        bank_reference: formData.bankReference,
        notes: formData.notes,
      });

      const label = milestoneType === 'advance' ? 'Advance' : 'Balance';
      addToast(`${label} payment of ${formatCurrency(amount)} confirmed for ${selectedOrder.id}`);
      recordPayment(selectedOrder.id, milestoneType, amount, formData.paymentMethod, formData.bankReference, formData.bankAccount);
      refreshFromApi('orders');
      refreshFromApi('finance');
    } catch (err) {
      addToast(`Payment confirmation failed: ${err.message || 'Server error'}`, 'error');
    }
    closeModal();
  }

  async function handleMarkPartial() {
    if (!selectedOrder) return;
    const amount = parseFloat(formData.receivedAmount);
    if (isNaN(amount) || amount <= 0) {
      addToast('Please enter a valid amount', 'error');
      return;
    }

    // Backend-first: same endpoint handles partial payments (doesn't auto-transition if not full)
    try {
      const endpoint = milestoneType === 'advance' ? 'confirm-advance' : 'confirm-balance';
      await api.post(`/api/export-orders/${selectedOrder.dbId || selectedOrder.id}/${endpoint}`, {
        amount,
        payment_date: formData.date,
        payment_method: formData.paymentMethod,
        bank_account_id: formData.bankAccountId || null,
        bank_reference: formData.bankReference,
        notes: formData.notes,
      });

      const label = milestoneType === 'advance' ? 'advance' : 'balance';
      addToast(`Partial ${label} of ${formatCurrency(amount)} recorded for ${selectedOrder.id}`, 'warning');
      recordPayment(selectedOrder.id, milestoneType + ' (partial)', amount, formData.paymentMethod, formData.bankReference, formData.bankAccount);
      refreshFromApi('orders');
      refreshFromApi('finance');
    } catch (err) {
      addToast(`Partial payment failed: ${err.message || 'Server error'}`, 'error');
    }
    closeModal();
  }

  async function handlePutOnHold() {
    if (!selectedOrder) return;
    try {
      await api.put(`/api/export-orders/${selectedOrder.dbId || selectedOrder.id}/status`, {
        status: 'Cancelled',
        notes: `Put on hold by Finance. Reason: ${formData.notes || 'Payment issue'}`,
      });
      addToast(`${selectedOrder.id} cancelled due to payment hold`, 'warning');
      refreshFromApi('orders');
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
            type === 'advance' ? 'bg-amber-100' : 'bg-orange-100'
          }`}>
            {type === 'advance' ? (
              <Banknote size={20} className="text-amber-600" />
            ) : (
              <CreditCard size={20} className="text-orange-600" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link to={`/export/${order.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-800">{order.id}</Link>
              <span className="text-xs text-gray-400">|</span>
              <span className="text-sm text-gray-600 truncate">{order.customerName}</span>
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
                  className={`h-1.5 rounded-full ${pctReceived >= 100 ? 'bg-green-500' : pctReceived > 0 ? 'bg-amber-500' : 'bg-gray-300'}`}
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
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
            <Clock size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-700">
              {pendingAdvance.length} advances
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 rounded-lg border border-orange-200">
            <DollarSign size={14} className="text-orange-600" />
            <span className="text-xs font-medium text-orange-700">
              {pendingBalance.length} balances
            </span>
          </div>
          {overdueCollections.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-700">
                {overdueCollections.length} overdue
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Financial Summary KPIs */}
      <div className="kpi-grid">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Receivables</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.totalReceivables)}</p>
          <p className="text-xs text-gray-400 mt-0.5">across {exportOrders.filter(o => o.status !== 'Cancelled').length} orders</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Received</span>
          </div>
          <p className="text-xl font-bold text-green-700">{formatCurrency(summary.totalReceived)}</p>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
            <div
              className="h-1.5 rounded-full bg-green-500"
              style={{ width: `${summary.totalReceivables > 0 ? Math.min((summary.totalReceived / summary.totalReceivables) * 100, 100) : 0}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-amber-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Outstanding</span>
          </div>
          <p className="text-xl font-bold text-amber-700">{formatCurrency(summary.totalOutstanding)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {summary.totalReceivables > 0 ? ((summary.totalOutstanding / summary.totalReceivables) * 100).toFixed(1) : 0}% of receivables
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-purple-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Collection Rate</span>
          </div>
          <p className="text-xl font-bold text-purple-700">
            {summary.totalReceivables > 0 ? ((summary.totalReceived / summary.totalReceivables) * 100).toFixed(1) : 0}%
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(summary.totalReceived)} of {formatCurrency(summary.totalReceivables)}</p>
        </div>
      </div>

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
          <CreditCard size={16} className="text-orange-500" />
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
          <div className="table-container">
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
                      <td className="py-2.5 px-3">
                        <Link to={`/export/${o.id}`} className="font-semibold text-blue-600 hover:text-blue-800">{o.id}</Link>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 truncate max-w-[150px]">{o.customerName}</td>
                      <td className="py-2.5 px-3 text-right text-gray-700">{formatCurrency(o.advanceExpected)}</td>
                      <td className={`py-2.5 px-3 text-right font-medium ${o.advanceReceived >= o.advanceExpected ? 'text-green-600' : 'text-amber-600'}`}>
                        {formatCurrency(o.advanceReceived)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-700">{formatCurrency(o.balanceExpected)}</td>
                      <td className={`py-2.5 px-3 text-right font-medium ${o.balanceReceived >= o.balanceExpected ? 'text-green-600' : 'text-amber-600'}`}>
                        {formatCurrency(o.balanceReceived)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-red-600">{formatCurrency(outstanding)}</td>
                      <td className="py-2.5 px-3 text-center">
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
        <div className="table-container">
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
                      <td className="py-2 px-3">
                        <Link to={`/export/${o.id}`} className="font-semibold text-blue-600 hover:text-blue-800">{o.id}</Link>
                      </td>
                      <td className="py-2 px-3 text-gray-600 truncate max-w-[150px]">{o.customerName}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{formatCurrency(o.contractValue)}</td>
                      <td className="py-2 px-3 text-right text-green-600 font-medium">{formatCurrency(totalReceived)}</td>
                      <td className={`py-2 px-3 text-right font-bold ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {outstanding > 0 ? formatCurrency(outstanding) : 'Paid'}
                      </td>
                      <td className="py-2 px-3 text-center"><StatusBadge status={o.status} /></td>
                      <td className={`py-2 px-3 text-center text-xs font-medium ${days > 60 ? 'text-red-600' : days > 30 ? 'text-amber-600' : 'text-gray-500'}`}>
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
            <Receipt size={16} className="text-green-500" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Payment History (This Session)
            </h2>
            <span className="ml-auto text-xs text-gray-400">{paymentHistory.length} transaction{paymentHistory.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {paymentHistory.map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 bg-green-50 border border-green-100 rounded-lg px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle size={16} className="text-green-500" />
                  <div>
                    <span className="font-semibold text-gray-900">{p.orderId}</span>
                    <span className="text-gray-400 mx-2">—</span>
                    <span className="text-gray-600 capitalize">{p.type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-bold text-green-700">{formatCurrency(p.amount)}</span>
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
                  <span className="font-medium text-gray-900">{selectedOrder.customerName}</span>
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
                  <span className="font-medium text-green-600">
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
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Wire">Wire</option>
                  <option value="LC">Letter of Credit</option>
                  <option value="TT">Telegraphic Transfer</option>
                  <option value="Cash">Cash</option>
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
                Confirm Full
              </button>
              <button
                onClick={handleMarkPartial}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
              >
                <FileText size={16} />
                Mark Partial
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
