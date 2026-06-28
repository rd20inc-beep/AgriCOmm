// Invoice Ledger (Phase 4) — a searchable, filterable list of local-sale
// invoices (one row per invoice; multi-line sales grouped by sale_group_no).
// Search by invoice no / customer / rice type / lot / batch / truck / payment
// ref; filter by date, payment status and outstanding-only. Each row opens the
// Invoice 360 and links to the customer ledger. Read-only; commercial figures
// only (no COGS/margin). Reuses the shared ledger CSV/print helpers.
import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Download, Printer, FileText, AlertTriangle, BookUser, ChevronRight } from 'lucide-react';
import { reportingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';

const pkr = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const STATUS_TONE = {
  Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-rose-100 text-rose-700',
};
const COLS = [
  { label: 'Invoice', key: 'invoiceNo' },
  { label: 'Date', accessor: (r) => dt(r.date) },
  { label: 'Customer', key: 'customer' },
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
  const outstanding = params.get('outstanding') === '1';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const set = (patch) => { const p = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); }); setParams(p); };

  useEffect(() => {
    setLoading(true); setError(null);
    reportingApi.invoiceLedger({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(outstanding ? { outstanding: '1' } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
      .then(res => setData(res?.rows ? res : (res?.data || res)))
      .catch(e => { setError(e?.status === 403 ? 'You are not permitted to view the invoice ledger.' : (e?.message || 'Failed to load.')); setData({ rows: [] }); })
      .finally(() => setLoading(false));
  }, [q, status, outstanding, from, to]);

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
          <p className="text-sm text-gray-500">Search and trace every local sales invoice.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportLedgerCSV({ filename: `invoice-ledger_${stamp}.csv`, columns: COLS, rows })} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => printLedger({ companyName: companyProfileData?.legalName || companyProfileData?.name, title: 'Invoice Ledger', subtitle: 'Local sales invoices', meta: exportMeta, columns: COLS, rows, generatedBy: user?.name || user?.email, footerNote: 'Commercial figures only.' })} disabled={!rows.length}
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
        <Kpi label="Invoices" value={String(totals.count ?? rows.length)} />
        <Kpi label="Total billed" value={pkr(totals.total)} />
        <Kpi label="Received" value={pkr(totals.received)} tone="emerald" />
        <Kpi label="Outstanding" value={pkr(totals.outstanding)} tone={totals.outstanding > 0 ? 'rose' : 'gray'} />
      </div>

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</div>}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Invoice</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Customer</th>
              <th className="px-3 py-2 text-left font-medium">Items</th>
              <th className="px-3 py-2 text-left font-medium">Traceability</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              <th className="px-3 py-2 text-right font-medium">Outstanding</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No invoices match.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-blue-50/40">
                <td className="px-3 py-2">
                  <Link to={r.href} className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1">{r.invoiceNo} <ChevronRight size={12} /></Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dt(r.date)}</td>
                <td className="px-3 py-2">{r.customerHref ? <Link to={r.customerHref} className="text-blue-600 hover:underline">{r.customer}</Link> : r.customer}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Click an invoice to open its full Invoice 360 (items, traceability, payment timeline, dispatch). Customer links open the customer ledger.</p>
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
