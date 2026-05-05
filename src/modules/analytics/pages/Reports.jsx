import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, TrendingUp, Users, Globe, Package, Award, Coins, Printer, RefreshCw,
  ArrowUpRight, ArrowDownLeft, Activity, Calendar, ExternalLink, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import {
  useExecutiveSummary, useOrderProfitability, useCustomerProfitability,
  useCountryAnalysis, useStockAgingReport, useSupplierQualityRanking,
} from '../../../api/queries';

// ─── Formatting ────────────────────────────────────────────────────────
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
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}

// ─── Range presets ────────────────────────────────────────────────────
const RANGES = [
  { value: '',        label: 'All Time' },
  { value: 'today',   label: 'Today' },
  { value: 'week',    label: 'This Week' },
  { value: 'month',   label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year',    label: 'This Year' },
];

function rangeToParams(range) {
  if (!range) return {};
  const now = new Date();
  const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
  const endOf   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x.toISOString().slice(0,10); };
  switch (range) {
    case 'today':   return { from_date: startOf(now), to_date: endOf(now) };
    case 'week':    {
      const day = now.getDay() || 7;
      const monday = new Date(now); monday.setDate(now.getDate() - (day - 1));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { from_date: startOf(monday), to_date: endOf(sunday) };
    }
    case 'month':   return { from_date: startOf(new Date(now.getFullYear(), now.getMonth(), 1)),     to_date: endOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from_date: startOf(new Date(now.getFullYear(), q * 3, 1)), to_date: endOf(new Date(now.getFullYear(), q * 3 + 3, 0)) };
    }
    case 'year':    return { from_date: startOf(new Date(now.getFullYear(), 0, 1)), to_date: endOf(new Date(now.getFullYear(), 11, 31)) };
    default:        return {};
  }
}

// ─── Page ─────────────────────────────────────────────────────────────
const TABS = [
  { key: 'orders',    label: 'Orders',     icon: TrendingUp },
  { key: 'customers', label: 'Customers',  icon: Users },
  { key: 'countries', label: 'Countries',  icon: Globe },
  { key: 'inventory', label: 'Inventory',  icon: Package },
  { key: 'quality',   label: 'Quality',    icon: Award },
];

