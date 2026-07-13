import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reportingApi } from '../../analytics/api/services';
import { useAuth } from '../../../context/AuthContext';
import { useApprovePayrollRun, usePayPayrollRun } from '../../../api/queries';
import {
  Landmark, ArrowDownLeft, ArrowUpRight,
  TrendingUp, TrendingDown, AlertTriangle,
  Bell, Clock, Lock, Wallet, Activity,
  Plus, Receipt, ArrowRightLeft, RefreshCw, ExternalLink,
  CheckCircle2, AlertCircle, CalendarClock,
} from 'lucide-react';
import {
  useReceivables, usePayables, useFinanceAlerts, useJournalEntries,
  useFinanceOverviewSummary, useUpcoming,
} from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import {
  BUCKET_KEYS, BUCKET_COLORS, ageDays, ageBucket, bucketize, isOpenAR,
} from '../utils/aging';
import { useFxRate } from '../utils/fx';
import AnomalyWatchCard from '../../ai/components/AnomalyWatchCard';
import PurchaseRequirementsPanel from '../../purchaseRequirements/components/PurchaseRequirementsPanel';

// ─── Formatting helpers ───────────────────────────────────────────────
function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Aging helpers + bucket palette moved to ../utils/aging so MoneyIn and
// any future caller render the same buckets. See useFxRate() too for
// the FX fallback used by mixed-currency receivables.

