import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Landmark, ArrowDownLeft, ArrowUpRight,
  TrendingUp, TrendingDown, AlertTriangle,
  Bell, Clock, Lock, Wallet, Activity,
  Plus, Receipt, ArrowRightLeft, RefreshCw, ExternalLink,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import {
  useReceivables, usePayables, useFinanceAlerts, useJournalEntries,
  useFinanceOverviewSummary,
} from '../../../api/queries';

// ─── Formatting helpers ───────────────────────────────────────────────
function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
function ageDays(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
function ageBucket(days) {
  if (days == null || days < 0) return null; // future-dated → not yet due
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}
const BUCKET_KEYS = ['0-30', '31-60', '61-90', '90+'];
const BUCKET_COLORS = {
  '0-30':  { bar: 'bg-emerald-500', tag: 'bg-emerald-50 text-emerald-700' },
  '31-60': { bar: 'bg-amber-500',   tag: 'bg-amber-50 text-amber-700' },
  '61-90': { bar: 'bg-orange-500',  tag: 'bg-orange-50 text-orange-700' },
  '90+':   { bar: 'bg-red-500',     tag: 'bg-red-50 text-red-700' },
};

// ─── Page ─────────────────────────────────────────────────────────────
export default function FinanceOverview() {
  const navigate = useNavigate();
  const { data: summary = {}, isLoading, refetch } = useFinanceOverviewSummary();
  const { data: receivables = [] } = useReceivables();
  const { data: payables = [] } = usePayables();
  const { data: alertsData = [] } = useFinanceAlerts();
  const { data: journalData = [] } = useJournalEntries();

  const exp = summary.export || {};
  const mill = summary.mill || {};
  const recv = summary.receivables || {};
  const pay = summary.payables || {};
  const cash = summary.cashPosition || {};
  const consolidated = summary.consolidated || {};

  // ─── Aging analysis (FE-computed since backend hardcodes aging=0) ──
  const recvAging = useMemo(() => bucketize(receivables), [receivables]);
  const payAging  = useMemo(() => bucketize(payables, 'pkr'), [payables]);

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
    : 'from-red-600 via-red-500 to-rose-500';

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

      {/* ─── PRIMARY KPI ROW ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
    rose:    { ring: 'ring-rose-100',    icon: 'text-rose-500 bg-rose-50',       accent: 'text-rose-600' },
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
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        {Icon && <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}><Icon size={14} /></span>}
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none">{primary}</div>
      {secondary && <div className="text-[11px] text-gray-500 mt-1">{secondary}</div>}
      {hint && (
        <div className={`text-[11px] mt-2 ${hintBad ? 'text-rose-600' : 'text-emerald-600'} font-medium`}>
          {hintBad ? '● ' : '✓ '}{hint}
        </div>
      )}
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
          <Icon size={14} className={tone === 'emerald' ? 'text-emerald-500' : 'text-rose-500'} />
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
        <Icon size={14} className="text-rose-500" /> {title}
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
    rose:    'bg-rose-50 border-rose-100 text-rose-800',
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
    rose:    'hover:bg-rose-500/20 text-rose-300',
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

// Group an array of receivables/payables into aging buckets. Returns
// { '0-30': {count, totalPkr, totalForeign}, '31-60': {...}, ..., totalPkr, totalForeign }.
function bucketize(rows, mode = 'mixed') {
  const init = () => ({ count: 0, totalPkr: 0, totalForeign: 0 });
  const result = {
    '0-30': init(), '31-60': init(), '61-90': init(), '90+': init(),
    totalPkr: 0, totalForeign: 0,
  };
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const out = parseFloat(r.outstanding) || 0;
    if (out <= 0) continue;
    const status = (r.status || '').toLowerCase();
    if (status === 'paid' || status === 'void' || status === 'cancelled') continue;
    const days = ageDays(r.dueDate || r.due_date);
    const bucket = ageBucket(days);
    if (!bucket) continue;
    const isPkr = (r.currency || '').toUpperCase() === 'PKR' || mode === 'pkr';
    const fxRate = parseFloat(r.fx_rate) || parseFloat(r.fxRate) || 280;
    const pkr = isPkr ? out : out * fxRate;
    const foreign = isPkr ? 0 : out;
    result[bucket].count += 1;
    result[bucket].totalPkr += pkr;
    result[bucket].totalForeign += foreign;
    result.totalPkr += pkr;
    result.totalForeign += foreign;
  }
  return result;
}
