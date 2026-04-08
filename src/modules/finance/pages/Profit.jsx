import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, DollarSign, Package, Factory, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../components/finance';
import { useProfitabilitySummary } from '../../api/queries';

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const TABS = ['Export', 'Mill', 'Consolidated'];
const VIEW_MODES = ['Booked', 'Current FX', 'Both'];

function AccuracyBadge({ status }) {
  if (status === 'exact') return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full"><CheckCircle size={10} /> Exact</span>;
  if (status === 'estimated') return <span className="inline-flex items-center gap-0.5 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Est.</span>;
  if (status === 'operational_margin_only') return <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Op. Only</span>;
  if (status === 'missing_prices') return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Missing</span>;
  return <span className="text-xs text-gray-400">{status || '—'}</span>;
}

export default function Profit() {
  const { data: summary = {}, isLoading } = useProfitabilitySummary();
  const [tab, setTab] = useState('Export');
  const [viewMode, setViewMode] = useState('Booked');

  const exportRows = summary.export?.rows || [];
  const millRows = summary.mill?.rows || [];
  const currentFxRate = summary.currentFxRate || 280;

  // KPIs
  const exportBookedProfitPkr = summary.export?.totalBookedProfitPkr || 0;
  const exportFxGainLoss = summary.export?.totalFxGainLossPkr || 0;
  const millProfitPkr = summary.mill?.totalProfitPkr || 0;
  const consolidatedPkr = exportBookedProfitPkr + millProfitPkr;

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
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => `${v}%` },
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
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => `${v}%` },
    { key: 'priceSource', label: 'Price Source', render: (v) => (
      <span className={`text-xs px-1.5 py-0.5 rounded ${v === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : v === 'commodity_rates' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>{v || 'none'}</span>
    )},
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  // Chart data
  const chartData = useMemo(() => {
    if (tab === 'Mill') {
      return millRows.filter(r => r.revenue > 0 || r.costs > 0).map(r => ({
        name: r.batchNo, Revenue: r.revenue, Cost: r.costs, Profit: r.grossProfit,
      }));
    }
    return exportRows.filter(r => r.revenuePkrBooked > 0).map(r => ({
      name: r.orderNo, Revenue: r.revenuePkrBooked, Cost: r.totalCostPkr, Profit: r.bookedProfitPkr,
    }));
  }, [tab, exportRows, millRows]);

  return (
    <div className="space-y-6">
      {/* FX info bar */}
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Base: PKR</span>
        <span>Current rate: 1 USD = {currentFxRate} PKR</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={DollarSign} title="Export Booked Profit" value={fmtPKR(exportBookedProfitPkr)}
          subtitle={`${exportRows.length} orders`} status={exportBookedProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={RefreshCw} title="FX Gain/Loss" value={fmtPKR(exportFxGainLoss)}
          subtitle="Current vs locked rate" status={exportFxGainLoss >= 0 ? 'good' : 'warning'} loading={isLoading} />
        <FinanceKPI icon={Factory} title="Mill Profit" value={fmtPKR(millProfitPkr)}
          subtitle={`${millRows.length} batches (PKR)`} status={millProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Consolidated" value={fmtPKR(consolidatedPkr)}
          subtitle="Export + Mill" status={consolidatedPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* Tab + view mode selectors */}
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
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
    </div>
  );
}
