// Invoice Ledger (Phase 4) — a searchable, filterable list of local-sale
// invoices (one row per invoice; multi-line sales grouped by sale_group_no).
// Search by invoice no / customer / rice type / lot / batch / truck / payment
// ref; filter by date, payment status and outstanding-only. Each row opens the
// Invoice 360 and links to the customer ledger. Read-only; commercial figures
// only (no COGS/margin). Reuses the shared ledger CSV/print helpers.
import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Download, Printer, FileText, AlertTriangle, BookUser, ChevronRight, ChevronDown, Factory } from 'lucide-react';
import { reportingApi } from '../api/services';
import { localSalesApi, lotInventoryApi } from '../../../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

// Roles allowed to see internal by-product pricing (mirrors the invoice gates).
const ADMIN_PRICING_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];

const pkr = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const STATUS_TONE = {
  Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-rose-100 text-rose-700',
};
const COLS = [
  { label: 'Invoice', key: 'invoiceNo' },
  { label: 'Type', accessor: (r) => r.kind === 'purchase' ? 'Purchase' : 'Sale' },
  { label: 'Date', accessor: (r) => dt(r.date) },
  { label: 'Party', accessor: (r) => r.party || r.customer },
  { label: 'Items', accessor: (r) => (r.items || []).join(' / ') },
  { label: 'Lots', accessor: (r) => (r.lots || []).join(' ') },
  { label: 'Batches', accessor: (r) => (r.batches || []).join(' ') },
  { label: 'Qty (kg)', align: 'right', accessor: (r) => Math.round(r.qtyKg) },
  { label: 'Total', align: 'right', accessor: (r) => Math.round(r.total) },
  { label: 'Received', align: 'right', accessor: (r) => Math.round(r.received) },
  { label: 'Outstanding', align: 'right', accessor: (r) => Math.round(r.outstanding) },
  { label: 'Status', key: 'paymentStatus' },
  { label: 'Dispatch', accessor: (r) => r.dispatched ? 'Dispatched' : 'Not dispatched' },
];