// ─── Page ─────────────────────────────────────────────────────────────
export default function FinanceOverview() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // Finance (payments-only) can't open Export/Mill pages — only navigate there if
  // the role actually has access, else keep the click on a finance destination so
  // it never lands on an "Access Denied" route.
  const goExport = () => navigate(hasPermission('export_orders', 'view') ? '/export' : '/finance/money-in');
  const goMill = () => navigate(hasPermission('milling', 'view') ? '/milling' : '/finance/money-in');
  const { data: upcoming } = useUpcoming();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { data: summary = {}, isLoading, refetch } = useFinanceOverviewSummary();
  const { data: receivables = [] } = useReceivables(rangeParams);
  const { data: payables = [] } = usePayables(rangeParams);
  const { data: alertsData = [] } = useFinanceAlerts();
  const { data: journalData = [] } = useJournalEntries(rangeParams);

  const exp = summary.export || {};
  const mill = summary.mill || {};
  const local = summary.local || {};
  const recv = summary.receivables || {};
  const pay = summary.payables || {};
  const cash = summary.cashPosition || {};
  const consolidated = summary.consolidated || {};

  // ─── Aging analysis (FE-computed since backend hardcodes aging=0) ──
  const recvAging = useMemo(() => bucketize(receivables, { mode: 'mixed' }), [receivables]);
  const payAging  = useMemo(() => bucketize(payables,    { mode: 'pkr' }),    [payables]);

  // ─── Top counterparties by outstanding ─────────────────────────────
  const topOverdueRecv = useMemo(() =>
    onlyOpen(receivables)
      .filter(r => isOverdue(r))
      .sort((a, b) => (parseFloat(b.outstanding) || 0) - (parseFloat(a.outstanding) || 0))
      .slice(0, 5),
    [receivables]
  );
  const topOverduePay = useMemo(() =>
    onlyOpen(payables)
      .filter(p => isOverdue(p))
      .sort((a, b) => (parseFloat(b.outstanding) || 0) - (parseFloat(a.outstanding) || 0))
      .slice(0, 5),
    [payables]
  );

  const topAlerts = useMemo(() => (Array.isArray(alertsData) ? alertsData : []).slice(0, 4), [alertsData]);
  const recentJournals = useMemo(() => (Array.isArray(journalData) ? journalData : []).slice(0, 6), [journalData]);

  if (isLoading) return <Skeleton />;

  const consolidatedProfit = consolidated.profitPkr || 0;
  const consolidatedColor = consolidatedProfit >= 0
    ? 'from-emerald-600 via-emerald-500 to-teal-500'
    : 'from-red-600 via-red-500 to-red-500';

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${consolidatedColor} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Activity size={14} /> Consolidated profit (booked)
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight">
              {fmtPKR(consolidatedProfit)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              Export {fmtPKR(exp.bookedProfitPkr || 0)} · Mill {fmtPKR(mill.grossProfit || 0)}
              {(local.grossProfit || 0) !== 0 && <> · Local {fmtPKR(local.grossProfit || 0)}</>}
              {(exp.fxGainLossPkr || 0) !== 0 && (
                <> · FX {(exp.fxGainLossPkr || 0) >= 0 ? '+' : ''}{fmtPKR(exp.fxGainLossPkr || 0)}</>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary.currentFxRate && (
              <span className="bg-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium">
                1 USD = {summary.currentFxRate} PKR
              </span>
            )}
            <span className="bg-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium">Base PKR</span>
            <button onClick={() => refetch()} className="bg-white/15 backdrop-blur-sm hover:bg-white/25 px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1 transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {(summary.warnings || []).length > 0 && (
          <div className="relative mt-3 pt-3 border-t border-white/20 space-y-1">
            {summary.warnings.slice(0, 2).map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <AlertTriangle size={12} /> <span className="opacity-95">{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── UPCOMING CHEQUES & DUES ──────────────────────────────── */}
      {((upcoming?.receiving?.length || 0) + (upcoming?.giving?.length || 0)) > 0 && (
        <Link to="/finance/due-dates" className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarClock size={16} className="text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-900">Upcoming Cheques &amp; Dues</h2>
            </div>
            <span className="text-xs text-blue-600 inline-flex items-center gap-1">View all <ExternalLink size={12} /></span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-[11px] text-emerald-600 uppercase tracking-wide flex items-center gap-1"><ArrowDownLeft size={11} /> Receiving</p>
              <p className="text-lg font-bold text-emerald-700">{fmtPKR(upcoming?.totalReceiving || 0)}</p>
              <p className="text-[11px] text-emerald-600/80">{upcoming?.receiving?.length || 0} cheque(s) / due(s)</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-[11px] text-red-600 uppercase tracking-wide flex items-center gap-1"><ArrowUpRight size={11} /> Giving</p>
              <p className="text-lg font-bold text-red-700">{fmtPKR(upcoming?.totalGiving || 0)}</p>
              <p className="text-[11px] text-red-600/80">{upcoming?.giving?.length || 0} cheque(s) / due(s)</p>
            </div>
          </div>
        </Link>
      )}

      {/* ─── PRIMARY KPI ROW ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          icon={ArrowDownLeft}
          tone="emerald"
          label="Receivables"
          primary={fmtUSD(recv.totalOutstandingForeign || 0)}
          secondary={`${recv.count || 0} open · ${fmtPKR(recv.totalOutstandingPkr || 0)}`}
          hint={(recv.overdueAmountForeign || 0) > 0 ? `${fmtUSD(recv.overdueAmountForeign)} overdue` : 'All current'}
          hintBad={(recv.overdueAmountForeign || 0) > 0}
          onClick={() => navigate('/finance/money-in')}
        />
        <KpiTile
          icon={ArrowUpRight}
          tone="rose"
          label="Payables"
          primary={fmtPKR(pay.totalOutstandingPkr || 0)}
          secondary={`${pay.count || 0} outstanding`}
          hint={(pay.overdueAmountPkr || 0) > 0 ? `${fmtPKR(pay.overdueAmountPkr)} overdue` : 'All current'}
          hintBad={(pay.overdueAmountPkr || 0) > 0}
          onClick={() => navigate('/finance/money-out')}
        />
        <KpiTile
          icon={Wallet}
          tone="indigo"
          label="Cash Position"
          primary={fmtPKR(cash.bankBalancePkr || 0)}
          secondary={cash.accountCount ? `${cash.accountCount} accounts` : 'All bank accounts'}
          hint={cash.bankBalancePkr > 0 ? 'Available' : 'Below zero'}
          hintBad={(cash.bankBalancePkr || 0) <= 0}
          onClick={() => navigate('/finance/cash')}
        />
        <KpiTile
          icon={TrendingUp}
          tone="violet"
          label="Collection Rate"
          primary={`${summary.collectionRate || 0}%`}
          secondary="Received vs expected"
          hint={(summary.collectionRate || 0) >= 80 ? 'On target' : 'Below 80%'}
          hintBad={(summary.collectionRate || 0) < 80}
        />
      </div>

      {/* ─── PAYROLL APPROVALS (Finance/Owner only, when pending) ──── */}
      <PayrollApprovalsCard fmtPKR={fmtPKR} />

      {/* ─── PAYROLL SUMMARY (consolidated from mill payroll) ──────── */}
      <PayrollSummaryStrip navigate={navigate} fmtPKR={fmtPKR} />

      {/* ─── AI ANOMALY WATCH ─────────────────────────────────────── */}
      <AnomalyWatchCard />

      {/* ─── BUSINESS SEGMENTS ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <SegmentCard
          tone="blue"
          title="Export Operations"
          subtitle={`${exp.activeOrders || 0} active · ${exp.totalOrders || 0} total`}
          revenueLabel="Revenue (PKR)"
          revenue={fmtPKR(exp.revenuePkrBooked || 0)}
          revenueSub={`${fmtUSD(exp.revenueForeign || 0)} foreign`}
          profitLabel="Booked Profit"
          profit={fmtPKR(exp.bookedProfitPkr || 0)}
          marginPct={exp.marginPct}
          onClick={goExport}
        />
        <SegmentCard
          tone="amber"
          title="Mill Operations"
          subtitle={`${mill.batchCount || 0} completed batches${mill.priceSource && mill.priceSource !== 'confirmed' ? ` · prices ${mill.priceSource.replace(/_/g, ' ')}` : ''}`}
          revenueLabel="Revenue (PKR)"
          revenue={fmtPKR(mill.revenue || 0)}
          revenueSub={`Costs ${fmtPKR((mill.directCosts || 0) + (mill.overheads || 0))}`}
          profitLabel="Gross Profit"
          profit={fmtPKR(mill.grossProfit || 0)}
          marginPct={mill.marginPct}
          onClick={goMill}
        />
        <SegmentCard
          tone="emerald"
          title="Local Sales"
          subtitle={`${local.completedCount || 0} completed · ${local.saleCount || 0} total${(local.outstanding || 0) > 0 ? ` · ${fmtPKR(local.outstanding)} due` : ''}`}
          revenueLabel="Revenue (PKR)"
          revenue={fmtPKR(local.revenue || 0)}
          revenueSub={`Collected ${fmtPKR(local.collected || 0)}`}
          profitLabel="Gross Profit"
          profit={fmtPKR(local.grossProfit || 0)}
          marginPct={local.marginPct}
          onClick={() => navigate('/finance/local-sales')}
        />
      </div>

      {/* ─── PURCHASE REQUESTS (approved material buys awaiting payment) ── */}
      <PurchaseRequirementsPanel embedded />

      {/* ─── AGING STRIPS ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgingPanel
          title="Receivables Aging"
          icon={ArrowDownLeft}
          tone="emerald"
          data={recvAging}
          totalLabel={fmtUSD(recvAging.totalForeign)}
          totalSubLabel={fmtPKR(recvAging.totalPkr)}
          onClickAll={() => navigate('/finance/money-in')}
        />
        <AgingPanel
          title="Payables Aging"
          icon={ArrowUpRight}
          tone="rose"
          data={payAging}
          totalLabel={fmtPKR(payAging.totalPkr)}
          onClickAll={() => navigate('/finance/money-out')}
        />
      </div>

      {/* ─── TOP COUNTERPARTIES ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CounterpartyList
          title="Top Overdue Customers"
          icon={AlertTriangle}
          empty="No overdue receivables"
          rows={topOverdueRecv}
          itemLabel={(r) => r.customerName || r.party || `#${r.id}`}
          itemAmount={(r) => fmtUSD(parseFloat(r.outstanding) || 0)}
          itemAge={(r) => ageDays(r.dueDate || r.due_date)}
          itemHref={(r) => r.orderId ? `/export/${r.orderId}` : '/finance/money-in'}
          tone="rose"
        />
        <CounterpartyList
          title="Top Overdue Suppliers"
          icon={AlertTriangle}
          empty="No overdue payables"
          rows={topOverduePay}
          itemLabel={(p) => p.supplierName || p.supplier_name || p.party || p.linkedRef || p.linked_ref || `#${p.id}`}
          itemAmount={(p) => fmtPKR(parseFloat(p.outstanding) || 0)}
          itemAge={(p) => ageDays(p.dueDate || p.due_date)}
          itemHref={() => '/finance/money-out'}
          tone="amber"
        />
      </div>

      {/* ─── COGS LIFECYCLE (kept from previous design — useful) ─── */}
      {exp.cogsStatus && (exp.cogsStatus.preShipment > 0 || exp.cogsStatus.shippedMissingCogs > 0) && (
        <CogsLifecyclePanel data={exp.cogsStatus} />
      )}

      {/* ─── ACTIVITY + ALERTS ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Alerts"
          icon={Bell}
          iconColor="text-amber-500"
          onSeeAll={() => navigate('/finance/alerts')}
        >
          {topAlerts.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-6 flex items-center justify-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" /> All clear
            </div>
          ) : (
            <div className="space-y-1.5">
              {topAlerts.map((a, i) => {
                const tone = a.type === 'danger' || a.severity === 'critical' ? 'red' :
                  a.type === 'warning' || a.severity === 'warning' ? 'amber' : 'blue';
                const cls = {
                  red: 'bg-red-50 border-l-red-500',
                  amber: 'bg-amber-50 border-l-amber-500',
                  blue: 'bg-blue-50 border-l-blue-500',
                }[tone];
                return (
                  <div key={a.id || i} className={`p-2.5 rounded-lg border-l-4 ${cls}`}>
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className={`mt-0.5 flex-shrink-0 text-${tone}-500`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 font-medium line-clamp-1">{a.title || a.message}</p>
                        {a.detail && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{a.detail}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="Recent Journal Entries"
          icon={Clock}
          iconColor="text-indigo-500"
          onSeeAll={() => navigate('/finance/accounting')}
        >
          {recentJournals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No recent entries</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentJournals.map((j, i) => (
                <li key={j.id || i} className="py-2 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Receipt size={13} className="text-indigo-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{j.description || j.narration || 'Journal entry'}</p>
                    {j.referenceNo && <p className="text-[11px] text-gray-400 truncate">{j.referenceNo}</p>}
                  </div>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{j.date || ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ─── QUICK ACTIONS BAR ────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-4 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-gray-400 mr-2">Quick actions</span>
          <QuickAction icon={ArrowDownLeft} label="Record Receipt" onClick={() => navigate('/finance/money-in')} tone="emerald" />
          <QuickAction icon={ArrowUpRight} label="Make Payment" onClick={() => navigate('/finance/money-out')} tone="rose" />
          <QuickAction icon={ArrowRightLeft} label="Internal Transfer" onClick={() => navigate('/finance/transfers')} tone="indigo" />
          <QuickAction icon={Landmark} label="Reconcile" onClick={() => navigate('/finance/cash')} tone="violet" />
          <QuickAction icon={TrendingUp} label="Profitability" onClick={() => navigate('/finance/profit')} tone="amber" />
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-32 bg-gray-100 rounded-2xl" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-44 bg-gray-100 rounded-xl" />
        <div className="h-44 bg-gray-100 rounded-xl" />
      </div>
    </div>
  );
}

// ─── KPI Tile ──────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, tone = 'gray', label, primary, secondary, hint, hintBad, onClick }) {
  const tones = {
    emerald: { ring: 'ring-emerald-100', icon: 'text-emerald-500 bg-emerald-50', accent: 'text-emerald-600' },
    rose:    { ring: 'ring-red-100',    icon: 'text-red-500 bg-red-50',       accent: 'text-red-600' },
    indigo:  { ring: 'ring-indigo-100',  icon: 'text-indigo-500 bg-indigo-50',   accent: 'text-indigo-600' },
    violet:  { ring: 'ring-violet-100',  icon: 'text-violet-500 bg-violet-50',   accent: 'text-violet-600' },
    amber:   { ring: 'ring-amber-100',   icon: 'text-amber-500 bg-amber-50',     accent: 'text-amber-600' },
    gray:    { ring: 'ring-gray-100',    icon: 'text-gray-500 bg-gray-50',       accent: 'text-gray-600' },
  };
  const t = tones[tone] || tones.gray;
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 ${onClick ? 'hover:border-gray-300 cursor-pointer hover:shadow-sm' : ''} transition-all p-4 text-left ring-1 ${t.ring}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium min-w-0 truncate">{label}</span>
        {Icon && <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${t.icon}`}><Icon size={14} /></span>}
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none truncate">{primary}</div>
      {secondary && <div className="text-[11px] text-gray-500 mt-1">{secondary}</div>}
      {hint && (
        <div className={`text-[11px] mt-2 ${hintBad ? 'text-red-600' : 'text-emerald-600'} font-medium`}>
          {hintBad ? '● ' : '✓ '}{hint}
        </div>
      )}
    </Cmp>
  );
}

// ─── Segment card (Export / Mill / Local Sales) ───────────────────────
function SegmentCard({ tone = 'gray', title, subtitle, revenueLabel, revenue, revenueSub, profitLabel, profit, marginPct, onClick }) {
  const tones = {
    blue:    { bar: 'bg-blue-500',    accent: 'text-blue-600',    ring: 'ring-blue-100' },
    amber:   { bar: 'bg-amber-500',   accent: 'text-amber-600',   ring: 'ring-amber-100' },
    emerald: { bar: 'bg-emerald-500', accent: 'text-emerald-600', ring: 'ring-emerald-100' },
    gray:    { bar: 'bg-gray-400',    accent: 'text-gray-600',    ring: 'ring-gray-100' },
  };
  const t = tones[tone] || tones.gray;
  const margin = parseFloat(marginPct) || 0;
  const profitNum = typeof profit === 'string' ? parseFloat(profit.replace(/[^0-9.-]/g, '')) : profit;
  const profitColor = profitNum >= 0 ? 'text-emerald-700' : 'text-red-600';
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 ${onClick ? 'hover:border-gray-300 cursor-pointer hover:shadow-sm' : ''} transition-all p-5 text-left ring-1 ${t.ring} relative overflow-hidden`}
    >
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${t.bar}`} />
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold ${t.accent}`}>{title}</h3>
        {margin !== 0 && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${margin >= 15 ? 'bg-emerald-50 text-emerald-700' : margin >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
            {margin.toFixed(1)}% margin
          </span>
        )}
      </div>
      {subtitle && <p className="text-[11px] text-gray-500 mb-3">{subtitle}</p>}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{revenueLabel}</p>
          <p className="text-base font-bold text-gray-900 mt-0.5">{revenue}</p>
          {revenueSub && <p className="text-[10px] text-gray-400 mt-0.5">{revenueSub}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{profitLabel}</p>
          <p className={`text-base font-bold mt-0.5 ${profitColor}`}>{profit}</p>
        </div>
      </div>
    </Cmp>
  );
}

// ─── Aging panel ───────────────────────────────────────────────────────
function AgingPanel({ title, icon: Icon, tone, data, totalLabel, totalSubLabel, onClickAll }) {
  const total = data.totalPkr || 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Icon size={14} className={tone === 'emerald' ? 'text-emerald-500' : 'text-red-500'} />
          {title}
        </h3>
        <button onClick={onClickAll} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
          View all <ExternalLink size={11} />
        </button>
      </div>

      <div className="mb-3">
        <div className="text-2xl font-bold text-gray-900">{totalLabel}</div>
        {totalSubLabel && <div className="text-xs text-gray-500 mt-0.5">{totalSubLabel}</div>}
      </div>

      {/* Stacked bar */}
      {total === 0 ? (
        <div className="text-xs text-gray-400 text-center py-3">No outstanding balances</div>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
            {BUCKET_KEYS.map(k => {
              const pct = total > 0 ? (data[k].totalPkr / total) * 100 : 0;
              if (pct === 0) return null;
              return <div key={k} className={BUCKET_COLORS[k].bar} style={{ width: `${pct}%` }} title={`${k}: ${pct.toFixed(0)}%`} />;
            })}
          </div>
          <div className="grid grid-cols-4 gap-1.5 mt-3">
            {BUCKET_KEYS.map(k => (
              <div key={k} className={`text-center px-1.5 py-2 rounded-md ${BUCKET_COLORS[k].tag}`}>
                <div className="text-[10px] uppercase tracking-wider font-medium">{k}d</div>
                <div className="text-sm font-bold mt-0.5">{data[k].count}</div>
                <div className="text-[10px] mt-0.5 truncate" title={fmtPKR(data[k].totalPkr)}>{fmtPKR(data[k].totalPkr)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Counterparty list ────────────────────────────────────────────────
function CounterpartyList({ title, icon: Icon, rows, itemLabel, itemAmount, itemAge, itemHref, empty }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
        <Icon size={14} className="text-red-500" /> {title}
      </h3>
      {rows.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-6 flex items-center justify-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-500" /> {empty}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const days = itemAge(r);
            return (
              <li key={r.id || i}>
                <Link to={itemHref(r)} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  <span className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{itemLabel(r)}</div>
                    {days != null && <div className="text-[11px] text-gray-500">{days} days overdue</div>}
                  </div>
                  <span className="text-sm font-bold text-gray-900 flex-shrink-0">{itemAmount(r)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Generic panel ────────────────────────────────────────────────────
function Panel({ title, icon: Icon, iconColor, children, onSeeAll }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Icon size={14} className={iconColor} /> {title}
        </h3>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
            View all <ExternalLink size={11} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── COGS lifecycle panel ─────────────────────────────────────────────
function CogsLifecyclePanel({ data }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Lock size={14} className="text-indigo-500" /> Export COGS Lifecycle
        </h3>
        <span className="text-[11px] text-gray-400">COGS locks at dispatch</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <CogsCell tone="amber" label="Pre-shipment" value={data.preShipment || 0} sub="Operational margin only" />
        <CogsCell tone="emerald" label="Shipped (with COGS)" value={Math.max(0, (data.shipped || 0) - (data.shippedMissingCogs || 0))} sub="Exact profit available" />
        <CogsCell tone={data.shippedMissingCogs > 0 ? 'rose' : 'gray'} label="Shipped (missing COGS)" value={data.shippedMissingCogs || 0} sub={data.shippedMissingCogs > 0 ? 'Needs investigation' : 'All clear'} />
      </div>
    </div>
  );
}
function CogsCell({ tone, label, value, sub }) {
  const t = {
    amber:   'bg-amber-50 border-amber-100 text-amber-800',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
    rose:    'bg-red-50 border-red-100 text-red-800',
    gray:    'bg-gray-50 border-gray-100 text-gray-700',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${t}`}>
      <p className="text-[11px] uppercase tracking-wide font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-[11px] mt-1 opacity-90">{sub}</p>
    </div>
  );
}

// ─── Quick action button ──────────────────────────────────────────────
function QuickAction({ icon: Icon, label, onClick, tone }) {
  const tones = {
    emerald: 'hover:bg-emerald-500/20 text-emerald-300',
    rose:    'hover:bg-red-500/20 text-red-300',
    indigo:  'hover:bg-indigo-500/20 text-indigo-300',
    violet:  'hover:bg-violet-500/20 text-violet-300',
    amber:   'hover:bg-amber-500/20 text-amber-300',
  };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-medium transition-colors ${tones[tone] || ''}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
function onlyOpen(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => {
      const status = (r.status || '').toLowerCase();
      const out = parseFloat(r.outstanding) || 0;
      return out > 0 && status !== 'paid' && status !== 'void' && status !== 'cancelled';
    });
}
function isOverdue(r) {
  const status = (r.status || '').toLowerCase();
  if (status === 'overdue') return true;
  const due = r.dueDate || r.due_date;
  if (!due) return false;
  const days = ageDays(due);
  return days != null && days > 0 && (parseFloat(r.outstanding) || 0) > 0;
}

// bucketize / ageDays / ageBucket / BUCKET_KEYS / BUCKET_COLORS now
// live in ../utils/aging.js — shared with MoneyIn.

// Consolidated payroll KPIs for the Head-Office Finance dashboard. Reads the
// existing mill payroll data (reports.view) — creates no payroll data, and the
// operational payroll stays in Mill Finance. Hidden if the endpoint is denied.
function PayrollSummaryStrip({ navigate, fmtPKR }) {
  const month = new Date().toISOString().slice(0, 7);
  const { data, isError } = useQuery({
    queryKey: ['payroll-overview', month],
    queryFn: async () => { const res = await reportingApi.payrollOverview({ month }); return res?.period ? res : (res?.data || res); },
    retry: false,
  });
  if (isError || !data) return null;
  const cards = [
    { label: 'Payroll this month', value: fmtPKR(data.paidThisMonth || 0), sub: `${data.runsThisMonth || 0} run(s)` },
    { label: 'Advance recovered', value: fmtPKR(data.advanceRecoveredThisMonth || 0), sub: 'this month', tone: 'amber' },
    { label: 'Advances outstanding', value: fmtPKR(data.advancesOutstanding || 0), sub: 'to recover', tone: 'amber' },
    { label: 'Active mill staff', value: String(data.activeWorkers || 0), sub: 'on payroll' },
    { label: 'Payroll % of expenses', value: `${data.payrollPctOfExpenses || 0}%`, sub: 'this month' },
  ];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Payroll summary · {month}</h3>
        <div className="flex items-center gap-3">
          <Link to="/reports/payroll-analytics" className="text-xs text-blue-600 hover:underline">Analytics →</Link>
          <Link to="/reports/payroll" className="text-xs text-blue-600 hover:underline">Ledger →</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {cards.map((c, i) => (
          <button key={i} onClick={() => navigate('/reports/payroll')} className="text-left rounded-lg border border-gray-100 bg-gray-50/50 p-3 hover:bg-gray-50">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{c.label}</p>
            <p className={`text-base font-bold ${c.tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{c.value}</p>
            <p className="text-[10px] text-gray-400">{c.sub}</p>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Operational payroll (employees, attendance, runs, advances) lives in Mill Finance → Payroll.</p>
    </div>
  );
}

// Pending payroll approvals — Finance/Owner can Approve a Prepared run or Pay an
// Approved one without leaving the Finance dashboard. Hidden for non-approvers /
// when nothing is pending. Calls the role-gated milling approve/pay endpoints.
function PayrollApprovalsCard({ fmtPKR }) {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('payroll', 'approve');
  const canPay = hasPermission('payroll', 'pay');
  const approveMut = useApprovePayrollRun();
  const payMut = usePayPayrollRun();
  const { data, isError, refetch } = useQuery({
    queryKey: ['payroll-pending'],
    enabled: canApprove || canPay,
    queryFn: async () => { const res = await reportingApi.payrollPending(); return res?.runs ? res : (res?.data || res); },
    retry: false,
  });
  if ((!canApprove && !canPay) || isError) return null;
  const runs = data?.runs || [];
  if (!runs.length) return null;
  const busy = approveMut.isPending || payMut.isPending;
  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><Clock size={16} className="text-amber-600" /> Payroll awaiting approval</h3>
        <span className="text-xs text-amber-700 font-medium">{fmtPKR(data?.netPending || 0)} pending</span>
      </div>
      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
            <div className="text-sm text-gray-700">
              <span className={`mr-2 px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${r.status === 'approved' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
              <span className="font-medium">{r.period}</span> · {r.employeeCount} emp · <span className="tabular-nums font-semibold">{fmtPKR(r.net)}</span>
              <span className="text-[11px] text-gray-400"> · prepared by {r.preparedBy || '—'}</span>
            </div>
            <div className="flex gap-2">
              {r.status === 'prepared' && canApprove && <button disabled={busy} onClick={() => approveMut.mutate(r.id)} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Approve</button>}
              {r.status === 'approved' && canPay && <button disabled={busy} onClick={() => payMut.mutate(r.id, { onSuccess: () => refetch() })} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Pay {fmtPKR(r.net)}</button>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Approving has no financial effect; paying posts the salary expense to Money Out / GL and recovers scheduled advances. Prepare runs in Mill Finance → Payroll.</p>
    </div>
  );
}
