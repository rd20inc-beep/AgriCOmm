import { useState, useMemo } from 'react';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import { TrendingUp, TrendingDown, DollarSign, Factory, Store, AlertTriangle, CheckCircle, RefreshCw, Activity, Printer } from 'lucide-react';
import { FinanceKPI, FinanceTable, FinanceChart } from '../../../components/finance';
import { useProfitabilitySummary, useLocalSales } from '../../../api/queries';
import { useFinanceDateRange, overviewSummaryParams } from '../hooks/useFinanceDateRange';
import { rangeLabel } from '../financeNav';
import { DEFAULT_FX_RATE } from '../utils/fx';
import { useApp } from '../../../context/AppContext';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtPKR, fmtMoney, fmtPct, fmtDate, fmtDateTime, fmtKg } from '../../../shared/utils/format';

const TABS = ['Export', 'Mill', 'Local', 'Consolidated'];

const RICE_BASIS = {
  locked: 'locked COGS',
  reserved: 'reserved lots',
  'reserved+estimate': 'reserved + estimate',
  allocated: 'allocated',
  estimate: 'estimate',
  unpriced: 'not costed',
};

function AccuracyBadge({ status }) {
  if (status === 'exact') return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full"><CheckCircle size={10} /> Exact</span>;
  if (status === 'estimated') return <span className="inline-flex items-center gap-0.5 text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Est.</span>;
  if (status === 'operational_margin_only') return <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Op. Only</span>;
  if (status === 'unpriced') return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full" title="No rice cost locked, reserved, allocated or estimable — left out of Booked Profit"><AlertTriangle size={10} /> Not costed</span>;
  if (status === 'missing_prices') return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full"><AlertTriangle size={10} /> Missing</span>;
  return <span className="text-xs text-gray-400">{status || '—'}</span>;
}

