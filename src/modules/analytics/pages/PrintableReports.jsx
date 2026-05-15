import { useState, useEffect, useMemo, useCallback } from 'react';
import { Printer, RefreshCw, Calendar, Factory, Boxes, TrendingUp, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';

// ─── Period helpers ────────────────────────────────────────────────────
// Each preset returns ISO strings for { from, to } and a label for
// the printed header. The user can also pick "custom" and edit dates.
function presetRange(preset) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  switch (preset) {
    case 'daily': {
      return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
    }
    case 'weekly': {
      // Monday-start week.
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: startOfDay(monday), to: endOfDay(sunday), label: 'This Week' };
    }
    case 'monthly': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: startOfDay(first), to: endOfDay(last), label: 'This Month' };
    }
    default:
      return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
  }
}

function fmtMt(v) {
  return (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtKg(v) {
  return (parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPkr(v) {
  return 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPct(v) {
  const n = parseFloat(v) || 0;
  return n.toFixed(1) + '%';
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

const STOCK_GROUP_OPTIONS = [
  { key: 'product',   label: 'By Product' },
  { key: 'supplier',  label: 'By Supplier' },
  { key: 'warehouse', label: 'By Warehouse' },
  { key: 'variety',   label: 'By Variety' },
  { key: 'type',      label: 'By Type' },
];

export default function PrintableReports() {
  const { addToast, companyProfileData } = useApp();

  const [reportType, setReportType] = useState('production'); // 'production' | 'stock' | 'pnl' | 'cashflow' | 'ar_aging' | 'ap_aging'
  const [preset, setPreset] = useState('monthly');
  const [stockGroupBy, setStockGroupBy] = useState('product');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Period-based reports use the period selector; snapshot reports
  // (stock + AR/AP aging) ignore it.
  const usesPeriod = reportType === 'production' || reportType === 'pnl' || reportType === 'cashflow';

  const range = useMemo(() => {
    if (preset === 'custom' && customFrom && customTo) {
      return {
        from: new Date(customFrom),
        to: new Date(customTo + 'T23:59:59'),
        label: `${customFrom} to ${customTo}`,
      };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      let res;
      const periodParams = { from: range.from.toISOString(), to: range.to.toISOString() };
      if (reportType === 'production') {
        res = await api.get('/api/reporting/printable/production', periodParams);
      } else if (reportType === 'pnl') {
        res = await api.get('/api/reporting/printable/pnl', periodParams);
      } else if (reportType === 'cashflow') {
        res = await api.get('/api/reporting/printable/cashflow', periodParams);
      } else if (reportType === 'ar_aging') {
        res = await api.get('/api/reporting/printable/ar-aging');
      } else if (reportType === 'ap_aging') {
        res = await api.get('/api/reporting/printable/ap-aging');
      } else {
        res = await api.get('/api/reporting/printable/stock', { group_by: stockGroupBy });
      }
      setData(res?.data || res);
    } catch (err) {
      addToast(err.message || 'Failed to load report', 'error');
    } finally {
      setLoading(false);
    }
  }, [reportType, range, stockGroupBy, addToast]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // Pop the printable subtree into a fresh window with only the page
  // styles we need. The main app's `flex h-screen overflow-hidden` shell
  // and scrolling `<main>` keep stomping our `@media print` overrides —
  // printing from a clean document avoids the fight entirely.
  const handlePrint = () => {
    const src = document.querySelector('.printable-area');
    if (!src) return;
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) {
      addToast('Pop-up blocked — please allow pop-ups to print.', 'error');
      return;
    }
    // Copy the page's stylesheets so Tailwind utility classes resolve
    // inside the new window. We pull <link rel="stylesheet"> hrefs and
    // <style> blocks from the current document.
    const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(n => n.outerHTML)
      .join('\n');
    win.document.open();
    win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>AgriCOmm Report</title>
${styleTags}
<style>
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: white; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; }
  .print-report h2 { page-break-after: avoid; }
  .print-report tr { page-break-inside: avoid; }
  .print-report table { page-break-inside: auto; width: 100%; border-collapse: collapse; }
  .print-report th, .print-report td { padding: 6px 10px; }
  .print-report thead { background: #f3f4f6; }
</style>
</head>
<body>
${src.outerHTML}
<script>
  window.onload = function () {
    setTimeout(function () { window.focus(); window.print(); }, 250);
    window.onafterprint = function () { window.close(); };
  };
</script>
</body>
</html>`);
    win.document.close();
  };

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  return (
    <div className="space-y-6">
      {/* Toolbar — hidden when printing */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 flex-wrap">
            {[
              { k: 'production', l: 'Production', i: Factory },
              { k: 'stock',      l: 'Stock',      i: Boxes },
              { k: 'pnl',        l: 'P&L',        i: TrendingUp },
              { k: 'cashflow',   l: 'Cashflow',   i: Wallet },
              { k: 'ar_aging',   l: 'AR Aging',   i: ArrowDownLeft },
              { k: 'ap_aging',   l: 'AP Aging',   i: ArrowUpRight },
            ].map(({ k, l, i: Ic }) => (
              <button key={k} onClick={() => setReportType(k)}
                className={`px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5 ${reportType === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                <Ic className="w-4 h-4" /> {l}
              </button>
            ))}
          </div>

          {usesPeriod && (
            <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
              {[
                { k: 'daily', l: 'Daily' },
                { k: 'weekly', l: 'Weekly' },
                { k: 'monthly', l: 'Monthly' },
                { k: 'custom', l: 'Custom' },
              ].map(o => (
                <button
                  key={o.k}
                  onClick={() => setPreset(o.k)}
                  className={`px-3 py-2 text-sm font-medium ${preset === o.k ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          )}

          {usesPeriod && preset === 'custom' && (
            <div className="inline-flex items-center gap-2 text-sm">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5" />
              <span className="text-gray-400">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5" />
            </div>
          )}

          {reportType === 'stock' && (
            <select
              value={stockGroupBy}
              onChange={e => setStockGroupBy(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {STOCK_GROUP_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          )}

          <div className="ml-auto inline-flex items-center gap-2">
            <button
              onClick={loadReport}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              onClick={handlePrint}
              disabled={!data}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>
      </div>

      {/* Printable area */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 print:shadow-none print:border-0 print:rounded-none print:p-0 printable-area">
        {loading || !data ? (
          <div className="text-center text-gray-400 py-12">Loading report…</div>
        ) : reportType === 'production' && data.summary && data.batches ? (
          <ProductionReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'stock' && data.grand && data.rows ? (
          <StockReportView data={data} companyName={companyName} groupLabel={STOCK_GROUP_OPTIONS.find(o => o.key === stockGroupBy)?.label} />
        ) : reportType === 'pnl' && data.revenue && data.costs ? (
          <PnlReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'cashflow' && data.summary ? (
          <CashflowReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'ar_aging' && data.buckets ? (
          <AgingReportView data={data} companyName={companyName} kind="receivable" />
        ) : reportType === 'ap_aging' && data.buckets ? (
          <AgingReportView data={data} companyName={companyName} kind="payable" />
        ) : (
          <div className="text-center text-gray-400 py-12">No data.</div>
        )}
      </div>

    </div>
  );
}

// ─── Production report view ────────────────────────────────────────────
function ProductionReportView({ data, companyName, range, preset }) {
  const { summary, byMill, byProduct, batches } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} Production Report`} subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />

      <SummaryRow items={[
        { label: 'Batches', value: summary.batchCount },
        { label: 'Completed', value: summary.completed },
        { label: 'Raw Input', value: `${fmtMt(summary.rawMt)} MT` },
        { label: 'Finished', value: `${fmtMt(summary.finishedMt)} MT` },
        { label: 'Avg Yield', value: fmtPct(summary.avgYieldPct) },
      ]} />

      <Section title="By Mill">
        <Table
          head={['Mill', 'Batches', 'Raw MT', 'Finished MT', 'Yield %']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={byMill.map(r => [r.name, r.batchCount, fmtMt(r.rawMt), fmtMt(r.finishedMt), fmtPct(r.yieldPct)])}
          empty="No production this period."
        />
      </Section>

      <Section title="By Product">
        <Table
          head={['Product', 'Batches', 'Raw MT', 'Finished MT', 'Yield %']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={byProduct.map(r => [r.name, r.batchCount, fmtMt(r.rawMt), fmtMt(r.finishedMt), fmtPct(r.yieldPct)])}
          empty="No production this period."
        />
      </Section>

      <Section title="Batch Detail">
        <Table
          head={['Batch No', 'Mill', 'Supplier', 'Product', 'Status', 'Raw MT', 'Finished MT', 'Yield %', 'Created']}
          align={['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'left']}
          rows={batches.map(b => [
            b.batchNo, b.millName || '—', b.supplierName || '—', b.productName || '—',
            b.status, fmtMt(b.rawMt), fmtMt(b.finishedMt), fmtPct(b.yieldPct), fmtDate(b.createdAt),
          ])}
          empty="No batches in this period."
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Stock report view ─────────────────────────────────────────────────
function StockReportView({ data, companyName, groupLabel }) {
  const { rows, grand, asOf } = data;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Stock Report" subtitle={`As of ${new Date(asOf).toLocaleString()} · ${groupLabel || ''}`} />

      <SummaryRow items={[
        { label: 'Lots', value: grand.lotCount },
        { label: 'Total', value: `${fmtKg(grand.totalKg)} kg` },
        { label: 'Available', value: `${fmtKg(grand.availableKg)} kg` },
        { label: 'Reserved', value: `${fmtKg(grand.reservedKg)} kg` },
        { label: 'Value', value: fmtPkr(grand.valuePkr) },
      ]} />

      <Section title="Stock Breakdown">
        <Table
          head={[groupLabel || 'Group', 'Lots', 'Total (kg)', 'Available (kg)', 'Reserved (kg)', 'Value (PKR)']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={rows.map(r => [
            r.name, r.lotCount, fmtKg(r.totalKg), fmtKg(r.availableKg), fmtKg(r.reservedKg), fmtPkr(r.valuePkr),
          ])}
          empty="No stock to report."
          totalRow={['TOTAL', grand.lotCount, fmtKg(grand.totalKg), fmtKg(grand.availableKg), fmtKg(grand.reservedKg), fmtPkr(grand.valuePkr)]}
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Profit & Loss report view ─────────────────────────────────────────
function PnlReportView({ data, companyName, range, preset }) {
  const { revenue, costs, netProfitPkr, marginPct } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} P&L`} subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
      <SummaryRow items={[
        { label: 'Revenue', value: fmtPkr(revenue.totalPkr) },
        { label: 'Total Costs', value: fmtPkr(costs.totalPkr) },
        { label: 'Net Profit', value: fmtPkr(netProfitPkr) },
        { label: 'Margin', value: `${(marginPct || 0).toFixed(1)}%` },
        { label: 'Mill Output', value: `${fmtMt(revenue.millFinishedMt)} MT` },
      ]} />
      <Section title="Revenue Breakdown">
        <Table
          head={['Stream', 'Count', 'Amount (PKR)']}
          align={['left', 'right', 'right']}
          rows={[
            ['Export Orders (shipped/closed)', revenue.exportCount, fmtPkr(revenue.exportPkr)],
            ['Local Sales (completed)',        revenue.localCount,  fmtPkr(revenue.localPkr)],
            ['Mill batches completed',         revenue.millBatchCount, `${fmtMt(revenue.millFinishedMt)} MT`],
          ]}
          totalRow={['TOTAL', revenue.exportCount + revenue.localCount, fmtPkr(revenue.totalPkr)]}
          empty="No revenue in this period."
        />
      </Section>
      <Section title="Cost Breakdown">
        <Table
          head={['Category', 'Count', 'Amount (PKR)']}
          align={['left', 'right', 'right']}
          rows={[
            ['Raw rice purchases (landed)', costs.rawRiceCount,           fmtPkr(costs.rawRicePkr)],
            ['Mill store consumables',      costs.millStoreCount,          fmtPkr(costs.millStorePkr)],
            ['Export operational costs',    costs.exportOpCostsCount,      fmtPkr(costs.exportOpCostsPkr)],
            ['Business expenses',           costs.businessExpensesCount,   fmtPkr(costs.businessExpensesPkr)],
          ]}
          totalRow={['TOTAL', costs.rawRiceCount + costs.millStoreCount + costs.exportOpCostsCount + costs.businessExpensesCount, fmtPkr(costs.totalPkr)]}
          empty="No costs in this period."
        />
      </Section>
      <Section title="Bottom Line">
        <Table
          head={['Line', 'Amount (PKR)']}
          align={['left', 'right']}
          rows={[
            ['Revenue',          fmtPkr(revenue.totalPkr)],
            ['Less: Costs',      `(${fmtPkr(costs.totalPkr)})`],
            ['Net Profit (PKR)', fmtPkr(netProfitPkr)],
            ['Margin %',         `${(marginPct || 0).toFixed(1)}%`],
          ]}
          empty=""
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Cashflow report view ──────────────────────────────────────────────
function CashflowReportView({ data, companyName, range, preset }) {
  const { summary, daily, topReceipts, topPayments } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} Cashflow`} subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
      <SummaryRow items={[
        { label: 'Money In', value: fmtPkr(summary.inPkr) },
        { label: 'Money Out', value: fmtPkr(summary.outPkr) },
        { label: 'Net Cashflow', value: fmtPkr(summary.netPkr) },
        { label: 'Receipts', value: summary.inCount },
        { label: 'Payments', value: summary.outCount },
      ]} />
      <Section title="Daily Movement">
        <Table
          head={['Date', 'In (PKR)', 'Out (PKR)', 'Net (PKR)']}
          align={['left', 'right', 'right', 'right']}
          rows={(daily || []).map(d => [d.day, fmtPkr(d.In), fmtPkr(d.Out), fmtPkr(d.Net)])}
          empty="No payments recorded in this period."
        />
      </Section>
      {(topReceipts || []).length > 0 && (
        <Section title="Top Receipts">
          <Table
            head={['Payment', 'Date', 'Counterparty', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topReceipts.map(r => [r.paymentNo, fmtDate(r.date), r.counterparty, r.method || '—', fmtPkr(r.amountPkr)])}
            empty=""
          />
        </Section>
      )}
      {(topPayments || []).length > 0 && (
        <Section title="Top Payments">
          <Table
            head={['Payment', 'Date', 'Counterparty', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topPayments.map(r => [r.paymentNo, fmtDate(r.date), r.counterparty, r.method || '—', fmtPkr(r.amountPkr)])}
            empty=""
          />
        </Section>
      )}
      <Footer />
    </div>
  );
}

// ─── Aging report view (AR or AP) ──────────────────────────────────────
function AgingReportView({ data, companyName, kind }) {
  const { asOf, buckets, totalPkr, rows } = data;
  const isAR = kind === 'receivable';
  const title = isAR ? 'Accounts Receivable Aging' : 'Accounts Payable Aging';
  const BUCKETS = ['0-30', '31-60', '61-90', '90+'];
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={title} subtitle={`As of ${new Date(asOf).toLocaleString()}`} />
      <SummaryRow items={[
        ...BUCKETS.map(b => ({ label: `${b} days`, value: fmtPkr(buckets[b]?.totalPkr || 0) })),
        { label: 'Total Outstanding', value: fmtPkr(totalPkr) },
      ]} />
      <Section title="By Bucket">
        <Table
          head={['Bucket', 'Count', 'Outstanding (PKR)', '% of Total']}
          align={['left', 'right', 'right', 'right']}
          rows={BUCKETS.map(b => [
            `${b} days`,
            buckets[b]?.count || 0,
            fmtPkr(buckets[b]?.totalPkr || 0),
            totalPkr > 0 ? `${((buckets[b]?.totalPkr || 0) / totalPkr * 100).toFixed(1)}%` : '—',
          ])}
          totalRow={['TOTAL', rows.length, fmtPkr(totalPkr), '100%']}
          empty="No open balances."
        />
      </Section>
      <Section title={isAR ? 'Open Receivables (oldest first)' : 'Open Payables (oldest first)'}>
        <Table
          head={[
            isAR ? 'Receivable' : 'Payable',
            'Counterparty',
            'Due',
            'Days',
            'Bucket',
            'Outstanding (PKR)',
          ]}
          align={['left', 'left', 'left', 'right', 'left', 'right']}
          rows={rows.map(r => [
            isAR ? r.recvNo : r.payableNo,
            r.counterparty,
            r.dueDate ? fmtDate(r.dueDate) : '—',
            r.ageDays,
            r.bucket,
            fmtPkr(r.outstandingPkr),
          ])}
          empty="No open balances."
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Shared print blocks ───────────────────────────────────────────────
function Header({ companyName, title, subtitle }) {
  return (
    <div className="border-b-2 border-gray-900 pb-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
          <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold">{title}</h1>
          <div className="text-xs text-gray-600">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ items }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {items.map((it, i) => (
        <div key={i} className="border border-gray-200 rounded p-3">
          <div className="text-[11px] text-gray-500 uppercase">{it.label}</div>
          <div className="text-base font-semibold text-gray-900 mt-1">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2 border-b border-gray-200 pb-1">{title}</h2>
      {children}
    </div>
  );
}

function Table({ head, align = [], rows, empty, totalRow }) {
  if (!rows || rows.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-4">{empty || 'No data.'}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b-2 border-gray-300">
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-semibold text-gray-700 text-${align[i] || 'left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-gray-100">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-1.5 text-${align[ci] || 'left'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalRow && (
          <tfoot>
            <tr className="border-t-2 border-gray-700 font-semibold bg-gray-50">
              {totalRow.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 text-${align[ci] || 'left'}`}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Footer() {
  return (
    <div className="text-[11px] text-gray-400 pt-4 border-t border-gray-200 flex justify-between">
      <span>AgriCOmm ERP · Printable Report</span>
      <span>Page printed {new Date().toLocaleString()}</span>
    </div>
  );
}
