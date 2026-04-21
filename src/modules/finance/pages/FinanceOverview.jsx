import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Landmark, ArrowDownLeft, ArrowUpRight,
  DollarSign, TrendingUp, AlertTriangle,
  Bell, Clock, RefreshCw,
} from 'lucide-react';
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

function StatCard({ label, value, sub, accent = 'gray', icon: Icon }) {
  const accents = {
    green: 'border-l-green-500 bg-green-50/50',
    red: 'border-l-red-500 bg-red-50/50',
    blue: 'border-l-blue-500 bg-blue-50/50',
    amber: 'border-l-amber-500 bg-amber-50/50',
    gray: 'border-l-gray-300 bg-gray-50/50',
  };
  return (
    <div className={`border-l-4 rounded-r-lg p-3 ${accents[accent]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
          {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
        </div>
        {Icon && <Icon size={16} className="text-gray-400 flex-shrink-0" />}
      </div>
    </div>
  );
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

  const overdueRecv = useMemo(() =>
    (Array.isArray(receivables) ? receivables : [])
      .filter(r => r.status === 'Overdue' || r.status === 'overdue')
      .sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0)).slice(0, 5),
    [receivables]
  );

  const topAlerts = useMemo(() => (Array.isArray(alertsData) ? alertsData : []).slice(0, 5), [alertsData]);
  const recentJournals = useMemo(() => (Array.isArray(journalData) ? journalData : []).slice(0, 6), [journalData]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[0,1,2].map(i => <div key={i} className="animate-pulse h-32 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

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

      {/* FX rate badge */}
      <div className="flex items-center gap-3 text-xs text-gray-400">
        {summary.currentFxRate && (
          <span className="flex items-center gap-1 bg-gray-100 px-2.5 py-1 rounded-full text-gray-600 font-medium">
            1 USD = {summary.currentFxRate} PKR
          </span>
        )}
        <span className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-medium">Base: PKR</span>
      </div>

      {/* 3-column snapshot: Money In / P&L / Money Out */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Money In */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-sm transition-shadow"
          onClick={() => navigate('/finance/money-in')}>
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownLeft size={18} className="text-green-600" />
            <h3 className="text-sm font-semibold text-gray-700">Money In</h3>
          </div>
          <div className="space-y-2">
            <StatCard label="Receivables" value={fmtUSD(recv.totalOutstandingForeign || 0)}
              sub={`${recv.count || 0} open · ${fmtPKR(recv.totalOutstandingPkr || 0)}`} accent="blue" />
            <StatCard label="Overdue" value={fmtUSD(recv.overdueAmountForeign || 0)}
              accent={(recv.overdueAmountForeign || 0) > 0 ? 'red' : 'green'}
              sub={(recv.overdueAmountForeign || 0) > 0 ? 'Past due date' : 'Nothing overdue'} />
            <StatCard label="Collection Rate" value={`${summary.collectionRate || 0}%`}
              accent={(summary.collectionRate || 0) >= 80 ? 'green' : 'amber'}
              sub="Received / Expected" />
          </div>
        </div>

        {/* P&L Center */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-700">Profit & Loss</h3>
          </div>
          <div className="space-y-2">
            <StatCard label="Export Revenue" value={fmtPKR(exp.revenuePkrBooked || 0)}
              sub={`${fmtUSD(exp.revenueForeign || 0)} ${exp.revenueForeignCurrency || 'USD'}`} accent="blue" />
            <StatCard label="Export Profit" value={fmtPKR(exp.bookedProfitPkr || 0)}
              sub={`Margin ${exp.marginPct || 0}%`}
              accent={(exp.bookedProfitPkr || 0) > 0 ? 'green' : 'red'} />
            <StatCard label="Mill Profit" value={fmtPKR(mill.grossProfit || 0)}
              sub={`${mill.batchCount || 0} batches · Margin ${mill.marginPct || 0}%`}
              accent={(mill.grossProfit || 0) > 0 ? 'green' : 'red'} />
            <div className="border-t pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-600 uppercase">Consolidated</span>
                <span className={`text-lg font-bold ${(consolidated.profitPkr || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {fmtPKR(consolidated.profitPkr || 0)}
                </span>
              </div>
              {(exp.fxGainLossPkr || 0) !== 0 && (
                <p className={`text-[11px] mt-0.5 ${(exp.fxGainLossPkr || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  FX impact: {fmtPKR(exp.fxGainLossPkr || 0)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Money Out */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-sm transition-shadow"
          onClick={() => navigate('/finance/money-out')}>
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpRight size={18} className="text-red-600" />
            <h3 className="text-sm font-semibold text-gray-700">Money Out</h3>
          </div>
          <div className="space-y-2">
            <StatCard label="Payables" value={fmtPKR(pay.totalOutstandingPkr || 0)}
              sub={`${pay.count || 0} outstanding`} accent="amber" />
            <StatCard label="Overdue Payables" value={fmtPKR(pay.overdueAmountPkr || 0)}
              accent={(pay.overdueAmountPkr || 0) > 0 ? 'red' : 'green'}
              sub={(pay.overdueAmountPkr || 0) > 0 ? 'Past due date' : 'All current'} />
            <StatCard label="Cash Position" value={fmtPKR(cash.bankBalancePkr || 0)}
              sub="All bank accounts"
              accent={(cash.bankBalancePkr || 0) > 0 ? 'green' : 'red'}
              icon={Landmark} />
          </div>
        </div>
      </div>

      {/* Bottom panels — 3 col */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Overdue Collections */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500" /> Overdue
            </h3>
            <button onClick={() => navigate('/finance/money-in')} className="text-xs text-blue-600 hover:underline">View All</button>
          </div>
          {overdueRecv.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No overdue receivables</p>
          ) : (
            <div className="space-y-1.5">
              {overdueRecv.map((r, i) => (
                <Link key={r.id || i} to={r.orderId ? `/export/${r.orderId}` : '/finance/money-in'}
                  className="flex items-center justify-between p-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors">
                  <span className="text-sm text-gray-900 truncate">{r.customerName || r.party || `#${r.id}`}</span>
                  <span className="text-sm font-bold text-red-600 ml-2">{fmtUSD(parseFloat(r.outstanding) || 0)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Bell size={14} className="text-amber-500" /> Alerts
            </h3>
            <button onClick={() => navigate('/finance/alerts')} className="text-xs text-blue-600 hover:underline">View All</button>
          </div>
          {topAlerts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No alerts</p>
          ) : (
            <div className="space-y-1.5">
              {topAlerts.map((a, i) => {
                const bg = a.type === 'danger' ? 'bg-red-50' : a.type === 'warning' ? 'bg-amber-50' : 'bg-blue-50';
                const dot = a.type === 'danger' ? 'bg-red-500' : a.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
                return (
                  <div key={a.id || i} className={`p-2 rounded-lg ${bg}`}>
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <p className="text-sm text-gray-900 line-clamp-1">{a.title || a.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Journal Entries */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-indigo-500" /> Recent Entries
            </h3>
            <button onClick={() => navigate('/finance/accounting')} className="text-xs text-blue-600 hover:underline">View All</button>
          </div>
          {recentJournals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No recent entries</p>
          ) : (
            <div className="space-y-1">
              {recentJournals.map((j, i) => (
                <div key={j.id || i} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50">
                  <DollarSign size={12} className="text-indigo-400 flex-shrink-0" />
                  <p className="text-sm text-gray-700 truncate flex-1">{j.description || j.narration || 'Entry'}</p>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{j.date || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
