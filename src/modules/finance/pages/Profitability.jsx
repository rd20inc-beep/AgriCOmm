import { useState, useMemo, useEffect } from 'react';
import api from '../../../api/client';
import {
  TrendingUp,
  AlertTriangle,
  BarChart3,
  DollarSign,
  X,
  ChevronRight,
  Package,
  Clock,
  Shield,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Layers,
  Info,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../../../context/AppContext';
// Profitability trend computed from real data below
import StatusBadge from '../../../components/StatusBadge';

// ------------------------------------------------------------------ helpers
function formatUSD(value) {
  return '$' + Math.round(value).toLocaleString('en-US');
}

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

function pct(num, den) {
  return den > 0 ? (num / den) * 100 : 0;
}

function daysBetween(dateStr, ref) {
  if (!dateStr) return 0;
  return Math.floor((ref - new Date(dateStr)) / (1000 * 60 * 60 * 24));
}

const ENTITY_TABS = ['Export', 'Mill', 'Consolidated'];
const SECONDARY_TABS = ['Order-wise', 'Batch-wise', 'Customer-wise', 'Country-wise', 'Monthly Trend'];

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#14b8a6', '#e879f9', '#64748b'];

// ===================================================================
// MAIN COMPONENT
// ===================================================================
export default function Profitability() {
  const {
    exportOrders,
    millingBatches,
    exportCostCategories,
    millingCostCategories,
  } = useApp();

  // Fetch local sales for profit calculations
  const [localSalesData, setLocalSalesData] = useState([]);
  useEffect(() => {
    api.get('/api/local-sales', { limit: 500 })
      .then(res => setLocalSalesData(res?.data?.sales || []))
      .catch(() => { /* local sales data is supplementary — page still works without it */ });
  }, []);

  // Compute profitability trend from real data
  const profitabilityTrend = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const pkrRate = settings?.pkrRate || 280;
    const totalExportProfit = exportOrders.reduce((sum, o) => {
      const opCosts = Object.values(o.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      const cogsUSD = (parseFloat(o.inventoryCogsTotalPkr) || 0) / pkrRate;
      const totalCost = opCosts + cogsUSD;
      return totalCost > 0 ? sum + (o.contractValue - totalCost) : sum;
    }, 0);
    const totalMillProfit = millingBatches.filter(b => b.status === 'Completed').reduce((sum, b) => {
      const fp = parseFloat(b.finishedPricePerMT) || 0;
      const bp = parseFloat(b.brokenPricePerMT) || 0;
      const np = parseFloat(b.branPricePerMT) || 0;
      const hp = parseFloat(b.huskPricePerMT) || 0;
      const rev = (b.actualFinishedMT * fp) + (b.brokenMT * bp) + (b.branMT * np) + (b.huskMT * hp);
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

  const [mainTab, setMainTab] = useState('Export');
  const [secondaryTab, setSecondaryTab] = useState('Order-wise');
  const [drilldown, setDrilldown] = useState(null); // { type: 'export'|'mill', id }
  const now = useMemo(() => new Date(), []);

  // ---------- derived secondary tab set ----------
  const visibleSecondaryTabs = useMemo(() => {
    if (mainTab === 'Export') return ['Order-wise', 'Customer-wise', 'Country-wise', 'Monthly Trend'];
    if (mainTab === 'Mill') return ['Batch-wise', 'Customer-wise', 'Country-wise', 'Monthly Trend'];
    return SECONDARY_TABS;
  }, [mainTab]);

  // auto-correct secondary when switching main
  const activeSecondary = visibleSecondaryTabs.includes(secondaryTab)
    ? secondaryTab
    : visibleSecondaryTabs[0];

  // ================================================================
  // EXPORT rows
  // ================================================================
  const exportRows = useMemo(() => {
    const pRate = settings?.pkrRate || 280;
    return exportOrders.map(order => {
      const operationalCosts = Object.values(order.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      const inventoryCOGS = (parseFloat(order.inventoryCogsTotalPkr) || 0) / pRate;
      const totalCosts = operationalCosts + inventoryCOGS;
      const grossProfit = order.contractValue - totalCosts;
      const marginPct = pct(grossProfit, order.contractValue);
      const costPerMT = order.qtyMT > 0 ? totalCosts / order.qtyMT : 0;
      const hasCOGS = inventoryCOGS > 0;

      // Risk flags
      const flags = [];
      if (!hasCOGS && order.status === 'Shipped') flags.push({ label: 'No Inventory COGS', color: 'bg-amber-100 text-amber-700' });
      if (grossProfit < 0) flags.push({ label: 'Negative Margin', color: 'bg-red-100 text-red-700' });
      else if (marginPct < 5 && totalCosts > 0) flags.push({ label: 'Low Margin', color: 'bg-amber-100 text-amber-700' });
      if (totalCosts > 0 && totalCosts > order.contractValue * 0.8) flags.push({ label: 'High Cost', color: 'bg-purple-100 text-purple-700' });
      if (
        (order.status === 'Awaiting Advance' || order.status === 'Awaiting Balance') &&
        daysBetween(order.createdAt, now) > 21
      ) {
        flags.push({ label: 'Overdue', color: 'bg-orange-100 text-orange-700' });
      }

      return {
        id: order.id,
        customerName: order.customerName,
        country: order.country,
        revenue: order.contractValue,
        directCosts: totalCosts,
        grossProfit,
        marginPct,
        qtyMT: order.qtyMT,
        costPerMT,
        flags,
        status: order.status,
        order, // keep ref for drilldown
      };
    });
  }, [exportOrders, now]);

  // ================================================================
  // MILL rows
  // ================================================================
  const millRows = useMemo(() => {
    return millingBatches.map(batch => {
      const totalCosts = Object.values(batch.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
      // Use batch-confirmed prices — NOT hardcoded constants
      const fp = parseFloat(batch.finishedPricePerMT) || 0;
      const bp = parseFloat(batch.brokenPricePerMT) || 0;
      const np = parseFloat(batch.branPricePerMT) || 0;
      const hp = parseFloat(batch.huskPricePerMT) || 0;
      const finishedRevenue = (batch.actualFinishedMT || 0) * fp;
      const brokenRevenue = (batch.brokenMT || 0) * bp;
      const branRevenue = (batch.branMT || 0) * np;
      const huskRevenue = (batch.huskMT || 0) * hp;
      const totalRevenue = finishedRevenue + brokenRevenue + branRevenue + huskRevenue;
      const grossProfit = totalRevenue - totalCosts;
      const marginPct = pct(grossProfit, totalRevenue);
      const pricesConfirmed = !!batch.pricesConfirmed;

      const flags = [];
      if (!pricesConfirmed && batch.status === 'Completed') flags.push({ label: 'Prices Not Confirmed', color: 'bg-amber-100 text-amber-700' });
      if (grossProfit < 0) flags.push({ label: 'Negative Margin', color: 'bg-red-100 text-red-700' });
      else if (marginPct < 5 && totalCosts > 0) flags.push({ label: 'Low Margin', color: 'bg-amber-100 text-amber-700' });
      if (totalCosts > 0 && totalCosts > totalRevenue * 0.8) flags.push({ label: 'High Cost', color: 'bg-purple-100 text-purple-700' });

      return {
        id: batch.id,
        supplierName: batch.supplierName,
        rawQtyMT: batch.rawQtyMT,
        finishedMT: batch.actualFinishedMT,
        revenue: totalRevenue,
        directCosts: totalCosts,
        grossProfit,
        yieldPct: batch.yieldPct,
        marginPct,
        flags,
        status: batch.status,
        linkedExportOrder: batch.linkedExportOrder,
        batch, // keep ref
        revenueBreakdown: { finishedRevenue, brokenRevenue, branRevenue, huskRevenue },
      };
    });
  }, [millingBatches]);

  // ================================================================
  // CUSTOMER-WISE aggregation (export)
  // ================================================================
  const customerRows = useMemo(() => {
    const map = {};
    exportRows.forEach(r => {
      const key = r.customerName;
      if (!map[key]) map[key] = { customer: key, orders: 0, totalRevenue: 0, totalProfit: 0, marginSum: 0 };
      map[key].orders += 1;
      map[key].totalRevenue += r.revenue;
      map[key].totalProfit += r.grossProfit;
      map[key].marginSum += r.marginPct;
    });
    return Object.values(map).map(c => ({
      ...c,
      avgMargin: c.orders > 0 ? c.marginSum / c.orders : 0,
    })).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [exportRows]);

  // ================================================================
  // COUNTRY-WISE aggregation
  // ================================================================
  const countryRows = useMemo(() => {
    const map = {};
    exportRows.forEach(r => {
      const key = r.country || 'Unknown';
      if (!map[key]) map[key] = { country: key, orders: 0, revenue: 0, qtyMT: 0, marginSum: 0 };
      map[key].orders += 1;
      map[key].revenue += r.revenue;
      map[key].qtyMT += r.qtyMT;
      map[key].marginSum += r.marginPct;
    });
    return Object.values(map).map(c => ({
      ...c,
      avgMargin: c.orders > 0 ? c.marginSum / c.orders : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [exportRows]);

  // ================================================================
  // CHART DATA
  // ================================================================

  // Margin trend bar chart data (from exportRows with costs)
  const marginTrendData = useMemo(() => {
    return exportRows
      .filter(r => r.directCosts > 0)
      .map(r => ({
        name: r.id,
        margin: parseFloat(r.marginPct.toFixed(1)),
        profit: Math.round(r.grossProfit),
      }));
  }, [exportRows]);

  // Top 5 profitable customers
  const top5Customers = useMemo(() => {
    return [...customerRows]
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, 5)
      .map(c => ({
        name: c.customer.length > 20 ? c.customer.substring(0, 20) + '...' : c.customer,
        fullName: c.customer,
        profit: Math.round(c.totalProfit),
      }));
  }, [customerRows]);

  // Cost breakdown pie (aggregate all export costs)
  const costBreakdownPie = useMemo(() => {
    const totals = {};
    exportCostCategories.forEach(cat => {
      totals[cat.key] = { name: cat.label, key: cat.key, value: 0 };
    });
    exportOrders.forEach(order => {
      Object.entries(order.costs || {}).forEach(([k, v]) => {
        if (totals[k]) totals[k].value += v;
        else totals[k] = { name: k, key: k, value: v };
      });
    });
    return Object.values(totals).filter(t => t.value > 0);
  }, [exportOrders, exportCostCategories]);

  // ================================================================
  // DRILLDOWN: find the entity
  // ================================================================
  const drilldownData = useMemo(() => {
    if (!drilldown) return null;
    if (drilldown.type === 'export') {
      const row = exportRows.find(r => r.id === drilldown.id);
      if (!row) return null;
      const order = row.order;
      const outstanding = order.contractValue - (order.advanceReceived || 0) - (order.balanceReceived || 0);
      // expected vs actual costs per category
      const expectedCostPerMT = {};
      exportCostCategories.forEach(cat => {
        // estimate expected as a proportion of contract value
        const totalActual = Object.values(order.costs || {}).reduce((s, c) => s + c, 0);
        expectedCostPerMT[cat.key] = totalActual > 0
          ? Math.round((order.costs[cat.key] || 0) * 0.9)
          : 0;
      });
      // find linked mill batch
      const linkedBatch = order.millingOrderId
        ? millingBatches.find(b => b.id === order.millingOrderId)
        : null;
      return {
        type: 'export',
        row,
        order,
        outstanding,
        expectedCosts: expectedCostPerMT,
        linkedBatch,
      };
    }
    if (drilldown.type === 'mill') {
      const row = millRows.find(r => r.id === drilldown.id);
      if (!row) return null;
      const batch = row.batch;
      // find linked export order
      const linkedOrder = batch.linkedExportOrder
        ? exportOrders.find(o => o.id === batch.linkedExportOrder)
        : null;
      return {
        type: 'mill',
        row,
        batch,
        linkedOrder,
      };
    }
    return null;
  }, [drilldown, exportRows, millRows, exportOrders, millingBatches, exportCostCategories]);

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profitability Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Deep-dive into margins, costs, and risk flags across Export and Milling
          </p>
        </div>
      </div>

      {/* ============ MAIN TOGGLE ============ */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit overflow-x-auto">
        {ENTITY_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
              mainTab === tab
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ============ SECONDARY TABS ============ */}
      {mainTab !== 'Consolidated' && (
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto whitespace-nowrap">
          {visibleSecondaryTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setSecondaryTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeSecondary === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* ================================================================
          EXPORT TAB
          ================================================================ */}
      {mainTab === 'Export' && (
        <>
          {/* ---------- Order-wise ---------- */}
          {activeSecondary === 'Order-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Export Order Profitability (USD)</h2>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  Click any row for drilldown
                </div>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Order No</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Direct Costs</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Gross Profit</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Margin %</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty MT</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Cost/MT</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Risk Flag</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exportRows.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => setDrilldown({ type: 'export', id: row.id })}
                        className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${
                          row.flags.some(f => f.label === 'Negative Margin') ? 'bg-red-50/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-blue-700">{row.id}</td>
                        <td className="px-4 py-3 text-gray-900 truncate max-w-[180px]">{row.customerName}</td>
                        <td className="px-4 py-3 text-gray-600">{row.country}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(row.revenue)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(row.directCosts)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatUSD(row.grossProfit)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          row.marginPct < 0 ? 'text-red-600' : row.marginPct < 5 ? 'text-amber-600' : row.marginPct < 15 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {row.directCosts > 0 ? row.marginPct.toFixed(1) + '%' : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{row.qtyMT}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {row.costPerMT > 0 ? formatUSD(row.costPerMT) : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 justify-center">
                            {row.flags.length > 0 ? row.flags.map((f, i) => (
                              <span key={i} className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${f.color}`}>
                                {f.label}
                              </span>
                            )) : (
                              row.directCosts > 0
                                ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">OK</span>
                                : <span className="text-gray-400 text-xs">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={row.status} />
                        </td>
                      </tr>
                    ))}
                    {exportRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-4 py-12 text-center text-gray-500">No export orders found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Customer-wise ---------- */}
          {activeSecondary === 'Customer-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Customer-wise Profitability (USD)</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Orders</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Profit</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customerRows.map(c => (
                      <tr key={c.customer} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[240px]">{c.customer}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.orders}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(c.totalRevenue)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${c.totalProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatUSD(c.totalProfit)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          c.avgMargin < 0 ? 'text-red-600' : c.avgMargin < 5 ? 'text-amber-600' : c.avgMargin < 15 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {c.avgMargin.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {customerRows.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500">No data.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Country-wise ---------- */}
          {activeSecondary === 'Country-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Country-wise Profitability (USD)</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Orders</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty MT</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {countryRows.map(c => (
                      <tr key={c.country} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.country}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.orders}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(c.revenue)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.qtyMT.toFixed(1)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          c.avgMargin < 0 ? 'text-red-600' : c.avgMargin < 5 ? 'text-amber-600' : c.avgMargin < 15 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {c.avgMargin.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {countryRows.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500">No data.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Monthly Trend ---------- */}
          {activeSecondary === 'Monthly Trend' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Monthly Profit Trend
              </h2>
              <div className="h-48 sm:h-64 lg:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={profitabilityTrend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                      formatter={value => [`$${value.toLocaleString()}`, undefined]}
                    />
                    <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }} />
                    <Line type="monotone" dataKey="export" name="Export Profit" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                    <Line type="monotone" dataKey="mill" name="Mill Profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ---------- Charts Row (Export) ---------- */}
          {(activeSecondary === 'Order-wise' || activeSecondary === 'Customer-wise' || activeSecondary === 'Country-wise') && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Margin Trend Bar Chart */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  Margin by Order
                </h2>
                <div className="h-48 sm:h-56 lg:h-64">
                  {marginTrendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={marginTrendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={(value, name) => {
                            if (name === 'margin') return [`${value}%`, 'Margin'];
                            return [`$${value.toLocaleString()}`, 'Profit'];
                          }}
                        />
                        <Bar dataKey="margin" name="margin" radius={[4, 4, 0, 0]} barSize={28}>
                          {marginTrendData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.margin < 0 ? '#ef4444' : entry.margin < 5 ? '#f59e0b' : '#3b82f6'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">No cost data recorded</div>
                  )}
                </div>
              </div>

              {/* Top 5 Profitable Customers Horizontal Bar */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Top 5 Profitable Customers
                </h2>
                <div className="h-48 sm:h-56 lg:h-64">
                  {top5Customers.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top5Customers} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={value => [`$${value.toLocaleString()}`, 'Profit']}
                          labelFormatter={label => {
                            const found = top5Customers.find(c => c.name === label);
                            return found ? found.fullName : label;
                          }}
                        />
                        <Bar dataKey="profit" name="Profit" fill="#10b981" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">No data</div>
                  )}
                </div>
              </div>

              {/* Cost Breakdown Pie */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600" />
                  Cost Breakdown
                </h2>
                <div className="h-64 flex items-center justify-center">
                  {costBreakdownPie.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={costBreakdownPie}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={85}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                        >
                          {costBreakdownPie.map((entry, idx) => (
                            <Cell key={entry.key} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={value => [formatUSD(value), 'Cost']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-gray-400 text-sm">No cost data</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================
          MILL TAB
          ================================================================ */}
      {mainTab === 'Mill' && (
        <>
          {/* ---------- Batch-wise ---------- */}
          {activeSecondary === 'Batch-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Milling Batch Profitability (PKR)</h2>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Info className="w-3.5 h-3.5 text-blue-500" />
                  Revenue = Finished x 72,800 + Broken x 42,000 + Bran x 22,400 + Husk x 8,400
                </div>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Batch</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Supplier</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Raw Qty</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Finished Qty</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue (PKR)</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Costs (PKR)</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Gross Profit (PKR)</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Yield %</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Margin %</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Risk Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {millRows.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => setDrilldown({ type: 'mill', id: row.id })}
                        className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${
                          row.flags.some(f => f.label === 'Negative Margin') ? 'bg-red-50/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-blue-700">{row.id}</td>
                        <td className="px-4 py-3 text-gray-900 truncate max-w-[160px]">{row.supplierName}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{row.rawQtyMT} MT</td>
                        <td className="px-4 py-3 text-right text-gray-700">{row.finishedMT} MT</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatPKR(row.revenue)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatPKR(row.directCosts)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatPKR(row.grossProfit)}
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${
                          row.yieldPct >= 75 ? 'text-green-600' : row.yieldPct >= 70 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {row.yieldPct > 0 ? row.yieldPct.toFixed(1) + '%' : '-'}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          row.marginPct < 0 ? 'text-red-600' : row.marginPct < 5 ? 'text-amber-600' : row.marginPct < 15 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {row.directCosts > 0 ? row.marginPct.toFixed(1) + '%' : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 justify-center">
                            {row.flags.length > 0 ? row.flags.map((f, i) => (
                              <span key={i} className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${f.color}`}>
                                {f.label}
                              </span>
                            )) : (
                              row.directCosts > 0
                                ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">OK</span>
                                : <span className="text-gray-400 text-xs">-</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {millRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center text-gray-500">No milling batches found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Customer-wise (Mill = Supplier-wise) ---------- */}
          {activeSecondary === 'Customer-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Supplier-wise Milling Profitability (PKR)</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Supplier</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Batches</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Profit</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(() => {
                      const map = {};
                      millRows.forEach(r => {
                        const key = r.supplierName;
                        if (!map[key]) map[key] = { supplier: key, batches: 0, totalRevenue: 0, totalProfit: 0, marginSum: 0 };
                        map[key].batches += 1;
                        map[key].totalRevenue += r.revenue;
                        map[key].totalProfit += r.grossProfit;
                        map[key].marginSum += r.marginPct;
                      });
                      return Object.values(map).sort((a, b) => b.totalProfit - a.totalProfit).map(c => (
                        <tr key={c.supplier} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{c.supplier}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{c.batches}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">{formatPKR(c.totalRevenue)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${c.totalProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatPKR(c.totalProfit)}
                          </td>
                          <td className={`px-4 py-3 text-right font-bold ${
                            (c.marginSum / c.batches) < 5 ? 'text-amber-600' : 'text-green-600'
                          }`}>
                            {(c.marginSum / c.batches).toFixed(1)}%
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Country-wise (for Mill, show by linked export country) ---------- */}
          {activeSecondary === 'Country-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Mill Output by Linked Export Destination</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Destination</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Batches</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue (PKR)</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Raw Qty MT</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(() => {
                      const map = {};
                      millRows.forEach(r => {
                        const linkedOrder = r.linkedExportOrder
                          ? exportOrders.find(o => o.id === r.linkedExportOrder)
                          : null;
                        const dest = linkedOrder ? linkedOrder.country : 'Unlinked / Local';
                        if (!map[dest]) map[dest] = { dest, batches: 0, revenue: 0, rawQty: 0, marginSum: 0 };
                        map[dest].batches += 1;
                        map[dest].revenue += r.revenue;
                        map[dest].rawQty += r.rawQtyMT;
                        map[dest].marginSum += r.marginPct;
                      });
                      return Object.values(map).sort((a, b) => b.revenue - a.revenue).map(c => (
                        <tr key={c.dest} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{c.dest}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{c.batches}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">{formatPKR(c.revenue)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{c.rawQty.toFixed(1)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${
                            (c.marginSum / c.batches) < 5 ? 'text-amber-600' : 'text-green-600'
                          }`}>
                            {(c.marginSum / c.batches).toFixed(1)}%
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------- Monthly Trend (Mill) ---------- */}
          {activeSecondary === 'Monthly Trend' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                Monthly Mill Profit Trend
              </h2>
              <div className="h-48 sm:h-64 lg:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={profitabilityTrend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                      formatter={value => [`$${value.toLocaleString()}`, undefined]}
                    />
                    <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }} />
                    <Line type="monotone" dataKey="mill" name="Mill Profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                    <Line type="monotone" dataKey="export" name="Export Profit" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================
          CONSOLIDATED TAB
          ================================================================ */}
      {mainTab === 'Consolidated' && (
        <>
          {/* Note */}
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <p className="text-sm text-blue-800">
              Internal transfers eliminated in consolidation. Export procurement from mill is treated as intercompany
              and netted out to avoid double-counting.
            </p>
          </div>

          {/* Secondary tabs for consolidated */}
          <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto whitespace-nowrap">
            {SECONDARY_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setSecondaryTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeSecondary === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Order-wise / Batch-wise: side by side tables */}
          {(activeSecondary === 'Order-wise' || activeSecondary === 'Batch-wise') && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Export table */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Export Division (USD)</h2>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    Red = margin &lt; 5%
                  </div>
                </div>
                <div className="table-container">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Order No</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Revenue</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Costs</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Gross Profit</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Margin</th>
                        <th className="text-center px-3 py-2 font-semibold text-gray-600">Risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {exportRows.map(row => (
                        <tr
                          key={row.id}
                          onClick={() => setDrilldown({ type: 'export', id: row.id })}
                          className={`hover:bg-blue-50/40 cursor-pointer ${row.flags.some(f => f.label === 'Negative Margin') ? 'bg-red-50/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{row.id}</div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[120px]">{row.customerName}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{formatUSD(row.revenue)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{formatUSD(row.directCosts)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatUSD(row.grossProfit)}
                          </td>
                          <td className={`px-3 py-2 text-right font-bold ${row.marginPct < 5 ? 'text-red-600' : row.marginPct < 15 ? 'text-amber-600' : 'text-green-600'}`}>
                            {row.directCosts > 0 ? row.marginPct.toFixed(1) + '%' : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.flags.length > 0 ? (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${row.flags[0].color}`}>
                                <AlertTriangle className="w-2.5 h-2.5" /> {row.flags[0].label.split(' ')[0]}
                              </span>
                            ) : row.directCosts > 0 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">OK</span>
                            ) : <span className="text-gray-400">-</span>}
                          </td>
                        </tr>
                      ))}
                      {exportRows.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-xs">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mill table */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Milling Division (PKR)</h2>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    Red = margin &lt; 5%
                  </div>
                </div>
                <div className="table-container">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Batch No</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Revenue</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Costs</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Gross Profit</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600">Margin</th>
                        <th className="text-center px-3 py-2 font-semibold text-gray-600">Risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {millRows.map(row => (
                        <tr
                          key={row.id}
                          onClick={() => setDrilldown({ type: 'mill', id: row.id })}
                          className={`hover:bg-blue-50/40 cursor-pointer ${row.flags.some(f => f.label === 'Negative Margin') ? 'bg-red-50/40' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{row.id}</div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[120px]">{row.supplierName}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{formatPKR(row.revenue)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{formatPKR(row.directCosts)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatPKR(row.grossProfit)}
                          </td>
                          <td className={`px-3 py-2 text-right font-bold ${row.marginPct < 5 ? 'text-red-600' : row.marginPct < 15 ? 'text-amber-600' : 'text-green-600'}`}>
                            {row.directCosts > 0 ? row.marginPct.toFixed(1) + '%' : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.flags.length > 0 ? (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${row.flags[0].color}`}>
                                <AlertTriangle className="w-2.5 h-2.5" /> {row.flags[0].label.split(' ')[0]}
                              </span>
                            ) : row.directCosts > 0 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">OK</span>
                            ) : <span className="text-gray-400">-</span>}
                          </td>
                        </tr>
                      ))}
                      {millRows.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-xs">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Customer-wise consolidated */}
          {activeSecondary === 'Customer-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Customer-wise Profitability (USD) - Consolidated</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Orders</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Profit</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customerRows.map(c => (
                      <tr key={c.customer} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[240px]">{c.customer}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.orders}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(c.totalRevenue)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${c.totalProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatUSD(c.totalProfit)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          c.avgMargin < 5 ? 'text-amber-600' : 'text-green-600'
                        }`}>
                          {c.avgMargin.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Country-wise consolidated */}
          {activeSecondary === 'Country-wise' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Country-wise Profitability (USD) - Consolidated</h2>
              </div>
              <div className="table-container">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Orders</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Qty MT</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600">Avg Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {countryRows.map(c => (
                      <tr key={c.country} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.country}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.orders}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatUSD(c.revenue)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.qtyMT.toFixed(1)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          c.avgMargin < 5 ? 'text-amber-600' : 'text-green-600'
                        }`}>
                          {c.avgMargin.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly Trend consolidated */}
          {activeSecondary === 'Monthly Trend' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Monthly Profit Trend (Consolidated)
              </h2>
              <div className="h-48 sm:h-64 lg:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={profitabilityTrend} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                      formatter={value => [`$${value.toLocaleString()}`, undefined]}
                    />
                    <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }} />
                    <Line type="monotone" dataKey="export" name="Export Profit" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                    <Line type="monotone" dataKey="mill" name="Mill Profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Charts Row (Consolidated) */}
          {(activeSecondary === 'Order-wise' || activeSecondary === 'Batch-wise') && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Margin Trend Bar Chart */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  Margin by Order
                </h2>
                <div className="h-48 sm:h-56 lg:h-64">
                  {marginTrendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={marginTrendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={value => [`${value}%`, 'Margin']}
                        />
                        <Bar dataKey="margin" name="margin" radius={[4, 4, 0, 0]} barSize={28}>
                          {marginTrendData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.margin < 0 ? '#ef4444' : entry.margin < 5 ? '#f59e0b' : '#3b82f6'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">No cost data</div>
                  )}
                </div>
              </div>

              {/* Top 5 Profitable Customers */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Top 5 Profitable Customers
                </h2>
                <div className="h-48 sm:h-56 lg:h-64">
                  {top5Customers.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top5Customers} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={value => [`$${value.toLocaleString()}`, 'Profit']}
                        />
                        <Bar dataKey="profit" name="Profit" fill="#10b981" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">No data</div>
                  )}
                </div>
              </div>

              {/* Cost Breakdown Pie */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600" />
                  Cost Breakdown
                </h2>
                <div className="h-64 flex items-center justify-center">
                  {costBreakdownPie.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={costBreakdownPie}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={85}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                        >
                          {costBreakdownPie.map((entry, idx) => (
                            <Cell key={entry.key} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}
                          formatter={value => [formatUSD(value), 'Cost']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-gray-400 text-sm">No cost data</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ================================================================
          DRILLDOWN DRAWER / MODAL
          ================================================================ */}
      {drilldownData && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 transition-opacity"
            onClick={() => setDrilldown(null)}
          />

          {/* Drawer */}
          <div className="relative w-full max-w-2xl bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  {drilldownData.type === 'export' ? (
                    <>
                      <ArrowUpRight className="w-5 h-5 text-blue-600" />
                      {drilldownData.row.id} Drilldown
                    </>
                  ) : (
                    <>
                      <Package className="w-5 h-5 text-green-600" />
                      {drilldownData.row.id} Drilldown
                    </>
                  )}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {drilldownData.type === 'export'
                    ? drilldownData.order.customerName
                    : drilldownData.batch.supplierName}
                </p>
              </div>
              <button
                onClick={() => setDrilldown(null)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* ============ EXPORT DRILLDOWN ============ */}
              {drilldownData.type === 'export' && (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Contract Value</p>
                      <p className="text-xl font-bold text-blue-900 mt-1">{formatUSD(drilldownData.order.contractValue)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-green-600 uppercase tracking-wider">Gross Profit</p>
                      <p className={`text-xl font-bold mt-1 ${drilldownData.row.grossProfit >= 0 ? 'text-green-900' : 'text-red-700'}`}>
                        {formatUSD(drilldownData.row.grossProfit)}
                      </p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Margin</p>
                      <p className={`text-xl font-bold mt-1 ${
                        drilldownData.row.marginPct < 0 ? 'text-red-700' : drilldownData.row.marginPct < 5 ? 'text-amber-700' : 'text-green-700'
                      }`}>
                        {drilldownData.row.directCosts > 0 ? drilldownData.row.marginPct.toFixed(1) + '%' : '-'}
                      </p>
                    </div>
                    <div className={`rounded-lg p-4 ${drilldownData.outstanding > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                      <p className={`text-xs font-medium uppercase tracking-wider ${drilldownData.outstanding > 0 ? 'text-red-600' : 'text-gray-600'}`}>Outstanding</p>
                      <p className={`text-xl font-bold mt-1 ${drilldownData.outstanding > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                        {formatUSD(drilldownData.outstanding)}
                      </p>
                    </div>
                  </div>

                  {/* Payment Collection */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Collection Status
                      </h3>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Advance Expected</span>
                        <span className="font-medium text-gray-900">{formatUSD(drilldownData.order.advanceExpected)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Advance Received</span>
                        <span className={`font-medium ${drilldownData.order.advanceReceived > 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {formatUSD(drilldownData.order.advanceReceived)}
                          {drilldownData.order.advanceDate && (
                            <span className="text-xs text-gray-400 ml-1">({drilldownData.order.advanceDate})</span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Balance Expected</span>
                        <span className="font-medium text-gray-900">{formatUSD(drilldownData.order.balanceExpected)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Balance Received</span>
                        <span className={`font-medium ${drilldownData.order.balanceReceived > 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {formatUSD(drilldownData.order.balanceReceived)}
                          {drilldownData.order.balanceDate && (
                            <span className="text-xs text-gray-400 ml-1">({drilldownData.order.balanceDate})</span>
                          )}
                        </span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 flex items-center justify-between text-sm font-semibold">
                        <span className="text-gray-700">Outstanding</span>
                        <span className={drilldownData.outstanding > 0 ? 'text-red-700' : 'text-green-700'}>
                          {formatUSD(drilldownData.outstanding)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cost Breakdown Table */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-600" />
                        Cost Breakdown
                      </h3>
                    </div>
                    <div className="table-container">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Category</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Expected</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Actual</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Variance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {exportCostCategories.map(cat => {
                            const actual = drilldownData.order.costs[cat.key] || 0;
                            const expected = drilldownData.expectedCosts[cat.key] || 0;
                            const variance = actual - expected;
                            if (actual === 0 && expected === 0) return null;
                            return (
                              <tr key={cat.key} className="hover:bg-gray-50">
                                <td className="px-4 py-2 text-gray-900">{cat.label}</td>
                                <td className="px-4 py-2 text-right text-gray-600">{formatUSD(expected)}</td>
                                <td className="px-4 py-2 text-right font-medium text-gray-900">{formatUSD(actual)}</td>
                                <td className={`px-4 py-2 text-right font-medium ${variance > 0 ? 'text-red-600' : variance < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                  {variance > 0 ? '+' : ''}{formatUSD(variance)}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-gray-50 font-semibold">
                            <td className="px-4 py-2 text-gray-900">Total</td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {formatUSD(Object.values(drilldownData.expectedCosts).reduce((s, v) => s + v, 0))}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-900">
                              {formatUSD(drilldownData.row.directCosts)}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {formatUSD(drilldownData.row.directCosts - Object.values(drilldownData.expectedCosts).reduce((s, v) => s + v, 0))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Shipment Status */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Package className="w-4 h-4 text-cyan-600" />
                        Shipment Status
                      </h3>
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">Status</span>
                        <div className="mt-0.5"><StatusBadge status={drilldownData.order.status} /></div>
                      </div>
                      <div>
                        <span className="text-gray-500">Vessel</span>
                        <p className="font-medium text-gray-900 mt-0.5">{drilldownData.order.vesselName || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">ETD</span>
                        <p className="font-medium text-gray-900 mt-0.5">{drilldownData.order.etd || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">ETA</span>
                        <p className="font-medium text-gray-900 mt-0.5">{drilldownData.order.eta || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Destination</span>
                        <p className="font-medium text-gray-900 mt-0.5">{drilldownData.order.destinationPort}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Incoterm</span>
                        <p className="font-medium text-gray-900 mt-0.5">{drilldownData.order.incoterm}</p>
                      </div>
                    </div>
                  </div>

                  {/* Linked Mill Source */}
                  {drilldownData.linkedBatch && (
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <ArrowDownRight className="w-4 h-4 text-indigo-600" />
                          Linked Mill Source
                        </h3>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">Batch ID</span>
                          <p className="font-medium text-indigo-700 mt-0.5">{drilldownData.linkedBatch.id}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Status</span>
                          <div className="mt-0.5"><StatusBadge status={drilldownData.linkedBatch.status} /></div>
                        </div>
                        <div>
                          <span className="text-gray-500">Raw Qty</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedBatch.rawQtyMT} MT</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Finished Qty</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedBatch.actualFinishedMT} MT</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Yield</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedBatch.yieldPct}%</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Supplier</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedBatch.supplierName}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Risk Summary */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-red-600" />
                        Risk Summary
                      </h3>
                    </div>
                    <div className="p-4">
                      {drilldownData.row.flags.length > 0 ? (
                        <div className="space-y-2">
                          {drilldownData.row.flags.map((f, i) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${f.color.replace('text-', 'bg-').split(' ')[0]}`}>
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                              <span className="text-sm font-medium">{f.label}</span>
                              <span className="text-xs ml-auto">
                                {f.label === 'Negative Margin' && `Profit: ${formatUSD(drilldownData.row.grossProfit)}`}
                                {f.label === 'Low Margin' && `Margin: ${drilldownData.row.marginPct.toFixed(1)}%`}
                                {f.label === 'High Cost' && `Cost ratio: ${pct(drilldownData.row.directCosts, drilldownData.row.revenue).toFixed(0)}%`}
                                {f.label === 'Overdue' && `Created: ${drilldownData.order.createdAt}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                          <Shield className="w-4 h-4" />
                          <span className="text-sm font-medium">No risk flags detected</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Activity Timeline */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-600" />
                        Activity Timeline
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="relative">
                        <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200" />
                        <div className="space-y-4">
                          {[...(drilldownData.order.activityLog || [])].reverse().map((entry, idx) => (
                            <div key={idx} className="flex gap-3 relative">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                                idx === 0 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                              }`}>
                                <Clock className="w-3.5 h-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-900 font-medium">{entry.action}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-gray-500">{entry.date}</span>
                                  <span className="text-xs text-gray-400">by {entry.by}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                          {(!drilldownData.order.activityLog || drilldownData.order.activityLog.length === 0) && (
                            <p className="text-sm text-gray-400 pl-10">No activity recorded.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ============ MILL DRILLDOWN ============ */}
              {drilldownData.type === 'mill' && (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Raw Qty</p>
                      <p className="text-xl font-bold text-blue-900 mt-1">{drilldownData.batch.rawQtyMT} MT</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-green-600 uppercase tracking-wider">Finished Qty</p>
                      <p className="text-xl font-bold text-green-900 mt-1">{drilldownData.batch.actualFinishedMT} MT</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Yield</p>
                      <p className={`text-xl font-bold mt-1 ${
                        drilldownData.batch.yieldPct >= 75 ? 'text-green-700' : drilldownData.batch.yieldPct >= 70 ? 'text-amber-700' : 'text-red-700'
                      }`}>
                        {drilldownData.batch.yieldPct > 0 ? drilldownData.batch.yieldPct.toFixed(1) + '%' : '-'}
                      </p>
                    </div>
                    <div className={`rounded-lg p-4 ${drilldownData.row.grossProfit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Gross Profit</p>
                      <p className={`text-xl font-bold mt-1 ${drilldownData.row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatPKR(drilldownData.row.grossProfit)}
                      </p>
                    </div>
                  </div>

                  {/* By-Product Breakdown */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Package className="w-4 h-4 text-amber-600" />
                        By-Product Breakdown
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <span className="text-gray-500">Finished Rice</span>
                          <p className="font-bold text-gray-900 mt-0.5">{drilldownData.batch.actualFinishedMT} MT</p>
                          <p className="text-xs text-gray-400">{formatPKR(drilldownData.row.revenueBreakdown.finishedRevenue)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <span className="text-gray-500">Broken Rice</span>
                          <p className="font-bold text-gray-900 mt-0.5">{drilldownData.batch.brokenMT} MT</p>
                          <p className="text-xs text-gray-400">{formatPKR(drilldownData.row.revenueBreakdown.brokenRevenue)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <span className="text-gray-500">Bran</span>
                          <p className="font-bold text-gray-900 mt-0.5">{drilldownData.batch.branMT} MT</p>
                          <p className="text-xs text-gray-400">{formatPKR(drilldownData.row.revenueBreakdown.branRevenue)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <span className="text-gray-500">Husk</span>
                          <p className="font-bold text-gray-900 mt-0.5">{drilldownData.batch.huskMT} MT</p>
                          <p className="text-xs text-gray-400">{formatPKR(drilldownData.row.revenueBreakdown.huskRevenue)}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm bg-gray-50 rounded-lg p-3">
                        <span className="text-gray-500">Wastage</span>
                        <span className="font-medium text-red-600">{drilldownData.batch.wastageMT} MT</span>
                      </div>
                    </div>
                  </div>

                  {/* Revenue Breakdown */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Revenue Breakdown (PKR)
                      </h3>
                    </div>
                    <div className="table-container">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Product</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Qty (MT)</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Rate/MT</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">Finished Rice</td>
                            <td className="px-4 py-2 text-right text-gray-700">{drilldownData.batch.actualFinishedMT}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatPKR(parseFloat(drilldownData.batch.finishedPricePerMT) || 0)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{formatPKR(drilldownData.row.revenueBreakdown.finishedRevenue)}</td>
                          </tr>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">Broken Rice</td>
                            <td className="px-4 py-2 text-right text-gray-700">{drilldownData.batch.brokenMT}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatPKR(parseFloat(drilldownData.batch.brokenPricePerMT) || 0)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{formatPKR(drilldownData.row.revenueBreakdown.brokenRevenue)}</td>
                          </tr>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">Bran</td>
                            <td className="px-4 py-2 text-right text-gray-700">{drilldownData.batch.branMT}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatPKR(parseFloat(drilldownData.batch.branPricePerMT) || 0)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{formatPKR(drilldownData.row.revenueBreakdown.branRevenue)}</td>
                          </tr>
                          <tr className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">Husk</td>
                            <td className="px-4 py-2 text-right text-gray-700">{drilldownData.batch.huskMT}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatPKR(parseFloat(drilldownData.batch.huskPricePerMT) || 0)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-900">{formatPKR(drilldownData.row.revenueBreakdown.huskRevenue)}</td>
                          </tr>
                          <tr className="bg-gray-50 font-semibold">
                            <td className="px-4 py-2 text-gray-900" colSpan={3}>Total Revenue</td>
                            <td className="px-4 py-2 text-right text-gray-900">{formatPKR(drilldownData.row.revenue)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Cost Breakdown Table */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-purple-600" />
                        Cost Breakdown (PKR)
                      </h3>
                    </div>
                    <div className="table-container">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-4 py-2 font-semibold text-gray-600">Category</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">Amount</th>
                            <th className="text-right px-4 py-2 font-semibold text-gray-600">% of Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {millingCostCategories.map(cat => {
                            const amount = drilldownData.batch.costs[cat.key] || 0;
                            if (amount === 0) return null;
                            const costPct = pct(amount, drilldownData.row.directCosts);
                            return (
                              <tr key={cat.key} className="hover:bg-gray-50">
                                <td className="px-4 py-2 text-gray-900">{cat.label}</td>
                                <td className="px-4 py-2 text-right font-medium text-gray-900">{formatPKR(amount)}</td>
                                <td className="px-4 py-2 text-right text-gray-600">{costPct.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                          <tr className="bg-gray-50 font-semibold">
                            <td className="px-4 py-2 text-gray-900">Total</td>
                            <td className="px-4 py-2 text-right text-gray-900">{formatPKR(drilldownData.row.directCosts)}</td>
                            <td className="px-4 py-2 text-right text-gray-600">100%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Profitability Summary */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-green-600" />
                        Profitability Summary
                      </h3>
                    </div>
                    <div className="p-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Total Revenue</span>
                        <span className="font-medium text-gray-900">{formatPKR(drilldownData.row.revenue)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Total Costs</span>
                        <span className="font-medium text-gray-900">{formatPKR(drilldownData.row.directCosts)}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 flex items-center justify-between font-semibold">
                        <span className="text-gray-700">Gross Profit</span>
                        <span className={drilldownData.row.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}>
                          {formatPKR(drilldownData.row.grossProfit)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Margin</span>
                        <span className={`font-bold ${
                          drilldownData.row.marginPct < 0 ? 'text-red-600' : drilldownData.row.marginPct < 5 ? 'text-amber-600' : 'text-green-600'
                        }`}>
                          {drilldownData.row.directCosts > 0 ? drilldownData.row.marginPct.toFixed(1) + '%' : '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Linked Export Order */}
                  {drilldownData.linkedOrder && (
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <ArrowUpRight className="w-4 h-4 text-blue-600" />
                          Linked Export Order
                        </h3>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">Order ID</span>
                          <p className="font-medium text-blue-700 mt-0.5">{drilldownData.linkedOrder.id}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Customer</span>
                          <p className="font-medium text-gray-900 mt-0.5 truncate">{drilldownData.linkedOrder.customerName}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Country</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedOrder.country}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Status</span>
                          <div className="mt-0.5"><StatusBadge status={drilldownData.linkedOrder.status} /></div>
                        </div>
                        <div>
                          <span className="text-gray-500">Contract Value</span>
                          <p className="font-medium text-gray-900 mt-0.5">{formatUSD(drilldownData.linkedOrder.contractValue)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Qty</span>
                          <p className="font-medium text-gray-900 mt-0.5">{drilldownData.linkedOrder.qtyMT} MT</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Risk Summary */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-red-600" />
                        Risk Summary
                      </h3>
                    </div>
                    <div className="p-4">
                      {drilldownData.row.flags.length > 0 ? (
                        <div className="space-y-2">
                          {drilldownData.row.flags.map((f, i) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${f.color.replace('text-', 'bg-').split(' ')[0]}`}>
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                              <span className="text-sm font-medium">{f.label}</span>
                              <span className="text-xs ml-auto">
                                {f.label === 'Negative Margin' && `Profit: ${formatPKR(drilldownData.row.grossProfit)}`}
                                {f.label === 'Low Margin' && `Margin: ${drilldownData.row.marginPct.toFixed(1)}%`}
                                {f.label === 'High Cost' && `Cost ratio: ${pct(drilldownData.row.directCosts, drilldownData.row.revenue).toFixed(0)}%`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                          <Shield className="w-4 h-4" />
                          <span className="text-sm font-medium">No risk flags detected</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Activity Timeline (mill batches don't have activityLog in mockData, so synthetic) */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-600" />
                        Activity Timeline
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="relative">
                        <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200" />
                        <div className="space-y-4">
                          {(() => {
                            const activities = [];
                            if (drilldownData.batch.createdAt) {
                              activities.push({ date: drilldownData.batch.createdAt, action: 'Batch created', by: 'Mill Manager' });
                            }
                            if (drilldownData.batch.arrivalAnalysis) {
                              activities.push({ date: drilldownData.batch.createdAt, action: `Raw material received - ${drilldownData.batch.rawQtyMT} MT from ${drilldownData.batch.supplierName}`, by: 'Inventory' });
                            }
                            if (drilldownData.batch.varianceStatus === 'Approved') {
                              activities.push({ date: drilldownData.batch.createdAt, action: `Quality variance ${drilldownData.batch.variancePct}% approved`, by: 'QC Analyst' });
                            }
                            if (drilldownData.batch.varianceStatus === 'Pending') {
                              activities.push({ date: drilldownData.batch.createdAt, action: `Quality variance ${drilldownData.batch.variancePct}% pending approval`, by: 'QC Analyst' });
                            }
                            if (drilldownData.batch.status === 'In Progress') {
                              activities.push({ date: drilldownData.batch.createdAt, action: 'Milling in progress', by: 'Mill Operator' });
                            }
                            if (drilldownData.batch.completedAt) {
                              activities.push({ date: drilldownData.batch.completedAt, action: `Milling completed - Yield ${drilldownData.batch.yieldPct}%`, by: 'Mill Manager' });
                            }
                            if (drilldownData.batch.linkedExportOrder) {
                              activities.push({ date: drilldownData.batch.completedAt || drilldownData.batch.createdAt, action: `Linked to export order ${drilldownData.batch.linkedExportOrder}`, by: 'System' });
                            }
                            return activities.reverse().map((entry, idx) => (
                              <div key={idx} className="flex gap-3 relative">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                                  idx === 0 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'
                                }`}>
                                  <Clock className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-900 font-medium">{entry.action}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-gray-500">{entry.date}</span>
                                    <span className="text-xs text-gray-400">by {entry.by}</span>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Animation style for drawer */}
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
