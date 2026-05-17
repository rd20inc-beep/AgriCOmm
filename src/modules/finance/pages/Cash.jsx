import { useMemo, useState } from 'react';
import { Landmark, Wallet, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useBankAccounts, useBankTransactions } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

export default function Cash() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: accounts = [], isLoading: loadingAccounts } = useBankAccounts();
  const { data: txData, isLoading: loadingTx } = useBankTransactions(rangeParams);
  const allTransactions = txData?.transactions || txData || [];
  const [accountFilter, setAccountFilter] = useState('all');
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
    { key: 'reference', label: 'Reference', render: (v) => v || '—' },
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

  return (
    <div className="space-y-5 pb-4">
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
    </div>
  );
}
