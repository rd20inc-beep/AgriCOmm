import { useState, useEffect, useMemo, useCallback } from 'react';
import { Printer, RefreshCw, Calendar, Factory, Boxes, TrendingUp, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import {
  ProductionReportView, StockReportView,
  PnlReportView, CashflowReportView, AgingReportView,
} from './PrintableReportsViews';

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


const STOCK_GROUP_OPTIONS = [
  { key: 'subtype',   label: 'By Byproduct (B1/B2/Sortex/...)' },
  { key: 'product',   label: 'By Product' },
  { key: 'supplier',  label: 'By Supplier' },
  { key: 'warehouse', label: 'By Warehouse' },
  { key: 'variety',   label: 'By Variety' },
  { key: 'grade',     label: 'By Grade (B1/B2/CSR/...)' },
  { key: 'type',      label: 'By Type (raw/finished/byproduct)' },
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

  // Print in the current tab. The global @media print rule in index.css
  // (gated on body.app-print-mask) hides everything except .print-report,
  // so toggling that class around window.print() gives us a clean preview
  // with no app chrome and no new browser window.
  const handlePrint = () => {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Safety net for browsers that don't fire afterprint reliably.
    setTimeout(cleanup, 60_000);
    window.print();
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

