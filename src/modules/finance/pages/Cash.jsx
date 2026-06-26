import { useMemo, useState } from 'react';
import { Landmark, Wallet, TrendingUp, TrendingDown, Activity, Printer, ArrowLeftRight, Trash2, Check } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useBankAccounts, useBankTransactions, useFundTransfers, useDeleteFundTransfer, useAcceptFundTransfer } from '../../../api/queries';
import TransferFundsDrawer from '../components/TransferFundsDrawer';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useApp } from '../../../context/AppContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { shortenRef } from '../utils/refs';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

export default function Cash() {
  const { companyProfileData } = useApp();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: accounts = [], isLoading: loadingAccounts } = useBankAccounts();
  const { data: txData, isLoading: loadingTx } = useBankTransactions(rangeParams);
  const allTransactions = txData?.transactions || txData || [];
  const [accountFilter, setAccountFilter] = useState('all');
  const [showTransfer, setShowTransfer] = useState(false);
  const { data: fundTransfers = [] } = useFundTransfers();
  const delTransfer = useDeleteFundTransfer();
  const acceptTransfer = useAcceptFundTransfer();
  const { requestOwnerApproval } = useOwnerAuth();
  async function handleDeleteTransfer(t) {
    if (!window.confirm(`Reverse transfer ${t.transferNo}? This restores account balances and removes its GL entries.`)) return;
    try { await delTransfer.mutateAsync(t.id); } catch (e) { window.alert(e?.response?.data?.message || e?.message || 'Could not reverse the transfer.'); }
  }
  async function handleAcceptTransfer(t) {
    try { await requestOwnerApproval((ownerId) => acceptTransfer.mutateAsync({ id: t.id, ownerId })); }
    catch (e) { if (e?.message !== 'Owner authorization cancelled') window.alert(e?.response?.data?.message || e?.message || 'Could not accept the transfer.'); }
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

  const totalBalance = accounts.reduce((s, a) => s + (parseFloat(a.currentBalance) || 0), 0);
  const pkrAccounts = accounts.filter(a => (a.currency || 'PKR') === 'PKR');
  const usdAccounts = accounts.filter(a => a.currency === 'USD');
  const pkrBalance = pkrAccounts.reduce((s, a) => s + (parseFloat(a.currentBalance) || 0), 0);
  const usdBalance = usdAccounts.reduce((s, a) => s + (parseFloat(a.currentBalance) || 0), 0);

  const accountColumns = [
    { key: 'name', label: 'Account', sortable: true },
    { key: 'bankName', label: 'Bank', sortable: true, render: (v) => v || '—' },
    { key: 'accountNumber', label: 'Account #', render: (v) => v || '—' },
    { key: 'currency', label: 'Currency', render: (v) => v || 'PKR' },
    { key: 'currentBalance', label: 'Balance', sortable: true, align: 'right', render: (v, row) => {
      const cur = row.currency || 'PKR';
      const prefix = cur === 'USD' ? '$' : 'Rs ';
      return <span className="font-medium">{prefix}{Math.round(parseFloat(v) || 0).toLocaleString()}</span>;
    }},
  ];

  const txColumns = [
    { key: 'transactionDate', label: 'Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—' },
    { key: 'type', label: 'Type', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'credit' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
        {v === 'credit' ? 'In' : 'Out'}
      </span>
    )},
    { key: 'amount', label: 'Amount', sortable: true, align: 'right', render: (v, row) => (
      <span className={row.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}>{fmtPKR(Math.abs(v))}</span>
    )},
    { key: 'accountName', label: 'Account' },
    { key: 'reference', label: 'Reference', render: (v) => (
      <span title={v || ''}>{shortenRef(v) || '—'}</span>
    )},
    { key: 'counterparty', label: 'Counterparty', render: (v) => v || '—' },
  ];

  // Last-30-days net flow chart bucketed by day, computed from real
  // bank_transactions (was previously a fabricated curve based on
  // current-balance × i*0.06).
  const cashFlowData = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    const dayBuckets = new Map();
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
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
  }, [transactions]);

  const hasFlow = cashFlowData.some(b => b.In > 0 || b.Out > 0);

  const netFlow30d = cashFlowData.reduce((s, b) => s + b.In - b.Out, 0);
  const heroGradient = totalBalance > 0
    ? 'from-blue-700 via-blue-600 to-cyan-500'
    : 'from-slate-700 via-slate-600 to-slate-500';
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
              <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Cash Position</div>
              <div className="text-xs text-gray-600">
                {accounts.length} accounts · Total {fmtPKR(totalBalance)}
                {usdAccounts.length > 0 && <> · USD ${Math.round(usdBalance).toLocaleString()}</>}
              </div>
            </div>
          </div>
        </div>

      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 70% 30%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Landmark size={14} /> Cash on hand
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPKR(totalBalance)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {pkrAccounts.length > 0 && <>PKR {fmtPKR(pkrBalance)}</>}
              {usdAccounts.length > 0 && <> · USD ${Math.round(usdBalance).toLocaleString()}</>}
              {' · '}{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/30">
              <FlowIcon size={12} /> 30-day net {netFlow30d >= 0 ? '+' : ''}{fmtPKR(netFlow30d)}
            </span>
            <div className="opacity-80 text-right">
              {hasFlow ? `${transactions.length} transactions` : 'No recent activity'}
            </div>
            <button onClick={() => setShowTransfer(true)}
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-blue-700 text-xs font-semibold hover:bg-blue-50 shadow-sm">
              <ArrowLeftRight size={13} /> Transfer Funds
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Landmark} title="Total Cash" value={fmtPKR(totalBalance)}
          subtitle={`${accounts.length} accounts`} status={totalBalance > 0 ? 'good' : 'danger'} loading={loadingAccounts} />
        <FinanceKPI icon={Wallet} title="PKR Accounts" value={fmtPKR(pkrBalance)}
          subtitle={`${pkrAccounts.length} accounts`} status="info" loading={loadingAccounts} />
        <FinanceKPI icon={Wallet} title="USD Accounts" value={`$${Math.round(usdBalance).toLocaleString()}`}
          subtitle={`${usdAccounts.length} accounts`} status="info" loading={loadingAccounts} />
        <FinanceKPI icon={Landmark} title="Active Accounts" value={String(accounts.filter(a => a.isActive !== false).length)}
          subtitle="In use" status="neutral" loading={loadingAccounts} />
      </div>

      {hasFlow ? (
        <FinanceChart
          title="Cash Flow — Last 30 Days"
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
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">
          No bank transactions in the last 30 days yet — record receipts or payments to populate this chart.
        </div>
      )}

      <FinanceTable title="Bank Accounts" columns={accountColumns} data={accounts}
        searchKeys={['name', 'bankName', 'accountNumber']} exportFilename="bank-accounts" loading={loadingAccounts} />

      {/* Head Office ⇄ Mill fund transfers */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5"><ArrowLeftRight size={14} className="text-blue-500" /> Head Office ⇄ Mill Transfers</h3>
          <button onClick={() => setShowTransfer(true)} className="no-print text-xs font-medium text-blue-600 hover:text-blue-700">+ New transfer</button>
        </div>
        {fundTransfers.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No fund transfers yet. Use <span className="font-medium">Transfer Funds</span> to move money between Head Office and the Mill.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>{['Ref', 'Date', 'Direction', 'From', 'To', 'Method', 'Amount', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2 font-medium ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {fundTransfers.map((t) => {
                  const hoIsReceiver = t.toEntity === 'general'; // Mill → HO awaits HO acceptance here
                  return (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-700">{t.transferNo}</td>
                    <td className="px-3 py-2">{t.transferDate ? new Date(t.transferDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.direction === 'ho_to_mill' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                        {t.direction === 'ho_to_mill' ? 'HO → Mill' : 'Mill → HO'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{t.fromAccountName || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{t.toAccountName || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 capitalize">{(t.method || '').replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtPKR(t.amount)}</td>
                    <td className="px-3 py-2">
                      {t.status === 'completed'
                        ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">Received</span>
                        : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">{hoIsReceiver ? 'Awaiting you' : 'Awaiting mill'}</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {t.status === 'pending' && hoIsReceiver && (
                        <button onClick={() => handleAcceptTransfer(t)} disabled={acceptTransfer.isPending} title="Accept funds"
                          className="no-print inline-flex items-center gap-1 px-2 py-1 mr-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={12} /> Accept</button>
                      )}
                      <button onClick={() => handleDeleteTransfer(t)} disabled={delTransfer.isPending} title={t.status === 'completed' ? 'Reverse transfer' : 'Cancel transfer'}
                        className="no-print text-gray-400 hover:text-red-600 disabled:opacity-50"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {Array.isArray(allTransactions) && allTransactions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Account:</span>
            <button onClick={() => setAccountFilter('all')}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${accountFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
              All <span className="opacity-60 ml-1">({allTransactions.length})</span>
            </button>
            {accounts.map(a => {
              const n = allTransactions.filter(t => String(t.bankAccountId || t.bank_account_id) === String(a.id)).length;
              if (n === 0) return null;
              const active = String(accountFilter) === String(a.id);
              return (
                <button key={a.id} onClick={() => setAccountFilter(String(a.id))}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
                  {a.name} <span className="opacity-60 ml-1">({n})</span>
                </button>
              );
            })}
          </div>
          <FinanceTable title="Recent Transactions" columns={txColumns} data={transactions}
            searchKeys={['reference', 'counterparty', 'accountName']} exportFilename="bank-transactions" loading={loadingTx} />
        </div>
      )}
      </div>{/* /.print-report */}
      <TransferFundsDrawer open={showTransfer} onClose={() => setShowTransfer(false)} defaultDirection="ho_to_mill" />
    </div>
  );
}
