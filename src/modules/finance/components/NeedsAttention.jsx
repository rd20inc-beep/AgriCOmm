import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import useConfirm from '../../../hooks/useConfirm';
import {
  usePendingExportReceipts, useConfirmExportReceipt, useRejectExportReceipt, useReceivables, useUpcoming,
  useFundTransfers, useAcceptFundTransfer, useBankAccounts, useFxRates, useClearCheque,
  useApprovePayrollRun, usePayPayrollRun,
} from '../../../api/queries';
import { reportingApi } from '../../analytics/api/services';
import { purchaseRequirementsApi } from '../../purchaseRequirements/api/services';
import { financeApi } from '../api/services';
import { accountsForMethod } from '../../../components/payments/paymentPayload';
import { ClearChequeDialog } from '../pages/DueDates';
import { ResolveDrawer } from '../pages/Suspense';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { fmtAmt } from '../drawers/drawerLogic';
import { buildNeedsAttention } from '../utils/needsAttention';
import { withRange } from '../financeNav';

const TONE = {
  danger: { cls: 'border-l-red-500', Icon: AlertCircle, icon: 'text-red-500' },
  warning: { cls: 'border-l-amber-500', Icon: AlertTriangle, icon: 'text-amber-500' },
  info: { cls: 'border-l-blue-400', Icon: Info, icon: 'text-blue-500' },
};

/**
 * Home ▸ Needs Attention — the actionable queue (utils/needsAttention.js):
 * receipts to confirm, money due in, cheques to clear, transfers to accept,
 * payroll to approve or pay, purchases to mark bought, suspense to resolve,
 * overdrawn accounts, a stale rate, and the server's data warnings. One line
 * each, its amount in its own currency, one action — shown only to a role
 * the route behind that action admits; the rest are counted, not shown.
 */
