import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ship, Factory, DollarSign, AlertTriangle, Clock,
  CheckCircle2, ArrowRight, TrendingUp, CreditCard,
  FileText, Truck, Package, RefreshCw,
} from 'lucide-react';
import { SkeletonDashboard as DashboardSkeleton } from '../../../components/Skeleton';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { millingApi } from '../../../modules/milling/api/services';

import YieldDistributionChart from './dashboard/YieldDistributionChart';
import RecentActivity from './dashboard/RecentActivity';

const fmt = (v) => '$' + (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPKR = (v) => 'Rs ' + Math.round(Number(v) || 0).toLocaleString('en-PK');

function KPI({ icon: Icon, label, value, sub, accent = 'blue', to }) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-purple-600 bg-purple-50',
  };
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1 truncate">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colors[accent]}`}><Icon size={18} /></div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function ActionItem({ icon: Icon, label, count, to, accent = 'amber', onAction, actionLabel }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
    red: 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100',
    green: 'bg-green-50 border-green-200 text-green-900 hover:bg-green-100',
  };
  if (count === 0) return null;
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${colors[accent]} transition-colors`}>
      <div className="flex items-center gap-3">
        <Icon size={18} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 bg-white rounded-full text-xs font-bold">{count}</span>
        <Link to={to} className="text-xs font-medium hover:underline flex items-center gap-1">
          View <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

// Compact pipeline — group 11 statuses into 5 phases
const PHASES = [
  { label: 'New', statuses: ['Draft', 'Awaiting Advance'], color: 'bg-amber-500' },
  { label: 'Funded', statuses: ['Advance Received', 'Procurement Pending'], color: 'bg-green-500' },
  { label: 'Production', statuses: ['In Milling', 'Docs In Preparation'], color: 'bg-blue-500' },
  { label: 'Shipping', statuses: ['Awaiting Balance', 'Ready to Ship', 'Shipped'], color: 'bg-purple-500' },
  { label: 'Delivered', statuses: ['Arrived', 'Closed'], color: 'bg-slate-500' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { exportOrders, millingBatches, alerts, dismissAlert, dataLoading, refreshFromApi, addToast } = useApp();
  const { user } = useAuth();
  const isOwnerOrAdmin = user?.role === 'Owner' || user?.role === 'Super Admin';

  if (dataLoading && exportOrders.length === 0) {
    return <DashboardSkeleton />;
  }

  const safeBatches = Array.isArray(millingBatches) ? millingBatches : [];
  const safeOrders = Array.isArray(exportOrders) ? exportOrders : [];

  // ─── Action queue ───
  const pendingApprovalBatches = safeBatches.filter(b => b.status === 'Pending Approval');
  const awaitingAdvance = safeOrders.filter(o => o.status === 'Awaiting Advance').length;
  const docsInPrep = safeOrders.filter(o => o.status === 'Docs In Preparation').length;
  const readyToShip = safeOrders.filter(o => o.status === 'Ready to Ship').length;
  const awaitingBalance = safeOrders.filter(o => o.status === 'Awaiting Balance').length;
  const varianceAlerts = safeBatches.filter(b => b.variancePct != null && Math.abs(Number(b.variancePct)) > 1).length;

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

  // ─── Pipeline phases ───
  const phaseCounts = PHASES.map(phase => ({
    ...phase,
    count: safeOrders.filter(o => phase.statuses.includes(o.status)).length,
    value: safeOrders.filter(o => phase.statuses.includes(o.status)).reduce((s, o) => s + (Number(o.contractValue) || 0), 0),
  }));
  const totalPipelineOrders = phaseCounts.reduce((s, p) => s + p.count, 0);

  // ─── Yield distribution ───
  const yieldDistribution = useMemo(() => {
    const completed = safeBatches.filter(b => b.status === 'Completed' && Number(b.rawQtyMT) > 0);
    if (completed.length === 0) return [
      { name: 'Finished', value: 65, fill: '#3b82f6' },
      { name: 'Broken', value: 15, fill: '#f59e0b' },
      { name: 'Bran', value: 10, fill: '#10b981' },
      { name: 'Husk', value: 8, fill: '#8b5cf6' },
      { name: 'Wastage', value: 2, fill: '#ef4444' },
    ];
    const t = completed.reduce((a, b) => ({
      f: a.f + (Number(b.actualFinishedMT) || 0), br: a.br + (Number(b.brokenMT) || 0),
      bn: a.bn + (Number(b.branMT) || 0), h: a.h + (Number(b.huskMT) || 0),
      w: a.w + (Number(b.wastageMT) || 0), r: a.r + (Number(b.rawQtyMT) || 0),
    }), { f: 0, br: 0, bn: 0, h: 0, w: 0, r: 0 });
    const pct = v => Math.round((v / t.r) * 100) || 0;
    return [
      { name: 'Finished', value: pct(t.f), fill: '#3b82f6' },
      { name: 'Broken', value: pct(t.br), fill: '#f59e0b' },
      { name: 'Bran', value: pct(t.bn), fill: '#10b981' },
      { name: 'Husk', value: pct(t.h), fill: '#8b5cf6' },
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

  const totalActions = pendingApprovalBatches.length + awaitingAdvance + docsInPrep + readyToShip + varianceAlerts;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Operations overview</p>
        </div>
        <button
          onClick={() => refreshFromApi('orders')}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw size={16} className={dataLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Action Queue — what needs attention NOW */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-gray-900">Needs Your Attention</h2>
        </div>

        {/* Pending Batch Approvals — Owner/Admin only, inline cards */}
        {isOwnerOrAdmin && pendingApprovalBatches.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Milling Batches Awaiting Approval ({pendingApprovalBatches.length})
            </p>
            <div className="space-y-2">
              {pendingApprovalBatches.slice(0, 5).map(b => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{b.id}</p>
                    <p className="text-xs text-gray-600">
                      {b.supplierName || 'No supplier'} · {Number(b.rawQtyMT || 0).toFixed(1)} MT
                      {b.linkedExportOrder && <span> · Order: {b.linkedExportOrder}</span>}
                      {b.createdByName && <span className="text-gray-400"> · by {b.createdByName}</span>}
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
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700"
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
                      className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-medium rounded-lg hover:bg-red-200"
                    >
                      Reject
                    </button>
                    <Link
                      to={`/milling/${b.id}`}
                      className="px-2 py-1.5 text-xs text-blue-600 hover:underline"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              ))}
              {pendingApprovalBatches.length > 5 && (
                <Link to="/milling" className="block text-xs text-blue-600 hover:underline text-center py-1">
                  +{pendingApprovalBatches.length - 5} more pending...
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Other action items */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <ActionItem icon={CreditCard} label="Awaiting advance payment" count={awaitingAdvance} to="/export?status=Awaiting+Advance" accent="amber" />
          <ActionItem icon={FileText} label="Documents in preparation" count={docsInPrep} to="/export?status=Docs+In+Preparation" accent="blue" />
          <ActionItem icon={Ship} label="Ready to ship" count={readyToShip} to="/export?status=Ready+to+Ship" accent="green" />
          <ActionItem icon={Clock} label="Awaiting balance payment" count={awaitingBalance} to="/export?status=Awaiting+Balance" accent="amber" />
          <ActionItem icon={AlertTriangle} label="Mill yield variance alerts" count={varianceAlerts} to="/quality" accent="red" />
        </div>

        {totalActions === 0 && !isOwnerOrAdmin && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-900">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">All caught up — nothing needs attention.</span>
          </div>
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPI icon={Ship} label="Active Orders" value={activeOrders} to="/export" accent="blue" />
        <KPI icon={Factory} label="Active Batches" value={activeBatches} to="/milling" accent="purple" />
        <KPI icon={Truck} label="In Transit" value={shipmentsInTransit} accent="green" />
        <KPI icon={DollarSign} label="Receivables" value={fmt(totalReceivable)} accent="amber" />
        <KPI icon={TrendingUp} label="Export Profit" value={fmt(exportProfit)} accent="green" />
      </div>

      {/* Compact Pipeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Order Pipeline</h2>
          <Link to="/export" className="text-xs text-blue-600 hover:underline">All orders →</Link>
        </div>

        {/* Phase bar */}
        {totalPipelineOrders > 0 && (
          <div className="flex h-3 rounded-full overflow-hidden mb-4">
            {phaseCounts.map(phase => (
              phase.count > 0 && (
                <div
                  key={phase.label}
                  className={`${phase.color} transition-all`}
                  style={{ width: `${(phase.count / totalPipelineOrders) * 100}%` }}
                  title={`${phase.label}: ${phase.count}`}
                />
              )
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {phaseCounts.map(phase => (
            <button
              key={phase.label}
              onClick={() => navigate('/export?status=' + encodeURIComponent(phase.statuses[0]))}
              className="p-3 text-left border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${phase.color}`} />
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{phase.label}</p>
              </div>
              <p className="text-xl font-bold text-gray-900">{phase.count}</p>
              <p className="text-[11px] text-gray-500">{fmt(phase.value)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <YieldDistributionChart data={yieldDistribution} />
        </div>
        <div className="lg:col-span-2">
          <RecentActivity activities={recentActivities} />
        </div>
      </div>
    </div>
  );
}
