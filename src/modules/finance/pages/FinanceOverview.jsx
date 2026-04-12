import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Landmark, ArrowDownLeft, ArrowUpRight, Activity,
  DollarSign, TrendingUp, Percent, AlertTriangle,
  Bell, Clock, RefreshCw,
} from 'lucide-react';
import { FinanceKPI, FinanceChart } from '../../../components/finance';
import {
  useReceivables, useFinanceAlerts, useJournalEntries,
  useFinanceOverviewSummary,
} from '../../../api/queries';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function FinanceOverview() {
  const navigate = useNavigate();
  const { data: summary = {}, isLoading } = useFinanceOverviewSummary();
  const { data: receivables = [] } = useReceivables();
  const { data: alertsData = [] } = useFinanceAlerts();
  const { data: journalData = [] } = useJournalEntries();

  const exp = summary.export || {};
  const mill = summary.mill || {};
  const recv = summary.receivables || {};
  const pay = summary.payables || {};
  const cash = summary.cashPosition || {};
  const consolidated = summary.consolidated || {};

  // Overdue receivables list
  const overdueRecv = useMemo(() =>
    receivables.filter(r => r.status === 'Overdue' || r.status === 'overdue')
      .sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0)).slice(0, 5),
    [receivables]
  );

  const topAlerts = useMemo(() => (alertsData || []).slice(0, 5), [alertsData]);

  // Chart data (synthetic from current totals)
  const cashFlowData = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const inflow = recv.totalOutstandingPkr || 0;
    const outflow = pay.totalOutstandingPkr || 0;
    return months.map((month, i) => ({
      month,
      'Money In': Math.round((inflow / 6) * (0.8 + i * 0.08)),
      'Money Out': Math.round((outflow / 6) * (0.85 + i * 0.06)),
    }));
  }, [recv, pay]);

  return (
    <div className="space-y-6">
      {/* Warnings */}
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

      {/* Metadata bar */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        {summary.asOfTimestamp && (
          <span className="flex items-center gap-1"><Clock size={12} /> {new Date(summary.asOfTimestamp).toLocaleString()}</span>
        )}
        {summary.currentFxRate && (
          <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">
            <RefreshCw size={10} /> 1 USD = {summary.currentFxRate} PKR
          </span>
        )}
        <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Base: PKR</span>
      </div>

      {/* PRIMARY KPIs — PKR base */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI
          icon={TrendingUp} title="Booked Revenue" value={fmtPKR(exp.revenuePkrBooked || 0)}
          subtitle={`${fmtUSD(exp.revenueForeign || 0)} ${exp.revenueForeignCurrency || 'USD'}`}
          status="info" onClick={() => navigate('/finance/profit')} loading={isLoading}
        />
        <FinanceKPI
          icon={DollarSign} title="Booked Profit" value={fmtPKR(exp.bookedProfitPkr || 0)}
          subtitle={`Margin ${exp.marginPct || 0}%`}
          status={(exp.bookedProfitPkr || 0) > 0 ? 'good' : 'danger'}
          onClick={() => navigate('/finance/profit')} loading={isLoading}
        />
        <FinanceKPI
          icon={RefreshCw} title="FX Gain/Loss" value={fmtPKR(exp.fxGainLossPkr || 0)}
          subtitle="Current vs booked rate"
          status={(exp.fxGainLossPkr || 0) >= 0 ? 'good' : 'warning'}
          loading={isLoading}
        />
        <FinanceKPI
          icon={TrendingUp} title="Consolidated Profit" value={fmtPKR(consolidated.profitPkr || 0)}
          subtitle={`Export + Mill (${fmtUSD(consolidated.profitForeign || 0)} eq.)`}
          status={(consolidated.profitPkr || 0) > 0 ? 'good' : 'danger'}
          onClick={() => navigate('/finance/profit')} loading={isLoading}
        />
      </div>

      {/* SECONDARY KPIs — cash & working capital */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI
          icon={Landmark} title="Cash Position" value={fmtPKR(cash.bankBalancePkr || 0)}
          subtitle="All bank accounts (PKR)"
          status={(cash.bankBalancePkr || 0) > 0 ? 'good' : 'danger'}
          onClick={() => navigate('/finance/cash')} loading={isLoading}
        />
        <FinanceKPI
          icon={ArrowDownLeft} title="Receivables" value={fmtUSD(recv.totalOutstandingForeign || 0)}
          subtitle={`${recv.count || 0} open (${fmtPKR(recv.totalOutstandingPkr || 0)})`}
          status="info" onClick={() => navigate('/finance/money-in')} loading={isLoading}
        />
        <FinanceKPI
          icon={ArrowUpRight} title="Payables" value={fmtPKR(pay.totalOutstandingPkr || 0)}
          subtitle={`${pay.count || 0} outstanding`}
          status="neutral" onClick={() => navigate('/finance/money-out')} loading={isLoading}
        />
        <FinanceKPI
          icon={Percent} title="Collection Rate" value={`${summary.collectionRate || 0}%`}
          subtitle="Received / Expected"
          status={(summary.collectionRate || 0) >= 80 ? 'good' : (summary.collectionRate || 0) >= 50 ? 'warning' : 'danger'}
          onClick={() => navigate('/finance/money-in')} loading={isLoading}
        />
      </div>

      {/* Mill KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI
          icon={Activity} title="Mill Revenue" value={fmtPKR(mill.revenue || 0)}
          subtitle={`${mill.batchCount || 0} batches (${mill.priceSource || 'none'})`}
          status={(mill.revenue || 0) > 0 ? 'info' : 'warning'} loading={isLoading}
        />
        <FinanceKPI
          icon={Activity} title="Mill Profit" value={fmtPKR(mill.grossProfit || 0)}
          subtitle={`Margin ${mill.marginPct || 0}%`}
          status={(mill.grossProfit || 0) > 0 ? 'good' : 'danger'} loading={isLoading}
        />
        <FinanceKPI
          icon={AlertTriangle} title="Overdue Payables" value={fmtPKR(pay.overdueAmountPkr || 0)}
          subtitle="Past due date"
          status={(pay.overdueAmountPkr || 0) > 0 ? 'danger' : 'good'}
          onClick={() => navigate('/finance/money-out')} loading={isLoading}
        />
        <FinanceKPI
          icon={AlertTriangle} title="Overdue Receivables" value={fmtUSD(recv.overdueAmountForeign || 0)}
          subtitle="Past due date"
          status={(recv.overdueAmountForeign || 0) > 0 ? 'danger' : 'good'}
          onClick={() => navigate('/finance/money-in')} loading={isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FinanceChart
          title="Cash Flow Trend (PKR)" type="line" data={cashFlowData} currency="Rs "
          series={[
            { key: 'Money In', name: 'Money In', color: '#10b981' },
            { key: 'Money Out', name: 'Money Out', color: '#ef4444' },
          ]}
          loading={isLoading}
        />
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Export Profit Breakdown (PKR)</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Booked Revenue</span>
              <span className="font-medium text-gray-900">{fmtPKR(exp.revenuePkrBooked || 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Operational Costs</span>
              <span className="font-medium text-red-600">-{fmtPKR(exp.operationalCostsPkr || 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">COGS (Rice/Milling)</span>
              <span className="font-medium text-red-600">-{fmtPKR(exp.cogsPkr || 0)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm font-bold">
              <span>Booked Profit</span>
              <span className={(exp.bookedProfitPkr || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtPKR(exp.bookedProfitPkr || 0)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>FX Gain/Loss (rate change)</span>
              <span className={(exp.fxGainLossPkr || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}>{fmtPKR(exp.fxGainLossPkr || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Overdue Collections */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" /> Overdue Collections
            </h3>
            <button onClick={() => navigate('/finance/money-in')} className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-2">
            {overdueRecv.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No overdue receivables</p>}
            {overdueRecv.map((r, i) => (
              <Link key={r.id || i} to={r.orderId ? `/export/${r.orderId}` : '/finance/money-in'}
                className="flex items-center justify-between p-2.5 rounded-lg bg-red-50 border border-red-100 hover:bg-red-100 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.customerName || r.party || `#${r.id}`}</p>
                  <p className="text-xs text-blue-600">{r.recvNo || r.orderId || ''}</p>
                </div>
                <span className="text-sm font-bold text-red-600 flex-shrink-0 ml-2">{fmtUSD(parseFloat(r.outstanding) || 0)}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Bell size={15} className="text-amber-500" /> Finance Alerts
            </h3>
            <button onClick={() => navigate('/finance/alerts')} className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-2">
            {topAlerts.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No active alerts</p>}
            {topAlerts.map((a, i) => {
              const dot = a.type === 'danger' ? 'bg-red-500' : a.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
              const bg = a.type === 'danger' ? 'bg-red-50' : a.type === 'warning' ? 'bg-amber-50' : 'bg-blue-50';
              return (
                <div key={a.id || i} className={`p-2.5 rounded-lg ${bg}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                    <div><p className="text-sm font-medium text-gray-900">{a.title}</p><p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{a.message}</p></div>
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
              <Clock size={15} className="text-indigo-500" /> Recent Activity
            </h3>
            <button onClick={() => navigate('/finance/accounting')} className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All</button>
          </div>
          <div className="space-y-1.5">
            {(journalData || []).length === 0 && <p className="text-sm text-gray-400 text-center py-4">No recent activity</p>}
            {(journalData || []).slice(0, 6).map((j, i) => (
              <div key={j.id || i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={13} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{j.description || j.narration || 'Entry'}</p>
                  <p className="text-xs text-gray-400">{j.date || ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
