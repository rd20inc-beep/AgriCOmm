import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useConfirm from '../../../hooks/useConfirm';
import { Landmark, Wallet, TrendingUp, TrendingDown, ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Undo2, Check, Plus } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useBankAccounts, useBankTransactions, useFundTransfers, useReverseFundTransfer, useAcceptFundTransfer } from '../../../api/queries';
import ListCapHint from '../../../shared/components/ListCapHint';
import ContraTransferDrawer from '../components/ContraTransferDrawer';
import FundTransferDetailDrawer from '../components/FundTransferDetailDrawer';
import { transferRowLabel, transferStatusLabel, DIRECTION_LABEL } from '../utils/contraTransfer';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { canAcceptTransfer } from '../utils/transferPermissions';
import { shortenRef } from '../utils/refs';
import StatusBadge from '../../../shared/components/StatusBadge';
import { toLocalISODate, fmtPKR, fmtUSD, fmtMoney, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { Section, TypeChip, EmptyLine } from '../components/FinanceUI';
import { btnSecondary, btnRowPrimary, btnRowSecondary, th, tdMoney } from '../utils/uiClasses';

export default function Cash() {
  const { companyProfileData, addToast } = useApp();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: accounts = [], isLoading: loadingAccounts, error: accountsError, refetch: refetchAccounts } = useBankAccounts();
  const { data: txData, isLoading: loadingTx, error: txError, refetch: refetchTx } = useBankTransactions(rangeParams);
  const allTransactions = txData?.transactions || txData || [];
  const [accountFilter, setAccountFilter] = useState('all');
  // Contra transfer drawer (new, or editing = reverse + replace) and the
  // transfer detail drawer.
  const [contra, setContra] = useState({ open: false, editing: null });
  const [detailId, setDetailId] = useState(null);
  const { data: fundTransfers = [] } = useFundTransfers();
  const reverseTransfer = useReverseFundTransfer();
  const acceptTransfer = useAcceptFundTransfer();
  const { user, hasPermission } = useAuth();
  // Reversal / edit is Owner / Super Admin only (the server enforces the same).
  const canReverse = user?.role === 'Owner' || user?.role === 'Super Admin';
  const canCreateContra = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit');
  // A bank row opens the Transaction drawer (or its transfer); an account row
  // opens the Account drawer.
  const drawers = useFinanceDrawers();
  const [confirm, confirmDialog] = useConfirm();

  // ?action=transfer (the Finance header's + Transfer) opens a new contra
  // transfer; closing the drawer drops the param.
  const [searchParams, setSearchParams] = useSearchParams();
  const transferRequested = canCreateContra && searchParams.get('action') === 'transfer';
  const contraOpen = contra.open || transferRequested;
  function closeContra() {
    setContra({ open: false, editing: null });
    if (searchParams.has('action')) {
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }
  async function handleReverseTransfer(t) {
    const accepted = t.status === 'completed';
    const ok = await confirm({
      title: `Reverse transfer ${t.transferNo}?`,
      consequence: t.direction === 'internal'
        ? 'The money goes back to the sending account and comes out of the receiving one (bank charges too, if any). The transfer stays on record as Reversed.'
        : accepted
          ? 'The money goes back to the sending account and comes out of the receiving one. Equal-and-opposite journals are posted; the transfer stays on record as Reversed.'
          : 'The money goes back to the sending account (the receiver never accepted it). An equal-and-opposite journal is posted; the transfer stays on record as Reversed.',
      amount: t.amount != null ? fmtMoney(parseFloat(t.amount) || 0, t.currency || 'PKR') : undefined,
      reason: 'required',
      confirmLabel: 'Reverse transfer',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try { await reverseTransfer.mutateAsync({ id: t.id, reason: ok?.reason }); }
    catch (e) { addToast(e?.response?.data?.message || e?.data?.message || e?.message || 'Could not reverse the transfer.', 'error'); }
  }
  async function handleAcceptTransfer(t) {
    // No Owner step: the receiving side's permission is the whole check.
    try { await acceptTransfer.mutateAsync(t.id); }
    catch (e) { addToast(e?.response?.data?.message || e?.data?.message || e?.message || 'Could not accept the transfer.', 'error'); }
  }

  function handlePrint() {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }
  const transactions = useMemo(() => {
    if (accountFilter === 'all') return allTransactions;
    const id = String(accountFilter);
    return allTransactions.filter(t => String(t.bankAccountId || t.bank_account_id) === id);
  }, [allTransactions, accountFilter]);

  // Balances are kept per currency and never added together: a USD balance
  // is not a rupee figure, and no FX conversion is applied here.
  const pkrAccounts = accounts.filter(a => (a.currency || 'PKR') === 'PKR');
  const usdAccounts = accounts.filter(a => a.currency === 'USD');
  const pkrBalance = pkrAccounts.reduce((s, a) => s + (parseFloat(a.currentBalance) || 0), 0);
  const usdBalance = usdAccounts.reduce((s, a) => s + (parseFloat(a.currentBalance) || 0), 0);

  const accountColumns = [
    { key: 'name', label: 'Account', sortable: true, render: (v) => <span className="block max-w-[16rem] truncate" title={v || ''}>{v || '—'}</span> },
    { key: 'bankName', label: 'Bank', sortable: true, render: (v) => v || '—' },
    { key: 'accountNumber', label: 'Account #', render: (v) => v || '—' },
    { key: 'currency', label: 'Currency', render: (v) => v || 'PKR' },
    { key: 'currentBalance', label: 'Balance', sortable: true, align: 'right', render: (v, row) => (
      <span className="font-semibold text-gray-900">{fmtMoney(parseFloat(v) || 0, row.currency || 'PKR', { decimals: 0 })}</span>
    )},
  ];

  const txColumns = [
    { key: 'transactionDate', label: 'Date', sortable: true, render: (v) => fmtDate(v) },
    { key: 'type', label: 'Type', sortable: true, render: (v) => (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${v === 'credit' ? 'text-emerald-700' : 'text-red-700'}`}>
        {v === 'credit' ? <ArrowDownLeft size={13} aria-hidden="true" /> : <ArrowUpRight size={13} aria-hidden="true" />}
        {v === 'credit' ? 'In' : 'Out'}
      </span>
    )},
    { key: 'amount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => (
      <span className={row.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}>{fmtMoney(Math.abs(parseFloat(v) || 0), row.currency || 'PKR')}</span>
    )},
    { key: 'accountName', label: 'Account' },
    // What kind of movement this is. A row written by a transfer between the
    // company's own accounts reads "CONTRA · From → To" (or HO → MILL …).
    { key: 'category', label: 'Kind', render: (v, row) => <TxKind row={row} /> },
    { key: 'reference', label: 'Reference', render: (v) => (
      <span title={v || ''}>{shortenRef(v) || '—'}</span>
    )},
    { key: 'counterparty', label: 'Counterparty', render: (v, row) => {
      const label = transferRowLabel(row);
      const text = label || v || '—';
      return <span className="block max-w-[18rem] truncate" title={text}>{text}</span>;
    } },
  ];

  // Last-30-days net flow chart bucketed by day, computed from real
  // bank_transactions (was previously a fabricated curve based on
  // current-balance × i*0.06).
  // PKR accounts only — summing USD movements into rupee buckets would mix
  // currencies, so the chart (and the 30-day net) is labelled PKR.
  const cashFlowData = (() => {
    const pkrAccountIds = new Set(accounts.filter(a => (a.currency || 'PKR') === 'PKR').map(a => String(a.id)));
    // Contra transfers between the company's own accounts are not cash flow —
    // they are left out (their bank charges, a real expense, stay in).
    const txs = (Array.isArray(transactions) ? transactions : [])
      .filter(t => pkrAccountIds.has(String(t.bankAccountId ?? t.bank_account_id)))
      .filter(t => !(t.ftDirection === 'internal' && !/charges/i.test(t.category || '')));
    const dayBuckets = new Map();
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = toLocalISODate(d);
      dayBuckets.set(key, { day: key.slice(5), In: 0, Out: 0, Net: 0 });
    }
    for (const t of txs) {
      const dRaw = t.transactionDate || t.transaction_date || t.date;
      if (!dRaw) continue;
      const key = String(dRaw).slice(0, 10);
      const bucket = dayBuckets.get(key);
      if (!bucket) continue;
      const amt = Math.abs(parseFloat(t.amount) || 0);
      if (t.type === 'credit') bucket.In += amt; else bucket.Out += amt;
      bucket.Net = bucket.In - bucket.Out;
    }
    return Array.from(dayBuckets.values());
  })();

  const hasFlow = cashFlowData.some(b => b.In > 0 || b.Out > 0);

  const netFlow30d = cashFlowData.reduce((s, b) => s + b.In - b.Out, 0);
  const FlowIcon = netFlow30d >= 0 ? TrendingUp : TrendingDown;

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  return (
    <div className="space-y-5 pb-4">
      <div className="print-report space-y-5">
        {/* Print-only header */}
        <div className="hidden print:block">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between mb-4">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
              <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Cash Position</div>
              <div className="text-xs text-gray-600">
                {accounts.length} accounts · PKR {fmtPKR(pkrBalance)}
                {usdAccounts.length > 0 && <> · USD {fmtUSD(usdBalance, { decimals: 0 })}</>}
              </div>
            </div>
          </div>
        </div>

      {/* Cash on hand — PKR and USD each in their own currency, never added */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="cash-position">
        <FinanceKPI icon={Landmark} title="Cash on hand · PKR" value={fmtPKR(pkrBalance)}
          subtitle={`${pkrAccounts.length} PKR of ${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          status={pkrBalance > 0 ? 'good' : 'danger'} loading={loadingAccounts} />
        <FinanceKPI icon={Wallet} title="Cash on hand · USD" value={fmtUSD(usdBalance)}
          subtitle={`${usdAccounts.length} USD ${usdAccounts.length === 1 ? 'account' : 'accounts'}`} status="info" loading={loadingAccounts} />
        <FinanceKPI icon={FlowIcon} title="30-day net · PKR" value={`${netFlow30d >= 0 ? '+' : ''}${fmtPKR(netFlow30d)}`}
          subtitle={hasFlow ? `${transactions.length} transactions` : 'No recent activity'}
          status={netFlow30d >= 0 ? 'good' : 'danger'} loading={loadingTx} />
        <FinanceKPI icon={Landmark} title="Active Accounts" value={String(accounts.filter(a => a.isActive !== false).length)}
          subtitle="In use" status="neutral" loading={loadingAccounts} />
      </div>

      {hasFlow ? (
        <FinanceChart
          title="Cash Flow (PKR accounts) — Last 30 Days"
          type="bar"
          data={cashFlowData}
          xKey="day"
          currency="Rs "
          series={[
            { key: 'In',  name: 'In',  color: '#10b981' },
            { key: 'Out', name: 'Out', color: '#ef4444' },
          ]}
          height={220}
          loading={loadingTx}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <EmptyLine icon={TrendingUp}>No PKR bank transactions in the last 30 days yet — record receipts or payments to populate this chart.</EmptyLine>
        </div>
      )}

      <FinanceTable title="Bank Accounts" columns={accountColumns} data={accounts}
        onRowClick={drawers?.openAccount ? (row) => drawers.openAccount(row) : undefined}
        searchKeys={['name', 'bankName', 'accountNumber']} exportFilename="bank-accounts" loading={loadingAccounts}
        error={accountsError} onRetry={refetchAccounts} emptyText="No cash or bank accounts yet." />

      {/* Head Office ⇄ Mill fund transfers */}
      <Section flush title="Transfers between your accounts" icon={ArrowLeftRight} count={fundTransfers.length || undefined}
        action={canCreateContra ? (
          <button type="button" onClick={() => setContra({ open: true, editing: null })} className={`${btnSecondary} no-print`}>
            <Plus size={14} aria-hidden="true" /> Contra transfer
          </button>
        ) : null}>
        {fundTransfers.length === 0 ? (
          <EmptyLine icon={ArrowLeftRight}>No transfers yet. A contra transfer moves money between your own accounts (Cash ⇄ Bank, Bank ⇄ Bank, Head Office ⇄ Mill).</EmptyLine>
        ) : (
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr>{['Ref', 'Date', 'Direction', 'From', 'To', 'Method', 'Amount', 'Status', ''].map((h, i) => (
                  <th key={i} className={`${th} ${i === 6 || i === 8 ? 'text-right' : 'text-left'}`}>{h || <span className="sr-only">Actions</span>}</th>))}
                </tr>
              </thead>
              <tbody>
                {fundTransfers.map((t) => {
                  const hoIsReceiver = t.toEntity === 'general'; // Mill → HO awaits HO acceptance here
                  return (
                  <tr key={t.id} onClick={() => setDetailId(t.id)} className={`border-t border-gray-100 cursor-pointer hover:bg-blue-50/30 ${t.status === 'reversed' ? 'text-gray-400' : ''}`}>
                    <td data-label="Ref" className="px-4 py-2.5 font-medium text-gray-700">{t.transferNo}</td>
                    <td data-label="Date" className="px-4 py-2.5 whitespace-nowrap">{fmtDate(t.transferDate)}</td>
                    <td data-label="Direction" className="px-4 py-2.5">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <TypeChip>{DIRECTION_LABEL[t.direction] || t.direction}</TypeChip>
                        {t.fxUnbooked && <TypeChip title="FX difference not booked — review" className="!bg-amber-50 !text-amber-800 !ring-amber-200">FX not booked</TypeChip>}
                      </span>
                    </td>
                    <td data-label="From" className="px-4 py-2.5 text-gray-600 max-w-[12rem] truncate" title={t.fromAccountName || ''}>{t.fromAccountName || '—'}</td>
                    <td data-label="To" className="px-4 py-2.5 text-gray-600 max-w-[12rem] truncate" title={t.toAccountName || ''}>{t.toAccountName || '—'}</td>
                    <td data-label="Method" className="px-4 py-2.5 text-gray-500 capitalize">{(t.method || '').replace('_', ' ')}</td>
                    <td data-label="Amount" className={`px-4 py-2.5 ${tdMoney} font-semibold ${t.status === 'reversed' ? 'line-through' : ''}`}>
                      {fmtMoney(parseFloat(t.amount) || 0, t.currency || 'PKR')}
                      {t.toCurrency && t.toCurrency !== t.currency && (
                        <div className="text-[10px] font-normal text-gray-500">→ {fmtMoney(parseFloat(t.toAmount) || 0, t.toCurrency)}</div>
                      )}
                    </td>
                    <td data-label="Status" className="px-4 py-2.5">
                      <StatusBadge status={t.status === 'pending'
                        ? (hoIsReceiver ? 'Awaiting you' : 'Awaiting mill')
                        : transferStatusLabel(t)} />
                    </td>
                    <td data-label="Actions" className="px-4 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-1.5">
                        {canReverse && t.status !== 'reversed' && (
                          <button type="button" onClick={() => handleReverseTransfer(t)} disabled={reverseTransfer.isPending} title="Reverse transfer"
                            className={`no-print ${btnRowSecondary}`}><Undo2 size={12} aria-hidden="true" /> Reverse</button>
                        )}
                        {t.status === 'pending' && hoIsReceiver && canAcceptTransfer(t, hasPermission) && (
                          <button type="button" onClick={() => handleAcceptTransfer(t)} disabled={acceptTransfer.isPending} title="Accept funds"
                            className={`no-print ${btnRowPrimary}`}><Check size={12} aria-hidden="true" /> Accept</button>
                        )}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {Array.isArray(allTransactions) && allTransactions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Account</span>
            <button type="button" aria-pressed={accountFilter === 'all'} onClick={() => setAccountFilter('all')}
              className={`text-xs px-3 min-h-10 sm:min-h-8 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${accountFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
              All <span className="opacity-60 ml-1">({allTransactions.length})</span>
            </button>
            {accounts.map(a => {
              const n = allTransactions.filter(t => String(t.bankAccountId || t.bank_account_id) === String(a.id)).length;
              if (n === 0) return null;
              const active = String(accountFilter) === String(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={active} onClick={() => setAccountFilter(String(a.id))}
                  className={`text-xs px-3 min-h-10 sm:min-h-8 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
                  {a.name} <span className="opacity-60 ml-1">({n})</span>
                </button>
              );
            })}
          </div>
          <ListCapHint rows={allTransactions} total={txData?.listTotal} className="mb-1" />
          <FinanceTable title="Recent Transactions" columns={txColumns} data={transactions}
            onRowClick={(row) => {
              if (row.fundTransferId) setDetailId(row.fundTransferId);
              else drawers?.openTransaction?.('bank', row.id);
            }}
            searchKeys={['reference', 'counterparty', 'accountName', 'category', 'ftFromAccountName', 'ftToAccountName']} exportFilename="bank-transactions" loading={loadingTx}
            error={txError} onRetry={refetchTx} emptyText="No transactions in this period." />
        </div>
      )}
      </div>{/* /.print-report */}
      <ContraTransferDrawer open={contraOpen} editing={contra.editing}
        onClose={closeContra}
        onDone={(data) => { const id = data?.transfer?.id; if (id && contra.editing) setDetailId(id); }} />
      <FundTransferDetailDrawer open={!!detailId && !contraOpen} transferId={detailId} canManage={canReverse}
        onClose={() => setDetailId(null)} onNavigate={setDetailId}
        onEdit={(t) => setContra({ open: true, editing: t })} />
      {confirmDialog}
    </div>
  );
}

// Type badge for a bank-transaction row. Transfer rows (fund_transfer_id set)
// say which kind; everything else shows its category.
function TxKind({ row }) {
  const dir = row?.ftDirection;
  const cat = row?.category || '';
  if (dir) {
    const charges = /charges/i.test(cat);
    const reversal = /reversal/i.test(cat);
    const text = charges ? 'Bank charges' : dir === 'internal' ? 'CONTRA' : (dir === 'ho_to_mill' ? 'HO → Mill' : 'Mill → HO');
    return (
      <TypeChip title={transferRowLabel(row) || ''}>{text}{reversal ? ' · reversal' : ''}</TypeChip>
    );
  }
  return cat ? <span className="text-[11px] text-gray-500 capitalize">{String(cat).replace(/_/g, ' ')}</span> : <span className="text-gray-300">—</span>;
}