export default function NeedsAttention({ summary, rangeKey = '' }) {
  const { hasPermission } = useAuth();
  const { addToast } = useApp() || {};
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drawers = useFinanceDrawers();
  const [confirm, confirmDialog] = useConfirm();

  const canPayroll = hasPermission('payroll', 'approve') || hasPermission('payroll', 'pay');
  const canPR = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit') || hasPermission('mill_store', 'create_purchase');
  const canSuspense = hasPermission('finance', 'post_journal');

  const { data: pendingReceipts = [] } = usePendingExportReceipts();
  const { data: receivables = [] } = useReceivables({});
  const { data: upcoming } = useUpcoming();
  const { data: fundTransfers = [] } = useFundTransfers();
  const { data: accounts = [] } = useBankAccounts();
  const { data: fx } = useFxRates({ currency: 'USD' });
  const { data: payroll } = useQuery({
    queryKey: ['payroll-pending'], enabled: canPayroll, retry: false,
    queryFn: async () => { const res = await reportingApi.payrollPending(); return res?.runs ? res : (res?.data || res); },
  });
  const { data: purchaseRequests = [] } = useQuery({
    queryKey: ['purchase-requirements', 'approved', 'needs-attention'], enabled: canPR, retry: false,
    queryFn: async () => { const res = await purchaseRequirementsApi.list({ status: 'approved' }); return (res?.data || res)?.requirements || []; },
  });
  const { data: suspense = [] } = useQuery({
    queryKey: ['suspense', 'list', 'needs-attention'], enabled: canSuspense, retry: false,
    queryFn: async () => (await financeApi.suspenseList({}))?.data || [],
  });

  const { items, hiddenCount } = useMemo(() => buildNeedsAttention({
    pendingReceipts, receivables, upcoming, fundTransfers, payroll, purchaseRequests, suspense, accounts, fx, summary,
  }, hasPermission), [pendingReceipts, receivables, upcoming, fundTransfers, payroll, purchaseRequests, suspense, accounts, fx, summary, hasPermission]);

  const confirmMut = useConfirmExportReceipt();
  const rejectMut = useRejectExportReceipt();
  const acceptMut = useAcceptFundTransfer();
  const clearMut = useClearCheque();
  const approveMut = useApprovePayrollRun();
  const payMut = usePayPayrollRun();
  const [rates, setRates] = useState({});
  const [clearing, setClearing] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [busy, setBusy] = useState(null);
  const err = (e, fallback) => addToast?.(e?.data?.message || e?.response?.data?.message || e?.message || fallback, 'error');

  async function run(item) {
    const p = item.payload;
    switch (item.action?.type) {
      case 'confirmReceipt': {
        const foreign = item.action.needsRate;
        const rate = parseFloat(rates[p.id] ?? p.fxRate ?? p.bookedFxRate) || 0;
        if (foreign && !(rate > 0)) { addToast?.('Enter the FX rate the bank applied', 'error'); return; }
        setBusy(item.key);
        try {
          await confirmMut.mutateAsync({ paymentId: p.id, data: { fx_rate: foreign ? rate : 1 } });
          addToast?.(`${p.receiptType || 'Export'} receipt for ${p.orderNo} confirmed & posted`, 'success');
          qc.invalidateQueries({ queryKey: ['finance-bank-transactions'] });
        } catch (e) { err(e, 'Confirmation failed'); } finally { setBusy(null); }
        return;
      }
      case 'receive': drawers?.openPayment(p); return;
      case 'clearCheque': setClearing(p); return;
      case 'acceptTransfer':
        setBusy(item.key);
        try { await acceptMut.mutateAsync(p.id); addToast?.(`${p.transferNo || 'Transfer'} accepted`, 'success'); }
        catch (e) { err(e, 'Could not accept the transfer.'); } finally { setBusy(null); }
        return;
      case 'approvePayroll': {
        const ok = await confirm({
          title: `Approve the ${p.period} payroll run?`,
          consequence: `${p.employeeCount} employee(s), prepared by ${p.preparedBy || '—'}. No money moves yet — the run then waits for Pay.`,
          amount: fmtAmt(p.net, 'PKR'), confirmLabel: 'Approve', cancelLabel: 'Go back', danger: false,
        });
        if (!ok) return;
        approveMut.mutate(p.id, {
          onSuccess: () => { addToast?.(`Payroll run for ${p.period} approved`, 'success'); qc.invalidateQueries({ queryKey: ['payroll-pending'] }); },
          onError: (e) => err(e, 'Could not approve the payroll run.'),
        });
        return;
      }
      case 'payPayroll': {
        const ok = await confirm({
          title: `Pay the ${p.period} payroll?`,
          consequence: `Pays ${p.employeeCount} employee(s): posts the salary expense to Money Out and the GL, moves the cash/bank balance and recovers scheduled advances.`,
          amount: fmtAmt(p.net, 'PKR'), confirmLabel: 'Pay', cancelLabel: 'Go back',
        });
        if (!ok) return;
        payMut.mutate(p.id, {
          onSuccess: () => { addToast?.(`Payroll for ${p.period} paid`, 'success'); qc.invalidateQueries({ queryKey: ['payroll-pending'] }); },
          onError: (e) => err(e, 'Could not pay the payroll run.'),
        });
        return;
      }
      case 'markPurchased': {
        // A store item is bought by recording the store purchase (stock +
        // payable + the request closed together) — that form lives on the
        // Purchase Requirements page.
        if (p.item_id && hasPermission('mill_store', 'create_purchase')) { navigate('/purchase-requirements'); return; }
        const ok = await confirm({
          title: `Mark ${p.pr_no || 'this request'} purchased?`,
          consequence: 'The request is closed as bought. No stock, payable or payment is recorded by this.',
          confirmLabel: 'Mark purchased', cancelLabel: 'Go back', danger: false,
        });
        if (!ok) return;
        setBusy(item.key);
        try {
          await purchaseRequirementsApi.markPurchased(p.id);
          addToast?.('Marked purchased', 'success');
          qc.invalidateQueries({ queryKey: ['purchase-requirements'] });
        } catch (e) { err(e, 'Action failed'); } finally { setBusy(null); }
        return;
      }
      case 'resolveSuspense': setResolving(p); return;
      case 'openAccount': drawers?.openAccount(p); return;
      case 'addRate': navigate(withRange('/finance/accounting/rates', rangeKey)); return;
      default:
    }
  }

  async function reject(p) {
    const ok = await confirm({
      title: `Reject the ${p.receiptType} receipt for ${p.orderNo}?`,
      consequence: 'The receipt is marked as not received. Nothing is posted to the bank or the ledger, and the reason is recorded for whoever entered it.',
      amount: fmtAmt(p.amount, p.currency || 'USD'), reason: 'required', confirmLabel: 'Mark not received', cancelLabel: 'Go back',
    });
    if (!ok) return;
    try { await rejectMut.mutateAsync({ paymentId: p.id, data: { reason: ok.reason } }); addToast?.('Receipt marked as not received', 'warning'); }
    catch (e) { err(e, 'Reject failed'); }
  }

  async function onClearConfirm(accountId) {
    try {
      await clearMut.mutateAsync({ id: clearing.paymentId, data: { bank_account_id: parseInt(accountId, 10) } });
      addToast?.(`Cheque cleared — ${fmtAmt(clearing.amount, clearing.currency)} settled and posted`, 'success');
      setClearing(null);
    } catch (e) { err(e, 'Failed to clear cheque'); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="needs-attention">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <ListChecks size={16} className="text-amber-600" /> Needs attention
          {items.length > 0 && <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5" data-testid="na-count">{items.length}</span>}
        </h2>
        <Link to={withRange('/finance/alerts', rangeKey)} className="text-xs text-blue-600 hover:underline">All alerts →</Link>
      </div>
      {items.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-6 flex items-center justify-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500" /> Nothing waiting for you
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const tone = TONE[item.severity] || TONE.info;
            const p = item.payload;
            return (
              <li key={item.key} data-kind={item.kind} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 border-l-4 ${tone.cls} px-3 py-2`}>
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <tone.Icon size={14} className={`mt-0.5 shrink-0 ${tone.icon}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 font-medium truncate">{item.title}</p>
                    {item.sub && <p className="text-[11px] text-gray-500 truncate">{item.sub}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.amount != null && item.currency && (
                    <span className="text-sm font-semibold tabular-nums" data-currency={item.currency}>{fmtAmt(item.amount, item.currency)}</span>
                  )}
                  {item.action?.type === 'confirmReceipt' && item.action.needsRate && (
                    <input type="number" step="0.0001" min="0" aria-label="FX rate the bank applied"
                      value={rates[p.id] ?? (p.fxRate || p.bookedFxRate || '')}
                      onChange={(e) => setRates((s) => ({ ...s, [p.id]: e.target.value }))}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-xs text-right" placeholder="rate" />
                  )}
                  {item.action && (
                    <button type="button" disabled={busy === item.key} onClick={() => run(item)} data-action={item.action.type}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {item.action.label}
                    </button>
                  )}
                  {item.action?.type === 'confirmReceipt' && (
                    <button type="button" onClick={() => reject(p)} className="text-[11px] text-gray-500 hover:text-red-600" data-action="rejectReceipt">Reject</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="text-[11px] text-gray-400 mt-2" data-testid="na-hidden">{hiddenCount} more need someone with other permissions.</p>
      )}
      {clearing && (
        <ClearChequeDialog key={clearing.paymentId} item={clearing} accounts={accountsForMethod(accounts, 'cheque')}
          busy={clearMut.isPending} onCancel={() => setClearing(null)} onConfirm={onClearConfirm} />
      )}
      {resolving && (
        <ResolveDrawer entry={resolving} addToast={addToast} onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); qc.invalidateQueries({ queryKey: ['suspense'] }); }} />
      )}
      {confirmDialog}
    </div>
  );
}
