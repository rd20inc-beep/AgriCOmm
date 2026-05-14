import { useState, useEffect, useMemo, useCallback } from 'react';
import { Printer, RefreshCw, Calendar, Factory, Boxes } from 'lucide-react';
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

  const [reportType, setReportType] = useState('production'); // 'production' | 'stock'
  const [preset, setPreset] = useState('daily');
  const [stockGroupBy, setStockGroupBy] = useState('product');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

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
      if (reportType === 'production') {
        const res = await api.get('/api/reporting/printable/production', {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        });
        setData(res?.data || res);
      } else {
        const res = await api.get('/api/reporting/printable/stock', { group_by: stockGroupBy });
        setData(res?.data || res);
      }
    } catch (err) {
      addToast(err.message || 'Failed to load report', 'error');
    } finally {
      setLoading(false);
    }
  }, [reportType, range, stockGroupBy, addToast]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const handlePrint = () => window.print();

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';

  return (
    <div className="space-y-6">
      {/* Toolbar — hidden when printing */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
            <button
              onClick={() => setReportType('production')}
              className={`px-4 py-2 text-sm font-medium inline-flex items-center gap-2 ${reportType === 'production' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              <Factory className="w-4 h-4" /> Production
            </button>
            <button
              onClick={() => setReportType('stock')}
              className={`px-4 py-2 text-sm font-medium inline-flex items-center gap-2 ${reportType === 'stock' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              <Boxes className="w-4 h-4" /> Stock
            </button>
          </div>

          {reportType === 'production' && (
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

          {reportType === 'production' && preset === 'custom' && (
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
        ) : (
          <div className="text-center text-gray-400 py-12">No data.</div>
        )}
      </div>

      {/* Print-only style overrides. The app shell wraps everything in
          `flex h-screen overflow-hidden` with a scrolling `<main>`, so
          trying to "unlock" it doesn't reliably surface the full report
          to the printer. The robust pattern: hide every element by
          visibility, then re-show just the printable subtree, and let
          it flow as a normal block on the page. */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          .printable-area, .printable-area * { visibility: visible !important; }
          .printable-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            box-shadow: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
          .print-report h2 { page-break-after: avoid; }
          .print-report tr { page-break-inside: avoid; }
          .print-report table { page-break-inside: auto; }
        }
      `}</style>
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
