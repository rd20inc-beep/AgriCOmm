// Standalone /print-report route — mounted OUTSIDE the main Layout so
// there's no sidebar / header / scroll-container fight when the browser
// renders the print preview. The user clicks "Print" on /reports/print
// and we open this URL in a new tab; the page fetches the report, renders
// only the report body, then triggers window.print().
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import {
  ProductionReportView, StockReportView,
  PnlReportView, CashflowReportView, AgingReportView,
} from './PrintableReportsViews';

const STOCK_GROUP_OPTIONS = [
  { key: 'product',   label: 'By Product' },
  { key: 'supplier',  label: 'By Supplier' },
  { key: 'warehouse', label: 'By Warehouse' },
  { key: 'variety',   label: 'By Variety' },
  { key: 'type',      label: 'By Type' },
];

export default function StandalonePrintReport() {
  const { companyProfileData } = useApp();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const type = params.get('type') || 'production';
  const from = params.get('from');
  const to = params.get('to');
  const preset = params.get('preset') || 'monthly';
  const stockGroupBy = params.get('group_by') || 'product';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    async function load() {
      try {
        let res;
        if (type === 'production') {
          res = await api.get('/api/reporting/printable/production', { from, to });
        } else if (type === 'stock') {
          res = await api.get('/api/reporting/printable/stock', { group_by: stockGroupBy });
        } else if (type === 'pnl') {
          res = await api.get('/api/reporting/printable/pnl', { from, to });
        } else if (type === 'cashflow') {
          res = await api.get('/api/reporting/printable/cashflow', { from, to });
        } else if (type === 'ar_aging') {
          res = await api.get('/api/reporting/printable/ar-aging');
        } else if (type === 'ap_aging') {
          res = await api.get('/api/reporting/printable/ap-aging');
        } else {
          throw new Error(`Unknown report type "${type}"`);
        }
        if (!cancelled) setData(res?.data || res);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [type, from, to, stockGroupBy]);

  // Trigger native print once data is rendered.
  useEffect(() => {
    if (!data || loading) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [data, loading]);

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const range = from && to ? { from: new Date(from), to: new Date(to) } : null;

  return (
    <div style={{ background: 'white', minHeight: '100vh', padding: '24px' }}>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { background: white !important; margin: 0 !important; }
        }
      `}</style>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 14 }}>
          Loading report…
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: 40, color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div className="bg-white p-8 max-w-4xl mx-auto">
          {type === 'production' && data.summary && data.batches && (
            <ProductionReportView data={data} companyName={companyName} range={range} preset={preset} />
          )}
          {type === 'stock' && data.grand && data.rows && (
            <StockReportView data={data} companyName={companyName}
              groupLabel={STOCK_GROUP_OPTIONS.find(o => o.key === stockGroupBy)?.label} />
          )}
          {type === 'pnl' && data.revenue && data.costs && (
            <PnlReportView data={data} companyName={companyName} range={range} preset={preset} />
          )}
          {type === 'cashflow' && data.summary && (
            <CashflowReportView data={data} companyName={companyName} range={range} preset={preset} />
          )}
          {type === 'ar_aging' && data.buckets && (
            <AgingReportView data={data} companyName={companyName} kind="receivable" />
          )}
          {type === 'ap_aging' && data.buckets && (
            <AgingReportView data={data} companyName={companyName} kind="payable" />
          )}
        </div>
      )}
    </div>
  );
}
