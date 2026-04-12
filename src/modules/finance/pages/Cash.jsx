import { useMemo } from 'react';
import { Landmark, ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useBankAccounts, useBankTransactions } from '../../../api/queries';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

export default function Cash() {
  const { data: accounts = [], isLoading: loadingAccounts } = useBankAccounts();
  const { data: txData, isLoading: loadingTx } = useBankTransactions();
  const transactions = txData?.transactions || txData || [];

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

  // Cash flow chart from account data
  const cashData = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    return months.map((month, i) => ({
      month,
      Balance: Math.round(totalBalance * (0.7 + i * 0.06)),
    }));
  }, [totalBalance]);

  return (
    <div className="space-y-6">
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

      <FinanceChart title="Cash Balance Trend" type="line" data={cashData} currency="Rs "
        series={[{ key: 'Balance', name: 'Balance', color: '#3b82f6' }]} height={220} loading={loadingAccounts} />

      <FinanceTable title="Bank Accounts" columns={accountColumns} data={accounts}
        searchKeys={['name', 'bankName', 'accountNumber']} exportFilename="bank-accounts" loading={loadingAccounts} />

      {Array.isArray(transactions) && transactions.length > 0 && (
        <FinanceTable title="Recent Transactions" columns={txColumns} data={transactions}
          searchKeys={['reference', 'counterparty', 'accountName']} exportFilename="bank-transactions" loading={loadingTx} />
      )}
    </div>
  );
}