export default function Profit() {
  const { companyProfileData } = useApp();
  // Every figure here is the server's one profit definition
  // (backend finance/profitDefinitions.js), for the period in the URL.
  const { queryParams: rangeParams, rangeKey } = useFinanceDateRange();
  const periodLabel = rangeKey ? rangeLabel(rangeKey) : 'All time';
  const { data: summary = {}, isLoading } = useProfitabilitySummary(overviewSummaryParams(rangeParams));
  const { data: localSales = [], isLoading: localLoading } = useLocalSales();
  const [tab, setTab] = useState('Export');

  function handlePrint() {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  const exportRows = summary.export?.rows || [];
  const millRows = summary.mill?.rows || [];
  const currentFxRate = summary.currentFxRate || DEFAULT_FX_RATE;

  // KPIs — Booked / Realised / Pipeline / FX (export), mill realised (sales of
  // mill output − their COGS), local other, consolidated. PKR.
  const exp = summary.export || {};
  const exportBookedProfitPkr = exp.bookedPkr || 0;
  const exportRealisedPkr = exp.realisedPkr || 0;
  const exportPipelinePkr = exp.pipelinePkr || 0;
  const exportFxGainLoss = exp.fxRealisedPkr || 0;
  const millProfitPkr = summary.mill?.profitPkr || 0;
  const localProfitPkr = summary.local?.profitPkr || 0;
  const consolidatedPkr = summary.consolidated?.bookedPkr || 0;
  const consolidatedRealisedPkr = summary.consolidated?.realisedPkr || 0;

  const exportColumns = [
    { key: 'orderNo', label: 'Order', sortable: true, render: (v, row) => (
      <OrderRefLink to={`/export/${row.id}`} module="export_orders" onClick={e => e.stopPropagation()}>{v}</OrderRefLink>
    )},
    { key: 'status', label: 'Status', sortable: true, render: (v) => (v ? <StatusBadge status={v} /> : '—') },
    { key: 'currency', label: 'Cur.', render: (v) => <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{v}</span> },
    { key: 'contractValueForeign', label: 'Contract (Foreign)', sortable: true, align: 'right', render: (v, row) => fmtMoney(v, row.currency || 'USD') },
    { key: 'bookedFxRate', label: 'Locked Rate', align: 'right', render: (v) => <span className="text-xs text-gray-500">{v}</span> },
    { key: 'revenuePkrBooked', label: 'Revenue (PKR)', sortable: true, align: 'right', render: (v) => (v == null ? '—' : fmtPKR(v)) },
    { key: 'opCostsPkr', label: 'Op. Costs', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'riceCostPkr', label: 'Rice Cost', sortable: true, align: 'right', render: (v, row) => (
      <span className="inline-flex flex-col items-end">
        <span>{v == null ? '—' : fmtPKR(v)}</span>
        <span className="text-[10px] text-gray-400">{RICE_BASIS[row.riceCostBasis] || row.riceCostBasis}</span>
      </span>
    )},
    { key: 'bookedProfitPkr', label: 'Booked Profit', sortable: true, align: 'right', render: (v) => (
      v == null ? <span className="text-gray-400">excluded</span>
        : <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(v)}</span>
    )},
    { key: 'realisedProfitPkr', label: 'Realised', sortable: true, align: 'right', render: (v) => (v == null ? '—' : fmtPKR(v)) },
    { key: 'fxGainLossPkr', label: 'FX realised', sortable: true, align: 'right', render: (v) => (
      <span className={v >= 0 ? 'text-blue-600' : 'text-amber-600'}>{fmtPKR(v)}</span>
    )},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => (v == null ? '—' : fmtPct(v, { decimals: 2 }))},
    { key: 'calculationStatus', label: 'Accuracy', render: (v) => <AccuracyBadge status={v} /> },
  ];

  // Per batch (information): output at cost, what has been sold so far
  // (local sales + transfers to export, to date) and what is still stock.
  const millColumns = [
    { key: 'batchNo', label: 'Batch', sortable: true, render: (v, row) => (
      <OrderRefLink to={`/milling/${row.id}`} module="milling" onClick={e => e.stopPropagation()}>{v}</OrderRefLink>
    )},
    { key: 'rawQtyMT', label: 'Raw (MT)', sortable: true, align: 'right' },
    { key: 'outputKg', label: 'Output (kg)', sortable: true, align: 'right', render: (v) => fmtKg(v || 0) },
    { key: 'outputValueAtCostPkr', label: 'Output at cost', sortable: true, align: 'right', render: (v, row) => (row.hasOutputLots ? fmtPKR(v) : <span className="text-gray-400" title="No output lots booked for this batch">—</span>) },
    { key: 'soldKg', label: 'Sold (kg)', sortable: true, align: 'right', render: (v) => fmtKg(v || 0) },
    { key: 'soldRevenuePkr', label: 'Sales', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'soldCogsPkr', label: 'COGS', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'soldProfitPkr', label: 'Profit on sales', sortable: true, align: 'right', render: (v, row) => (
      <span className={v >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
        {fmtPKR(v)}{row.uncostedSales > 0 && <span className="block text-[10px] text-amber-700">{row.uncostedSales} sale(s) without COGS</span>}
      </span>
    )},
    { key: 'unsoldKg', label: 'Unsold (kg)', sortable: true, align: 'right', render: (v) => fmtKg(v || 0) },
    { key: 'unsoldValueAtCostPkr', label: 'Unsold stock at cost', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
  ];

  // Chart data per tab. Consolidated rolls every segment into one bar
  // so the user sees totals side-by-side.
  const chartData = useMemo(() => {
    if (tab === 'Mill') {
      return millRows.filter(r => r.soldRevenuePkr > 0 || r.soldCogsPkr > 0).map(r => ({
        name: r.batchNo, Revenue: r.soldRevenuePkr, Cost: r.soldCogsPkr, Profit: r.soldProfitPkr,
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
      // Server totals: export Booked, mill realised, local other — each sale once.
      const data = [];
      const e = summary.export || {}; const m = summary.mill || {}; const l = summary.local || {};
      if (e.bookedRevenuePkr) data.push({ name: 'Export (booked)', Revenue: e.bookedRevenuePkr, Cost: (e.bookedRevenuePkr || 0) - (e.bookedPkr || 0), Profit: e.bookedPkr || 0 });
      if (m.revenuePkr || m.cogsPkr) data.push({ name: 'Mill (sales)', Revenue: m.revenuePkr || 0, Cost: m.cogsPkr || 0, Profit: m.profitPkr || 0 });
      if (l.revenuePkr || l.cogsPkr) data.push({ name: 'Local (other)', Revenue: l.revenuePkr || 0, Cost: l.cogsPkr || 0, Profit: l.profitPkr || 0 });
      return data;
    }
    return exportRows.filter(r => r.priced && r.revenuePkrBooked > 0).map(r => ({
      name: r.orderNo, Revenue: r.revenuePkrBooked, Cost: r.totalCostPkr, Profit: r.bookedProfitPkr,
    }));
  }, [tab, exportRows, millRows, localSales, summary]);

  const localColumns = [
    { key: 'saleNo', label: 'Sale', sortable: true, render: (v, row) => (
      <OrderRefLink to={`/local-sales/${row.id}`} module="inventory" className="text-blue-600 hover:underline font-medium">{v}</OrderRefLink>
    )},
    { key: 'saleDate', label: 'Date', sortable: true, render: (v) => fmtDate(v) },
    { key: 'buyerName', label: 'Buyer', sortable: true, render: (v) => <span className="block max-w-[220px] truncate" title={v || ''}>{v || '—'}</span> },
    { key: 'itemName', label: 'Item', render: (v) => v || '—' },
    { key: 'quantityKg', label: 'Qty (kg)', sortable: true, align: 'right', render: (v) => fmtKg(parseFloat(v) || 0) },
    { key: 'totalAmount', label: 'Revenue', sortable: true, align: 'right', render: (v) => fmtPKR(v) },
    { key: 'cogsTotalPkr', label: 'Cost', align: 'right', render: (v, row) => fmtPKR(v || row.landedCostTotal) },
    { key: 'grossProfit', label: 'Profit', sortable: true, align: 'right', render: (v, row) => {
      const n = parseFloat(v || row.grossProfitPkr) || 0;
      return <span className={n >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{fmtPKR(n)}</span>;
    }},
    { key: 'marginPct', label: 'Margin', sortable: true, align: 'right', render: (v) => fmtPct(v) },
    { key: 'paymentStatus', label: 'Status', render: (v) => <StatusBadge status={v || 'Pending'} /> },
  ];

  const heroGradient = consolidatedPkr >= 0
    ? 'from-emerald-600 via-emerald-500 to-teal-500'
    : 'from-red-600 via-red-500 to-red-500';
  const HeroIcon = consolidatedPkr >= 0 ? TrendingUp : TrendingDown;
  const totalRevenue = (exp.bookedRevenuePkr || 0)
    + (summary.mill?.revenuePkr || 0)
    + (summary.local?.revenuePkr || 0);
  const overallMargin = totalRevenue > 0 ? (consolidatedPkr / totalRevenue) * 100 : null;

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  return (
    <div className="space-y-5 pb-4">
      <div className="print-report space-y-5">
        {/* Print-only header */}
        <div className="hidden print:block">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between mb-4">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
              <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Profitability — {tab}</div>
              <div className="text-xs text-gray-600">
                Consolidated {fmtPKR(consolidatedPkr)} · Margin {fmtPct(overallMargin)} · 1 USD = {currentFxRate}
              </div>
            </div>
          </div>
        </div>

      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className={`rounded-2xl bg-gradient-to-r ${heroGradient} p-5 sm:p-6 text-white shadow-sm relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <HeroIcon size={14} /> Consolidated profit (export booked + mill realised + local other) · {periodLabel}
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {fmtPKR(consolidatedPkr)}
            </div>
            <div className="text-xs opacity-90 mt-1">
              Export {fmtPKR(exportBookedProfitPkr)} · Mill {fmtPKR(millProfitPkr)} · Local {fmtPKR(localProfitPkr)}
              {exportFxGainLoss !== 0 && <> · FX realised {exportFxGainLoss >= 0 ? '+' : ''}{fmtPKR(exportFxGainLoss)} (not included)</>}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">
              Realised basis {fmtPKR(consolidatedRealisedPkr)}
              {(exp.unpricedCount || 0) > 0 && <> · {exp.unpricedCount} export order{exp.unpricedCount === 1 ? '' : 's'} not costed yet ({fmtPKR(exp.unpricedRevenuePkr || 0)} contract) — excluded</>}
              {(exp.estimatedCount || 0) > 0 && <> · {exp.estimatedCount} estimated</>}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/30">
              <Activity size={12} /> Margin {fmtPct(overallMargin)}
            </span>
            <div className="opacity-80 text-right">Base PKR · 1 USD = {currentFxRate}</div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <FinanceKPI icon={DollarSign} title="Export Booked" value={fmtPKR(exportBookedProfitPkr)}
          subtitle={`${exp.pricedCount || 0} confirmed orders costed${(exp.unpricedCount || 0) > 0 ? ` · ${exp.unpricedCount} excluded` : ''}`} status={exportBookedProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={CheckCircle} title="Export Realised" value={fmtPKR(exportRealisedPkr)}
          subtitle={`${exp.realisedCount || 0} shipped · locked COGS`} status={exportRealisedPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={Activity} title="Export Pipeline" value={fmtPKR(exportPipelinePkr)}
          subtitle="Booked − Realised" status={exportPipelinePkr >= 0 ? 'good' : 'warning'} loading={isLoading} />
        <FinanceKPI icon={RefreshCw} title="FX Realised" value={fmtPKR(exportFxGainLoss)}
          subtitle="PKR received vs booked rate" status={exportFxGainLoss >= 0 ? 'good' : 'warning'} loading={isLoading} />
        <FinanceKPI icon={Factory} title="Mill Realised" value={fmtPKR(millProfitPkr)}
          subtitle="Sales of mill output − COGS" status={millProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={Store} title="Local (other)" value={fmtPKR(localProfitPkr)}
          subtitle={`${summary.local?.saleCount || 0} non-mill sales`} status={localProfitPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
        <FinanceKPI icon={TrendingUp} title="Consolidated" value={fmtPKR(consolidatedPkr)}
          subtitle={`Booked · realised ${fmtPKR(consolidatedRealisedPkr)}`} status={consolidatedPkr >= 0 ? 'good' : 'danger'} loading={isLoading} />
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
        <FinanceTable title="Milling Batches — output, sold so far and unsold stock (PKR)" columns={millColumns} data={millRows}
          searchKeys={['batchNo']} exportFilename="mill-profitability-pkr" loading={isLoading} />
      )}
      {(tab === 'Local' || tab === 'Consolidated') && (
        <FinanceTable title="Local Sales — PKR (all; sales of mill output count in Mill profit)" columns={localColumns} data={localSales}
          searchKeys={['saleNo', 'buyerName', 'itemName']} exportFilename="local-sales-profitability-pkr" loading={localLoading} />
      )}
      </div>{/* /.print-report */}
    </div>
  );
}
