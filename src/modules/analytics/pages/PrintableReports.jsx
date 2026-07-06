import { useState, useEffect, useMemo, useCallback } from 'react';
import { Printer, RefreshCw, Calendar, Factory, Boxes, TrendingUp, Wallet, ArrowDownLeft, ArrowUpRight, ShoppingCart, FileText, Package, Sparkles, Shield } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useSummarizeReport } from '../../../api/queries';
import {
  ProductionReportView, StockReportView,
  PnlReportView, CashflowReportView, AgingReportView,
  PurchaseLedgerView, SalesLedgerView, StockDetailView, PnlAccrualView, PnlCompareView,
  AuditReportView,
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


// Compact figures (no big arrays) for the AI narrative, per report type.
function buildSummaryFigures(reportType, data, range) {
  const rng = range ? `${new Date(range.from).toISOString().slice(0, 10)} to ${new Date(range.to).toISOString().slice(0, 10)}` : undefined;
  if (reportType === 'pnl_accrual') {
    return { range: rng, basis: 'accrual', revenue: data.revenue?.totalPkr, cogs: data.cogs?.totalPkr, grossProfit: data.grossProfitPkr, grossMarginPct: data.grossMarginPct, operatingExpenses: data.opex?.totalPkr, netProfit: data.netProfitPkr, netMarginPct: data.netMarginPct, inventoryOnHand: data.inventoryOnHandPkr, topExpenseCategories: (data.opex?.byCategory || []).slice(0, 5) };
  }
  if (reportType === 'pnl') {
    return { range: rng, basis: 'cash', revenue: data.revenue?.totalPkr, totalCosts: data.costs?.totalPkr, netProfit: data.netProfitPkr, marginPct: data.marginPct, millOutputMt: data.revenue?.millFinishedMt };
  }
  // cashflow
  return { range: rng, ...(data.summary || {}) };
}
const SUMMARY_KIND = { pnl: 'pnl', pnl_accrual: 'pnl_accrual', cashflow: 'cashflow' };

function ReportSummaryCard({ reportType, data, range }) {
  const mut = useSummarizeReport();
  const [text, setText] = useState('');
  const [off, setOff] = useState(false);
  // Reset when the report or period changes.
  useEffect(() => { setText(''); setOff(false); }, [reportType, range?.from, range?.to]);
  if (!SUMMARY_KIND[reportType] || !data) return null;

  async function run() {
    try {
      const res = await mut.mutateAsync({ kind: SUMMARY_KIND[reportType], figures: buildSummaryFigures(reportType, data, range) });
      const d = res?.data || res;
      if (d?.aiEnabled === false) { setOff(true); return; }
      setText(d?.summary || '');
    } catch { setText(''); }
  }

  return (
    <div className="mb-4 rounded-xl border border-violet-100 bg-violet-50/40 p-4 print:border-gray-300 print:bg-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-violet-700 inline-flex items-center gap-1.5 print:text-gray-800"><Sparkles className="w-3.5 h-3.5" /> AI Summary</span>
        {!text && !off && (
          <button onClick={run} disabled={mut.isPending}
            className="print:hidden inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
            <Sparkles className={`w-3.5 h-3.5 ${mut.isPending ? 'animate-pulse' : ''}`} /> {mut.isPending ? 'Summarising…' : 'Summarise'}
          </button>
        )}
        {text && (
          <button onClick={run} disabled={mut.isPending} className="print:hidden text-[11px] font-medium text-violet-600 hover:text-violet-700">Regenerate</button>
        )}
      </div>
      {off && <p className="text-xs text-gray-500 mt-2">AI is off — set <code>OPENAI_API_KEY</code> on the server to enable narrative summaries.</p>}
      {text && <p className="text-sm text-gray-800 mt-2 leading-relaxed">{text}</p>}
      {!text && !off && !mut.isPending && <p className="text-xs text-gray-400 mt-2 print:hidden">Generate a plain-English read of this report.</p>}
    </div>
  );
}

const STOCK_GROUP_OPTIONS = [
  { key: 'byproduct', label: 'By By-Product + Rice Type (merged)' },
  { key: 'subtype',   label: 'By By-Product (all varieties merged)' },
  { key: 'product',   label: 'Products' },
  { key: 'supplier',  label: 'By Supplier' },
  { key: 'warehouse', label: 'By Warehouse' },
  { key: 'variety',   label: 'By Variety' },
  { key: 'grade',     label: 'By Grade (B1/B2/CSR/...)' },
  { key: 'type',      label: 'By Type (raw/finished/byproduct)' },
];

export default function PrintableReports() {
  const { addToast, companyProfileData } = useApp();
  const { user, hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  // A Mill role only gets the mill/inventory reports — the company-wide
  // financials (P&L, Cashflow, AR/AP aging) mix export data, which the mill
  // must not see. Their mill financials live on the Mill Finance dashboard.
  const millScoped = user?.role === 'Mill Manager';
  // The audit trail is admin-only (gated admin.view on the endpoint too).
  const canAudit = hasPermission?.('admin', 'view');
  const REPORT_TYPES = millScoped
    ? ['production', 'stock', 'stock_detail', 'purchase_ledger']
    : ['production', 'stock', 'stock_detail', 'purchase_ledger', 'sales_ledger', 'pnl_accrual', 'pnl', 'pnl_compare', 'cashflow', 'ar_aging', 'ap_aging', ...(canAudit ? ['audit_trail'] : [])];

  // Preselect via ?type= (e.g. the Audit Trail page links here with type=audit_trail).
  const initialType = REPORT_TYPES.includes(searchParams.get('type')) ? searchParams.get('type') : 'production';
  const [reportType, setReportType] = useState(initialType);
  // Audit-trail filters (action / entity contains, + user dropdown from the data).
  const [auditAction, setAuditAction] = useState('');
  const [auditEntity, setAuditEntity] = useState('');
  const [auditUserId, setAuditUserId] = useState('');
  const [preset, setPreset] = useState('monthly');
  const [stockGroupBy, setStockGroupBy] = useState('product');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Period-based reports use the period selector; snapshot reports
  // (stock + AR/AP aging) ignore it.
  const usesPeriod = ['production', 'pnl', 'pnl_accrual', 'pnl_compare', 'cashflow', 'purchase_ledger', 'sales_ledger', 'audit_trail'].includes(reportType);

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
      } else if (reportType === 'pnl_accrual') {
        res = await api.get('/api/reporting/printable/pnl-accrual', periodParams);
      } else if (reportType === 'pnl_compare') {
        const [cashRes, accrRes] = await Promise.all([
          api.get('/api/reporting/printable/pnl', periodParams),
          api.get('/api/reporting/printable/pnl-accrual', periodParams),
        ]);
        res = { data: { cash: cashRes?.data || cashRes, accrual: accrRes?.data || accrRes } };
      } else if (reportType === 'cashflow') {
        res = await api.get('/api/reporting/printable/cashflow', periodParams);
      } else if (reportType === 'ar_aging') {
        res = await api.get('/api/reporting/printable/ar-aging');
      } else if (reportType === 'ap_aging') {
        res = await api.get('/api/reporting/printable/ap-aging');
      } else if (reportType === 'purchase_ledger') {
        res = await api.get('/api/reporting/printable/purchase-ledger', periodParams);
      } else if (reportType === 'sales_ledger') {
        res = await api.get('/api/reporting/printable/sales-ledger', periodParams);
      } else if (reportType === 'stock_detail') {
        res = await api.get('/api/reporting/printable/stock-detail', {});
      } else if (reportType === 'audit_trail') {
        res = await api.get('/api/reporting/printable/audit-trail', {
          ...periodParams,
          ...(auditAction && { action: auditAction }),
          ...(auditEntity && { entity_type: auditEntity }),
          ...(auditUserId && { user_id: auditUserId }),
        });
      } else {
        res = await api.get('/api/reporting/printable/stock', { group_by: stockGroupBy });
      }
      setData(res?.data || res);
    } catch (err) {
      addToast(err.message || 'Failed to load report', 'error');
    } finally {
      setLoading(false);
    }
  }, [reportType, range, stockGroupBy, auditAction, auditEntity, auditUserId, addToast]);

  // Belt-and-suspenders: never hold/load a report type this role can't see.
  useEffect(() => {
    if (millScoped && !REPORT_TYPES.includes(reportType)) setReportType('production');
  }, [millScoped, reportType]);

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
              { k: 'production',     l: 'Production',     i: Factory },
              { k: 'stock',          l: 'Stock',          i: Boxes },
              { k: 'stock_detail',   l: 'Stock (detail)', i: Package },
              { k: 'purchase_ledger', l: 'Purchases',     i: ShoppingCart },
              { k: 'sales_ledger',   l: 'Sales',          i: FileText },
              { k: 'pnl_accrual', l: 'P&L (accrual)', i: TrendingUp },
              { k: 'pnl',        l: 'P&L (cash)',  i: TrendingUp },
              { k: 'pnl_compare', l: 'P&L (compare)', i: TrendingUp },
              { k: 'cashflow',   l: 'Cashflow',   i: Wallet },
              { k: 'ar_aging',   l: 'AR Aging',   i: ArrowDownLeft },
              { k: 'ap_aging',   l: 'AP Aging',   i: ArrowUpRight },
              { k: 'audit_trail', l: 'Audit Trail', i: Shield },
            ].filter(({ k }) => REPORT_TYPES.includes(k)).map(({ k, l, i: Ic }) => (
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

          {reportType === 'audit_trail' && (
            <div className="inline-flex items-center gap-2">
              <input value={auditAction} onChange={e => setAuditAction(e.target.value)} placeholder="Action contains…"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-40" />
              <input value={auditEntity} onChange={e => setAuditEntity(e.target.value)} placeholder="Entity type…"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-36" />
              <select value={auditUserId} onChange={e => setAuditUserId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">All users</option>
                {(data?.topUsers || []).filter(u => u.userId).map(u => <option key={u.userId} value={u.userId}>{u.user}</option>)}
              </select>
            </div>
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
        ) : (<>
          <ReportSummaryCard reportType={reportType} data={data} range={range} />
          {reportType === 'production' && data.summary && data.batches ? (
          <ProductionReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'stock' && data.grand && data.rows ? (
          <StockReportView data={data} companyName={companyName} groupLabel={STOCK_GROUP_OPTIONS.find(o => o.key === stockGroupBy)?.label} />
        ) : reportType === 'pnl_compare' && data.cash && data.accrual ? (
          <PnlCompareView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'pnl_accrual' && data.revenue && data.cogs ? (
          <PnlAccrualView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'pnl' && data.revenue && data.costs ? (
          <PnlReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'cashflow' && data.summary ? (
          <CashflowReportView data={data} companyName={companyName} range={range} preset={preset} />
        ) : reportType === 'ar_aging' && data.buckets ? (
          <AgingReportView data={data} companyName={companyName} kind="receivable" />
        ) : reportType === 'ap_aging' && data.buckets ? (
          <AgingReportView data={data} companyName={companyName} kind="payable" />
        ) : reportType === 'purchase_ledger' && data.rows && data.totals ? (
          <PurchaseLedgerView data={data} companyName={companyName} range={range} />
        ) : reportType === 'sales_ledger' && data.local !== undefined ? (
          <SalesLedgerView data={data} companyName={companyName} range={range} />
        ) : reportType === 'stock_detail' && data.rows && data.millStore !== undefined ? (
          <StockDetailView data={data} companyName={companyName} />
        ) : reportType === 'audit_trail' && data.byCategory ? (
          <AuditReportView data={data} companyName={companyName} range={range} />
          ) : (
            <div className="text-center text-gray-400 py-12">No data.</div>
          )}
        </>)}
      </div>

    </div>
  );
}

