import { useState, useMemo } from 'react';
import { TrendingUp, DollarSign, Package, Factory, AlertTriangle, CheckCircle } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../components/finance';
import { useProfitabilitySummary } from '../../api/queries';

function fmt(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}

const TABS = ['Export', 'Mill', 'Consolidated'];

export default function Profit() {
  const { data: summary = {}, isLoading } = useProfitabilitySummary();
  const [tab, setTab] = useState('Export');

  const pkrRate = summary.pkrRate || 280;
  const exportRows = summary.export?.rows || [];
  const millRows = summary.mill?.rows || [];

  // KPIs
  const exportRevenue = exportRows.reduce((s, r) => s + (r.contractValue || 0), 0);
  const exportCost = exportRows.reduce((s, r) => s + (r.totalCost || 0), 0);
  const exportProfit = summary.export?.totalProfit || 0;
  const millProfit = summary.mill?.totalProfit || 0;
  const millRevenue = millRows.reduce((s, r) => s + (r.revenue || 0), 0);
  const combinedProfit = exportProfit + (millProfit / pkrRate);

  // Accuracy badge
  function AccuracyBadge({ status }) {
    if (status === 'exact') return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full"><CheckCircle size={10} /> Exact</span>;
    if (status === 'missing_prices') return <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Est.</span>;
    return <span className="inline-flex items-center gap-0.5 text-xs text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full">Partial</span>;
  }

  const exportColumns = [
    { key: 'orderNo', label: 'Order', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'contractValue', label: 'Revenue', sortable: true, align: 'right', render: (v) => fmt(v) },
    { key: 'operationalCosts', label: 'Op. Costs', sortable: true, align: 'right', render: (v) => fmt(v) },
    { key: 'inventoryCOGS', label: 'COGS', sortable: true, align: 'right', render: (v) => v > 0 ? fmt(v) : <span className="text-gray-400">—</span> },
    { key: 'grossProfit', label: 'Profit', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmt(v)}</span>
    )},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => `${v}%` },
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  const millColumns = [
    { key: 'batchNo', label: 'Batch', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'rawQtyMT', label: 'Raw (MT)', sortable: true, align: 'right' },
    { key: 'finishedMT', label: 'Finished (MT)', sortable: true, align: 'right' },
    { key: 'revenue', label: 'Revenue', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'costs', label: 'Costs', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'grossProfit', label: 'Profit', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(v)}</span>
    )},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => `${v}%` },
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  // Profit chart data
  const profitChartData = useMemo(() => {
    if (tab === 'Export' || tab === 'Consolidated') {
      return exportRows.filter(r => r.contractValue > 0).map(r => ({
        name: r.orderNo, Revenue: r.contractValue, Cost: r.totalCost, Profit: r.grossProfit,
      }));
    }
    return millRows.filter(r => r.revenue > 0).map(r => ({
      name: r.batchNo, Revenue: r.revenue, Cost: r.costs, Profit: r.grossProfit,
    }));
  }, [tab, exportRows, millRows]);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={DollarSign} title="Export Revenue" value={fmt(exportRevenue)}
          subtitle={`${exportRows.length} orders`} status="info" loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Export Profit" value={fmt(exportProfit)}
          status={exportProfit >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={Factory} title="Mill Profit" value={fmtPKR(millProfit)}
          subtitle={`${millRows.length} batches`} status={millProfit >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Combined Profit" value={fmt(combinedProfit)}
          subtitle="USD equivalent" status={combinedProfit >= 0 ? 'good' : 'danger'} loading={isLoading} />
      </div>

      {/* Tab selector */}
      <div className="flex bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}</button>
        ))}
      </div>

      {/* Profit chart */}
      {profitChartData.length > 0 && (
        <FinanceChart
          title={`${tab} Profitability`}
          type="bar" data={profitChartData} xKey="name"
          currency={tab === 'Mill' ? 'Rs ' : '$'}
          series={[
            { key: 'Revenue', name: 'Revenue', color: '#3b82f6' },
            { key: 'Cost', name: 'Cost', color: '#f59e0b' },
            { key: 'Profit', name: 'Profit', color: '#10b981' },
          ]}
          height={250} loading={isLoading}
        />
      )}

      {/* Table */}
      {(tab === 'Export' || tab === 'Consolidated') && (
        <FinanceTable title="Export Orders" columns={exportColumns} data={exportRows}
          searchKeys={['orderNo']} exportFilename="export-profitability" loading={isLoading} />
      )}
      {(tab === 'Mill' || tab === 'Consolidated') && (
        <FinanceTable title="Milling Batches" columns={millColumns} data={millRows}
          searchKeys={['batchNo']} exportFilename="mill-profitability" loading={isLoading} />
      )}
    </div>
  );
}
