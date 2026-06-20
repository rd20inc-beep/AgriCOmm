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
import { LotReportView } from './LotReportViews';

const STOCK_GROUP_OPTIONS = [
  { key: 'product',   label: 'Products' },
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
  const lotIds = params.get('ids') || '';
  const lotDetail = params.get('detail') || 'full';

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
        } else if (type === 'lot') {
          res = await api.get('/api/lot-inventory/lots-report', { ids: lotIds });
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
  }, [type, from, to, stockGroupBy, lotIds]);

  // Trigger native print once data has rendered. Use double rAF to make
  // sure the browser has committed at least one paint frame containing
  // the report before window.print() captures the page state — fixed
  // setTimeouts could fire before React painted, producing blank output.
  const [hasPrinted, setHasPrinted] = useState(false);
  useEffect(() => {
    if (!data || loading || hasPrinted) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setTimeout(() => {
          if (cancelled) return;
          setHasPrinted(true);
          window.print();
        }, 500);
      });
    });
    return () => { cancelled = true; };
  }, [data, loading, hasPrinted]);

  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const range = from && to ? { from: new Date(from), to: new Date(to) } : null;

  return (
    <div style={{ background: 'white', minHeight: '100vh', padding: '24px' }}>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Manual print + close, hidden from the print output via .no-print. */}
      {data && !loading && !error && (
        <div className="no-print" style={{ position: 'fixed', top: 12, right: 12, zIndex: 50, display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()}
            style={{ background: '#2563eb', color: 'white', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, border: 0, cursor: 'pointer' }}>
            Print
          </button>
          <button onClick={() => window.close()}
            style={{ background: 'white', color: '#374151', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, border: '1px solid #e5e7eb', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      )}

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
          {type === 'lot' && Array.isArray(data.lots) && (
            <LotReportView lots={data.lots} companyName={companyName} detail={lotDetail} generatedAt={data.generatedAt} />
          )}
        </div>
      )}
    </div>
  );
}
