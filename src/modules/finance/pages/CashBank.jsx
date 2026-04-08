import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  CreditCard,
  CheckCircle2,
  XCircle,
  Eye,
  Link2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBankTransactions, useCashForecast } from '../../api/queries';
import { accountingApi } from '../../api/services';

function formatPKR(value) {
  if (value === 0) return 'Rs 0';
  return 'Rs ' + Math.round(Math.abs(value)).toLocaleString('en-PK');
}

function formatUSD(value) {
  if (value === 0) return '$0';
  return '$' + Math.abs(value).toLocaleString('en-US');
}

function formatAmount(value, currency) {
  if (currency === 'USD') return formatUSD(value);
  return formatPKR(value);
}

export default function CashBank() {
  const qc = useQueryClient();
  const { bankAccountsList: rawBankAccounts, addToast } = useApp();
  const bankAccounts = Array.isArray(rawBankAccounts) ? rawBankAccounts : [];
  const { data: rawBankTransactions = [] } = useBankTransactions();
  const bankTransactions = Array.isArray(rawBankTransactions) ? rawBankTransactions : [];
  const { data: rawCashForecast = {} } = useCashForecast();
  // cashForecast can be object or array — normalize
  const cashForecast = rawCashForecast || {};
  const forecastProjection = Array.isArray(cashForecast.projection) ? cashForecast.projection : (Array.isArray(cashForecast) ? cashForecast : []);

  // KPI calculations
  const kpis = useMemo(() => {
    const totalCash = bankAccounts
      .filter((a) => a.type === 'cash')
      .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0);

    const totalBank = bankAccounts
      .filter((a) => a.type === 'bank')
      .reduce((sum, a) => sum + (parseFloat(a.currentBalance) || 0), 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthTxns = bankTransactions.filter(
      (t) => t.date && new Date(t.date) >= monthStart
    );
    const inflowsThisMonth = monthTxns
      .filter((t) => t.type === 'credit')
      .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    const outflowsThisMonth = monthTxns
      .filter((t) => t.type === 'debit')
      .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

    const pendingReceipts = parseFloat(cashForecast.totalExpectedReceipts) || 0;
    const pendingPayments = parseFloat(cashForecast.totalExpectedPayments) || 0;

    return { totalCash, totalBank, inflowsThisMonth, outflowsThisMonth, pendingReceipts, pendingPayments };
  }, [bankAccounts, bankTransactions, cashForecast]);

  const kpiCards = [
    { label: 'Total Cash', value: formatPKR(kpis.totalCash), icon: Wallet, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total Bank', value: formatPKR(kpis.totalBank), icon: Landmark, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Inflows This Month', value: formatUSD(kpis.inflowsThisMonth), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Outflows This Month', value: formatUSD(kpis.outflowsThisMonth), icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Pending Receipts', value: formatUSD(kpis.pendingReceipts), icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Pending Payments', value: formatUSD(kpis.pendingPayments), icon: CreditCard, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  async function handleMatch(txn) {
    try {
      // Create a reconciliation and match the transaction
      const reconRes = await accountingApi.createReconciliation({
        bank_account_id: txn.bankAccountId || txn.bank_account_id,
        period_start: txn.date || txn.transactionDate,
        period_end: txn.date || txn.transactionDate,
      });
      const reconId = reconRes?.data?.reconciliation?.id || reconRes?.data?.id;
      if (reconId) {
        await accountingApi.matchReconciliation(reconId, {
          transaction_ids: [txn.id],
        });
      }
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
      addToast(`Transaction matched: ${txn.bankRef || txn.bank_ref} - ${txn.counterparty}`);
    } catch (err) {
      addToast(`Failed to match transaction: ${err.message}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Cash & Bank</h1>

      {/* KPI Cards */}
      <div className="kpi-grid">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${kpi.bg}`}>
                  <Icon size={16} className={kpi.color} />
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
              <p className="text-sm font-bold text-gray-900">{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {/* Section A: Bank Accounts */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Bank Accounts</h2>
        </div>
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-600">Account Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
                <th className="text-right px-6 py-3 font-medium text-gray-600">Current Balance</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bankAccounts.map((account) => {
                const isNegative = account.currentBalance < 0;
                return (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{account.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          account.type === 'bank'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {account.type === 'bank' ? 'Bank' : 'Cash'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{account.currency}</td>
                    <td className={`px-6 py-3 text-right font-mono font-semibold ${isNegative ? 'text-red-600' : 'text-gray-900'}`}>
                      {isNegative && '-'}
                      {formatAmount(account.currentBalance, account.currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          account.currentBalance !== 0
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {account.currentBalance !== 0 ? 'Active' : 'Dormant'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section B: Cash Forecast */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cash Forecast</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {forecastProjection.map((fc) => {
            const net = (parseFloat(fc.expectedReceipts) || 0) - (parseFloat(fc.expectedPayments) || 0);
            const isPositive = net >= 0;
            return (
              <div key={fc.horizon} className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">{fc.label}</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Expected Receipts</span>
                    <span className="text-sm font-semibold text-green-600">
                      {formatUSD(parseFloat(fc.expectedReceipts) || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Expected Payments</span>
                    <span className="text-sm font-semibold text-red-600">
                      {formatUSD(parseFloat(fc.expectedPayments) || 0)}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-700">Net Position</span>
                      <span
                        className={`text-lg font-bold ${
                          isPositive ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {isPositive ? '+' : '-'}
                        {formatUSD(Math.abs(net))}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className={`mt-3 h-1 rounded-full ${
                    isPositive ? 'bg-green-400' : 'bg-red-400'
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Section C: Bank Transaction Feed */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Bank Transaction Feed</h2>
        </div>
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Bank Ref</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Counterparty</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Matched</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Linked Ref</th>
                <th className="text-center px-6 py-3 font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bankTransactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-600">{txn.date}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{txn.bankRef}</td>
                  <td className="px-4 py-3 text-gray-900">{txn.counterparty}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-semibold ${
                      txn.type === 'credit' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {txn.type === 'credit' ? '+' : '-'}
                    {formatAmount(txn.amount, txn.currency)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {txn.matched ? (
                      <CheckCircle2 size={18} className="inline text-green-500" />
                    ) : (
                      <XCircle size={18} className="inline text-red-400" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {txn.linkedRef ? (
                      <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                        <Link2 size={14} />
                        {txn.linkedRef}
                      </span>
                    ) : (
                      <span className="text-gray-400">--</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-center">
                    {txn.matched ? (
                      <button className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                        <Eye size={14} />
                        View
                      </button>
                    ) : (
                      <button
                        onClick={() => handleMatch(txn)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Link2 size={14} />
                        Match
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
