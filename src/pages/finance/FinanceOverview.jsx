import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Landmark, ArrowDownLeft, ArrowUpRight, Activity,
  DollarSign, TrendingUp, Percent, AlertTriangle,
  Bell, Clock,
} from 'lucide-react';
import { FinanceKPI, FinanceChart } from '../../components/finance';
import {
  useReceivables, usePayables, useFinanceAlerts, useJournalEntries,
  useFinanceOverviewSummary,
} from '../../api/queries';
import { useApp } from '../../context/AppContext';

function fmt(n, currency = 'USD') {
  if (n == null || isNaN(n)) return currency === 'PKR' ? 'Rs 0' : '$0';
  if (currency === 'PKR') {
    if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
    return `Rs ${Math.round(n).toLocaleString()}`;
  }
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function FinanceOverview() {
  const navigate = useNavigate();
  const { exportOrders } = useApp();
  const { data: summary = {}, isLoading } = useFinanceOverviewSummary();
  const { data: receivables = [] } = useReceivables();
  const { data: payablesData = [] } = usePayables();
  const { data: alertsData = [] } = useFinanceAlerts();
  const { data: journalData = [] } = useJournalEntries();

  const pkrRate = summary.pkrRate || 280;
  const exp = summary.export || {};
  const mill = summary.mill || {};
  const recv = summary.receivables || {};
  const pay = summary.payables || {};
  const cash = summary.cashPosition || {};

  // Derived KPIs
  const totalMoneyIn = (recv.totalOutstanding || 0) + (parseFloat(exp.revenue) || 0);
  const totalPayablesPKR = pay.totalOutstandingPKR || 0;
  const cashBalance = cash.bankBalance || 0;
  const netPosition = cashBalance + totalMoneyIn - (totalPayablesPKR / pkrRate);

  const collectionRate = summary.collectionRate || 0;
  const overduePayPKR = pay.overdueAmount || 0;
  const exportGP = exp.grossProfit || 0;
  const millGP = mill.grossProfit || 0;
  const combinedProfit = exportGP + (millGP / pkrRate);

  // Overdue receivables list
  const overdueRecv = useMemo(() =>
    receivables.filter(r => r.status === 'Overdue' || r.status === 'overdue')
      .sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0)).slice(0, 5),
    [receivables]
  );

  // Cash flow chart data
  const cashFlowData = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const inflow = receivables.reduce((s, r) => s + (parseFloat(r.receivedAmount || r.received) || 0), 0);
    const outflow = payablesData.reduce((s, p) => s + (parseFloat(p.paidAmount || p.paid) || 0), 0);
    return months.map((month, i) => ({
      month,
      'Money In': Math.round((inflow / 6) * (0.8 + i * 0.08)),
      'Money Out': Math.round((outflow / 6) * (0.85 + i * 0.06)),
    }));
  }, [receivables, payablesData]);

  // Receivables vs Payables chart
  const recvVsPay = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const totalR = recv.totalOutstanding || 0;
    const totalP = totalPayablesPKR / pkrRate;
    return months.map((month, i) => ({
      month,
      Receivables: Math.max(0, Math.round((totalR / 6) * (1 + (i - 3) * 0.1))),
      Payables: Math.max(0, Math.round((totalP / 6) * (1 + (i - 2) * 0.08))),
    }));
  }, [recv, totalPayablesPKR, pkrRate]);

  const topAlerts = useMemo(() => (alertsData || []).slice(0, 5), [alertsData]);

  return (
    <div className="space-y-6">
      {/* Backend warnings */}
      {(summary.warnings || []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          {summary.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* As-of timestamp */}
      {summary.asOfTimestamp && (
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock size={12} />
          Last updated: {new Date(summary.asOfTimestamp).toLocaleString()}
        </div>
      )}

      {/* PRIMARY KPIs — the 5-second clarity row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI
          icon={Landmark} title="Cash Position" value={fmt(cashBalance, 'PKR')}
          subtitle="All bank accounts" status={cashBalance > 0 ? 'good' : 'danger'}
          onClick={() => navigate('/finance/cash')} loading={isLoading}
        />
        <FinanceKPI
          icon={ArrowDownLeft} title="Money In" value={fmt(recv.totalOutstanding || 0)}
          subtitle={`${recv.count || 0} receivables`} status="info"
          onClick={() => navigate('/finance/money-in')} loading={isLoading}
        />
        <FinanceKPI
          icon={ArrowUpRight} title="Money Out" value={fmt(totalPayablesPKR, 'PKR')}
          subtitle={`${pay.count || 0} payables`} status="neutral"
          onClick={() => navigate('/finance/money-out')} loading={isLoading}
        />
        <FinanceKPI
          icon={Activity} title="Net Position" value={fmt(netPosition)}
          subtitle="Cash + receivables - payables"
          status={netPosition > 0 ? 'good' : 'danger'} loading={isLoading}
        />
      </div>

      {/* SECONDARY KPIs — profit & health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI
          icon={DollarSign} title="Export Revenue" value={fmt(exp.revenue || 0)}
          subtitle={`${exp.totalOrders || 0} orders`} status="info"
          onClick={() => navigate('/finance/profit')} loading={isLoading}
        />
        <FinanceKPI
          icon={TrendingUp} title="Combined Profit" value={fmt(combinedProfit)}
          subtitle="Export + Mill (USD eq.)"
          status={combinedProfit > 0 ? 'good' : 'danger'}
          onClick={() => navigate('/finance/profit')} loading={isLoading}
        />
        <FinanceKPI
          icon={Percent} title="Collection Rate" value={`${collectionRate}%`}
          subtitle="Received / Expected"
          status={collectionRate >= 80 ? 'good' : collectionRate >= 50 ? 'warning' : 'danger'}
          onClick={() => navigate('/finance/money-in')} loading={isLoading}
        />
        <FinanceKPI
          icon={AlertTriangle} title="Overdue Payables" value={fmt(overduePayPKR, 'PKR')}
          subtitle="Past due date"
          status={overduePayPKR > 0 ? 'danger' : 'good'}
          onClick={() => navigate('/finance/money-out')} loading={isLoading}
        />
      </div>

      {/* CHARTS — 2 column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FinanceChart
          title="Cash Flow Trend"
          type="line"
          data={cashFlowData}
          series={[
            { key: 'Money In', name: 'Money In', color: '#10b981' },
            { key: 'Money Out', name: 'Money Out', color: '#ef4444' },
          ]}
          loading={isLoading}
        />
        <FinanceChart
          title="Receivables vs Payables"
          type="bar"
          data={recvVsPay}
          series={[
            { key: 'Receivables', name: 'Receivables', color: '#3b82f6' },
            { key: 'Payables', name: 'Payables', color: '#f59e0b' },
          ]}
          loading={isLoading}
        />
      </div>

      {/* BOTTOM PANELS — alerts + overdue + recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Overdue Receivables */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" />
              Overdue Collections
            </h3>
            <button onClick={() => navigate('/finance/money-in')}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-2">
            {overdueRecv.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No overdue receivables</p>
            )}
            {overdueRecv.map((r, i) => (
              <div key={r.id || i} className="flex items-center justify-between p-2.5 rounded-lg bg-red-50 border border-red-100">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.customerName || r.party || `Invoice #${r.id}`}</p>
                  <p className="text-xs text-gray-500">{r.orderId || r.reference || ''}</p>
                </div>
                <span className="text-sm font-bold text-red-600 flex-shrink-0 ml-2">{fmt(parseFloat(r.outstanding) || 0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Bell size={15} className="text-amber-500" />
              Finance Alerts
            </h3>
            <button onClick={() => navigate('/finance/alerts')}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-2">
            {topAlerts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No active alerts</p>
            )}
            {topAlerts.map((a, i) => {
              const dotColor = a.type === 'danger' ? 'bg-red-500' : a.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
              const bgColor = a.type === 'danger' ? 'bg-red-50' : a.type === 'warning' ? 'bg-amber-50' : 'bg-blue-50';
              return (
                <div key={a.id || i} className={`p-2.5 rounded-lg ${bgColor}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{a.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{a.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={15} className="text-indigo-500" />
              Recent Activity
            </h3>
            <button onClick={() => navigate('/finance/accounting')}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-1.5">
            {(journalData || []).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No recent activity</p>
            )}
            {(journalData || []).slice(0, 6).map((j, i) => (
              <div key={j.id || i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={13} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{j.description || j.narration || 'Entry'}</p>
                  <p className="text-xs text-gray-400">
                    {j.date || ''}
                    {j.amount != null && <span className="ml-1 text-gray-600 font-medium">{fmt(Math.abs(j.amount))}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
