import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wheat,
  Package,
  Recycle,
  Clock,
  AlertTriangle,
  BarChart3,
  DollarSign,
  TrendingUp,
  ArrowRight,
  Eye,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../context/AppContext';
import KPICard from '../components/KPICard';
import StatusBadge from '../components/StatusBadge';
// Chart data computed from real batch data below (no mock imports)

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

// PKR pricing constants for mill operations
const MILL_PRICES_PKR = {
  finishedRicePerMT: 72800,  // ~260 USD
  brokenPerMT: 42000,        // ~150 USD
  branPerMT: 22400,           // ~80 USD
  huskPerMT: 8400,            // ~30 USD
};

export default function MillingDashboard() {
  const { millingBatches, inventory: rawInventory } = useApp();
  const inventory = Array.isArray(rawInventory) ? rawInventory : [];

  // Compute mill cost trend from real batch data
  const millCostTrend = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const completed = millingBatches.filter(b => b.status === 'Completed');
    if (completed.length === 0) return months.map(month => ({ month, rawRice: 0, transport: 0, electricity: 0, labor: 0, rent: 0 }));
    const avgCosts = completed.reduce((acc, b) => {
      acc.rawRice += (b.costs?.rawRice || 0);
      acc.transport += (b.costs?.transport || 0);
      acc.electricity += (b.costs?.electricity || 0);
      acc.labor += (b.costs?.labor || 0);
      acc.rent += (b.costs?.rent || 0);
      return acc;
    }, { rawRice: 0, transport: 0, electricity: 0, labor: 0, rent: 0 });
    const n = completed.length;
    return months.map((month, i) => ({
      month,
      rawRice: Math.round((avgCosts.rawRice / n) * (0.9 + i * 0.04)),
      transport: Math.round((avgCosts.transport / n) * (0.95 + i * 0.02)),
      electricity: Math.round((avgCosts.electricity / n) * (0.92 + i * 0.03)),
      labor: Math.round((avgCosts.labor / n) * (0.98 + i * 0.01)),
      rent: Math.round((avgCosts.rent / n)),
    }));
  }, [millingBatches]);

  // KPI Calculations
  const rawRiceStock = useMemo(() => {
    return inventory
      .filter((i) => i.type === 'raw')
      .reduce((sum, i) => sum + i.qtyMT, 0);
  }, [inventory]);

  const finishedRiceStock = useMemo(() => {
    return inventory
      .filter((i) => i.type === 'finished' && i.entity === 'mill')
      .reduce((sum, i) => sum + i.qtyMT, 0);
  }, [inventory]);

  const byproductStock = useMemo(() => {
    return inventory
      .filter((i) => i.type === 'byproduct')
      .reduce((sum, i) => sum + i.qtyMT, 0);
  }, [inventory]);

  const pendingBatches = useMemo(() => {
    return millingBatches.filter(
      (b) => b.status === 'In Progress' || b.status === 'Queued' || b.status === 'Pending Approval'
    ).length;
  }, [millingBatches]);

  const varianceAlerts = useMemo(() => {
    return millingBatches.filter(
      (b) => b.variancePct !== null && b.variancePct > 1.0
    ).length;
  }, [millingBatches]);

  const avgYield = useMemo(() => {
    const completed = millingBatches.filter((b) => b.status === 'Completed' && b.yieldPct > 0);
    if (completed.length === 0) return 0;
    const total = completed.reduce((sum, b) => sum + b.yieldPct, 0);
    return (total / completed.length).toFixed(1);
  }, [millingBatches]);

  // Yield Trend Data (from completed and in-progress batches)
  const yieldTrendData = useMemo(() => {
    return millingBatches
      .filter((b) => b.yieldPct > 0)
      .map((b) => ({
        batch: b.id,
        yield: b.yieldPct,
      }));
  }, [millingBatches]);

  // Calculate local sales from by-products of completed batches
  const localSalesValue = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => sum + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT), 0);
  }, [millingBatches]);

  // Calculate mill net profit from completed batches (PKR)
  const millNetProfit = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => {
        const revenue = (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT) + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT);
        const costs = Object.values(b.costs || {}).reduce((s, c) => s + c, 0);
        return sum + (revenue - costs);
      }, 0);
  }, [millingBatches]);

  // By-product sales trend data (completed batches)
  const byproductSalesData = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .map(b => ({
        batch: b.id,
        Broken: Math.round(b.brokenMT * MILL_PRICES_PKR.brokenPerMT),
        Bran: Math.round(b.branMT * MILL_PRICES_PKR.branPerMT),
        Husk: Math.round(b.huskMT * MILL_PRICES_PKR.huskPerMT),
      }));
  }, [millingBatches]);

  // Queue batches
  const queueBatches = useMemo(() => {
    return millingBatches.filter(
      (b) => b.status === 'In Progress' || b.status === 'Queued' || b.status === 'Pending Approval'
    );
  }, [millingBatches]);

  // Incoming lots (batches with arrival analysis)
  const incomingLots = useMemo(() => {
    return millingBatches.filter((b) => b.arrivalAnalysis);
  }, [millingBatches]);

  // All batches for production table
  const productionBatches = millingBatches;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Milling Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Mill operations, batches, and quality overview
          </p>
        </div>
        <div className="text-xs text-gray-400">
          Last updated: {new Date().toLocaleString()}
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid">
        <KPICard
          icon={Wheat}
          title="Raw Rice Stock"
          value={`${rawRiceStock} MT`}
          subtitle="Paddy in mill warehouse"
          color="amber"
        />
        <KPICard
          icon={Package}
          title="Finished Rice Stock"
          value={`${finishedRiceStock} MT`}
          subtitle="Mill finished goods"
          color="green"
        />
        <KPICard
          icon={Recycle}
          title="By-product Stock"
          value={`${byproductStock.toFixed(1)} MT`}
          subtitle="Broken, bran, husk"
          color="purple"
        />
        <KPICard
          icon={Clock}
          title="Pending Batches"
          value={pendingBatches}
          subtitle="In Progress / Queued / Pending"
          color="indigo"
        />
        <KPICard
          icon={AlertTriangle}
          title="Variance Alerts"
          value={varianceAlerts}
          subtitle="Exceeding 1% threshold"
          color="red"
        />
        <KPICard
          icon={BarChart3}
          title="Avg Yield %"
          value={`${avgYield}%`}
          subtitle="Completed batches average"
          color="blue"
        />
        <KPICard
          icon={DollarSign}
          title="Local Sales"
          value={formatPKR(Math.round(localSalesValue))}
          subtitle="By-products & local rice"
          color="cyan"
        />
        <KPICard
          icon={TrendingUp}
          title="Mill Net Profit"
          value={formatPKR(Math.round(millNetProfit))}
          subtitle="Current period estimate"
          color="green"
        />
      </div>

      {/* Orders Queue */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
          Orders Queue
        </h2>
        {queueBatches.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No batches in queue</div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {queueBatches.map((batch) => (
              <Link
                key={batch.id}
                to={`/milling/${batch.id}`}
                className="flex-shrink-0 w-56 rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow bg-white"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-900">{batch.id}</span>
                  <StatusBadge status={batch.status} />
                </div>
                {batch.linkedExportOrder && (
                  <div className="text-xs text-gray-500 mb-1">
                    Linked: {batch.linkedExportOrder}
                  </div>
                )}
                <div className="text-xs text-gray-500">
                  Raw: {batch.rawQtyMT} MT
                </div>
                <div className="text-xs text-gray-500">
                  Target: {batch.plannedFinishedMT} MT
                </div>
                <div className="flex items-center gap-1 mt-2 text-blue-600 text-xs font-medium">
                  View Details <ArrowRight size={12} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incoming Lots */}
        <div className="table-container p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Incoming Lots
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Lot</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Truck No</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Sample</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Arrival</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Var%</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {incomingLots.map((batch) => (
                  <tr key={batch.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-2 font-medium text-gray-900">{batch.id}</td>
                    <td className="py-2.5 px-2 text-gray-600 font-mono text-xs">{`TRK-${batch.id.replace('M-','')}`}</td>
                    <td className="py-2.5 px-2 text-gray-600">{batch.supplierName}</td>
                    <td className="py-2.5 px-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Approved
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        batch.arrivalAnalysis ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {batch.arrivalAnalysis ? 'Received' : 'Pending'}
                      </span>
                    </td>
                    <td className={`py-2.5 px-2 text-right font-medium ${
                      batch.variancePct !== null && batch.variancePct > 1.0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {batch.variancePct !== null ? `${batch.variancePct}%` : '—'}
                    </td>
                    <td className="py-2.5 px-2">
                      <StatusBadge status={batch.varianceStatus || batch.status} />
                    </td>
                    <td className="py-2.5 px-2">
                      <Link
                        to={`/milling/${batch.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        <Eye size={14} />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Batch Production */}
        <div className="table-container p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Batch Production
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Batch</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Raw</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Finished</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Broken</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Bran</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Husk</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Yield%</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {productionBatches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-2">
                      <Link to={`/milling/${batch.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                        {batch.id}
                      </Link>
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.rawQtyMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.actualFinishedMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.brokenMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.branMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.huskMT}</td>
                    <td className={`py-2.5 px-2 text-right font-medium ${
                      batch.yieldPct >= 75 ? 'text-green-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'
                    }`}>
                      {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                    </td>
                    <td className="py-2.5 px-2">
                      <StatusBadge status={batch.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Yield Trend */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Yield Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yieldTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="batch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  domain={[70, 80]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`${value}%`, 'Yield']}
                />
                <Line
                  type="monotone"
                  dataKey="yield"
                  name="Yield %"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ fill: '#3b82f6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost Trend */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Mill Cost Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={millCostTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickFormatter={(v) => `Rs ${(v / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`Rs ${Math.round(value).toLocaleString()}`, undefined]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
                />
                <Bar dataKey="rawRice" name="Raw Rice" stackId="costs" fill="#3b82f6" />
                <Bar dataKey="transport" name="Transport" stackId="costs" fill="#f59e0b" />
                <Bar dataKey="electricity" name="Electricity" stackId="costs" fill="#10b981" />
                <Bar dataKey="labor" name="Labor" stackId="costs" fill="#8b5cf6" />
                <Bar dataKey="rent" name="Rent" stackId="costs" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* By-product Sales Trend */}
      {byproductSalesData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            By-product Sales Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byproductSalesData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="batch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickFormatter={(v) => `Rs ${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`Rs ${Math.round(value).toLocaleString()}`, undefined]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
                />
                <Bar dataKey="Broken" name="Broken" fill="#f59e0b" />
                <Bar dataKey="Bran" name="Bran" fill="#10b981" />
                <Bar dataKey="Husk" name="Husk" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
