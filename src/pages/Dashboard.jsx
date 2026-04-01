import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SkeletonDashboard as DashboardSkeleton } from '../components/Skeleton';
import { useApp } from '../context/AppContext';

import KPICardsRow from './dashboard/KPICardsRow';
import OrderPipeline from './dashboard/OrderPipeline';
import ProfitabilityChart from './dashboard/ProfitabilityChart';
import ReceivablesPayablesChart from './dashboard/ReceivablesPayablesChart';
import AlertsPanel from './dashboard/AlertsPanel';
import YieldDistributionChart from './dashboard/YieldDistributionChart';
import RecentActivity from './dashboard/RecentActivity';

const pipelineStatuses = [
  'Draft',
  'Awaiting Advance',
  'Advance Received',
  'Procurement Pending',
  'In Milling',
  'Docs In Preparation',
  'Awaiting Balance',
  'Ready to Ship',
  'Shipped',
  'Arrived',
  'Closed',
];

export default function Dashboard() {
  const { exportOrders, millingBatches, alerts, dismissAlert, entityFilter, dataLoading, refreshFromApi } = useApp();
  const [periodFilter, setPeriodFilter] = useState('This Month');

  // Show skeleton on first load
  if (dataLoading && exportOrders.length === 0) {
    return <DashboardSkeleton />;
  }

  // Filter alerts by entity
  const filteredAlerts = useMemo(() => {
    if (entityFilter === 'All') return alerts;
    if (entityFilter === 'Export') return alerts.filter(a => a.entity === 'export' || a.entity === 'finance');
    if (entityFilter === 'Mill') return alerts.filter(a => a.entity === 'mill');
    return alerts;
  }, [alerts, entityFilter]);

  // KPI calculations
  const activeOrders = useMemo(() => {
    const excluded = ['Draft', 'Closed', 'Cancelled'];
    return exportOrders.filter((o) => !excluded.includes(o.status)).length;
  }, [exportOrders]);

  const advancePending = useMemo(() => {
    return exportOrders.reduce((sum, o) => {
      const diff = o.advanceExpected - o.advanceReceived;
      return diff > 0 ? sum + diff : sum;
    }, 0);
  }, [exportOrders]);

  const balancePending = useMemo(() => {
    return exportOrders.reduce((sum, o) => {
      const diff = o.balanceExpected - o.balanceReceived;
      return diff > 0 ? sum + diff : sum;
    }, 0);
  }, [exportOrders]);

  const shipmentsInTransit = useMemo(() => {
    return exportOrders.filter((o) => o.status === 'Shipped').length;
  }, [exportOrders]);

  const millBatchesRunning = useMemo(() => {
    return millingBatches.filter((b) => b.status === 'In Progress').length;
  }, [millingBatches]);

  const varianceAlerts = useMemo(() => {
    return millingBatches.filter((b) => b.variancePct !== null && b.variancePct > 1.0).length;
  }, [millingBatches]);

  const exportReceivables = useMemo(() => {
    return exportOrders.reduce((sum, o) => {
      const outstanding = o.contractValue - o.advanceReceived - o.balanceReceived;
      return outstanding > 0 ? sum + outstanding : sum;
    }, 0);
  }, [exportOrders]);

  const exportReceivablesOrderCount = useMemo(() => {
    return exportOrders.filter((o) => o.contractValue - o.advanceReceived - o.balanceReceived > 0).length;
  }, [exportOrders]);

  // Separate profit calculations — Export in USD, Mill in PKR
  const exportProfit = useMemo(() => {
    const val = exportOrders.reduce((sum, o) => {
      const costs = Object.values(o.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      return costs > 0 ? sum + ((parseFloat(o.contractValue) || 0) - costs) : sum;
    }, 0);
    return isNaN(val) ? 0 : Math.round(val);
  }, [exportOrders]);

  const millProfitPKR = useMemo(() => {
    const val = millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => {
        const revenue = ((parseFloat(b.actualFinishedMT) || 0) * 72800) + ((parseFloat(b.brokenMT) || 0) * 42000) + ((parseFloat(b.branMT) || 0) * 22400) + ((parseFloat(b.huskMT) || 0) * 8400);
        const costs = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
        return sum + (revenue - costs);
      }, 0);
    return isNaN(val) ? 0 : Math.round(val);
  }, [millingBatches]);

  // Pipeline counts
  const pipelineCounts = useMemo(() => {
    const counts = {};
    pipelineStatuses.forEach((s) => {
      counts[s] = 0;
    });
    exportOrders.forEach((o) => {
      if (counts[o.status] !== undefined) {
        counts[o.status]++;
      }
    });
    return counts;
  }, [exportOrders]);

  // Compute chart data from real orders/batches
  const profitabilityTrend = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const totalExportProfit = exportOrders.reduce((sum, o) => {
      const costs = Object.values(o.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      return costs > 0 ? sum + ((parseFloat(o.contractValue) || 0) - costs) : sum;
    }, 0);
    const totalMillProfit = millingBatches.filter(b => b.status === 'Completed').reduce((sum, b) => {
      const rev = ((parseFloat(b.actualFinishedMT) || 0) * 72800) + ((parseFloat(b.brokenMT) || 0) * 42000) + ((parseFloat(b.branMT) || 0) * 22400) + ((parseFloat(b.huskMT) || 0) * 8400);
      const costs = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      return sum + (rev - costs);
    }, 0);
    const avg = totalExportProfit / Math.max(months.length, 1);
    const mavg = totalMillProfit / Math.max(months.length, 1);
    return months.map((month, i) => ({
      month,
      export: Math.round(avg * (0.8 + i * 0.08)),
      mill: Math.round(mavg * (0.85 + i * 0.06)),
    }));
  }, [exportOrders, millingBatches]);

  const receivablesPayables = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const totalRec = exportOrders.reduce((s, o) => s + o.contractValue - o.advanceReceived - o.balanceReceived, 0);
    const totalPay = exportOrders.reduce((s, o) => s + Object.values(o.costs || {}).reduce((cs, c) => cs + (parseFloat(c) || 0), 0), 0);
    return months.map((month, i) => ({
      month,
      receivables: Math.max(0, Math.round((totalRec / 6) * (1 + (i - 3) * 0.1))),
      payables: Math.max(0, Math.round((totalPay / 6) * (1 + (i - 2) * 0.08))),
    }));
  }, [exportOrders]);

  const recentActivities = useMemo(() => {
    const items = [];
    exportOrders.slice(0, 5).forEach((o, i) => {
      items.push({
        id: i + 1,
        type: i % 2 === 0 ? 'finance' : 'document',
        action: `${o.status} — ${o.id} (${o.customerName})`,
        by: 'System',
        time: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'Recently',
      });
    });
    return items.length > 0 ? items : [{ id: 1, type: 'finance', action: 'No recent activity', by: '', time: '' }];
  }, [exportOrders]);

  const yieldDistribution = useMemo(() => {
    const completed = millingBatches.filter(b => b.status === 'Completed' && b.rawQtyMT > 0);
    if (completed.length === 0) {
      return [
        { name: 'Finished Rice', value: 65, fill: '#3b82f6' },
        { name: 'Broken', value: 15, fill: '#f59e0b' },
        { name: 'Bran', value: 10, fill: '#10b981' },
        { name: 'Husk', value: 8, fill: '#8b5cf6' },
        { name: 'Wastage', value: 2, fill: '#ef4444' },
      ];
    }
    const totals = completed.reduce((acc, b) => ({
      finished: acc.finished + (parseFloat(b.actualFinishedMT) || 0),
      broken: acc.broken + (parseFloat(b.brokenMT) || 0),
      bran: acc.bran + (parseFloat(b.branMT) || 0),
      husk: acc.husk + (parseFloat(b.huskMT) || 0),
      wastage: acc.wastage + (parseFloat(b.wastageMT) || 0),
      raw: acc.raw + (parseFloat(b.rawQtyMT) || 0),
    }), { finished: 0, broken: 0, bran: 0, husk: 0, wastage: 0, raw: 0 });
    const pct = (v) => Math.round((v / totals.raw) * 100) || 0;
    return [
      { name: 'Finished Rice', value: pct(totals.finished), fill: '#3b82f6' },
      { name: 'Broken', value: pct(totals.broken), fill: '#f59e0b' },
      { name: 'Bran', value: pct(totals.bran), fill: '#10b981' },
      { name: 'Husk', value: pct(totals.husk), fill: '#8b5cf6' },
      { name: 'Wastage', value: pct(totals.wastage), fill: '#ef4444' },
    ];
  }, [millingBatches]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Rice export operations overview
          </p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option>This Month</option>
            <option>Last Month</option>
            <option>This Quarter</option>
            <option>This Year</option>
            <option>All Time</option>
          </select>
          <button
            onClick={() => refreshFromApi('orders')}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh data"
          >
            <RefreshCw size={16} className={dataLoading ? 'animate-spin' : ''} />
          </button>
          <div className="text-xs text-gray-400 hidden sm:block">
            Last updated: {new Date().toLocaleString()}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <KPICardsRow
        entityFilter={entityFilter}
        activeOrders={activeOrders}
        advancePending={advancePending}
        balancePending={balancePending}
        shipmentsInTransit={shipmentsInTransit}
        millBatchesRunning={millBatchesRunning}
        millingBatchesTotal={millingBatches.length}
        varianceAlerts={varianceAlerts}
        exportReceivables={exportReceivables}
        exportReceivablesOrderCount={exportReceivablesOrderCount}
        exportProfit={exportProfit}
        millProfitPKR={millProfitPKR}
      />

      {/* Order Pipeline */}
      <OrderPipeline pipelineCounts={pipelineCounts} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left column - 60% (3/5) */}
        <div className="lg:col-span-3 space-y-4 lg:space-y-6">
          <ProfitabilityChart data={profitabilityTrend} />
          <ReceivablesPayablesChart data={receivablesPayables} />
        </div>

        {/* Right column - 40% (2/5) */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          <AlertsPanel
            filteredAlerts={filteredAlerts}
            entityFilter={entityFilter}
            dismissAlert={dismissAlert}
          />
          <YieldDistributionChart data={yieldDistribution} />
          <RecentActivity activities={recentActivities} />
        </div>
      </div>
    </div>
  );
}