export default function Reports() {
  const [range, setRange] = useState('');
  const [tab, setTab] = useState('orders');
  const params = useMemo(() => rangeToParams(range), [range]);

  const { data: exec = {}, isLoading: execLoading, refetch: refetchExec } = useExecutiveSummary(params);

  const refetchAll = () => refetchExec();

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Hero band ─────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-blue-800 to-cyan-700 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <BarChart3 size={14} /> Reports & Analytics
            </div>
            <h1 className="text-3xl font-bold leading-tight">Business Reports</h1>
            <p className="text-sm opacity-80 mt-1">
              Real-time view of every order, customer and shipment — sourced directly from production data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-white/15 backdrop-blur-sm rounded-lg flex items-center gap-1.5 px-2 py-1.5">
              <Calendar size={13} className="opacity-80" />
              <select value={range} onChange={e => setRange(e.target.value)}
                className="bg-transparent border-0 text-xs font-medium text-white outline-none cursor-pointer pr-2">
                {RANGES.map(r => <option key={r.value} value={r.value} className="text-gray-900">{r.label}</option>)}
              </select>
            </div>
            <button onClick={refetchAll}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
            <Link to="/reports/print"
              className="bg-white text-slate-900 hover:bg-gray-100 px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 shadow-sm transition-colors">
              <Printer size={14} /> Print Reports
            </Link>
          </div>
        </div>
      </div>

      {/* ─── Executive KPI strip ──────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile icon={TrendingUp}    tone="blue"    label="Total Orders"     primary={exec.totalOrders ?? '—'} secondary={`${exec.activeOrders ?? 0} active`} loading={execLoading} />
        <KpiTile icon={ArrowDownLeft} tone="emerald" label="Total Revenue"    primary={fmtPKR(exec.totalRevenuePkr)} secondary={`${exec.totalShipments ?? 0} shipped`} loading={execLoading} />
        <KpiTile icon={Coins}         tone="amber"   label="Outstanding A/R"  primary={fmtPKR(exec.totalOutstandingPkr)} secondary={`${exec.openReceivables ?? 0} open`} loading={execLoading} />
        <KpiTile icon={Activity}      tone="violet"  label="Booked Profit"    primary={fmtPKR(exec.bookedProfitPkr)} secondary={`Margin ${fmtPct(exec.avgMarginPct)}`} loading={execLoading} />
        <KpiTile icon={Award}         tone="rose"    label="Avg Yield"        primary={fmtPct(exec.avgYieldPct)} secondary={`${exec.totalBatches ?? 0} batches`} loading={execLoading} />
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <nav className="flex overflow-x-auto border-b border-gray-200">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 sm:px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key ? 'border-blue-600 text-blue-600 bg-blue-50/40' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 sm:p-6">
          {tab === 'orders'    && <OrdersTab params={params} />}
          {tab === 'customers' && <CustomersTab params={params} />}
          {tab === 'countries' && <CountriesTab params={params} />}
          {tab === 'inventory' && <InventoryTab />}
          {tab === 'quality'   && <QualityTab params={params} />}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Orders ──────────────────────────────────────────────────────
function OrdersTab({ params }) {
  const { data: rows = [], isLoading } = useOrderProfitability(params);

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (parseFloat(b.bookedProfitPkr) || 0) - (parseFloat(a.bookedProfitPkr) || 0)),
    [rows]);

  const chartData = useMemo(() =>
    sorted.slice(0, 10).map(r => ({
      name: r.orderNo,
      Revenue: parseFloat(r.revenuePkrBooked) || 0,
      Cost:    parseFloat(r.totalCostPkr)     || 0,
      Profit:  parseFloat(r.bookedProfitPkr)  || 0,
    })),
    [sorted]);

  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No orders in this period." />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Order-level Profitability" subtitle="Top 10 by booked profit (PKR)" />
      <ChartBlock data={chartData} />
      <Table
        head={['Order', 'Customer', 'Status', 'Currency', 'Revenue (PKR)', 'Cost (PKR)', 'Profit (PKR)', 'Margin']}
        align={['left','left','left','left','right','right','right','right']}
        rows={sorted.map(r => [
          <Link to={`/export/${r.orderNo || r.id}`} className="text-blue-600 hover:underline font-medium">{r.orderNo}</Link>,
          r.customerName || '—',
          <StatusChip s={r.status} />,
          r.currency || 'PKR',
          fmtPKR(r.revenuePkrBooked),
          fmtPKR(r.totalCostPkr),
          <ProfitCell v={r.bookedProfitPkr} />,
          fmtPct(r.marginPct),
        ])}
      />
    </div>
  );
}

// ─── Tab: Customers ───────────────────────────────────────────────────
function CustomersTab({ params }) {
  const { data: rows = [], isLoading } = useCustomerProfitability(params);
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No customer activity in this period." />;

  const sorted = [...rows].sort((a, b) => (parseFloat(b.totalProfitPkr) || 0) - (parseFloat(a.totalProfitPkr) || 0));

  return (
    <div className="space-y-4">
      <SectionHeader title="Customer Profitability" subtitle="Ranked by total booked profit" />
      <Table
        head={['#', 'Customer', 'Country', 'Orders', 'Revenue (PKR)', 'Profit (PKR)', 'Avg Margin']}
        align={['left','left','left','right','right','right','right']}
        rows={sorted.map((r, i) => [
          i + 1,
          r.customerName || '—',
          r.country || '—',
          r.orderCount || 0,
          fmtPKR(r.totalRevenuePkr),
          <ProfitCell v={r.totalProfitPkr} />,
          fmtPct(r.avgMarginPct),
        ])}
      />
    </div>
  );
}

// ─── Tab: Countries ───────────────────────────────────────────────────
function CountriesTab({ params }) {
  const { data: rows = [], isLoading } = useCountryAnalysis(params);
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No country data for this period." />;

  const sorted = [...rows].sort((a, b) => (parseFloat(b.totalRevenuePkr) || 0) - (parseFloat(a.totalRevenuePkr) || 0));
  const chartData = sorted.slice(0, 8).map(r => ({
    name: r.country || '—',
    Revenue: parseFloat(r.totalRevenuePkr) || 0,
    Profit:  parseFloat(r.totalProfitPkr)  || 0,
  }));

  return (
    <div className="space-y-4">
      <SectionHeader title="Sales by Country" subtitle="Revenue and profit destination breakdown" />
      <ChartBlock data={chartData} />
      <Table
        head={['Country', 'Orders', 'Quantity (MT)', 'Revenue (PKR)', 'Profit (PKR)', 'Margin']}
        align={['left','right','right','right','right','right']}
        rows={sorted.map(r => [
          r.country || '—',
          r.orderCount || 0,
          (parseFloat(r.totalQtyMt) || 0).toFixed(1),
          fmtPKR(r.totalRevenuePkr),
          <ProfitCell v={r.totalProfitPkr} />,
          fmtPct(r.avgMarginPct),
        ])}
      />
    </div>
  );
}

// ─── Tab: Inventory ───────────────────────────────────────────────────
function InventoryTab() {
  const { data: rows = [], isLoading } = useStockAgingReport();
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No stock to report." />;

  const totalValue = rows.reduce((s, r) => s + (parseFloat(r.totalValuePkr) || parseFloat(r.totalValue) || 0), 0);
  const totalKg    = rows.reduce((s, r) => s + (parseFloat(r.totalKg) || 0), 0);

  return (
    <div className="space-y-4">
      <SectionHeader title="Stock Aging" subtitle="Inventory grouped by holding period" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Total weight"  value={`${(totalKg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`} />
        <SummaryCell label="Total value"   value={fmtPKR(totalValue)} />
        <SummaryCell label="Aging buckets" value={String(rows.length)} />
        <SummaryCell label="See printable" value={<Link to="/reports/print" className="text-blue-600 hover:underline inline-flex items-center gap-1">/reports/print <ExternalLink size={12} /></Link>} />
      </div>
      <Table
        head={['Bucket', 'Lots', 'Quantity (kg)', 'Value (PKR)']}
        align={['left','right','right','right']}
        rows={rows.map(r => [
          r.ageBucket || r.bucket || '—',
          r.lotCount || 0,
          (parseFloat(r.totalKg) || 0).toLocaleString(),
          fmtPKR(parseFloat(r.totalValuePkr) || parseFloat(r.totalValue) || 0),
        ])}
      />
    </div>
  );
}

// ─── Tab: Quality ─────────────────────────────────────────────────────
function QualityTab({ params }) {
  const { data: rows = [], isLoading } = useSupplierQualityRanking(params);
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No quality data yet — record arrival samples on milling batches to populate this report." />;

  const sorted = [...rows].sort((a, b) => (parseFloat(b.avgYieldPct) || 0) - (parseFloat(a.avgYieldPct) || 0));

  return (
    <div className="space-y-4">
      <SectionHeader title="Supplier Quality Ranking" subtitle="Yield + variance by supplier" />
      <Table
        head={['#', 'Supplier', 'Batches', 'Avg Yield', 'Avg Broken %', 'Avg Moisture %', 'Variance Flags']}
        align={['left','left','right','right','right','right','right']}
        rows={sorted.map((r, i) => [
          i + 1,
          r.supplierName || '—',
          r.batchCount || 0,
          fmtPct(r.avgYieldPct),
          fmtPct(r.avgBrokenPct),
          fmtPct(r.avgMoisturePct),
          r.varianceFlags > 0 ? (
            <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
              <AlertTriangle size={12} /> {r.varianceFlags}
            </span>
          ) : <span className="text-emerald-600 font-medium">none</span>,
        ])}
      />
    </div>
  );
}

// ─── Shared subcomponents ────────────────────────────────────────────
function KpiTile({ icon: Icon, tone = 'gray', label, primary, secondary, loading }) {
  const tones = {
    blue:    { ring: 'ring-blue-100',    icon: 'text-blue-500 bg-blue-50' },
    emerald: { ring: 'ring-emerald-100', icon: 'text-emerald-500 bg-emerald-50' },
    amber:   { ring: 'ring-amber-100',   icon: 'text-amber-500 bg-amber-50' },
    violet:  { ring: 'ring-violet-100',  icon: 'text-violet-500 bg-violet-50' },
    rose:    { ring: 'ring-rose-100',    icon: 'text-rose-500 bg-rose-50' },
    gray:    { ring: 'ring-gray-100',    icon: 'text-gray-500 bg-gray-50' },
  };
  const t = tones[tone] || tones.gray;
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ring-1 ${t.ring}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        {Icon && <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}><Icon size={14} /></span>}
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none">
        {loading ? <span className="inline-block w-16 h-4 bg-gray-100 rounded animate-pulse" /> : primary}
      </div>
      {secondary && <div className="text-[11px] text-gray-500 mt-1">{secondary}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function SummaryCell({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
      <div className="text-base font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function ChartBlock({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : v} />
          <Tooltip formatter={(v) => fmtPKR(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Revenue" fill="#3b82f6" />
          {Object.keys(data[0] || {}).includes('Cost')   && <Bar dataKey="Cost"   fill="#f59e0b" />}
          {Object.keys(data[0] || {}).includes('Profit') && <Bar dataKey="Profit" fill="#10b981" />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusChip({ s }) {
  const tone =
    s === 'Closed' || s === 'Arrived' ? 'bg-slate-100 text-slate-700'
    : s === 'Shipped' ? 'bg-cyan-100 text-cyan-700'
    : s === 'Cancelled' ? 'bg-rose-100 text-rose-700'
    : 'bg-blue-100 text-blue-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{s || '—'}</span>;
}

function ProfitCell({ v }) {
  const n = parseFloat(v) || 0;
  const cls = n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-600' : 'text-gray-500';
  return <span className={`font-semibold ${cls}`}>{fmtPKR(n)}</span>;
}

function Table({ head, align = [], rows }) {
  if (!rows || rows.length === 0) return <Empty msg="No rows." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {head.map((h, i) => (
              <th key={i} className={`text-${align[i] || 'left'} py-2.5 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wider`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className={`text-${align[ci] || 'left'} py-2.5 px-3 text-gray-800`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }) {
  return <div className="text-center text-sm text-gray-400 py-12">{msg}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-32 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
    </div>
  );
}