export default function InvoiceLedger() {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [qInput, setQInput] = useState(params.get('q') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const kind = params.get('kind') || '';
  const outstanding = params.get('outstanding') === '1';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const set = (patch) => { const p = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); }); setParams(p); };

  // Internal by-product pricing — admin roles only. Lazy-fetched per row on
  // expand from the existing role-gated invoice endpoints (server enforces it).
  const canSeePricing = ADMIN_PRICING_ROLES.includes(user?.role);
  const [expanded, setExpanded] = useState(() => new Set());
  const [bpData, setBpData] = useState({});
  const [bpLoading, setBpLoading] = useState({});
  const toggleBp = async (r) => {
    const key = `${r.kind}-${r.id}`;
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    if (bpData[key] != null || bpLoading[key]) return;
    setBpLoading(prev => ({ ...prev, [key]: true }));
    try {
      let groups = [];
      if (r.kind === 'purchase') {
        const res = await lotInventoryApi.getPurchaseInvoice(r.id);
        groups = (res?.data || res)?.producedByproducts || [];
      } else {
        const res = await localSalesApi.getInvoiceAdmin(r.id);
        groups = (res?.data || res)?.batchByproducts || [];
      }
      setBpData(prev => ({ ...prev, [key]: groups }));
    } catch (e) {
      setBpData(prev => ({ ...prev, [key]: [] }));
    } finally {
      setBpLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  useEffect(() => {
    setLoading(true); setError(null);
    reportingApi.invoiceLedger({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(outstanding ? { outstanding: '1' } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
      .then(res => setData(res?.rows ? res : (res?.data || res)))
      .catch(e => { setError(e?.status === 403 ? 'You are not permitted to view the invoice ledger.' : (e?.message || 'Failed to load.')); setData({ rows: [] }); })
      .finally(() => setLoading(false));
  }, [q, status, kind, outstanding, from, to]);

  // Debounce the search box → URL.
  useEffect(() => {
    const t = setTimeout(() => { if (qInput !== q) set({ q: qInput.trim() }); }, 350);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const stamp = new Date().toISOString().slice(0, 10);
  const exportMeta = useMemo(() => [
    `${rows.length} invoices`, q ? `Search: ${q}` : null, status ? `Status: ${status}` : null, outstanding ? 'Outstanding only' : null,
  ].filter(Boolean), [rows.length, q, status, outstanding]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><FileText size={22} /> Invoice Ledger</h1>
          <p className="text-sm text-gray-500">Search and trace every sales & purchase invoice.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportLedgerCSV({ filename: `invoice-ledger_${stamp}.csv`, columns: COLS, rows })} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => printLedger({ companyName: companyProfileData?.legalName || companyProfileData?.name, title: 'Invoice Ledger', subtitle: 'Sales & purchase invoices', meta: exportMeta, columns: COLS, rows, generatedBy: user?.name || user?.email, footerNote: 'Commercial figures only.' })} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[220px]">
          <span className="text-xs text-gray-500 block mb-1">Search</span>
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-2">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Invoice no, customer, rice type, lot, batch, truck, payment ref…"
              className="w-full text-sm outline-none" />
          </div>
        </label>
        <label><span className="text-xs text-gray-500 block mb-1">Type</span>
          <select value={kind} onChange={e => set({ kind: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white outline-none">
            <option value="">All</option><option value="sale">Sales</option><option value="purchase">Purchases</option>
          </select>
        </label>
        <label><span className="text-xs text-gray-500 block mb-1">Status</span>
          <select value={status} onChange={e => set({ status: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white outline-none">
            <option value="">All</option><option value="Paid">Paid</option><option value="Partial">Partial</option><option value="Unpaid">Unpaid</option>
          </select>
        </label>
        <label><span className="text-xs text-gray-500 block mb-1">From</span>
          <input type="date" value={from} onChange={e => set({ from: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none" />
        </label>
        <label><span className="text-xs text-gray-500 block mb-1">To</span>
          <input type="date" value={to} onChange={e => set({ to: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={outstanding} onChange={e => set({ outstanding: e.target.checked ? '1' : '' })} /> Outstanding only
        </label>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Invoices" value={`${totals.count ?? rows.length}${totals.sales != null ? ` (${totals.sales} sale / ${totals.purchases} purch.)` : ''}`} />
        <Kpi label="Total value" value={pkr(totals.total)} />
        <Kpi label="Settled" value={pkr(totals.received)} tone="emerald" />
        <Kpi label="Outstanding" value={pkr(totals.outstanding)} tone={totals.outstanding > 0 ? 'rose' : 'gray'} />
      </div>

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</div>}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Invoice</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Party</th>
              <th className="px-3 py-2 text-left font-medium">Items</th>
              <th className="px-3 py-2 text-left font-medium">Traceability</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Settled</th>
              <th className="px-3 py-2 text-right font-medium">Outstanding</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              {canSeePricing && <th className="px-3 py-2 text-left font-medium">By-products</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={canSeePricing ? 11 : 10} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canSeePricing ? 11 : 10} className="px-3 py-8 text-center text-gray-400">No invoices match.</td></tr>
            ) : rows.map((r) => { const bpKey = `${r.kind}-${r.id}`; const isOpen = expanded.has(bpKey); return (
              <Fragment key={bpKey}>
              <tr className="hover:bg-blue-50/40">
                <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${r.kind === 'purchase' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{r.kind === 'purchase' ? 'Purchase' : 'Sale'}</span></td>
                <td className="px-3 py-2">
                  <Link to={r.href} className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1">{r.invoiceNo} <ChevronRight size={12} /></Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dt(r.date)}</td>
                <td className="px-3 py-2">{(r.partyHref || r.customerHref) ? <Link to={r.partyHref || r.customerHref} className="text-blue-600 hover:underline">{r.party || r.customer}</Link> : (r.party || r.customer)}</td>
                <td className="px-3 py-2 max-w-[16rem] truncate" title={(r.items || []).join(', ')}>{(r.items || []).join(', ') || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {(r.lots || []).length > 0 && <span>Lot {(r.lots || []).join(', ')}</span>}
                  {(r.batches || []).length > 0 && <span>{(r.lots || []).length ? ' · ' : ''}Batch {(r.batches || []).join(', ')}</span>}
                  {(r.lots || []).length === 0 && (r.batches || []).length === 0 && <span>—</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pkr(r.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{pkr(r.received)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.outstanding > 0 ? 'text-rose-600' : 'text-gray-400'}`}>{pkr(r.outstanding)}</td>
                <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_TONE[r.paymentStatus] || 'bg-gray-100 text-gray-600'}`}>{r.paymentStatus}</span></td>
                {canSeePricing && (
                  <td className="px-3 py-2">
                    <button onClick={() => toggleBp(r)} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${isOpen ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      <Factory size={12} /> {isOpen ? 'Hide' : 'Pricing'} {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  </td>
                )}
              </tr>
              {canSeePricing && isOpen && (
                <tr className="bg-amber-50/30">
                  <td colSpan={11} className="px-4 py-3">
                    <BpPanel groups={bpData[bpKey]} loading={bpLoading[bpKey]} kind={r.kind} />
                  </td>
                </tr>
              )}
              </Fragment>
            ); })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Click an invoice to open its 360 view. Sales open the Invoice 360; purchases open the Purchase Invoice. Party links open the customer/supplier ledger.</p>
    </div>
  );
}

// Inline by-product pricing panel for an expanded ledger row (admin only).
// `groups` = batchByproducts (sale) or producedByproducts (purchase).
function BpPanel({ groups, loading, kind }) {
  if (loading) return <p className="text-xs text-gray-400">Loading by-product pricing…</p>;
  if (!groups || groups.length === 0) return <p className="text-xs text-gray-400">No milling by-product pricing for this {kind === 'purchase' ? 'purchase' : 'invoice'} (not milled, or no per-grade prices recorded).</p>;
  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">{kind === 'purchase' ? 'Produced from this lot' : 'Source batch'} — by-product pricing · internal</p>
      {groups.map((bp) => (
        <div key={bp.batchId} className="rounded-lg border border-amber-200 overflow-hidden bg-white">
          <div className="px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-b border-amber-100 bg-amber-50/50">
            <Link to={bp.batchHref} className="text-xs font-medium text-blue-600 hover:underline">Batch {bp.batchNo}{bp.sharePct != null && bp.sharePct < 99.5 ? ` · ${Math.round(bp.sharePct)}% of this lot` : ''}</Link>
            {bp.byproductRecovery > 0 && <span className="text-xs text-emerald-700">By-product recovery {pkr(bp.byproductRecovery)}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Product / grade</th>
                  <th className="px-3 py-1.5 text-left font-medium">Type</th>
                  <th className="px-3 py-1.5 text-right font-medium">Produced</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cost/kg</th>
                  <th className="px-3 py-1.5 text-right font-medium">Sale price/kg</th>
                  <th className="px-3 py-1.5 text-right font-medium">Recovery value</th>
                  <th className="px-3 py-1.5 text-left font-medium">Warehouse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bp.outputs.map((o) => (
                  <tr key={o.lotId}>
                    <td className="px-3 py-1.5"><Link to={o.href} className="text-blue-600 hover:underline">{o.productGrade}</Link></td>
                    <td className="px-3 py-1.5 text-gray-600">{o.type === 'byproduct' ? 'by-product' : 'finished'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(o.producedKg).toLocaleString()} kg</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.costPerKg ? pkr(o.costPerKg) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.salePricePerKg ? pkr(o.salePricePerKg) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.recoveryValue ? pkr(o.recoveryValue) : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600">{o.warehouse || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, tone = 'gray' }) {
  const toneCls = { emerald: 'text-emerald-700', rose: 'text-rose-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${toneCls}`}>{value}</p>
    </div>
  );
}
