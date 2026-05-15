import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, DollarSign, Factory, Store, AlertTriangle, CheckCircle, RefreshCw, Activity } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useProfitabilitySummary, useLocalSales, useLocalSalesSummary } from '../../../api/queries';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const TABS = ['Export', 'Mill', 'Local', 'Consolidated'];

function AccuracyBadge({ status }) {
  if (status === 'exact') return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full"><CheckCircle size={10} /> Exact</span>;
  if (status === 'estimated') return <span className="inline-flex items-center gap-0.5 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Est.</span>;
  if (status === 'operational_margin_only') return <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Op. Only</span>;
  if (status === 'missing_prices') return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Missing</span>;
  return <span className="text-xs text-gray-400">{status || '—'}</span>;
}

export default function Profit() {
  const { data: summary = {}, isLoading } = useProfitabilitySummary();
  const { data: localSales = [], isLoading: localLoading } = useLocalSales();
  const { data: localSummary = {} } = useLocalSalesSummary();
  const [tab, setTab] = useState('Export');

  const exportRows = summary.export?.rows || [];
  const millRows = summary.mill?.rows || [];
  const currentFxRate = summary.currentFxRate || 280;

  // KPIs
  const exportBookedProfitPkr = summary.export?.totalBookedProfitPkr || 0;
  const exportFxGainLoss = summary.export?.totalFxGainLossPkr || 0;
  const millProfitPkr = summary.mill?.totalProfitPkr || 0;
  const localProfitPkr = parseFloat(localSummary?.profit?.grossProfit) || 0;
  const consolidatedPkr = exportBookedProfitPkr + millProfitPkr + localProfitPkr;

  const exportColumns = [
    { key: 'orderNo', label: 'Order', sortable: true, render: (v, row) => (
      <Link to={`/export/${row.id}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline" onClick={e => e.stopPropagation()}>{v}</Link>
    )},
    { key: 'status', label: 'Status', sortable: true },
    { key: 'currency', label: 'Cur.', render: (v) => <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{v}</span> },
    { key: 'contractValueForeign', label: 'Contract (Foreign)', sortable: true, align: 'right', render: (v, row) => fmtUSD(v) },
    { key: 'bookedFxRate', label: 'Locked Rate', align: 'right', render: (v) => <span className="text-xs text-gray-500">{v}</span> },
    { key: 'revenuePkrBooked', label: 'Revenue (PKR)', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'totalCostPkr', label: 'Total Cost (PKR)', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'bookedProfitPkr', label: 'Booked Profit', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(v)}</span>
    )},
    { key: 'fxGainLossPkr', label: 'FX +/-', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-blue-600' : 'text-orange-600'}>{fmtPKR(v)}</span>
    )},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => v == null || isNaN(v) ? '—' : `${v}%`},
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  const millColumns = [
    { key: 'batchNo', label: 'Batch', sortable: true, render: (v, row) => (
      <Link to={`/milling/${row.id}`} className="text-blue-600 hover:text-blue-800 font-medium hover:underline" onClick={e => e.stopPropagation()}>{v}</Link>
    )},
    { key: 'status', label: 'Status', sortable: true },
    { key: 'rawQtyMT', label: 'Raw (MT)', sortable: true, align: 'right' },
    { key: 'finishedMT', label: 'Finished (MT)', sortable: true, align: 'right' },
    { key: 'revenue', label: 'Revenue (PKR)', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'costs', label: 'Costs (PKR)', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'grossProfit', label: 'Profit (PKR)', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(v)}</span>
    )},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => v == null || isNaN(v) ? '—' : `${v}%`},
    { key: 'priceSource', label: 'Price Source', render: (v) => (
      <span className={`text-xs px-1.5 py-0.5 rounded ${v === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : v === 'commodity_rates' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>{v || 'none'}</span>
    )},
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  // Chart data per tab. Consolidated rolls every segment into one bar
  // so the user sees totals side-by-side.
  const chartData = useMemo(() => {
    if (tab === 'Mill') {
      return millRows.filter(r => r.revenue > 0 || r.costs > 0).map(r => ({
        name: r.batchNo, Revenue: r.revenue, Cost: r.costs, Profit: r.grossProfit,
      }));
    }
    if (tab === 'Local') {
      return (localSales || [])
        .filter(s => parseFloat(s.totalAmount) > 0)
        .map(s => ({
          name: s.saleNo,
          Revenue: parseFloat(s.totalAmount) || 0,
          Cost:    parseFloat(s.cogsTotalPkr || s.landedCostTotal) || 0,
          Profit:  parseFloat(s.grossProfit || s.grossProfitPkr) || 0,
        }));
    }
    if (tab === 'Consolidated') {
      const exportTotals = exportRows.reduce((a, r) => ({
        Revenue: a.Revenue + (parseFloat(r.revenuePkrBooked) || 0),
        Cost:    a.Cost    + (parseFloat(r.totalCostPkr)     || 0),
        Profit:  a.Profit  + (parseFloat(r.bookedProfitPkr)  || 0),
      }), { Revenue: 0, Cost: 0, Profit: 0 });
      const millTotals = millRows.reduce((a, r) => ({
        Revenue: a.Revenue + (parseFloat(r.revenue)     || 0),
        Cost:    a.Cost    + (parseFloat(r.costs)       || 0),
        Profit:  a.Profit  + (parseFloat(r.grossProfit) || 0),
      }), { Revenue: 0, Cost: 0, Profit: 0 });
      const localTotals = (localSales || []).reduce((a, s) => ({
        Revenue: a.Revenue + (parseFloat(s.totalAmount)                       || 0),
        Cost:    a.Cost    + (parseFloat(s.cogsTotalPkr || s.landedCostTotal) || 0),
        Profit:  a.Profit  + (parseFloat(s.grossProfit || s.grossProfitPkr)   || 0),
      }), { Revenue: 0, Cost: 0, Profit: 0 });
      const data = [];
      if (exportTotals.Revenue || exportTotals.Cost) data.push({ name: 'Export', ...exportTotals });
      if (millTotals.Revenue   || millTotals.Cost)   data.push({ name: 'Mill',   ...millTotals });
      if (localTotals.Revenue  || localTotals.Cost)  data.push({ name: 'Local',  ...localTotals });
      return data;
    }
    return exportRows.filter(r => r.revenuePkrBooked > 0).map(r => ({
      name: r.orderNo, Revenue: r.revenuePkrBooked, Cost: r.totalCostPkr, Profit: r.bookedProfitPkr,
    }));
  }, [tab, exportRows, millRows, localSales]);

  const localColumns = [
    { key: 'saleNo', label: 'Sale', sortable: true, render: (v, row) => (
      <Link to={`/local-sales/${row.id}`} className="text-blue-600 hover:underline font-medium">{v}</Link>
    )},
    { key: 'saleDate', label: 'Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—' },
    { key: 'buyerName', label: 'Buyer', sortable: true, render: (v) => v || '—' },
    { key: 'itemName', label: 'Item', render: (v) => v || '—' },
    { key: 'quantityKg', label: 'Qty (kg)', sortable: true, align: 'right', render: (v) => Math.round(parseFloat(v) || 0).toLocaleString() },
    { key: 'totalAmount', label: 'Revenue', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'cogsTotalPkr', label: 'Cost', align: 'right', render: (v, row) => fmtPKR(v || row.landedCostTotal) },
    { key: 'grossProfit', label: 'Profit', sortable: true, align: 'right', render: (v, row) => {
      const n = parseFloat(v || row.grossProfitPkr) || 0;
      return <span className={n >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(n)}</span>;
    }},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => v == null || isNaN(parseFloat(v)) ? '—' : `${parseFloat(v).toFixed(1)}%` },
    { key: 'paymentStatus', label: 'Status', render: (v) => <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">{v || 'Pending'}</span> },
  ];

  const heroGradient = consolidatedPkr >= 0
    ? 'from-emerald-600 via-emerald-500 to-teal-500'
    : 'from-red-600 via-red-500 to-rose-500';
  const HeroIcon = consolidatedPkr >= 0 ? TrendingUp : TrendingDown;
  const totalRevenue = (summary.export?.totalRevenuePkr ?? exportRows.reduce((a, r) => a + (parseFloat(r.revenuePkrBooked) || 0), 0))
    + millRows.reduce((a, r) => a + (parseFloat(r.revenue) || 0), 0)
    + (parseFloat(localSummary?.profit?.revenue) || 0);
  const overallMargin = totalRevenue > 0 ? (consolidatedPkr / totalRevenue) * 100 : null;

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <HeroIcon size={14} /> Consolidated profit (Export + Mill + Local)
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPKR(consolidatedPkr)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              Export {fmtPKR(exportBookedProfitPkr)} · Mill {fmtPKR(millProfitPkr)} · Local {fmtPKR(localProfitPkr)}
              {exportFxGainLoss !== 0 && <> · FX {exportFxGainLoss >= 0 ? '+' : ''}{fmtPKR(exportFxGainLoss)}</>}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/30">
              <Activity size={12} /> Margin {overallMargin == null ? '—' : `${overallMargin.toFixed(1)}%`}
            </span>
            <div className="opacity-80 text-right">Base PKR · 1 USD = {currentFxRate}</div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <FinanceKPI icon={DollarSign} title="Export Profit" value={fmtPKR(exportBookedProfitPkr)}
          subtitle={`${exportRows.length} orders`} status={exportBookedProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={RefreshCw} title="FX Gain/Loss" value={fmtPKR(exportFxGainLoss)}
          subtitle="Current vs locked rate" status={exportFxGainLoss >= 0 ? 'good' : 'warning'} loading={isLoading} />
        <FinanceKPI icon={Factory} title="Mill Profit" value={fmtPKR(millProfitPkr)}
          subtitle={`${millRows.length} batches (PKR)`} status={millProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={Store} title="Local Profit" value={fmtPKR(localProfitPkr)}
          subtitle={`${localSales.length} sales`} status={localProfitPkr >= 0 ? 'good' : 'danger'} loading={localLoading} />
        <FinanceKPI icon={TrendingUp} title="Consolidated" value={fmtPKR(consolidatedPkr)}
          subtitle="Export + Mill + Local" status={consolidatedPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* View mode selector */}
      <div className="flex items-center gap-3">
        <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{t}</button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <FinanceChart title={`${tab} Profitability (PKR)`} type="bar" data={chartData} xKey="name" currency="Rs "
          series={[
            { key: 'Revenue', name: 'Revenue', color: '#3b82f6' },
            { key: 'Cost', name: 'Cost', color: '#f59e0b' },
            { key: 'Profit', name: 'Profit', color: '#10b981' },
          ]} height={250} loading={isLoading} />
      )}

      {/* Tables */}
      {(tab === 'Export' || tab === 'Consolidated') && (
        <FinanceTable title="Export Orders — PKR Base Profitability" columns={exportColumns} data={exportRows}
          searchKeys={['orderNo']} exportFilename="export-profitability-pkr" loading={isLoading} />
      )}
      {(tab === 'Mill' || tab === 'Consolidated') && (
        <FinanceTable title="Milling Batches — PKR" columns={millColumns} data={millRows}
          searchKeys={['batchNo']} exportFilename="mill-profitability-pkr" loading={isLoading} />
      )}
      {(tab === 'Local' || tab === 'Consolidated') && (
        <FinanceTable title="Local Sales — PKR" columns={localColumns} data={localSales}
          searchKeys={['saleNo', 'buyerName', 'itemName']} exportFilename="local-sales-profitability-pkr" loading={localLoading} />
      )}
    </div>
  );
}
