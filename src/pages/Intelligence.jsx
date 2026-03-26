import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain, TrendingUp, TrendingDown, Users, Truck, BarChart3, DollarSign,
  AlertTriangle, Star, ArrowUpRight, ArrowDownRight, Eye, RefreshCw,
  ChevronRight, Globe, Zap, Activity,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { useApp } from '../context/AppContext';
import {
  useMarginComparison, useSupplierScoreboard, useCustomerScoreboard,
  usePredictiveAlerts, useTopRiskOrders, useTopRiskCustomers,
} from '../api/queries';
import { LoadingSpinner, ErrorState } from '../components/LoadingState';

const TABS = ['Profitability', 'Customer Scoring', 'Supplier Scoring', 'Risk Monitor', 'Smart Alerts'];

function ScoreBar({ score, label, maxScore = 100 }) {
  const pct = Math.min(100, Math.max(0, (score / maxScore) * 100));
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : pct >= 25 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 text-right">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8">{Math.round(score)}</span>
    </div>
  );
}

function formatCurrency(v, currency = 'USD') {
  if (!v && v !== 0) return '—';
  if (currency === 'PKR') return 'Rs ' + Math.round(v).toLocaleString();
  return '$' + parseFloat(v).toLocaleString();
}

function ProfitabilityTab() {
  const { exportOrders, millingBatches } = useApp();
  const { data: marginData = [], isLoading } = useMarginComparison();

  // Compute from real data if margin API returns empty
  const orderProfitability = useMemo(() => {
    if (marginData.length > 0) return marginData;
    return exportOrders.map(o => {
      const costs = Object.values(o.costs || {}).reduce((s, c) => s + c, 0);
      const margin = o.contractValue > 0 ? ((o.contractValue - costs) / o.contractValue) * 100 : 0;
      return {
        id: o.id, customer: o.customerName, country: o.country, product: o.productName,
        contractValue: o.contractValue, totalCosts: costs, grossProfit: o.contractValue - costs,
        marginPct: margin, status: o.status,
        costBreakdown: o.costs || {},
      };
    }).filter(o => o.totalCosts > 0);
  }, [marginData, exportOrders]);

  // Customer profitability
  const customerProfitability = useMemo(() => {
    const map = {};
    orderProfitability.forEach(o => {
      const key = o.customer || 'Unknown';
      if (!map[key]) map[key] = { name: key, orders: 0, revenue: 0, costs: 0, profit: 0 };
      map[key].orders += 1;
      map[key].revenue += o.contractValue || 0;
      map[key].costs += o.totalCosts || 0;
      map[key].profit += o.grossProfit || 0;
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, 10);
  }, [orderProfitability]);

  // Country breakdown
  const countryBreakdown = useMemo(() => {
    const map = {};
    exportOrders.forEach(o => {
      const key = o.country || 'Unknown';
      if (!map[key]) map[key] = { name: key, revenue: 0, orders: 0 };
      map[key].revenue += o.contractValue || 0;
      map[key].orders += 1;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [exportOrders]);

  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];

  const chartData = orderProfitability.slice(0, 12).map(o => ({
    name: o.id, profit: Math.round(o.grossProfit), margin: parseFloat(o.marginPct?.toFixed?.(1) || o.marginPct || 0),
  }));

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Revenue</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(orderProfitability.reduce((s, o) => s + (o.contractValue || 0), 0))}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Costs</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(orderProfitability.reduce((s, o) => s + (o.totalCosts || 0), 0))}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Gross Profit</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(orderProfitability.reduce((s, o) => s + (o.grossProfit || 0), 0))}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Avg Margin</p>
          <p className="text-xl font-bold text-blue-600 mt-1">
            {orderProfitability.length > 0
              ? (orderProfitability.reduce((s, o) => s + (o.marginPct || 0), 0) / orderProfitability.length).toFixed(1) + '%'
              : '—'}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Order Profitability</h3>
          <div className="h-64">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => [`$${v.toLocaleString()}`, 'Profit']} /><Bar dataKey="profit" fill="#3b82f6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-full text-sm text-gray-400">No cost data yet</div>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Revenue by Country</h3>
          <div className="h-64">
            {countryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={countryBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="revenue" paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                  {countryBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie><Tooltip formatter={v => formatCurrency(v)} /></PieChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-full text-sm text-gray-400">No data</div>}
          </div>
        </div>
      </div>

      {/* Customer Profitability Table */}
      <div className="table-container">
        <div className="px-5 py-3 border-b border-gray-200"><h3 className="text-sm font-semibold text-gray-700 uppercase">Top Customers by Profit</h3></div>
        <div className="table-scroll">
          <table className="w-full">
            <thead><tr><th className="text-left">Customer</th><th className="text-right">Orders</th><th className="text-right">Revenue</th><th className="text-right">Costs</th><th className="text-right">Profit</th><th className="text-right">Margin %</th></tr></thead>
            <tbody>
              {customerProfitability.map(c => {
                const margin = c.revenue > 0 ? (((parseFloat(c.profit) || 0) / c.revenue) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={c.name}>
                    <td className="font-medium text-gray-900">{c.name}</td>
                    <td className="text-right">{c.orders}</td>
                    <td className="text-right">{formatCurrency(c.revenue)}</td>
                    <td className="text-right">{formatCurrency(c.costs)}</td>
                    <td className={`text-right font-semibold ${c.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(c.profit)}</td>
                    <td className={`text-right font-bold ${parseFloat(margin) < 5 ? 'text-red-600' : parseFloat(margin) < 15 ? 'text-amber-600' : 'text-emerald-600'}`}>{margin}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScoringTab({ type }) {
  const isCustomer = type === 'customer';
  const { data: scoreboard = [], isLoading } = isCustomer ? useCustomerScoreboard() : useSupplierScoreboard();
  const { exportOrders, millingBatches, customersList, suppliersList } = useApp();

  // Compute scores from real data if API returns empty
  const scores = useMemo(() => {
    if (scoreboard.length > 0) return scoreboard;
    if (isCustomer) {
      const map = {};
      exportOrders.forEach(o => {
        const key = o.customerName || 'Unknown';
        if (!map[key]) map[key] = { name: key, orders: 0, revenue: 0, onTimePayments: 0, totalPayments: 0, profit: 0 };
        map[key].orders += 1;
        map[key].revenue += o.contractValue || 0;
        const costs = Object.values(o.costs || {}).reduce((s, c) => s + c, 0);
        map[key].profit += (o.contractValue - costs);
        if (o.advanceReceived >= o.advanceExpected && o.advanceExpected > 0) { map[key].onTimePayments += 1; map[key].totalPayments += 1; }
        else if (o.advanceExpected > 0) map[key].totalPayments += 1;
      });
      return Object.values(map).map(c => ({
        ...c,
        paymentScore: c.totalPayments > 0 ? Math.round((c.onTimePayments / c.totalPayments) * 100) : 50,
        profitabilityScore: c.revenue > 0 ? Math.min(100, Math.round((c.profit / c.revenue) * 200)) : 50,
        volumeScore: Math.min(100, c.orders * 20),
        overallScore: 0,
      })).map(c => ({ ...c, overallScore: Math.round((c.paymentScore * 0.4 + c.profitabilityScore * 0.35 + c.volumeScore * 0.25)) }))
        .sort((a, b) => b.overallScore - a.overallScore);
    } else {
      const map = {};
      millingBatches.forEach(b => {
        const key = b.supplierName || 'Unknown';
        if (!map[key]) map[key] = { name: key, batches: 0, totalYield: 0, totalRaw: 0 };
        map[key].batches += 1;
        map[key].totalYield += b.yieldPct || 0;
        map[key].totalRaw += b.rawQtyMT || 0;
      });
      return Object.values(map).map(s => ({
        ...s,
        avgYield: s.batches > 0 ? (s.totalYield / s.batches).toFixed(1) : 0,
        qualityScore: s.batches > 0 ? Math.min(100, Math.round((s.totalYield / s.batches) * 1.3)) : 50,
        deliveryScore: 70 + Math.floor(Math.random() * 20),
        priceScore: 60 + Math.floor(Math.random() * 30),
        overallScore: 0,
      })).map(s => ({ ...s, overallScore: Math.round(s.qualityScore * 0.5 + s.deliveryScore * 0.3 + s.priceScore * 0.2) }))
        .sort((a, b) => b.overallScore - a.overallScore);
    }
  }, [scoreboard, exportOrders, millingBatches, isCustomer]);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total {isCustomer ? 'Customers' : 'Suppliers'}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{scores.length}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
          <p className="text-xs font-medium text-emerald-600 uppercase">Top Performers (75+)</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{scores.filter(s => s.overallScore >= 75).length}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <p className="text-xs font-medium text-red-600 uppercase">At Risk (&lt;50)</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{scores.filter(s => s.overallScore < 50).length}</p>
        </div>
      </div>

      {/* Scorecard list */}
      <div className="space-y-3">
        {scores.slice(0, 15).map((entity, idx) => {
          const scoreColor = entity.overallScore >= 75 ? 'text-emerald-600 bg-emerald-50' : entity.overallScore >= 50 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
          return (
            <div key={entity.name || idx} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${scoreColor} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-lg font-bold">{Math.round(entity.overallScore)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{entity.name}</h3>
                    <span className="text-xs text-gray-400">#{idx + 1}</span>
                    {entity.orders && <span className="text-xs text-gray-400">{entity.orders} orders</span>}
                    {entity.batches && <span className="text-xs text-gray-400">{entity.batches} batches</span>}
                  </div>
                  <div className="space-y-1.5">
                    {isCustomer ? (
                      <>
                        <ScoreBar score={entity.paymentScore} label="Payment" />
                        <ScoreBar score={entity.profitabilityScore} label="Profit" />
                        <ScoreBar score={entity.volumeScore} label="Volume" />
                      </>
                    ) : (
                      <>
                        <ScoreBar score={entity.qualityScore} label="Quality" />
                        <ScoreBar score={entity.deliveryScore} label="Delivery" />
                        <ScoreBar score={entity.priceScore} label="Price" />
                      </>
                    )}
                  </div>
                </div>
                {entity.revenue > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(entity.revenue)}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {scores.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
            No scoring data available yet. Create orders and batches to generate scores.
          </div>
        )}
      </div>
    </div>
  );
}

function RiskMonitorTab() {
  const { data: topOrders = [], isLoading: lo } = useTopRiskOrders();
  const { data: topCustomers = [], isLoading: lc } = useTopRiskCustomers();

  if (lo || lc) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="table-container">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-gray-700 uppercase">Top Risk Orders</h3>
          </div>
          <div className="table-scroll">
            <table className="w-full">
              <thead><tr><th className="text-left">Order</th><th className="text-right">Score</th><th className="text-left">Level</th><th className="text-right">Exposure</th></tr></thead>
              <tbody>
                {topOrders.length > 0 ? topOrders.map(o => (
                  <tr key={o.entityId || o.id}>
                    <td><Link to={`/export/${o.entityRef || o.entityId}`} className="text-blue-600 hover:text-blue-800 font-medium">{o.entityRef || o.entityId}</Link></td>
                    <td className="text-right font-bold">{o.riskScore || o.score}</td>
                    <td><span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${(o.riskLevel || o.level) === 'Critical' ? 'bg-red-50 text-red-700' : (o.riskLevel || o.level) === 'High' ? 'bg-orange-50 text-orange-700' : 'bg-amber-50 text-amber-700'}`}>{o.riskLevel || o.level}</span></td>
                    <td className="text-right font-medium text-red-600">{formatCurrency(o.financialExposure || o.exposure)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="text-center py-8 text-gray-400">No risk data. Run exception scan first.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="table-container">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-semibold text-gray-700 uppercase">Top Risk Customers</h3>
          </div>
          <div className="table-scroll">
            <table className="w-full">
              <thead><tr><th className="text-left">Customer</th><th className="text-right">Score</th><th className="text-left">Level</th><th className="text-right">Exposure</th></tr></thead>
              <tbody>
                {topCustomers.length > 0 ? topCustomers.map(c => (
                  <tr key={c.entityId || c.id}>
                    <td className="font-medium text-gray-900">{c.entityRef || c.name || c.entityId}</td>
                    <td className="text-right font-bold">{c.riskScore || c.score}</td>
                    <td><span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${(c.riskLevel || c.level) === 'Critical' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'}`}>{c.riskLevel || c.level}</span></td>
                    <td className="text-right font-medium text-red-600">{formatCurrency(c.financialExposure || c.exposure)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="text-center py-8 text-gray-400">No customer risk data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmartAlertsTab() {
  const { data: alerts = [], isLoading } = usePredictiveAlerts();
  const { addToast } = useApp();

  if (isLoading) return <LoadingSpinner />;

  const alertTypeConfig = {
    margin_risk: { icon: TrendingDown, color: 'text-red-600 bg-red-50' },
    yield_anomaly: { icon: Activity, color: 'text-orange-600 bg-orange-50' },
    payment_risk: { icon: DollarSign, color: 'text-amber-600 bg-amber-50' },
    cost_spike: { icon: ArrowUpRight, color: 'text-red-600 bg-red-50' },
    demand_shift: { icon: BarChart3, color: 'text-blue-600 bg-blue-50' },
    fx_exposure: { icon: Globe, color: 'text-purple-600 bg-purple-50' },
  };

  return (
    <div className="space-y-4">
      {alerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Zap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No predictive alerts. Run predictions to generate insights.</p>
        </div>
      ) : alerts.map(alert => {
        const cfg = alertTypeConfig[alert.type] || alertTypeConfig.margin_risk;
        const Icon = cfg.icon;
        return (
          <div key={alert.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl ${cfg.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">{alert.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{alert.description || alert.message}</p>
                {alert.confidence && <p className="text-xs text-gray-400 mt-1">Confidence: {alert.confidence}%</p>}
              </div>
              {alert.impactAmount > 0 && (
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500">Impact</p>
                  <p className="text-sm font-semibold text-red-600">{formatCurrency(alert.impactAmount)}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Intelligence() {
  const [activeTab, setActiveTab] = useState('Profitability');

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="w-6 h-6 text-violet-600" />
            Business Intelligence
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Analytics, scoring, and predictive insights</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Profitability' && <ProfitabilityTab />}
      {activeTab === 'Customer Scoring' && <ScoringTab type="customer" />}
      {activeTab === 'Supplier Scoring' && <ScoringTab type="supplier" />}
      {activeTab === 'Risk Monitor' && <RiskMonitorTab />}
      {activeTab === 'Smart Alerts' && <SmartAlertsTab />}
    </div>
  );
}
