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
  Receipt,
  Mail,
  Landmark,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useUpdateOrderStatus, usePendingExportReceipts, useConfirmExportReceipt, useRejectExportReceipt, useReceivables } from '../../../api/queries';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { canRecordVariant } from '../../../components/payments/paymentVariants';
import StatusBadge from '../../../shared/components/StatusBadge';
import EmailComposer from '../../../components/EmailComposer';
import useConfirm from '../../../hooks/useConfirm';
import { isBalanceDue } from '../../exportOrders/components/constants';
import { fmtUSD, fmtPKR, fmtMoney, fmtDate } from '../../../shared/utils/format';
import { EmptyLine } from '../components/FinanceUI';
import { btnIcon, btnRowPrimary, btnRowSecondary, btnRowQuiet } from '../utils/uiClasses';

// Amount in the order's own currency (an EUR order must not read — or be
// dunned — in dollars). Export orders default to USD.
const fmtOrd = (value, order) => fmtMoney(parseFloat(value) || 0, order?.currency || 'USD');
const fmtRs2 = (value) => fmtPKR(parseFloat(value) || 0, { decimals: 2 });

function daysSince(dateStr) {
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

export default function FinanceConfirmations() {
  const { exportOrders, addToast, settings, customersList = [] } = useApp();
  const { hasPermission } = useAuth();
  // Finance (payments-only) can't open export order pages — render order numbers
  // as plain text for them instead of an /export link that lands on Access Denied.
  const canViewExport = hasPermission('export_orders', 'view');
  // What each button asks of the server: recording a receipt is
  // export_orders.confirm_advance or finance.confirm_payment (record-receipt);
  // confirming / rejecting one is finance.confirm_payment; holding an order
  // is a status change, export_orders.approve.
  const canRecord = canRecordVariant('receive_export', hasPermission);
  const canConfirm = hasPermission('finance', 'confirm_payment');
  const canHold = hasPermission('export_orders', 'approve');
  const drawers = useFinanceDrawers();
  const [confirm, confirmDialog] = useConfirm();
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

  const updateStatusMut = useUpdateOrderStatus();
  // Item 14 — pending export receipts inbox (Finance verifies FX + confirms).
  const { data: pendingReceipts = [] } = usePendingExportReceipts();
  const confirmReceiptMut = useConfirmExportReceipt();
  const rejectReceiptMut = useRejectExportReceipt();
  const [fxByPayment, setFxByPayment] = useState({});

  const [emailOrder, setEmailOrder] = useState(null);
  const [emailType, setEmailType] = useState('advance');

  // === COMPUTED LISTS ===

  const pendingAdvance = useMemo(() => {
    return exportOrders.filter(
      (o) => o.advanceReceived < o.advanceExpected && o.status === 'Awaiting Advance'
    );
  }, [exportOrders]);

  const pendingBalance = useMemo(() => {
    // Ship on the advance: the balance is owed after sailing (plus any legacy
    // order still parked in 'Awaiting Balance').
    return exportOrders.filter(isBalanceDue);
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

  // === RECEIPT + HOLD ===
  // Recording an advance / balance opens the shared Payment form (variant
  // receive_export → POST /export-orders/:id/record-receipt): a PENDING
  // receipt Finance confirms above with the rate the bank applied.
  function openReceipt(order, type) {
    const expected = type === 'advance' ? order.advanceExpected - order.advanceReceived : order.balanceExpected - order.balanceReceived;
    drawers?.openPayment(null, {
      variant: 'receive_export',
      ctx: {
        orderId: order.dbId || order.id, kind: type, currency: order.currency || 'USD',
        outstanding: Math.max(0, Math.round(expected * 100) / 100),
        bankAccountId: order.bankAccountId || order.bank_account_id || null,
        fxRate: order.bookedFxRate || null,
        party: { type: 'customer', id: order.customerId, name: order.customerName },
        ref: `${order.id} · ${type === 'advance' ? 'Advance' : 'Balance'}`,
        notes: `${type === 'advance' ? 'Advance' : 'Balance'} payment for ${order.id}`,
      },
    });
  }

  async function handlePutOnHold(order) {
    if (!order || updateStatusMut.isPending) return;
    const ok = await confirm({
      title: `Put ${order.id} on hold?`,
      consequence: 'The order is cancelled for a payment issue. The reason is recorded on the order.',
      reason: 'required',
      confirmLabel: 'Put on hold',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try {
      await updateStatusMut.mutateAsync({
        id: order.dbId || order.id,
        data: { status: 'Cancelled', notes: `Put on hold by Finance. Reason: ${ok.reason || 'Payment issue'}` },
      });
      addToast(`${order.id} cancelled due to payment hold`, 'warning');
    } catch (err) {
      addToast(`Failed to update order: ${err.message || 'Server error'}`, 'error');
    }
  }

  // Finance confirms a PENDING receipt with the actual FX rate → posts it.
  async function confirmPending(p) {
    if (confirmReceiptMut.isPending) return;
    const isForeign = (p.currency || 'USD') !== 'PKR';
    const fx = parseFloat(fxByPayment[p.id]) || parseFloat(p.fxRate) || 0;
    if (isForeign && fx <= 0) { addToast('Enter the FX rate the bank applied', 'error'); return; }
    try {
      // Finance's confirmation posts it; there is no Owner authorisation step.
      await confirmReceiptMut.mutateAsync({ paymentId: p.id, data: { fx_rate: isForeign ? fx : 1 } });
      addToast(`${p.receiptType} receipt for ${p.orderNo} confirmed & posted`);
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Confirmation failed', 'error');
    }
  }
  async function rejectPending(p) {
    const ok = await confirm({
      title: `Reject the ${p.receiptType} receipt for ${p.orderNo}?`,
      consequence: 'The receipt is marked as not received. Nothing is posted to the bank or the ledger, and the reason is recorded for whoever entered it.',
      amount: fmtMoney(p.amount || 0, p.currency || 'USD'),
      reason: 'required',
      confirmLabel: 'Mark not received',
      cancelLabel: 'Go back',
    });
    if (!ok || rejectReceiptMut.isPending) return;
    try {
      await rejectReceiptMut.mutateAsync({ paymentId: p.id, data: { reason: ok.reason } });
      addToast('Receipt marked as not received', 'warning');
    } catch (err) {
      addToast(err?.data?.message || err?.message || 'Reject failed', 'error');
    }
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
            <div className="flex items-center gap-2 min-w-0">
              {orderRef(order.id, 'text-sm font-semibold text-blue-600 hover:text-blue-800')}
              <span className="text-xs text-gray-400">|</span>
              <span className="text-sm text-gray-600 truncate min-w-0" title={order.customerName || undefined}><PartyLink type="customer" id={order.customerId} name={order.customerName} /></span>
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
              <span className="text-xs text-gray-500">{pctReceived.toFixed(0)}%</span>
              {isOverdue && (
                <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                  <AlertTriangle size={12} />
                  {daysSince(order.createdAt)}d overdue
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-sm font-semibold text-gray-900 tabular-nums">
              {fmtOrd(remaining, order)}
            </div>
            <div className="text-xs text-gray-400">
              of {fmtOrd(expected, order)}
            </div>
          </div>
          <StatusBadge status={order.status} />
          <button
            type="button"
            onClick={() => { setEmailOrder(order); setEmailType(type); }}
            className={btnIcon}
            title="Send Payment Reminder"
            aria-label={`Send payment reminder for ${order.id}`}
          >
            <Mail size={15} aria-hidden="true" />
          </button>
          {canHold && (
            <button type="button" onClick={() => handlePutOnHold(order)} disabled={updateStatusMut.isPending} data-action="hold"
              className={btnRowSecondary}
              title="Put the order on hold (cancels it for a payment issue)">
              <PauseCircle size={13} aria-hidden="true" /> Hold
            </button>
          )}
          {canRecord && (
            <button type="button" onClick={() => openReceipt(order, type)} data-action="receive" className={btnRowPrimary}>
              <CheckCircle size={14} aria-hidden="true" />
              Record receipt
            </button>
          )}
        </div>
      </div>
    );
  }

  // Card figures: Owner/Export get the order-level summary ($); payments-only
  // Finance gets the receivables-based summary (Rs), which is populated for them.
  const cards = canViewExport
    ? { fmt: fmtUSD, receivables: summary.totalReceivables, received: summary.totalReceived, outstanding: summary.totalOutstanding, subCount: exportOrders.filter((o) => o.status !== 'Cancelled').length }
    : { fmt: fmtRs2, receivables: financeSummary.expected, received: financeSummary.received, outstanding: financeSummary.outstanding, subCount: receivables.length };
  const cardRate = cards.receivables > 0 ? (cards.received / cards.receivables) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          Export receipts waiting for Finance to confirm, and advances / balances still to collect.
        </p>
        <div className="flex flex-wrap items-center gap-3">
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
      <div className="bg-white rounded-xl p-5 border border-amber-200">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">Pending Finance Confirmation</h2>
          <span className="ml-auto text-xs text-gray-400">{pendingReceipts.length} receipt{pendingReceipts.length !== 1 ? 's' : ''}</span>
        </div>
        {pendingReceipts.length === 0 ? (
          <EmptyLine icon={CheckCircle}>No receipts awaiting confirmation.</EmptyLine>
        ) : (
          <div className="space-y-2">
            {pendingReceipts.map((p) => {
              const isForeign = (p.currency || 'USD') !== 'PKR';
              const fx = parseFloat(fxByPayment[p.id]) || parseFloat(p.fxRate) || 0;
              const pkr = (parseFloat(p.amount) || 0) * (isForeign ? fx : 1);
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border border-gray-100 rounded-lg p-3 bg-amber-50/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm min-w-0">
                      {p.orderId && canViewExport
                        ? <Link to={`/export/${p.orderId}`} className="font-semibold text-blue-600 hover:text-blue-800">{p.orderNo}</Link>
                        : <span className="font-semibold text-gray-700">{p.orderNo}</span>}
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-700 truncate min-w-0 max-w-[220px]" title={p.customerName || undefined}><PartyLink type="customer" id={p.customerId} name={p.customerName} /></span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{p.receiptType}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {fmtMoney(p.amount, p.currency || 'USD')} · recorded by {p.recordedByName || '—'} · {p.paymentDate ? fmtDate(String(p.paymentDate).slice(0, 10)) : ''}
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
                        <label className="block text-xs text-gray-500 uppercase">FX rate</label>
                        <input type="number" step="0.0001" value={fxByPayment[p.id] ?? (p.fxRate || '')}
                          onChange={(e) => setFxByPayment((s) => ({ ...s, [p.id]: e.target.value }))}
                          placeholder="rate" aria-label="FX rate" className="w-24 px-2 min-h-10 md:min-h-8 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}
                    <div className="text-right text-xs text-gray-500 w-28">
                      <span className="block text-xs uppercase text-gray-500">PKR</span>
                      {fmtPKR(pkr)}
                    </div>
                    {canConfirm && (<>
                    <button type="button" onClick={() => rejectPending(p)} disabled={rejectReceiptMut.isPending} className={btnRowQuiet}>
                      Reject
                    </button>
                    <button type="button" onClick={() => confirmPending(p)} disabled={confirmReceiptMut.isPending} data-action="confirm-receipt" className={btnRowPrimary}>
                      <CheckCircle size={14} aria-hidden="true" /> Confirm
                    </button>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Financial Summary KPIs */}
      <div className="kpi-grid">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Total Receivables</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{cards.fmt(cards.receivables)}</p>
          <p className="text-xs text-gray-400 mt-0.5">across {cards.subCount} {canViewExport ? 'orders' : 'receivables'}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
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
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-amber-500" />
            <span className="text-xs font-medium text-gray-500 uppercase">Outstanding</span>
          </div>
          <p className="text-xl font-bold text-amber-700">{cards.fmt(cards.outstanding)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {cards.receivables > 0 ? ((cards.outstanding / cards.receivables) * 100).toFixed(1) : 0}% of receivables
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
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
        <div className="bg-white rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-sm font-semibold text-gray-900">
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
      <div className="bg-white rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Banknote size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">
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
      <div className="bg-white rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">
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
        <div className="bg-white rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt size={16} className="text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-900">
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
                      <td data-label="Customer" className="py-2.5 px-3 text-gray-600 truncate max-w-[150px]" title={o.customerName || undefined}><PartyLink type="customer" id={o.customerId} name={o.customerName} /></td>
                      <td data-label="Adv Expected" className="mob-hide py-2.5 px-3 text-right text-gray-700">{fmtOrd(o.advanceExpected, o)}</td>
                      <td data-label="Adv Received" className={`py-2.5 px-3 text-right font-medium ${o.advanceReceived >= o.advanceExpected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {fmtOrd(o.advanceReceived, o)}
                      </td>
                      <td data-label="Bal Expected" className="mob-hide py-2.5 px-3 text-right text-gray-700">{fmtOrd(o.balanceExpected, o)}</td>
                      <td data-label="Bal Received" className={`py-2.5 px-3 text-right font-medium ${o.balanceReceived >= o.balanceExpected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {fmtOrd(o.balanceReceived, o)}
                      </td>
                      <td data-label="Outstanding" className="py-2.5 px-3 text-right font-bold text-red-600">{fmtOrd(outstanding, o)}</td>
                      <td data-label="Action" className="py-2.5 px-3 text-center">
                        {canRecord && (
                          <button
                            onClick={() => openReceipt(o, advPartial ? 'advance' : 'balance')} data-action="receive"
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Record more
                          </button>
                        )}
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
      <div className="bg-white rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={16} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-900">
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
                      <td data-label="Customer" className="py-2 px-3 text-gray-600 truncate max-w-[150px]" title={o.customerName || undefined}><PartyLink type="customer" id={o.customerId} name={o.customerName} /></td>
                      <td data-label="Contract Value" className="mob-hide py-2 px-3 text-right text-gray-700">{fmtOrd(o.contractValue, o)}</td>
                      <td data-label="Total Received" className="py-2 px-3 text-right text-emerald-600 font-medium">{fmtOrd(totalReceived, o)}</td>
                      <td data-label="Outstanding" className={`py-2 px-3 text-right font-bold ${outstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {outstanding > 0 ? fmtOrd(outstanding, o) : 'Paid'}
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

      </>)}

      {/* Email Composer for Payment Reminders */}
      {emailOrder && (
        <EmailComposer
          isOpen={!!emailOrder}
          onClose={() => setEmailOrder(null)}
          defaultTo={(customersList.find(c => c.id === emailOrder.customerId) || {}).email || ''}
          linkedType="export_order"
          linkedId={emailOrder.dbId || null}
          defaultSubject={emailType === 'advance'
            ? `Advance Payment Required - Order ${emailOrder.id}`
            : `Balance Payment Due - Order ${emailOrder.id}`
          }
          defaultBody={emailType === 'advance'
            ? `Dear Customer,\n\nThis is a reminder regarding the advance payment for Order ${emailOrder.id}.\n\nAdvance Expected: ${fmtOrd(emailOrder.advanceExpected, emailOrder)}
\nAdvance Received: ${fmtOrd(emailOrder.advanceReceived, emailOrder)}
\nRemaining: ${fmtOrd(emailOrder.advanceExpected - emailOrder.advanceReceived, emailOrder)}
\n\nPlease arrange the payment at your earliest convenience.\n\nBest regards,\nAGRI COMMODITIES`
            : `Dear Customer,\n\nThis is a reminder regarding the balance payment for Order ${emailOrder.id}.\n\nBalance Expected: ${fmtOrd(emailOrder.balanceExpected, emailOrder)}
\nBalance Received: ${fmtOrd(emailOrder.balanceReceived, emailOrder)}
\nRemaining: ${fmtOrd(emailOrder.balanceExpected - emailOrder.balanceReceived, emailOrder)}
\n\nPlease arrange the payment at your earliest convenience.\n\nBest regards,\nAGRI COMMODITIES`
          }
        />
      )}

      {confirmDialog}
    </div>
  );
}
