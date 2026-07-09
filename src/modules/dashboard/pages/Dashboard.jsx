import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import { chatApi } from '../../chat/api';
import {
  Ship, Factory, DollarSign, AlertTriangle, Clock,
  CheckCircle2, ArrowRight, TrendingUp, CreditCard,
  FileText, Truck, Package, RefreshCw, Activity,
  Plus, ArrowDownLeft, ArrowUpRight, ArrowRightLeft,
  Wallet, Zap, BarChart3, Inbox,
} from 'lucide-react';
import { SkeletonDashboard as DashboardSkeleton } from '../../../components/Skeleton';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useMasterDataApprovalsCount } from '../../../modules/admin/api/queries';
import { millingApi } from '../../../modules/milling/api/services';

import YieldDistributionChart from './dashboard/YieldDistributionChart';
import RecentActivity from './dashboard/RecentActivity';
import PendingApprovalsCard from '../components/PendingApprovalsCard';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';

// ─── Formatting ────────────────────────────────────────────────────────
const fmt = (v) => '$' + (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtMt = (v) => `${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MT`;
const fmtPctSafe = (v) => v == null || isNaN(v) ? '—' : `${Number(v).toFixed(1)}%`;

// ─── Pipeline phase grouping ───────────────────────────────────────────
const PHASES = [
  { label: 'New',        statuses: ['Draft', 'Awaiting Advance'],                               color: 'bg-amber-500',  ring: 'ring-amber-200' },
  { label: 'Funded',     statuses: ['Advance Received', 'Procurement Pending'],                  color: 'bg-emerald-500',ring: 'ring-emerald-200' },
  { label: 'Production', statuses: ['In Milling', 'Docs In Preparation'],                        color: 'bg-blue-500',   ring: 'ring-blue-200' },
  { label: 'Shipping',   statuses: ['Awaiting Balance', 'Ready to Ship', 'Shipped'],             color: 'bg-violet-500', ring: 'ring-violet-200' },
  { label: 'Delivered',  statuses: ['Arrived', 'Closed'],                                        color: 'bg-slate-500',  ring: 'ring-slate-200' },
];

// ─── Page ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { requestOwnerApproval } = useOwnerAuth();
  const { exportOrders, millingBatches, dataLoading, refreshFromApi, addToast } = useApp();
  const { user, hasPermission } = useAuth();
  const isOwnerOrAdmin = user?.role === 'Owner' || user?.role === 'Super Admin';
  // This "Operations Overview" is an export/mill operations dashboard (order
  // pipeline, shipments, export customers…). A payments-only role (Finance) can't
  // open any of it and shouldn't see the customer/order detail — send them to
  // their own Finance Dashboard. Computed here (before any early return) so it can
  // gate the render without changing hook order.
  const financeOnly = hasPermission('finance', 'view')
    && !hasPermission('export_orders', 'view')
    && !hasPermission('milling', 'view')
    && !hasPermission('inventory', 'view');
  // Gate cross-domain shortcuts: a role without export/mill view (e.g. QC Analyst,
  // Documentation Officer) would hit Access Denied on tiles that jump to /export
  // or /milling. Only show those to roles that can actually open them.
  const canExport = hasPermission('export_orders', 'view');
  const canMill = hasPermission('milling', 'view');
  // Pending master-data quick-add approvals (Admin → Approvals). Hook must run
  // before the early return below to keep hook order stable.
  const { data: pendingMasterApprovals = 0 } = useMasterDataApprovalsCount();
  // Chat approvals feed (fund transfers, export confirmations, stock adjustments,
  // …) — shared cache with ChatWidget; folded into the action count so the
  // header / "all caught up" state agrees with the PendingApprovalsCard below.
  const { data: chatApprovalsData } = useQuery({
    queryKey: ['chat-approvals'],
    queryFn: async () => { const r = await chatApi.approvals(); return r?.data || r || {}; },
    refetchInterval: 15000,
  });
  const dashApprovals = (chatApprovalsData?.items || []).filter(a => !['batch', 'masterdata'].includes(a.kind)).length;

  // NOTE: the loading / redirect guards live AFTER all hooks (just before the
  // main return) — an early return here would skip the useMemo hooks below and
  // trip React error #310 ("more hooks than the previous render") once data loads.

  const safeBatches = Array.isArray(millingBatches) ? millingBatches : [];
  const safeOrders = Array.isArray(exportOrders) ? exportOrders : [];

  // ─── Action queue ───
  const pendingApprovalBatches = safeBatches.filter(b => b.status === 'Pending Approval');
  const awaitingAdvance = safeOrders.filter(o => o.status === 'Awaiting Advance').length;
  const docsInPrep = safeOrders.filter(o => o.status === 'Docs In Preparation').length;
  const readyToShip = safeOrders.filter(o => o.status === 'Ready to Ship').length;
  const awaitingBalance = safeOrders.filter(o => o.status === 'Awaiting Balance').length;
  const varianceAlerts = safeBatches.filter(b => b.variancePct != null && Math.abs(Number(b.variancePct)) > 1).length;
  const masterApprovals = isOwnerOrAdmin ? pendingMasterApprovals : 0;
  const totalActions = pendingApprovalBatches.length + awaitingAdvance + docsInPrep + readyToShip + varianceAlerts + masterApprovals + dashApprovals;

  // ─── KPIs ───
  const activeOrders = safeOrders.filter(o => !['Draft', 'Closed', 'Cancelled'].includes(o.status)).length;
  const activeBatches = safeBatches.filter(b => ['In Progress', 'Queued', 'Pending Approval'].includes(b.status)).length;
  const shipmentsInTransit = safeOrders.filter(o => o.status === 'Shipped').length;
  const totalReceivable = safeOrders.reduce((s, o) => {
    const out = (Number(o.contractValue) || 0) - (Number(o.advanceReceived) || 0) - (Number(o.balanceReceived) || 0);
    return out > 0 ? s + out : s;
  }, 0);
  const exportProfit = safeOrders.reduce((s, o) => {
    const costs = Object.values(o.costs || {}).reduce((cs, c) => cs + (parseFloat(c) || 0), 0);
    return costs > 0 ? s + ((Number(o.contractValue) || 0) - costs) : s;
  }, 0);
  const totalContractValue = safeOrders.reduce((s, o) => s + (Number(o.contractValue) || 0), 0);

  // ─── Pipeline ───
  const phaseCounts = PHASES.map(phase => ({
    ...phase,
    count: safeOrders.filter(o => phase.statuses.includes(o.status)).length,
    value: safeOrders.filter(o => phase.statuses.includes(o.status)).reduce((s, o) => s + (Number(o.contractValue) || 0), 0),
  }));
  const totalPipelineOrders = phaseCounts.reduce((s, p) => s + p.count, 0);

  // ─── Production summary (this week / month) ───
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() || 7) - 1));
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sumProduction = (since) => safeBatches.reduce(
    (a, b) => {
      const d = b.createdAt ? new Date(b.createdAt) : null;
      if (!d || d < since) return a;
      a.batches += 1;
      a.rawMt += Number(b.rawQtyMT) || 0;
      a.finishedMt += Number(b.actualFinishedMT) || 0;
      return a;
    },
    { batches: 0, rawMt: 0, finishedMt: 0 }
  );
  const productionWeek = sumProduction(startOfWeek);
  const productionMonth = sumProduction(startOfMonth);
  const yieldWeek = productionWeek.rawMt > 0 ? (productionWeek.finishedMt / productionWeek.rawMt) * 100 : null;

  // ─── Money flow snapshot — derived from order receipts ───
  const moneyFlow = safeOrders.reduce(
    (a, o) => {
      const recv = (Number(o.advanceReceived) || 0) + (Number(o.balanceReceived) || 0);
      a.received += recv;
      a.outstanding += Math.max(0, (Number(o.contractValue) || 0) - recv);
      return a;
    },
    { received: 0, outstanding: 0 }
  );
  const collectionRate = (moneyFlow.received + moneyFlow.outstanding) > 0
    ? Math.round((moneyFlow.received / (moneyFlow.received + moneyFlow.outstanding)) * 100)
    : 0;

  // ─── Yield distribution ───
  const yieldDistribution = useMemo(() => {
    const completed = safeBatches.filter(b => b.status === 'Completed' && Number(b.rawQtyMT) > 0);
    if (completed.length === 0) return [
      { name: 'Finished', value: 65, fill: '#3b82f6' },
      { name: 'Broken', value: 33, fill: '#f59e0b' },
      { name: 'Wastage', value: 2, fill: '#ef4444' },
    ];
    const t = completed.reduce((a, b) => ({
      f: a.f + (Number(b.actualFinishedMT) || 0), br: a.br + (Number(b.brokenMT) || 0),
      w: a.w + (Number(b.wastageMT) || 0), r: a.r + (Number(b.rawQtyMT) || 0),
    }), { f: 0, br: 0, w: 0, r: 0 });
    const pct = v => Math.round((v / t.r) * 100) || 0;
    return [
      { name: 'Finished', value: pct(t.f), fill: '#3b82f6' },
      { name: 'Broken', value: pct(t.br), fill: '#f59e0b' },
      { name: 'Wastage', value: pct(t.w), fill: '#ef4444' },
    ];
  }, [safeBatches]);

  // ─── Recent activity ───
  const recentActivities = useMemo(() => {
    const items = safeOrders.slice(0, 5).map((o, i) => ({
      id: i + 1, type: 'finance',
      action: `${o.status} — ${o.id} (${o.customerName})`,
      by: 'System', time: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '',
    }));
    return items.length > 0 ? items : [{ id: 1, type: 'finance', action: 'No recent activity', by: '', time: '' }];
  }, [safeOrders]);

  // ─── Recent shipments (top 5 most recently shipped/arrived) ───
  const recentShipments = useMemo(() => {
    return safeOrders
      .filter(o => o.status === 'Shipped' || o.status === 'Arrived' || o.status === 'Closed')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 4);
  }, [safeOrders]);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // All hooks are above this point — these guards are safe to early-return on.
  // Payments-only Finance has no business on the export/mill Operations Overview
  // (and can't open its links) — send them to their own Finance Dashboard.
  if (financeOnly) return <Navigate to="/finance" replace />;
  if (dataLoading && (exportOrders || []).length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 80% 30%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Activity size={14} /> {today}
            </div>
            <h1 className="text-3xl font-bold leading-tight">
              {user?.fullName ? `Welcome back, ${user.fullName.split(' ')[0]}` : 'Operations Overview'}
            </h1>
            <p className="text-sm opacity-80 mt-1">
              {totalActions > 0
                ? `${totalActions} item${totalActions === 1 ? '' : 's'} need attention today.`
                : 'Everything is on track.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeroStat label="Active Orders" value={activeOrders} accent="blue" />
            <HeroStat label="Active Batches" value={activeBatches} accent="amber" />
            <HeroStat label="In Transit" value={shipmentsInTransit} accent="emerald" />
            <button
              onClick={() => refreshFromApi('orders')}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} className={dataLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ─── ACTION QUEUE ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" /> Needs Your Attention
          </h2>
          {totalActions > 0 && (
            <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-semibold">{totalActions} open</span>
          )}
        </div>

        {/* Pending approvals — same feed as the chat widget (fund transfers,
            export confirmations, stock adjustments, …). Batches + master-data are
            excluded here because they already have their own widgets below. */}
        <PendingApprovalsCard excludeKinds={['batch', 'masterdata']} />

        {/* Pending Batch Approvals — Owner/Admin only */}
        {isOwnerOrAdmin && pendingApprovalBatches.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Milling batches awaiting approval ({pendingApprovalBatches.length})
            </p>
            <div className="space-y-2">
              {pendingApprovalBatches.slice(0, 3).map(b => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{b.id}</p>
                    <p className="text-xs text-gray-600">
                      <PartyLink type="supplier" id={b.supplierId} name={b.supplierName} fallback="No supplier" /> · {Number(b.rawQtyMT || 0).toFixed(1)} MT
                      {b.linkedExportOrder && <span> · Order: {b.linkedExportOrder}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={async () => {
                        try {
                          await millingApi.approveBatch(b.dbId || b.id);
                          addToast(`Batch ${b.id} approved`, 'success');
                          refreshFromApi('batches');
                        } catch (err) { addToast(err?.response?.data?.message || 'Failed', 'error'); }
                      }}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Rejection reason:');
                        if (!reason?.trim()) return;
                        millingApi.rejectBatch(b.dbId || b.id, { reason: reason.trim() })
                          .then(() => { addToast(`Batch ${b.id} rejected`, 'success'); refreshFromApi('batches'); })
                          .catch(err => addToast(err?.response?.data?.message || 'Failed', 'error'));
                      }}
                      className="px-3 py-1.5 bg-rose-100 text-rose-700 text-xs font-medium rounded-lg hover:bg-rose-200"
                    >
                      Reject
                    </button>
                    <Link to={`/milling/${b.id}`} className="px-2 py-1.5 text-xs text-blue-600 hover:underline">Details</Link>
                  </div>
                </div>
              ))}
              {pendingApprovalBatches.length > 3 && (
                <Link to="/milling" className="block text-xs text-blue-600 hover:underline text-center py-1">
                  +{pendingApprovalBatches.length - 3} more pending →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Other action items */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {isOwnerOrAdmin && <ActionItem icon={Inbox} label="Master-data approvals" count={masterApprovals} to="/admin" accent="amber" />}
          {canExport && <ActionItem icon={CreditCard} label="Awaiting advance payment"  count={awaitingAdvance} to="/export?status=Awaiting+Advance"    accent="amber" />}
          {canExport && <ActionItem icon={FileText}   label="Documents in preparation"  count={docsInPrep}      to="/export?status=Docs+In+Preparation" accent="blue" />}
          {canExport && <ActionItem icon={Ship}       label="Ready to ship"             count={readyToShip}     to="/export?status=Ready+to+Ship"       accent="green" />}
          {canExport && <ActionItem icon={Clock}      label="Awaiting balance payment"  count={awaitingBalance} to="/export?status=Awaiting+Balance"    accent="amber" />}
          {canMill   && <ActionItem icon={AlertTriangle} label="Mill yield variance"    count={varianceAlerts}  to="/quality"                            accent="red" />}
        </div>

        {totalActions === 0 && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900">
            <CheckCircle2 size={16} />
            <span className="text-sm font-medium">All caught up — nothing needs attention.</span>
          </div>
        )}
      </div>

      {/* ─── PRIMARY KPI ROW ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          icon={Ship}
          tone="blue"
          label="Order Book"
          primary={fmt(totalContractValue)}
          secondary={`${activeOrders} active orders`}
          hint={`${shipmentsInTransit} in transit`}
          onClick={canExport ? () => navigate('/export') : undefined}
        />
        <KpiTile
          icon={Wallet}
          tone="emerald"
          label="Money Received"
          primary={fmt(moneyFlow.received)}
          secondary={`${collectionRate}% of expected`}
          hint={collectionRate >= 80 ? 'On target' : 'Below 80%'}
          hintBad={collectionRate < 80}
          onClick={() => navigate('/finance/money-in')}
        />
        <KpiTile
          icon={Clock}
          tone="amber"
          label="Outstanding"
          primary={fmt(moneyFlow.outstanding)}
          secondary="Open balance to collect"
          hint={awaitingBalance > 0 ? `${awaitingBalance} awaiting balance` : 'No urgent collections'}
          hintBad={awaitingBalance > 0}
          onClick={() => navigate('/finance/money-in')}
        />
        <KpiTile
          icon={TrendingUp}
          tone="violet"
          label="Booked Profit"
          primary={fmt(exportProfit)}
          secondary="Across all open orders"
          hint={exportProfit > 0 ? 'Positive' : 'Below break-even'}
          hintBad={exportProfit <= 0}
          onClick={() => navigate('/finance/profit')}
        />
      </div>

      {/* ─── ORDER PIPELINE ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Activity size={14} className="text-blue-500" /> Order Pipeline
            <span className="text-xs text-gray-400 font-normal">({totalPipelineOrders} orders · {fmt(phaseCounts.reduce((s, p) => s + p.value, 0))})</span>
          </h2>
          {canExport && <Link to="/export" className="text-xs text-blue-600 hover:underline">All orders →</Link>}
        </div>

        {totalPipelineOrders > 0 ? (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden mb-4 bg-gray-100">
              {phaseCounts.map(phase => phase.count > 0 && (
                <div
                  key={phase.label}
                  className={`${phase.color} transition-all`}
                  style={{ width: `${(phase.count / totalPipelineOrders) * 100}%` }}
                  title={`${phase.label}: ${phase.count} orders`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {phaseCounts.map(phase => (
                <button
                  key={phase.label}
                  onClick={() => navigate('/export?status=' + encodeURIComponent(phase.statuses[0]))}
                  className="p-3 text-left border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/40 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-2 h-2 rounded-full ${phase.color}`} />
                    <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">{phase.label}</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 leading-none">{phase.count}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{fmt(phase.value)}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-gray-400 py-6 text-sm">No orders in the pipeline.</p>
        )}
      </div>

      {/* ─── PRODUCTION + RECENT SHIPMENTS ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Production summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Factory size={14} className="text-orange-500" /> Production Summary
            </h2>
            <Link to="/reports/print" className="text-xs text-blue-600 hover:underline">Print report →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <ProductionCell label="This Week" batches={productionWeek.batches} rawMt={productionWeek.rawMt} finishedMt={productionWeek.finishedMt} />
            <ProductionCell label="This Month" batches={productionMonth.batches} rawMt={productionMonth.rawMt} finishedMt={productionMonth.finishedMt} />
          </div>
          <div className="flex items-center justify-between text-xs pt-3 border-t border-gray-100">
            <span className="text-gray-500">Avg yield (this week)</span>
            <span className={`font-bold ${yieldWeek != null && yieldWeek >= 65 ? 'text-emerald-600' : yieldWeek != null && yieldWeek >= 60 ? 'text-amber-600' : 'text-gray-700'}`}>
              {fmtPctSafe(yieldWeek)}
            </span>
          </div>
        </div>

        {/* Recent shipments */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Truck size={14} className="text-cyan-500" /> Recent Shipments
            </h2>
            {canExport && <Link to="/export" className="text-xs text-blue-600 hover:underline">All shipments →</Link>}
          </div>
          {recentShipments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No shipments yet</p>
          ) : (
            <ul className="space-y-2">
              {recentShipments.map(o => {
                const statusTone = o.status === 'Shipped' ? 'bg-cyan-100 text-cyan-700'
                  : o.status === 'Arrived' ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-700';
                return (
                  <li key={o.id}>
                    <Link to={`/export/${o.id}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                        <Ship size={14} className="text-cyan-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{o.id} · <PartyLink type="customer" id={o.customerId} name={o.customerName} /></p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {o.qtyMT} MT to {o.country}{o.vesselName ? ` · ${o.vesselName}` : ''}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusTone} flex-shrink-0`}>{o.status}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ─── YIELD CHART + RECENT ACTIVITY ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <YieldDistributionChart data={yieldDistribution} />
        </div>
        <div className="lg:col-span-2">
          <RecentActivity activities={recentActivities} />
        </div>
      </div>

      {/* ─── QUICK ACTIONS ────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-4 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-gray-400 mr-2">Quick actions</span>
          {canExport && <QuickAction icon={Plus} label="New Export Order" onClick={() => navigate("/export?new=1")} tone="blue" />}
          {canMill && <QuickAction icon={Factory} label="New Milling Batch" onClick={() => navigate("/milling?new=1")} tone="amber" />}
          <QuickAction icon={ArrowDownLeft}   label="Record Receipt"    onClick={() => navigate('/finance/money-in')} tone="emerald" />
          <QuickAction icon={ArrowUpRight}    label="Make Payment"      onClick={() => navigate('/finance/money-out')} tone="rose" />
          <QuickAction icon={BarChart3}       label="Print Reports"     onClick={() => navigate('/reports/print')}    tone="violet" />
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function HeroStat({ label, value, accent }) {
  const tones = {
    blue: 'border-blue-400/40 bg-blue-500/10',
    amber: 'border-amber-400/40 bg-amber-500/10',
    emerald: 'border-emerald-400/40 bg-emerald-500/10',
  };
  return (
    <div className={`px-4 py-2.5 rounded-xl border backdrop-blur-sm ${tones[accent]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-bold leading-none mt-0.5">{value}</div>
    </div>
  );
}

function ActionItem({ icon: Icon, label, count, to, accent = 'amber' }) {
  if (count === 0) return null;
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
    red: 'bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100',
  };
  return (
    <Link to={to} className={`flex items-center justify-between p-3 rounded-lg border ${colors[accent]} transition-colors`}>
      <div className="flex items-center gap-3">
        <Icon size={16} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 bg-white rounded-full text-xs font-bold">{count}</span>
        <ArrowRight size={14} />
      </div>
    </Link>
  );
}

function KpiTile({ icon: Icon, tone = 'gray', label, primary, secondary, hint, hintBad, onClick }) {
  const tones = {
    blue:    { ring: 'ring-blue-100',    icon: 'text-blue-500 bg-blue-50' },
    emerald: { ring: 'ring-emerald-100', icon: 'text-emerald-500 bg-emerald-50' },
    amber:   { ring: 'ring-amber-100',   icon: 'text-amber-500 bg-amber-50' },
    violet:  { ring: 'ring-violet-100',  icon: 'text-violet-500 bg-violet-50' },
    rose:    { ring: 'ring-rose-100',    icon: 'text-rose-500 bg-rose-50' },
    gray:    { ring: 'ring-gray-100',    icon: 'text-gray-500 bg-gray-50' },
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

function ProductionCell({ label, batches, rawMt, finishedMt }) {
  const yieldPct = rawMt > 0 ? (finishedMt / rawMt) * 100 : null;
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold text-gray-900">{batches}</span>
        <span className="text-[11px] text-gray-500">batches</span>
      </div>
      <div className="text-[11px] text-gray-600 mt-1">
        Raw {fmtMt(rawMt)} → Output {fmtMt(finishedMt)}
      </div>
      {yieldPct != null && (
        <div className="text-[11px] text-gray-500 mt-0.5">
          Yield <span className="font-semibold text-gray-700">{yieldPct.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, tone }) {
  const tones = {
    blue:    'hover:bg-blue-500/20 text-blue-300',
    emerald: 'hover:bg-emerald-500/20 text-emerald-300',
    rose:    'hover:bg-rose-500/20 text-rose-300',
    amber:   'hover:bg-amber-500/20 text-amber-300',
    violet:  'hover:bg-violet-500/20 text-violet-300',
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
