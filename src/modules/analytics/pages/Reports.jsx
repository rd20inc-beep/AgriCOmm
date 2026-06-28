import { useMemo, useState, useEffect, useRef, Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import {
  BarChart3, TrendingUp, Users, Globe, Package, Award, Coins, Printer, RefreshCw,
  ArrowUpRight, ArrowDownLeft, Activity, Calendar, ExternalLink, AlertTriangle, FileText,
  ShoppingCart, Truck, Receipt, Scale, ChevronDown, ChevronRight, Layers,
  Factory, Gauge, Wallet, Star, Plus, Trash2, Hash, Search, Download, Mail, Send,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  LineChart, Line,
} from 'recharts';
import {
  useExecutiveSummary, useOrderProfitability, useCustomerProfitability,
  useCountryAnalysis, useStockAgingReport, useSupplierQualityRanking,
  usePayments, useReceivables, usePayables, usePrintableStock,
  useLocalSales, usePurchases, useBatchMargin, useLotTracker, useSalesTracker,
  useCashForecast, useKpiBenchmarks, useMillEfficiency, useRecoveryLeaderboard,
  useStockValuation, useStockTurnover,
  useOperatorProductivity, useUtilityConsumption, useRecoveryByVariety,
  useSavedReports, useSaveReport, useDeleteSavedReport, useWarehouses,
} from '../../../api/queries';
import { reportingApi, aiApi } from '../api/services';
import { exportLedgerCSV, printLedger } from '../utils/ledgerExport';
import SlideDrawer from '../../../components/SlideDrawer';
import TransactionDocument from '../../../components/TransactionDocument';

// ─── Formatting ────────────────────────────────────────────────────────
// When the "Exact numbers" toggle is on, money is shown in full digits
// instead of Cr/L/K/M shorthand. The flag is module-scoped and set by the
// Reports component at the top of each render (synchronously, before any
// formatter runs in JSX), so call sites don't need to thread a param.
let EXACT_NUMBERS = false;
export function setExactNumbers(on) { EXACT_NUMBERS = !!on; }
function fmtPKR(n) {
  if (n == null || isNaN(n)) return 'Rs 0';
  if (EXACT_NUMBERS) return `Rs ${Math.round(n).toLocaleString()}`;
  if (Math.abs(n) >= 10_000_000) return `Rs ${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `Rs ${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(n).toLocaleString()}`;
}
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  if (EXACT_NUMBERS) return `$${Math.round(n).toLocaleString()}`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
// Exact value for a title tooltip — always full digits regardless of toggle.
function exactPKR(n) { return (n == null || isNaN(n)) ? 'Rs 0' : `Rs ${Math.round(n).toLocaleString()}`; }
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}

// ─── Range presets ────────────────────────────────────────────────────
const RANGES = [
  { value: '',        label: 'All Time' },
  { value: 'today',   label: 'Today' },
  { value: 'week',    label: 'This Week' },
  { value: 'month',   label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year',    label: 'This Year' },
];

function rangeToParams(range) {
  if (!range) return {};
  const now = new Date();
  const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
  const endOf   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x.toISOString().slice(0,10); };
  switch (range) {
    case 'today':   return { from_date: startOf(now), to_date: endOf(now) };
    case 'week':    {
      const day = now.getDay() || 7;
      const monday = new Date(now); monday.setDate(now.getDate() - (day - 1));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { from_date: startOf(monday), to_date: endOf(sunday) };
    }
    case 'month':   return { from_date: startOf(new Date(now.getFullYear(), now.getMonth(), 1)),     to_date: endOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from_date: startOf(new Date(now.getFullYear(), q * 3, 1)), to_date: endOf(new Date(now.getFullYear(), q * 3 + 3, 0)) };
    }
    case 'year':    return { from_date: startOf(new Date(now.getFullYear(), 0, 1)), to_date: endOf(new Date(now.getFullYear(), 11, 31)) };
    default:        return {};
  }
}

// ─── Page ─────────────────────────────────────────────────────────────
const TABS = [
  { key: 'moneyIn',   label: 'Money In',   icon: ArrowDownLeft },
  { key: 'moneyOut',  label: 'Money Out',  icon: ArrowUpRight },
  { key: 'sales',     label: 'Sales',      icon: ShoppingCart },
  { key: 'purchases', label: 'Purchases',  icon: Truck },
  { key: 'lots',      label: 'Lots',       icon: Layers },
  { key: 'margin',    label: 'Margin',     icon: Scale },
  { key: 'production', label: 'Production', icon: Factory },
  { key: 'orders',    label: 'Orders',     icon: TrendingUp },
  { key: 'customers', label: 'Customers',  icon: Users },
  { key: 'countries', label: 'Countries',  icon: Globe },
  { key: 'forecast',  label: 'Cash Forecast', icon: Wallet },
  { key: 'inventory', label: 'Inventory',  icon: Package },
  { key: 'kpis',      label: 'KPIs',       icon: Gauge },
  { key: 'quality',   label: 'Quality',    icon: Award },
];

// ─── Global search box ──────────────────────────────────────────────────
// Debounced cross-entity lookup (lots, batches, sales, orders, parties).
// Clicking a result navigates to that record's detail/statement page.
function GlobalSearchBox({ entity }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await reportingApi.search({ q: term, ...(entity ? { entity } : {}) });
        setGroups(res?.groups || res?.data?.groups || []);
      } catch { setGroups([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, entity]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (href) => { setOpen(false); setQ(''); navigate(href); };
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div ref={boxRef} className="relative">
      <div className="bg-white/15 backdrop-blur-sm rounded-lg flex items-center gap-1.5 px-2 py-1.5 w-44 focus-within:w-64 transition-all">
        <Search size={13} className="opacity-80 shrink-0" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search lots, sales, parties…"
          className="bg-transparent border-0 text-xs font-medium text-white placeholder-white/60 outline-none w-full" />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 mt-1 w-80 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-30 overflow-hidden">
          {loading && total === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">Searching…</p>
          ) : total === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">No matches for “{q.trim()}”.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {groups.map(g => (
                <div key={g.key}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50">{g.label}</p>
                  {g.items.map(it => (
                    <button key={`${g.key}-${it.id}`} onClick={() => go(it.href)}
                      className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-gray-50">
                      <span className="block text-sm font-medium truncate">{it.title}</span>
                      {it.subtitle && <span className="block text-[11px] text-gray-400 truncate">{it.subtitle}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shared Export-CSV + Print bar for the Phase 2 ledger reports. Pass the
// ledger's column defs + rows; Print uses the standardized template.
function LedgerExportBar({ title, subtitle, meta, columns, rows, footerNote, fileBase }) {
  const { companyProfileData } = useApp();
  const { user } = useAuth();
  const companyName = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
  const stamp = new Date().toISOString().slice(0, 10);
  const disabled = !rows || rows.length === 0;
  return (
    <div className="flex justify-end gap-2 print:hidden">
      <button onClick={() => exportLedgerCSV({ filename: `${fileBase || 'ledger'}_${stamp}.csv`, columns, rows })}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
        <Download size={13} /> Export CSV
      </button>
      <button onClick={() => printLedger({ companyName, title, subtitle, meta, columns, rows, footerNote, generatedBy: user?.name || user?.email })}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed">
        <Printer size={13} /> Print
      </button>
    </div>
  );
}

// Scheduled report emails manager — list, create (report · frequency ·
// recipients), send-now, delete. Reuses the backend scheduler + mailer.
function ScheduledEmailsManager() {
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ reportType: '', frequency: 'weekly', recipients: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    setLoading(true);
    reportingApi.scheduledReports()
      .then(res => { const d = res?.rows ? res : (res?.data || res); setRows(d.rows || []); setTypes(d.types || {}); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.reportType || !form.recipients.trim()) { setMsg({ t: 'err', m: 'Pick a report and add at least one recipient.' }); return; }
    setBusy(true); setMsg(null);
    try { await reportingApi.createScheduledReport(form); setForm({ reportType: '', frequency: 'weekly', recipients: '' }); setMsg({ t: 'ok', m: 'Schedule created.' }); load(); }
    catch (e) { setMsg({ t: 'err', m: e?.message || 'Could not create schedule.' }); }
    finally { setBusy(false); }
  };
  const runNow = async (id) => { setBusy(true); setMsg(null); try { const r = await reportingApi.runScheduledReport(id); const sent = r?.result?.items_processed ?? r?.data?.result?.items_processed; setMsg({ t: 'ok', m: `Sent now (${sent ?? 0} email${sent === 1 ? '' : 's'}).` }); load(); } catch (e) { setMsg({ t: 'err', m: e?.message || 'Send failed.' }); } finally { setBusy(false); } };
  const del = async (id) => { setBusy(true); try { await reportingApi.deleteScheduledReport(id); load(); } catch (e) { setMsg({ t: 'err', m: 'Delete failed.' }); } finally { setBusy(false); } };

  const typeEntries = Object.entries(types);
  return (
    <div className="space-y-5">
      {/* Create */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">New scheduled email</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500">Report</span>
            <select value={form.reportType} onChange={e => setForm(f => ({ ...f, reportType: e.target.value }))}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white outline-none">
              <option value="">Select a report…</option>
              {typeEntries.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Frequency</span>
            <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white outline-none">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-gray-500">Recipients (comma-separated emails)</span>
          <input value={form.recipients} onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
            placeholder="owner@company.com, finance@company.com"
            className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none" />
        </label>
        {msg && <p className={`text-xs ${msg.t === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.m}</p>}
        <button onClick={create} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Plus size={14} /> Create schedule
        </button>
      </div>

      {/* Existing */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Active schedules</h4>
        {loading ? <p className="text-xs text-gray-400">Loading…</p>
          : rows.length === 0 ? <p className="text-xs text-gray-400">No scheduled emails yet.</p>
          : (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className="rounded-lg border border-gray-200 p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{r.reportLabel} <span className="text-gray-400 font-normal">· {r.frequency}</span></p>
                    <p className="text-[11px] text-gray-500 truncate">{(r.recipients || []).join(', ')}</p>
                    <p className="text-[11px] text-gray-400">Next: {r.nextRun ? new Date(r.nextRun).toLocaleDateString('en-GB') : '—'}{r.lastStatus ? ` · last: ${r.lastStatus}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => runNow(r.id)} disabled={busy} title="Send now" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"><Send size={14} /></button>
                    <button onClick={() => del(r.id)} disabled={busy} title="Delete" className="p-1.5 text-gray-300 hover:text-rose-500 rounded-lg disabled:opacity-50"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        <p className="text-[11px] text-gray-400 mt-2">Emails are sent by the hourly scheduler when due (SMTP must be configured on the server). “Send now” triggers it immediately.</p>
      </div>
    </div>
  );
}

// AI report analyst — ask a question in plain English; the backend turns it
// into a safe read-only query and returns the answer table + the SQL it ran.
// Reuses the existing /api/ai endpoints (opt-in via OPENAI_API_KEY).
const AI_SAMPLES = [
  'Top 5 customers by sales value this month',
  'Total finished rice on hand by grade',
  'Which suppliers have the most outstanding payable?',
  'Average milling yield by variety',
];
function AiAnalystDrawer() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [status, setStatus] = useState(null);
  useEffect(() => { aiApi.status().then(r => setStatus(r?.data || r)).catch(() => setStatus({ enabled: false })); }, []);

  const ask = async (question) => {
    const Q = (question ?? q).trim();
    if (!Q) return;
    if (question) setQ(question);
    setLoading(true); setErr(null); setRes(null);
    try {
      const r = await aiApi.query(Q);
      const d = r?.data || r;
      if (d && d.aiEnabled === false) { setErr(d.message || 'AI is not configured on the server.'); }
      else setRes(d);
    } catch (e) { setErr(e?.message || 'Query failed — try rephrasing.'); }
    finally { setLoading(false); }
  };

  const aiOff = status && status.enabled === false;
  return (
    <div className="space-y-4">
      {aiOff && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          AI is not configured on the server (set <code>OPENAI_API_KEY</code>). You can still type a question; it will work once enabled.
        </div>
      )}
      <div>
        <textarea value={q} onChange={e => setQ(e.target.value)} rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
          placeholder="Ask about your data — e.g. “total sales by customer this month”"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        <div className="flex items-center justify-between mt-2">
          <div className="flex flex-wrap gap-1.5">
            {AI_SAMPLES.map(s => <button key={s} onClick={() => ask(s)} className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">{s}</button>)}
          </div>
          <button onClick={() => ask()} disabled={loading || !q.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0">
            <Search size={14} /> {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{err}</div>}

      {res && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          {res.explanation && <p className="px-3 py-2 text-sm text-gray-700 border-b border-gray-100 bg-gray-50">{res.explanation}</p>}
          <div className="overflow-x-auto max-h-[50vh]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 sticky top-0">
                <tr>{(res.columns || []).map(c => <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(res.rows || []).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {(res.columns || []).map(c => <td key={c} className="px-2 py-1.5 whitespace-nowrap">{row[c] == null ? '—' : String(row[c])}</td>)}
                  </tr>
                ))}
                {(res.rows || []).length === 0 && <tr><td colSpan={(res.columns || []).length || 1} className="px-2 py-6 text-center text-gray-400">No rows.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-100 bg-gray-50">
            <span className="text-[11px] text-gray-400">{res.rowCount ?? (res.rows || []).length} row{(res.rowCount ?? (res.rows || []).length) === 1 ? '' : 's'}</span>
            <button onClick={() => setShowSql(s => !s)} className="text-[11px] text-blue-600 hover:underline">{showSql ? 'Hide' : 'Show'} SQL</button>
          </div>
          {showSql && <pre className="px-3 py-2 bg-gray-900 text-gray-100 text-[11px] overflow-x-auto">{res.sql}</pre>}
        </div>
      )}
      <p className="text-[11px] text-gray-400">AI generates a read-only query from your question. Always sanity-check the numbers against the dashboards.</p>
    </div>
  );
}

// ─── Self-serve report builder ──────────────────────────────────────────
// Pick a dataset, choose columns, filter + sort, preview, then export / print
// (reuses LedgerExportBar) or save the layout (localStorage). Bounded — it
// composes existing report datasets rather than being a full BI query tool
// (the "Ask AI" analyst covers free-form questions).
const RB_NUM = (v) => { const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n).toLocaleString(); };
const RB_DATE = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '';
const REPORT_DATASETS = {
  lots: {
    label: 'Purchased lots',
    load: async () => { const r = await reportingApi.lotTracker(); return (r?.data?.rows || r?.rows || []); },
    columns: [
      { key: 'lotNo', label: 'Lot', accessor: r => r.lotNo },
      { key: 'date', label: 'Date', accessor: r => RB_DATE(r.date) },
      { key: 'supplier', label: 'Supplier', accessor: r => r.supplier },
      { key: 'riceType', label: 'Rice type', accessor: r => r.riceType },
      { key: 'variety', label: 'Variety', accessor: r => r.variety },
      { key: 'grade', label: 'Grade', accessor: r => r.grade },
      { key: 'warehouse', label: 'Warehouse', accessor: r => r.warehouse },
      { key: 'receivedKg', label: 'Received (kg)', accessor: r => RB_NUM(r.receivedKg), align: 'right' },
      { key: 'ratePerKg', label: 'Rate/kg', accessor: r => RB_NUM(r.ratePerKg), align: 'right' },
      { key: 'landedTotal', label: 'Landed total', accessor: r => RB_NUM(r.landedTotal), align: 'right' },
      { key: 'soldKg', label: 'Sold (kg)', accessor: r => RB_NUM(r.soldKg), align: 'right' },
      { key: 'milledKg', label: 'Milled (kg)', accessor: r => RB_NUM(r.milledKg), align: 'right' },
      { key: 'status', label: 'Status', accessor: r => r.status },
    ],
  },
  sales: {
    label: 'Local sales',
    load: async () => { const r = await reportingApi.salesTracker(); return (r?.data?.rows || r?.rows || []); },
    columns: [
      { key: 'saleNo', label: 'Sale', accessor: r => r.saleNo },
      { key: 'saleDate', label: 'Date', accessor: r => RB_DATE(r.saleDate) },
      { key: 'customer', label: 'Customer', accessor: r => r.customer || r.customerName },
      { key: 'itemName', label: 'Item', accessor: r => r.itemName },
      { key: 'quantityKg', label: 'Qty (kg)', accessor: r => RB_NUM(r.quantityKg), align: 'right' },
      { key: 'ratePerKg', label: 'Rate/kg', accessor: r => RB_NUM(r.ratePerKg), align: 'right' },
      { key: 'totalAmount', label: 'Value', accessor: r => RB_NUM(r.totalAmount), align: 'right' },
      { key: 'paidAmount', label: 'Received', accessor: r => RB_NUM(r.paidAmount), align: 'right' },
      { key: 'dueAmount', label: 'Outstanding', accessor: r => RB_NUM(r.dueAmount), align: 'right' },
      { key: 'margin', label: 'Margin', accessor: r => RB_NUM(r.margin), align: 'right' },
      { key: 'paymentStatus', label: 'Payment', accessor: r => r.paymentStatus },
    ],
  },
  finished_goods: {
    label: 'Finished goods stock',
    load: async () => { const r = await reportingApi.finishedGoodsLedger(); return (r?.rows || r?.data?.rows || []); },
    columns: [
      { key: 'key', label: 'Output', accessor: r => r.key },
      { key: 'type', label: 'Type', accessor: r => r.type === 'byproduct' ? 'by-product' : 'finished' },
      { key: 'producedKg', label: 'Produced (kg)', accessor: r => RB_NUM(r.producedKg), align: 'right' },
      { key: 'soldKg', label: 'Sold (kg)', accessor: r => RB_NUM(r.soldKg), align: 'right' },
      { key: 'onHandKg', label: 'On hand (kg)', accessor: r => RB_NUM(r.onHandKg), align: 'right' },
      { key: 'reservedKg', label: 'Reserved (kg)', accessor: r => RB_NUM(r.reservedKg), align: 'right' },
      { key: 'valuePkr', label: 'Value', accessor: r => RB_NUM(r.valuePkr), align: 'right' },
    ],
  },
  inventory_movements: {
    label: 'Inventory movements',
    load: async () => { const r = await reportingApi.inventoryLedger({ limit: 500 }); return (r?.rows || r?.data?.rows || []); },
    columns: [
      { key: 'date', label: 'Date', accessor: r => RB_DATE(r.date) },
      { key: 'label', label: 'Movement', accessor: r => r.label },
      { key: 'lotNo', label: 'Lot', accessor: r => r.lotNo || r.batchNo },
      { key: 'fromWh', label: 'From', accessor: r => r.fromWh },
      { key: 'toWh', label: 'To', accessor: r => r.toWh },
      { key: 'direction', label: 'Dir', accessor: r => r.direction },
      { key: 'qtyKg', label: 'Qty (kg)', accessor: r => RB_NUM(r.qtyKg), align: 'right' },
      { key: 'costPkr', label: 'Cost', accessor: r => RB_NUM(r.costPkr), align: 'right' },
    ],
  },
};
const RB_LAYOUTS_KEY = 'rf_report_builder_layouts';

function ReportBuilderDrawer() {
  const [datasetKey, setDatasetKey] = useState('lots');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(REPORT_DATASETS.lots.columns.map(c => c.key));
  const [filterText, setFilterText] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [layouts, setLayouts] = useState(() => { try { return JSON.parse(localStorage.getItem(RB_LAYOUTS_KEY) || '{}'); } catch { return {}; } });

  const ds = REPORT_DATASETS[datasetKey];
  useEffect(() => {
    setLoading(true);
    ds.load().then(r => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, [datasetKey]); // eslint-disable-line

  const cols = ds.columns.filter(c => selected.includes(c.key));
  const view = useMemo(() => {
    let v = rows;
    const f = filterText.trim().toLowerCase();
    if (f) v = v.filter(row => cols.some(c => String(c.accessor(row) ?? '').toLowerCase().includes(f)));
    if (sortKey) {
      const col = ds.columns.find(c => c.key === sortKey);
      if (col) v = [...v].sort((a, b) => {
        const av = col.accessor(a), bv = col.accessor(b);
        const an = parseFloat(String(av).replace(/,/g, '')), bn = parseFloat(String(bv).replace(/,/g, ''));
        const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return v;
  }, [rows, filterText, sortKey, sortDir, selected, datasetKey]); // eslint-disable-line

  const toggleCol = (k) => setSelected(s => s.includes(k) ? s.filter(x => x !== k) : [...ds.columns.map(c => c.key).filter(c => s.includes(c) || c === k)]);
  const switchDataset = (k) => { setDatasetKey(k); setSelected(REPORT_DATASETS[k].columns.map(c => c.key)); setSortKey(''); setFilterText(''); };

  const persist = (next) => { setLayouts(next); try { localStorage.setItem(RB_LAYOUTS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ } };
  const saveLayout = () => { const name = window.prompt('Save this layout as:'); if (!name) return; persist({ ...layouts, [name]: { datasetKey, selected, sortKey, sortDir } }); };
  const loadLayout = (name) => { const l = layouts[name]; if (!l) return; setDatasetKey(l.datasetKey); setSelected(l.selected); setSortKey(l.sortKey || ''); setSortDir(l.sortDir || 'asc'); };
  const delLayout = (name) => { const n = { ...layouts }; delete n[name]; persist(n); };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">Dataset</span>
          <select value={datasetKey} onChange={e => switchDataset(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white outline-none">
            {Object.entries(REPORT_DATASETS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Filter (any selected column)</span>
          <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Type to filter…" className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none" />
        </label>
      </div>

      {/* Column picker */}
      <div>
        <span className="text-xs text-gray-500">Columns</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ds.columns.map(c => (
            <button key={c.key} onClick={() => toggleCol(c.key)}
              className={`text-[11px] px-2 py-1 rounded-full border ${selected.includes(c.key) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort + actions */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Sort by</span>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none">
              <option value="">—</option>
              {cols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} disabled={!sortKey}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 disabled:opacity-40">{sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveLayout} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"><Star size={13} /> Save layout</button>
          <LedgerExportBar title={`Custom Report — ${ds.label}`} subtitle={filterText ? `Filtered: "${filterText}"` : null}
            meta={[`${view.length} rows`]} fileBase={`custom-${datasetKey}`} rows={view} columns={cols} />
        </div>
      </div>

      {/* Saved layouts */}
      {Object.keys(layouts).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(layouts).map(name => (
            <span key={name} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 rounded-full pl-2.5 pr-1 py-0.5">
              <button onClick={() => loadLayout(name)} className="text-gray-700 hover:text-blue-600">{name}</button>
              <button onClick={() => delLayout(name)} className="text-gray-300 hover:text-rose-500"><Trash2 size={11} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Preview */}
      {loading ? <Skeleton /> : (
        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>{cols.map(c => <th key={c.key} className={`px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {view.slice(0, 300).map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {cols.map(c => <td key={c.key} className={`px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.accessor(row) || '—'}</td>)}
                </tr>
              ))}
              {view.length === 0 && <tr><td colSpan={cols.length || 1} className="px-2 py-6 text-center text-gray-400">No rows.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {view.length > 300 && <p className="text-[11px] text-gray-400">Showing first 300 of {view.length} rows — export for the full set.</p>}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const { companyProfileData } = useApp();
  // A Mill role's reports must stay mill-only — no export-order profitability,
  // customers, countries or export A/R / booked profit.
  const millScoped = user?.role === 'Mill Manager';
  // Mill Operator = production-only, finance-free. Sees only production,
  // quality and (quantity-only) inventory — never money, margin, sales,
  // receivables, payables, cashflow or net profit.
  const operatorScoped = user?.role === 'Mill Operator';
  const visibleTabs = operatorScoped
    ? TABS.filter(t => ['production', 'quality', 'inventory'].includes(t.key))
    : millScoped
      ? TABS.filter(t => ['moneyIn', 'moneyOut', 'sales', 'purchases', 'lots', 'margin', 'production', 'inventory', 'kpis', 'quality'].includes(t.key))
      : TABS;

  // Party statements live under /milling for the Mill role, /finance otherwise.
  const statementHref = (type, id) => id
    ? `${millScoped ? '/milling' : '/finance'}/statements?type=${type}&id=${id}`
    : null;

  // One shared right-slider that renders the printable/downloadable document
  // (receipt / voucher / invoice) for whichever report row was clicked.
  const [doc, setDoc] = useState(null); // { kind, title, subtitle, data }
  const openDoc = (d) => setDoc(d);
  const [schedOpen, setSchedOpen] = useState(false); // scheduled-emails drawer
  const [aiOpen, setAiOpen] = useState(false); // AI analyst drawer
  const [builderOpen, setBuilderOpen] = useState(false); // report builder drawer

  // Tab + date range live in the URL (?tab=&range=) so views are deep-linkable,
  // bookmarkable and shareable, and the browser back button moves between tabs.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab = visibleTabs.some(t => t.key === rawTab) ? rawTab : (visibleTabs[0]?.key || 'moneyIn');
  const rawRange = searchParams.get('range') || '';
  const range = RANGES.some(r => r.value === rawRange) ? rawRange : '';
  const setTab = (key) => { const p = new URLSearchParams(searchParams); p.set('tab', key); setSearchParams(p); };
  const setRange = (val) => { const p = new URLSearchParams(searchParams); if (val) p.set('range', val); else p.delete('range'); setSearchParams(p); };
  // Exact-number toggle (?exact=1): show full digits instead of Cr/L/K shorthand.
  const exactMode = searchParams.get('exact') === '1';
  const setExactMode = (on) => { const p = new URLSearchParams(searchParams); if (on) p.set('exact', '1'); else p.delete('exact'); setSearchParams(p); };
  setExactNumbers(exactMode); // applied synchronously before formatters run in JSX below
  const params = useMemo(
    () => ({ ...rangeToParams(range), ...(millScoped ? { entity: 'mill' } : {}) }),
    [range, millScoped],
  );

  // Saved views — persist the current tab + date range as a named report and
  // jump back to it (wires the saved-reports endpoints into the dashboard).
  const { data: savedReports = [] } = useSavedReports();
  const saveMut = useSaveReport();
  const delMut = useDeleteSavedReport();
  const [savedOpen, setSavedOpen] = useState(false);
  const tabKeys = TABS.map(t => t.key);
  const saveCurrentView = async () => {
    const name = window.prompt('Name this view (tab + date range):', `${(TABS.find(t => t.key === tab) || {}).label || tab} — ${(RANGES.find(r => r.value === range) || {}).label || 'All Time'}`);
    if (!name) return;
    try {
      await saveMut.mutateAsync({ name, reportType: tab, entity: millScoped ? 'mill' : 'all', filters: { range }, isShared: false });
    } catch { /* surfaced by the mutation */ }
  };
  const loadView = (r) => {
    const rt = r.reportType || r.report_type;
    if (rt && tabKeys.includes(rt)) setTab(rt);
    const f = r.filters || {};
    setRange(typeof f.range === 'string' ? f.range : '');
    setSavedOpen(false);
  };

  const { data: exec = {}, isLoading: execLoading, refetch: refetchExec } = useExecutiveSummary(params);
  // Headline money totals across the system — receipts vs payments
  // from the unified payments feed. These power both the KPI strip
  // and the Money In/Out tabs without each tab refetching.
  const { data: receiptsData,  refetch: refetchReceipts }  = usePayments({ ...params, type: 'receipt' });
  const { data: paymentsData,  refetch: refetchPayments }  = usePayments({ ...params, type: 'payment' });
  const totalIn  = receiptsData?.totalPkr || 0;
  const totalOut = paymentsData?.totalPkr || 0;
  const netFlow  = totalIn - totalOut;

  const refetchAll = () => { refetchExec(); refetchReceipts(); refetchPayments(); };

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Hero band ─────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-blue-800 to-cyan-700 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <BarChart3 size={14} /> Reports & Analytics
            </div>
            <h1 className="text-3xl font-bold leading-tight">Business Reports</h1>
            <p className="text-sm opacity-80 mt-1">
              Real-time view of every order, customer and shipment — sourced directly from production data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GlobalSearchBox entity={millScoped ? 'mill' : ''} />
            <div className="bg-white/15 backdrop-blur-sm rounded-lg flex items-center gap-1.5 px-2 py-1.5">
              <Calendar size={13} className="opacity-80" />
              <select value={range} onChange={e => setRange(e.target.value)}
                className="bg-transparent border-0 text-xs font-medium text-white outline-none cursor-pointer pr-2">
                {RANGES.map(r => <option key={r.value} value={r.value} className="text-gray-900">{r.label}</option>)}
              </select>
            </div>
            <button onClick={() => setExactMode(!exactMode)}
              title={exactMode ? 'Showing full numbers — click for Cr/L/K shorthand' : 'Showing Cr/L/K shorthand — click for full numbers'}
              className={`backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors ${exactMode ? 'bg-white text-slate-900' : 'bg-white/15 hover:bg-white/25 text-white'}`}>
              <Hash size={12} /> Exact
            </button>
            <button onClick={refetchAll}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
            {!operatorScoped && (
              <button onClick={() => setBuilderOpen(true)} title="Build a custom report"
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
                <Layers size={12} /> Build
              </button>
            )}
            {!operatorScoped && (
              <button onClick={() => setAiOpen(true)} title="Ask AI about your data"
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
                <Search size={12} /> Ask AI
              </button>
            )}
            {!operatorScoped && (
              <button onClick={() => setSchedOpen(true)} title="Schedule reports by email"
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
                <Mail size={12} /> Schedule
              </button>
            )}
            {/* Saved views */}
            <div className="relative">
              <button onClick={() => setSavedOpen(o => !o)}
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors">
                <Star size={12} /> Saved{savedReports.length ? ` (${savedReports.length})` : ''} <ChevronDown size={12} />
              </button>
              {savedOpen && (
                <div className="absolute right-0 mt-1 w-72 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-20 overflow-hidden">
                  <button onClick={saveCurrentView} className="w-full text-left px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 border-b border-gray-100 inline-flex items-center gap-1.5">
                    <Plus size={14} /> Save current view
                  </button>
                  <div className="max-h-72 overflow-y-auto">
                    {savedReports.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-400">No saved views yet.</p>
                    ) : savedReports.map(r => {
                      const rt = r.reportType || r.report_type;
                      const known = TABS.some(t => t.key === rt);
                      return (
                        <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 border-b border-gray-50">
                          <button onClick={() => loadView(r)} className="min-w-0 text-left">
                            <span className="block text-sm font-medium truncate">{r.name}</span>
                            <span className="block text-[11px] text-gray-400">{(TABS.find(t => t.key === rt) || {}).label || rt}{!known ? ' · (not a dashboard tab)' : ''}{r.isShared || r.is_shared ? ' · shared' : ''}</span>
                          </button>
                          <button onClick={() => delMut.mutate(r.id)} title="Delete" className="shrink-0 text-gray-300 hover:text-rose-500"><Trash2 size={14} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {!operatorScoped && (
              <Link to="/reports/invoices"
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
                <Receipt size={14} /> Invoice Ledger
              </Link>
            )}
            <Link to="/reports/lots"
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
              <FileText size={14} /> Lot Reports
            </Link>
            <Link to="/reports/print"
              className="bg-white text-slate-900 hover:bg-gray-100 px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 shadow-sm transition-colors">
              <Printer size={14} /> Print Reports
            </Link>
          </div>
        </div>
      </div>

      {/* ─── Money KPI strip (the headline numbers across the whole system).
          Hidden entirely for the production-only Mill Operator. */}
      {!operatorScoped && (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile icon={ArrowDownLeft} tone="emerald" label="Total Money In"  primary={fmtPKR(totalIn)}  secondary={`${receiptsData?.count ?? 0} receipts`} />
        <KpiTile icon={ArrowUpRight}  tone="rose"    label="Total Money Out" primary={fmtPKR(totalOut)} secondary={`${paymentsData?.count ?? 0} payments`} />
        <KpiTile icon={Activity}      tone={netFlow >= 0 ? 'violet' : 'rose'} label="Net Cashflow"
                 primary={fmtPKR(netFlow)} secondary={netFlow >= 0 ? 'Positive' : 'Negative'} />
        {!millScoped && (
          <KpiTile icon={Coins}       tone="amber"   label="Outstanding A/R" primary={fmtPKR(exec.totalOutstandingPkr)} secondary={`${exec.openReceivables ?? 0} open`} loading={execLoading} />
        )}
        {!millScoped && (
          <KpiTile icon={TrendingUp}  tone="blue"    label="Booked Profit"   primary={fmtPKR(exec.bookedProfitPkr)} secondary={`Margin ${fmtPct(exec.avgMarginPct)}`} loading={execLoading} />
        )}
      </div>
      )}

      {/* Production-only banner for the Mill Operator role. */}
      {operatorScoped && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <Factory size={16} /> Production view — batches, yield, quality and stock quantities. Financial figures are not shown for this role.
        </div>
      )}

      {/* ─── Tabs ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <nav className="flex overflow-x-auto border-b border-gray-200">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 sm:px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key ? 'border-blue-600 text-blue-600 bg-blue-50/40' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 sm:p-6">
          {tab === 'moneyIn'   && <MoneyFlowTab kind="receipt" params={params} totalLabel="Money In"  statementHref={statementHref} openDoc={openDoc} />}
          {tab === 'moneyOut'  && <MoneyFlowTab kind="payment" params={params} totalLabel="Money Out" statementHref={statementHref} openDoc={openDoc} />}
          {tab === 'sales'     && <SalesTab params={params} statementHref={statementHref} openDoc={openDoc} />}
          {tab === 'purchases' && <PurchasesTab params={params} statementHref={statementHref} openDoc={openDoc} />}
          {tab === 'lots'      && <LotsTab params={params} statementHref={statementHref} openDoc={openDoc} />}
          {tab === 'margin'    && <MarginTab params={params} openDoc={openDoc} />}
          {tab === 'production' && <ProductionTab params={params} />}
          {tab === 'forecast'  && <ForecastTab />}
          {tab === 'kpis'      && <KpiTab params={params} millScoped={millScoped} />}
          {tab === 'orders'    && <OrdersTab params={params} />}
          {tab === 'customers' && <CustomersTab params={params} />}
          {tab === 'countries' && <CountriesTab params={params} />}
          {tab === 'inventory' && <InventoryTab millScoped={millScoped} hideValue={operatorScoped} />}
          {tab === 'quality'   && <QualityTab params={params} />}
        </div>
      </div>

      {/* Shared document slider — invoice / receipt / voucher for a clicked row */}
      <SlideDrawer
        open={!!doc}
        onClose={() => setDoc(null)}
        title={doc?.title || 'Document'}
        subtitle={doc?.subtitle}
        icon={Receipt}
        size="lg"
      >
        {doc && (doc.kind === 'margin'
          ? <MarginBreakdown e={doc.data} companyProfile={companyProfileData} />
          : doc.kind === 'batchMargin'
            ? <BatchMarginBreakdown b={doc.data} />
            : doc.kind === 'lot'
              ? <LotTrackerPanel lot={doc.data} statementHref={statementHref} />
              : doc.kind === 'sale'
                ? <SaleTrackerPanel sale={doc.data} statementHref={statementHref} companyProfile={companyProfileData} />
                : <TransactionDocument kind={doc.kind} data={doc.data} companyProfile={companyProfileData} />)}
      </SlideDrawer>

      {/* Scheduled report emails manager */}
      <SlideDrawer open={schedOpen} onClose={() => setSchedOpen(false)} title="Scheduled report emails" subtitle="Email a report on a schedule" icon={Mail} size="lg">
        {schedOpen && <ScheduledEmailsManager />}
      </SlideDrawer>

      {/* AI report analyst */}
      <SlideDrawer open={aiOpen} onClose={() => setAiOpen(false)} title="Ask AI" subtitle="Natural-language questions about your data" icon={Search} size="lg">
        {aiOpen && <AiAnalystDrawer />}
      </SlideDrawer>

      {/* Self-serve report builder */}
      <SlideDrawer open={builderOpen} onClose={() => setBuilderOpen(false)} title="Report Builder" subtitle="Pick a dataset, columns, filter & sort — then export" icon={Layers} size="3xl">
        {builderOpen && <ReportBuilderDrawer />}
      </SlideDrawer>
    </div>
  );
}

// ─── Tab: Money In / Money Out (the unified payments feed) ──────────
function MoneyFlowTab({ kind, params, totalLabel, statementHref, openDoc }) {
  const { data, isLoading } = usePayments({ ...params, type: kind });
  // Receivables / payables backdrop so we can show the open balance
  // alongside the realised cash flow on the same screen.
  const { data: receivables = [] } = useReceivables(params);
  const { data: payables    = [] } = usePayables(params);

  const rows  = data?.payments || [];
  const total = data?.totalPkr || 0;

  // Source breakdown — group receipts by recv_entity / recv_type
  // (export advance vs balance vs local sale), payments by
  // payable_type (vendor / expense / purchase).
  const sourceBreakdown = useMemo(() => {
    const buckets = new Map();
    for (const p of rows) {
      let key;
      if (kind === 'receipt') {
        if (p.localSaleId) key = 'Local Sale';
        else if ((p.recvType || '').toLowerCase().includes('advance')) key = 'Advance';
        else if ((p.recvType || '').toLowerCase().includes('balance')) key = 'Balance';
        else key = 'Other Receipt';
      } else {
        const pt = (p.payableType || '').toLowerCase();
        if (pt === 'expense')  key = 'Business Expense';
        else if (pt === 'purchase') key = 'Mill Purchase';
        else if (pt === 'vendor')   key = 'Supplier Payment';
        else key = 'Other Payment';
      }
      // Backend pre-normalises this so the FE doesn't have to repeat
      // the fallback chain (base_amount_pkr → amount × fx_rate → amount × 280).
      const pkr = parseFloat(p.baseAmountPkrNormalized) || parseFloat(p.baseAmountPkr) || 0;
      const cur = buckets.get(key) || { name: key, count: 0, totalPkr: 0 };
      cur.count += 1; cur.totalPkr += pkr;
      buckets.set(key, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => b.totalPkr - a.totalPkr);
  }, [rows, kind]);

  // Open-balance summary (receivable side for receipts, payable side
  // for payments).
  const openBalance = useMemo(() => {
    const list = kind === 'receipt' ? receivables : payables;
    return list.reduce((s, x) => s + (parseFloat(x.outstanding) || 0), 0);
  }, [kind, receivables, payables]);

  if (isLoading) return <Skeleton />;

  const tone = kind === 'receipt' ? 'emerald' : 'rose';

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`${totalLabel} — every ${kind === 'receipt' ? 'receipt' : 'payment'} across the system`}
        subtitle="Sourced from the unified payments feed (export advances/balances, local sales, supplier payments, expenses, mill purchases)."
      />

      {/* Summary cells */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label={`Total ${totalLabel}`} value={fmtPKR(total)} />
        <SummaryCell label="Transactions" value={String(rows.length)} />
        <SummaryCell label={kind === 'receipt' ? 'Open Receivables' : 'Open Payables'} value={fmtPKR(openBalance)} />
        <SummaryCell label="Sources"       value={String(sourceBreakdown.length)} />
      </div>

      {/* Source breakdown chips */}
      {sourceBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sourceBreakdown.map(b => (
            <div key={b.name} className={`px-3 py-2 rounded-lg border bg-${tone}-50 border-${tone}-200`}>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{b.name}</div>
              <div className="text-sm font-bold text-gray-900">{fmtPKR(b.totalPkr)}</div>
              <div className="text-[11px] text-gray-500">{b.count} {b.count === 1 ? 'txn' : 'txns'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Feed */}
      {rows.length === 0 ? (
        <Empty msg={`No ${kind === 'receipt' ? 'receipts' : 'payments'} in this period.`} />
      ) : (
        <Table
          head={['Date', 'Ref', 'Counterparty', 'Source', 'Bank', 'Amount']}
          align={['left','left','left','left','left','right']}
          rowClick={rows.map(p => () => openDoc?.(paymentToDoc(kind, p)))}
          rows={rows.map(p => {
            const pkr = parseFloat(p.baseAmountPkrNormalized) || parseFloat(p.baseAmountPkr) || 0;
            const isForeign = (p.currency || 'PKR') !== 'PKR';
            const amountCell = isForeign ? (
              <div className="text-right">
                <div className="font-semibold text-gray-900">{fmtPKR(pkr)}</div>
                <div className="text-[11px] text-gray-400">{p.currency} {Number(p.amount).toLocaleString()} @ {p.fxRate}</div>
              </div>
            ) : <span className="font-semibold text-gray-900">{fmtPKR(pkr)}</span>;
            const href = statementHref?.(p.counterpartyType, p.counterpartyId);
            return [
              p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—',
              <span className="font-mono text-xs">{p.paymentNo}</span>,
              href
                ? <Link to={href} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-600 hover:underline">{p.counterparty}</Link>
                : <span className="font-medium">{p.counterparty}</span>,
              p.sourceRef
                ? (p.sourceHref
                    ? <Link to={p.sourceHref} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline text-xs">{p.sourceRef}</Link>
                    : <span className="text-xs text-gray-600">{p.sourceRef}</span>)
                : <span className="text-xs text-gray-400">—</span>,
              <span className="text-xs text-gray-600">{p.bankName || p.paymentMethod || '—'}</span>,
              amountCell,
            ];
          })}
        />
      )}
    </div>
  );
}

// Build the printable doc model for a payments-feed row.
function paymentToDoc(kind, p) {
  const pkr = parseFloat(p.baseAmountPkrNormalized) || parseFloat(p.baseAmountPkr) || 0;
  const cur = p.currency || 'PKR';
  const native = parseFloat(p.amount) || pkr;
  if (kind === 'receipt') {
    return {
      kind: 'receipt', title: 'Payment Receipt', subtitle: p.counterparty,
      data: {
        recvNo: p.paymentNo, customerName: p.counterparty, type: p.recvType || (p.localSaleId ? 'Local Sale' : 'Receipt'),
        currency: cur, dueDate: p.paymentDate, expectedAmount: native, receivedAmount: native, outstanding: 0, status: 'Received',
      },
    };
  }
  return {
    kind: 'voucher', title: 'Payment Voucher', subtitle: p.counterparty,
    data: {
      payNo: p.paymentNo, supplierName: p.counterparty, category: p.payableType || 'Payment', linkedRef: p.sourceRef,
      entity: p.payEntity, currency: cur, dueDate: p.paymentDate, originalAmount: native, paidAmount: native, outstanding: 0, status: 'Paid',
    },
  };
}

// ─── Tab: Sales (local rice sales) ────────────────────────────────────
function SalesTab({ params, statementHref, openDoc }) {
  const { from_date, to_date, entity } = params || {};
  const { data: sales = [], isLoading } = useSalesTracker({ from: from_date, to: to_date, ...(entity ? { entity } : {}) });
  if (isLoading) return <Skeleton />;
  const rows = Array.isArray(sales) ? sales : [];
  if (rows.length === 0) return <Empty msg="No sales in this period." />;

  const total = rows.reduce((s, r) => s + (parseFloat(r.totalAmount) || 0), 0);
  const due   = rows.reduce((s, r) => s + (parseFloat(r.dueAmount) || 0), 0);
  const paid  = rows.reduce((s, r) => s + (parseFloat(r.paidAmount ?? ((parseFloat(r.totalAmount) || 0) - (parseFloat(r.dueAmount) || 0))) || 0), 0);

  return (
    <div className="space-y-5">
      <SectionHeader title="Sales — local rice sales" subtitle="Every local sale. Click a sale to trace its full lifecycle — what was sold, where it came from (supplier → lot → batch), the margin, and the downloadable invoice." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Total Sales" value={fmtPKR(total)} />
        <SummaryCell label="Invoices" value={String(rows.length)} />
        <SummaryCell label="Received" value={fmtPKR(paid)} />
        <SummaryCell label="Outstanding" value={fmtPKR(due)} />
      </div>
      <Table
        head={['Date', 'Sale No', 'Customer', 'Item', 'Qty', 'Amount', 'Status']}
        align={['left', 'left', 'left', 'left', 'right', 'right', 'left']}
        rowClick={rows.map(s => () => openDoc?.({ kind: 'sale', title: s.saleNo, subtitle: s.customer, data: s }))}
        rows={rows.map(s => {
          const cust = s.customerName || 'Walk-in customer';
          const href = statementHref?.('customer', s.customerId);
          return [
            s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—',
            <span className="font-mono text-xs text-blue-600">{s.saleNo}</span>,
            href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-600 hover:underline">{cust}</Link> : <span className="font-medium">{cust}</span>,
            <span className="text-xs">{s.itemName || '—'}</span>,
            mt2(s.quantityKg),
            <span className="font-semibold text-gray-900">{fmtPKR(s.totalAmount)}</span>,
            <StatusChip s={s.paymentStatus} />,
          ];
        })}
      />
    </div>
  );
}

// Slider: the full lifecycle of one sale (back-traced to supplier).
function SaleTrackerPanel({ sale, statementHref, companyProfile }) {
  const navigate = useNavigate();
  const prov = sale.provenance || {};
  const custHref = statementHref?.('customer', sale.customerId);
  const Cell = ({ label, value }) => (
    <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className="text-sm text-gray-800">{value}</p></div>
  );
  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <Cell label="Sale" value={<span className="font-mono">{sale.saleNo}</span>} />
        <Cell label="Customer" value={custHref ? <Link to={custHref} className="text-blue-600 hover:underline">{sale.customerName}</Link> : (sale.customerName || '—')} />
        <Cell label="Date" value={sale.saleDate ? new Date(sale.saleDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
        <Cell label="Payment" value={<><StatusBadgeMini s={sale.paymentStatus} /> {sale.dueAmount > 0 ? <span className="text-xs text-rose-600">{fmtPKR(sale.dueAmount)} due</span> : <span className="text-xs text-emerald-600">received</span>}</>} />
      </div>

      {/* What was sold */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">What was sold</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Cell label="Item" value={`${sale.itemName || '—'}${sale.itemType ? ` (${sale.itemType})` : ''}`} />
          <Cell label="Quantity" value={`${mt2(sale.quantityKg)}${sale.quantityBags ? ` · ${sale.quantityBags} bags` : ''}`} />
          <Cell label="Rate / kg" value={sale.ratePerKg > 0 ? `Rs ${Math.round(sale.ratePerKg).toLocaleString()}` : '—'} />
          <Cell label="From lot" value={sale.lotId ? <Link to={`/lot-inventory/${sale.lotId}`} className="text-blue-600 hover:underline font-mono text-xs">{sale.lotNo || '—'}</Link> : (sale.lotNo || '—')} />
          {sale.collectionLocation && <Cell label="Collected at" value={sale.collectionLocation} />}
        </div>
      </div>

      {/* Provenance — where it came from */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Where it came from</h4>
        {prov.kind === 'milled' ? (
          <div className="text-sm space-y-1.5">
            <p>Milled in batch {prov.batchId ? <Link to={`/milling/${prov.batchId}`} className="text-blue-600 hover:underline">{prov.batchNo}</Link> : (prov.batchNo || '—')}, from:</p>
            {(prov.rawLots || []).length > 0 ? (prov.rawLots || []).map((rl, i) => (
              <div key={i} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-1.5">
                <span>{rl.lotId ? <Link to={`/lot-inventory/${rl.lotId}`} className="text-blue-600 hover:underline font-mono text-xs">{rl.lotNo}</Link> : <span className="font-mono text-xs">{rl.lotNo}</span>}
                  {rl.supplier ? <> · {rl.supplierId ? <Link to={statementHref?.('supplier', rl.supplierId)} className="text-blue-600 hover:underline">{rl.supplier}</Link> : rl.supplier}</> : null}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{rl.kg ? mt2(rl.kg) : ''}{rl.sharePct != null && rl.sharePct < 99.5 ? ` · ${Math.round(rl.sharePct)}%` : ''}</span>
              </div>
            )) : <p className="text-xs text-gray-400">Raw source not recorded.</p>}
          </div>
        ) : prov.kind === 'raw' ? (
          <p className="text-sm">Sold as unprocessed rice — purchased lot {(prov.rawLots || [])[0]?.lotId ? <Link to={`/lot-inventory/${prov.rawLots[0].lotId}`} className="text-blue-600 hover:underline font-mono text-xs">{prov.rawLots[0].lotNo}</Link> : (prov.rawLots?.[0]?.lotNo || sale.lotNo || '—')}
            {prov.rawLots?.[0]?.supplier ? <> from {prov.rawLots[0].supplierId ? <Link to={statementHref?.('supplier', prov.rawLots[0].supplierId)} className="text-blue-600 hover:underline">{prov.rawLots[0].supplier}</Link> : prov.rawLots[0].supplier}</> : null}.</p>
        ) : (
          <p className="text-xs text-gray-400">Source lot not linked to this sale.</p>
        )}
      </div>

      {/* Financials */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Financials</h4>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-3 py-2 text-gray-600">Sale value</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(sale.totalAmount)}</td></tr>
              <tr><td className="px-3 py-2 text-gray-600">Received</td><td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtPKR(sale.paidAmount)}</td></tr>
              <tr><td className="px-3 py-2 text-gray-600">Outstanding</td><td className={`px-3 py-2 text-right tabular-nums ${sale.dueAmount > 0 ? 'text-rose-700' : 'text-gray-500'}`}>{fmtPKR(sale.dueAmount)}</td></tr>
              <tr><td className="px-3 py-2 text-gray-600">Cost of goods (landed)</td><td className="px-3 py-2 text-right tabular-nums">{sale.soldCostPerKg > 0 ? fmtPKR(sale.cost) : '—'}</td></tr>
              <tr className="bg-gray-50">
                <td className="px-3 py-2 font-semibold text-gray-800">Gross margin</td>
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${sale.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{sale.soldCostPerKg > 0 ? <>{fmtPKR(sale.margin)} ({(parseFloat(sale.marginPct) || 0).toFixed(1)}%)</> : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Items · payment trail · dispatch (Phase 2) */}
      <SaleDetailSection saleId={sale.saleId} />

      {/* Downloadable invoice */}
      <div className="pt-2 border-t border-gray-100">
        <TransactionDocument kind="invoice" data={sale} companyProfile={companyProfile} />
      </div>

      <button onClick={() => navigate(`/local-sales/${sale.saleId}`)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
        <ExternalLink size={14} /> Open sale detail
      </button>
    </div>
  );
}

// Column defs for CSV/print of a sale's line items.
const SALE_ITEM_COLS = [
  { label: 'Item', align: 'left', accessor: (i) => i.item || '' },
  { label: 'Lot', align: 'left', accessor: (i) => i.lotNo || '' },
  { label: 'Qty (kg)', align: 'right', accessor: (i) => Math.round(i.quantityKg) },
  { label: 'Rate/kg (PKR)', align: 'right', accessor: (i) => i.ratePerKg > 0 ? Math.round(i.ratePerKg) : '' },
  { label: 'Value (PKR)', align: 'right', accessor: (i) => Math.round(i.totalAmount) },
];

// Lazy-loaded Sale 360 extras — all line items (multi-item sales), the
// payment trail, and dispatch info. Fetches /reporting/sale-detail/:id.
function SaleDetailSection({ saleId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!saleId) { setLoading(false); return; }
    setLoading(true);
    reportingApi.saleDetail(saleId)
      .then(res => setData(res?.sale ? res : (res?.data || res)))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [saleId]);
  if (loading || !data) return null;
  const items = data.items || [];
  const payments = data.payments || [];
  const dispatch = data.dispatch || {};
  const t = data.totals || {};
  const multi = items.length > 1;
  const hasDispatch = dispatch.dispatched || dispatch.vehicleNo || dispatch.driverName;
  if (!multi && payments.length === 0 && !hasDispatch) return null;
  return (
    <div className="space-y-4">
      {multi && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Line items {data.sale?.saleGroupNo ? <span className="text-gray-400 font-normal">· group {data.sale.saleGroupNo}</span> : ''}</h4>
            <LedgerExportBar title="Sale — line items" subtitle={`Sale ${data.sale?.saleNo || ''}${data.sale?.customer ? ` · ${data.sale.customer}` : ''}`}
              fileBase={`sale-${data.sale?.saleNo || saleId}`} rows={items} columns={SALE_ITEM_COLS} />
          </div>
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-2 py-1.5 text-left font-medium">Item</th><th className="px-2 py-1.5 text-left font-medium">Lot</th><th className="px-2 py-1.5 text-right font-medium">kg</th><th className="px-2 py-1.5 text-right font-medium">Rate/kg</th><th className="px-2 py-1.5 text-right font-medium">Value</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(it => (
                  <tr key={it.id}><td className="px-2 py-1.5">{it.item || '—'}</td><td className="px-2 py-1.5">{it.href ? <Link to={it.href} className="font-mono text-blue-600 hover:underline">{it.lotNo}</Link> : (it.lotNo || '—')}</td><td className="px-2 py-1.5 text-right tabular-nums">{Math.round(it.quantityKg).toLocaleString()}</td><td className="px-2 py-1.5 text-right tabular-nums">{it.ratePerKg > 0 ? `Rs ${Math.round(it.ratePerKg).toLocaleString()}` : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtPKR(it.totalAmount)}</td></tr>
                ))}
                <tr className="bg-gray-50 font-semibold"><td className="px-2 py-1.5" colSpan={2}>Total</td><td className="px-2 py-1.5 text-right tabular-nums">{Math.round(t.quantityKg).toLocaleString()}</td><td className="px-2 py-1.5" /><td className="px-2 py-1.5 text-right tabular-nums">{fmtPKR(t.totalAmount)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment trail</h4>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-600">{p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} · <span className="capitalize">{p.method || 'payment'}</span>{p.reference ? ` · ${p.reference}` : ''}</span>
                <span className="tabular-nums font-medium text-emerald-700">{fmtPKR(p.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 font-semibold"><span>Total received</span><span className="tabular-nums">{fmtPKR(t.paid)}</span></div>
          </div>
        </div>
      )}

      {hasDispatch && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Dispatch</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`px-2.5 py-1 rounded-lg border ${dispatch.dispatched ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>{dispatch.dispatched ? 'Dispatched' : 'Not dispatched'}</span>
            {dispatch.dispatchDate && <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">{new Date(dispatch.dispatchDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
            {dispatch.vehicleNo && <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">Vehicle {dispatch.vehicleNo}</span>}
            {dispatch.driverName && <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">{dispatch.driverName}</span>}
            {dispatch.collectionLocation && <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">Collected at {dispatch.collectionLocation}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Purchases (rice lots + mill store + expenses) ────────────────
function PurchasesTab({ params, statementHref, openDoc }) {
  const { data, isLoading } = usePurchases(params);
  const [open, setOpen] = useState(null); // expanded row key
  if (isLoading) return <Skeleton />;
  const rows = data?.purchases || [];
  if (rows.length === 0) return <Empty msg="No purchases in this period." />;

  const totals = data?.totals || {};
  const total = parseFloat(totals.totalPkr ?? totals.total_pkr) || rows.reduce((s, r) => s + (parseFloat(r.amountPkr) || 0), 0);
  const unpaid = rows.filter(r => String(r.paymentStatus || '').toLowerCase() !== 'paid')
    .reduce((s, r) => s + (parseFloat(r.amountPkr) || 0), 0);
  const keyOf = (r) => `${r.source}-${r.refId ?? r.ref}`;

  return (
    <div className="space-y-5">
      <SectionHeader title="Purchases — rice, mill store & expenses" subtitle="Click a row to expand its details (quantity, rate per kg, katta, payment); use the voucher button for the downloadable document." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Total Purchases" value={fmtPKR(total)} />
        <SummaryCell label="Records" value={String(rows.length)} />
        <SummaryCell label="Unpaid" value={fmtPKR(unpaid)} />
        <SummaryCell label="Suppliers" value={String(new Set(rows.map(r => r.supplierName).filter(Boolean)).size)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              <th className="w-8 py-2.5 px-3" />
              <th className="text-left py-2.5 px-3">Date</th>
              <th className="text-left py-2.5 px-3">Ref</th>
              <th className="text-left py-2.5 px-3">Supplier</th>
              <th className="text-left py-2.5 px-3">Category</th>
              <th className="text-right py-2.5 px-3">Amount</th>
              <th className="text-left py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const k = keyOf(r);
              const isOpen = open === k;
              const sup = r.supplierName || '—';
              const href = statementHref?.('supplier', r.supplierId);
              return (
                <Fragment key={k}>
                  <tr onClick={() => setOpen(isOpen ? null : k)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="py-2.5 px-3 text-gray-400">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="py-2.5 px-3">{r.date ? new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-xs">{r.ref}</td>
                    <td className="py-2.5 px-3">{href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-600 hover:underline">{sup}</Link> : <span className="font-medium">{sup}</span>}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-600 capitalize">{r.category || r.source}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-900">{fmtPKR(r.amountPkr)}</td>
                    <td className="py-2.5 px-3"><StatusChip s={r.paymentStatus} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/60">
                      <td />
                      <td colSpan={6} className="px-3 pb-3 pt-1">
                        <PurchaseDetail r={r} openDoc={openDoc} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Expanded detail for a purchase row — qty / per-kg / katta for rice lots,
// payment state, and a button to open the downloadable voucher.
function PurchaseDetail({ r, openDoc }) {
  const isLot = r.source === 'lot';
  const qtyKg = parseFloat(r.qtyKg) || 0;
  const ratePerKg = parseFloat(r.ratePerKg) || 0;
  const bags = r.bags != null && r.bags !== '' ? parseInt(r.bags, 10) : null;
  const amount = parseFloat(r.amountPkr) || 0;
  const paid = String(r.paymentStatus || '').toLowerCase() === 'paid';
  const Cell = ({ label, value }) => (
    <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className="text-sm text-gray-800">{value}</p></div>
  );
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {isLot && <Cell label="Quantity" value={qtyKg > 0 ? `${Math.round(qtyKg).toLocaleString()} kg (${(qtyKg / 1000).toFixed(2)} MT)` : '—'} />}
        {isLot && <Cell label="Rate / kg" value={ratePerKg > 0 ? `Rs ${ratePerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : <span className="text-amber-600">Not recorded</span>} />}
        {isLot && <Cell label="Katta (bags)" value={bags != null ? `${bags.toLocaleString()}${r.bagWeightKg ? ` × ${parseFloat(r.bagWeightKg)} kg` : ''}` : <span className="text-amber-600">Not recorded</span>} />}
        <Cell label="Supplier" value={r.supplierName || '—'} />
        <Cell label="Total amount" value={fmtPKR(amount)} />
        <Cell label="Payment" value={<StatusChip s={r.paymentStatus} />} />
        {r.createdByName && <Cell label="Recorded by" value={r.createdByName} />}
        {r.date && <Cell label="Date" value={new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} />}
      </div>

      {!paid && (
        <div className="text-xs rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-amber-800">
          {amount > 0
            ? <>Unpaid — <span className="font-semibold">{fmtPKR(amount)}</span> outstanding to {r.supplierName || 'the supplier'}. Pay it from Mill Finance → Suppliers / Money Out.</>
            : <>No purchase price recorded for this lot yet, so there's nothing to pay. Set the price on the lot (Lot detail → Edit price) to create the supplier payable.</>}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={(e) => { e.stopPropagation(); openDoc?.(purchaseToDoc(r)); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
          <FileText size={13} /> View / download voucher
        </button>
      </div>
    </div>
  );
}

function purchaseToDoc(r) {
  const amt = parseFloat(r.amountPkr) || 0;
  const isPaid = String(r.paymentStatus || '').toLowerCase() === 'paid';
  const paid = isPaid ? amt : 0;
  return {
    kind: 'voucher', title: 'Payment Voucher', subtitle: r.supplierName || r.ref,
    data: {
      payNo: r.ref, supplierName: r.supplierName || '—', category: r.category || r.source, linkedRef: r.ref,
      currency: r.currency || 'PKR', dueDate: r.date, originalAmount: amt, paidAmount: paid,
      outstanding: Math.max(0, amt - paid), status: r.paymentStatus,
    },
  };
}

// ─── Tab: Margin (buy cost + expenses vs sale price, per sold lot) ─────
// "Cost" is the lot's LANDED cost — the purchase price plus any costs added
// to the lot — so it already folds the expenses in. We surface it both per-kg
// and as a total next to the sale price so the trading margin is obvious.
function marginRow(s) {
  const soldKg = parseFloat(s.quantityKg) || 0;
  const costPerKg = parseFloat(s.lotCostPerKg) || 0;
  const sale = parseFloat(s.totalAmount) || 0;
  // Prefer per-kg × sold qty (handles partial sales); fall back to the lot total.
  const cost = costPerKg > 0 ? costPerKg * soldKg : (parseFloat(s.lotLandedTotal) || 0);
  const hasCost = costPerKg > 0 || (parseFloat(s.lotLandedTotal) || 0) > 0;
  const salePerKg = soldKg > 0 ? sale / soldKg : (parseFloat(s.ratePerKg) || 0);
  const margin = sale - cost;
  const marginPct = sale > 0 ? (margin / sale) * 100 : 0;
  return { s, soldKg, costPerKg, salePerKg, cost, sale, margin, marginPct, hasCost };
}

function MarginTab({ params, openDoc }) {
  const [view, setView] = useState('sale'); // 'sale' | 'batch'
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <SectionHeader
          title="Trading Margin — buy cost + expenses vs sale price"
          subtitle={view === 'sale'
            ? 'By Sale: each local sale vs its lot’s landed cost (purchase + costs added to the lot). Click a row for the breakdown.'
            : 'By Batch: each milling / blending batch’s input cost (raw + milling) vs the realised sales of its finished + by-product outputs.'}
        />
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm shrink-0">
          {[['sale', 'By Sale'], ['batch', 'By Batch']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 font-medium ${view === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>
      </div>
      {view === 'sale' ? <MarginBySale params={params} openDoc={openDoc} /> : <MarginByBatch params={params} openDoc={openDoc} />}
    </div>
  );
}

function MarginBySale({ params, openDoc }) {
  const { data: sales = [], isLoading } = useLocalSales(params);
  if (isLoading) return <Skeleton />;
  const raw = Array.isArray(sales) ? sales : (sales?.sales || []);
  if (raw.length === 0) return <Empty msg="No sales to analyse in this period." />;
  const rows = raw.map(marginRow);

  const totRev = rows.reduce((a, e) => a + e.sale, 0);
  const totCost = rows.reduce((a, e) => a + (e.hasCost ? e.cost : 0), 0);
  const totMargin = totRev - totCost;
  const avgPct = totRev > 0 ? (totMargin / totRev) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Revenue" value={fmtPKR(totRev)} />
        <SummaryCell label="Cost (buy + exp)" value={fmtPKR(totCost)} />
        <SummaryCell label="Gross Margin" value={<span className={totMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtPKR(totMargin)}</span>} />
        <SummaryCell label="Avg Margin" value={fmtPct(avgPct)} />
      </div>
      <Table
        head={['Sale No', 'Lot', 'Item', 'Sold', 'Cost/kg', 'Sale/kg', 'Cost', 'Sale', 'Margin', '%']}
        align={['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
        rowClick={rows.map(e => () => openDoc?.({ kind: 'margin', title: 'Trading Margin', subtitle: e.s.saleNo, data: e }))}
        rows={rows.map(e => {
          const s = e.s;
          return [
            <span className="font-mono text-xs">{s.saleNo}</span>,
            s.lotId
              ? <Link to={`/lot-inventory/${s.lotId}`} onClick={(ev) => ev.stopPropagation()} className="text-blue-600 hover:underline text-xs">{s.lotRef || '—'}</Link>
              : <span className="text-xs text-gray-500">{s.lotRef || '—'}</span>,
            <span className="text-xs">{s.itemName || '—'}</span>,
            `${Math.round(e.soldKg).toLocaleString()} kg`,
            e.hasCost ? `Rs ${Math.round(e.costPerKg).toLocaleString()}` : '—',
            `Rs ${Math.round(e.salePerKg).toLocaleString()}`,
            e.hasCost ? fmtPKR(e.cost) : '—',
            <span className="font-semibold text-gray-900">{fmtPKR(e.sale)}</span>,
            e.hasCost ? <ProfitCell v={e.margin} /> : <span className="text-gray-400">—</span>,
            e.hasCost ? <span className={`font-medium ${e.marginPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{e.marginPct.toFixed(1)}%</span> : '—',
          ];
        })}
      />
      <p className="text-[11px] text-gray-400">Cost = the lot's landed cost (purchase price + any costs added to the lot). Open the lot for the itemised cost breakdown.</p>
    </div>
  );
}

// Slider body for a Margin row — buy-vs-sale breakdown + the downloadable invoice.
function MarginBreakdown({ e, companyProfile }) {
  const s = e.s;
  const perKgMargin = e.salePerKg - e.costPerKg;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-gray-500">Sale</p><p className="font-medium">{s.saleNo}</p></div>
        <div><p className="text-xs text-gray-500">Lot</p><p className="font-medium">{s.lotRef || '—'}</p></div>
        <div><p className="text-xs text-gray-500">Item</p><p>{s.itemName || '—'}</p></div>
        <div><p className="text-xs text-gray-500">Sold</p><p>{Math.round(e.soldKg).toLocaleString()} kg</p></div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase text-gray-500">
              <th className="text-left px-3 py-2">Line</th>
              <th className="text-right px-3 py-2">Per kg</th>
              <th className="text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="px-3 py-2 text-gray-600">Buying price + expenses</td><td className="px-3 py-2 text-right tabular-nums">Rs {Math.round(e.costPerKg).toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(e.cost)}</td></tr>
            <tr><td className="px-3 py-2 text-gray-600">Selling price</td><td className="px-3 py-2 text-right tabular-nums">Rs {Math.round(e.salePerKg).toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(e.sale)}</td></tr>
            <tr className="bg-gray-50">
              <td className="px-3 py-2 font-semibold text-gray-800">Gross margin</td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${perKgMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{perKgMargin >= 0 ? '+' : ''}Rs {Math.round(perKgMargin).toLocaleString()}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold ${e.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtPKR(e.margin)} ({e.marginPct.toFixed(1)}%)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Cost is the lot's landed cost (purchase + any costs added to the lot). For the itemised expense list, open the lot.</p>

      {/* Downloadable sales invoice */}
      <div className="pt-2 border-t border-gray-100">
        <TransactionDocument kind="invoice" data={s} companyProfile={companyProfile} />
      </div>
    </div>
  );
}

// Readable label for a by-product grade code.
const GRADE_LABELS = {
  b1: 'Broken B1', b2: 'Broken B2', b3: 'Broken B3', csr: 'CSR', short_grain: 'Short Grain',
  broken: 'Broken', sortex: 'Sortex', powder: 'Powder', sweeping: 'Sweeping',
};
function gradeLabel(g) {
  if (!g) return 'By-product';
  const k = String(g).toLowerCase().trim().replace(/\s+/g, '_');
  return GRADE_LABELS[k] || g;
}

// Margin grouped by milling/blending batch — input cost vs realised output sales.
function MarginByBatch({ params, openDoc }) {
  // Batch margin is keyed off milling_batches (created_at) — pass only the date range.
  const { from_date, to_date } = params || {};
  const { data: batches = [], isLoading } = useBatchMargin({ from_date, to_date });
  if (isLoading) return <Skeleton />;
  const rows = Array.isArray(batches) ? batches : [];
  if (rows.length === 0) return <Empty msg="No milling/blending batches in this period." />;

  const totInput = rows.reduce((a, b) => a + (parseFloat(b.inputCost) || 0), 0);
  const totSold = rows.reduce((a, b) => a + (parseFloat(b.soldValue) || 0), 0);
  const totCostOfSold = rows.reduce((a, b) => a + (parseFloat(b.costOfSold) || 0), 0);
  const totMargin = totSold - totCostOfSold;
  const totOnHand = rows.reduce((a, b) => a + (parseFloat(b.onHandValue) || 0), 0);
  const avgPct = totSold > 0 ? (totMargin / totSold) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryCell label="Input cost (raw + milling)" value={fmtPKR(totInput)} />
        <SummaryCell label="Output sold" value={fmtPKR(totSold)} />
        <SummaryCell label="Cost of sold" value={fmtPKR(totCostOfSold)} />
        <SummaryCell label="Realised margin" value={<span className={totMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtPKR(totMargin)}</span>} />
        <SummaryCell label="On-hand (at cost)" value={fmtPKR(totOnHand)} />
      </div>
      <Table
        head={['Batch', 'Supplier', 'Input', 'Finished', 'Input cost', 'Output sold', 'Cost of sold', 'Margin', '%', 'Batch 360']}
        align={['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center']}
        rowClick={rows.map(b => () => openDoc?.({ kind: 'batchMargin', title: 'Batch Margin', subtitle: b.batchNo, data: b }))}
        rows={rows.map(b => {
          const sold = parseFloat(b.soldValue) || 0;
          const hasSales = sold > 0;
          return [
            <span className="font-mono text-xs">{b.batchNo}</span>,
            <span className="text-xs">{b.supplierName || '—'}</span>,
            `${(parseFloat(b.rawQtyMT) || 0).toFixed(1)} MT`,
            `${(parseFloat(b.finishedMT) || 0).toFixed(1)} MT`,
            fmtPKR(b.inputCost),
            <span className="font-semibold text-gray-900">{fmtPKR(sold)}</span>,
            hasSales ? fmtPKR(b.costOfSold) : '—',
            hasSales ? <ProfitCell v={b.realizedMargin} /> : <span className="text-gray-400">—</span>,
            hasSales ? <span className={`font-medium ${(parseFloat(b.realizedMarginPct) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{(parseFloat(b.realizedMarginPct) || 0).toFixed(1)}%</span> : '—',
            <Link to={`/reports/batch-ledger/${b.id}`} onClick={(ev) => ev.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 whitespace-nowrap">
              <Factory size={12} /> Batch 360
            </Link>,
          ];
        })}
      />
      <p className="text-[11px] text-gray-400">Input cost = the batch's full cost basis (input rice + milling fee + other expenses + packing) — the same basis the residual cost engine uses, so it reconciles with the output lots' landed value. Output sold = realised local sales of the batch's finished + by-product lots, priced at each lot's residual landed cost. Unsold output is valued at cost under "On-hand".</p>
    </div>
  );
}

// Slider body for a Batch Margin row — input vs realised-output breakdown.
function BatchMarginBreakdown({ b }) {
  const navigate = useNavigate();
  const input = parseFloat(b.inputCost) || 0;
  const sold = parseFloat(b.soldValue) || 0;
  const costOfSold = parseFloat(b.costOfSold) || 0;
  const onHand = parseFloat(b.onHandValue) || 0;
  const margin = sold - costOfSold;
  const marginPct = sold > 0 ? (margin / sold) * 100 : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-gray-500">Batch</p><p className="font-medium">{b.batchNo}</p></div>
        <div><p className="text-xs text-gray-500">Supplier</p><p>{b.supplierName || '—'}</p></div>
        <div><p className="text-xs text-gray-500">Input</p><p>{(parseFloat(b.rawQtyMT) || 0).toFixed(2)} MT</p></div>
        <div><p className="text-xs text-gray-500">Finished</p><p>{(parseFloat(b.finishedMT) || 0).toFixed(2)} MT · yield {(parseFloat(b.yieldPct) || 0).toFixed(1)}%</p></div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="px-3 py-2 text-gray-600">Input cost (raw + milling)</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(input)}</td></tr>
            <tr><td className="px-3 py-2 text-gray-600">Output sold (realised)</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(sold)}</td></tr>
            <tr><td className="px-3 py-2 text-gray-600">Cost of sold output</td><td className="px-3 py-2 text-right tabular-nums">{fmtPKR(costOfSold)}</td></tr>
            <tr className="bg-gray-50">
              <td className="px-3 py-2 font-semibold text-gray-800">Realised margin</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtPKR(margin)} ({marginPct.toFixed(1)}%)</td>
            </tr>
            <tr><td className="px-3 py-2 text-gray-500">Unsold output on hand (at cost)</td><td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtPKR(onHand)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Realised margin counts only output already sold. Unsold finished/by-product stock is held at cost until sold. Input cost = input rice + milling fee + other expenses + packing (the residual cost basis); it reconciles with cost-of-sold + on-hand.</p>

      {/* Per-grade by-product breakdown */}
      {Array.isArray(b.byproducts) && b.byproducts.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-gray-700">By-product recovery by grade</h4>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <th className="text-left px-2 py-1.5">Grade</th>
                  <th className="text-right px-2 py-1.5">Produced</th>
                  <th className="text-right px-2 py-1.5">Price/kg</th>
                  <th className="text-right px-2 py-1.5">Value</th>
                  <th className="text-right px-2 py-1.5">Sold</th>
                  <th className="text-right px-2 py-1.5">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {b.byproducts.map((g, i) => {
                  const soldV = parseFloat(g.soldValue) || 0;
                  const m = parseFloat(g.margin) || 0;
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-medium text-gray-800">{gradeLabel(g.grade)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(parseFloat(g.producedKg) || 0).toLocaleString()} kg</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">Rs {Math.round(parseFloat(g.valuationPerKg) || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtPKR(g.valuationValue)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{soldV > 0 ? fmtPKR(soldV) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{soldV > 0 ? <span className={m >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmtPKR(m)}</span> : '—'}</td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 font-semibold text-gray-800">
                  <td className="px-2 py-1.5">Total recovery</td>
                  <td className="px-2 py-1.5" />
                  <td className="px-2 py-1.5" />
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtPKR(b.byproductRecovery)}</td>
                  <td className="px-2 py-1.5" colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">By-products are valued at their expected sale price; that value (recovery) is credited back into the finished cost, lowering it. “Margin” is what a grade actually sold for vs that valuation — 0 when sold at the valuation price, +/- if it sold higher/lower.</p>
        </div>
      )}

      {/* Full processing ledger — inputs / costs / outputs (Phase 2) */}
      <BatchLedgerSection batchId={b.id} />

      <div className="flex flex-wrap gap-2">
        <Link to={`/reports/batch-ledger/${b.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Factory size={14} /> Open complete Batch 360
        </Link>
        <button onClick={() => navigate(`/milling/${b.id}`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
          <ExternalLink size={14} /> Open batch detail
        </button>
      </div>
    </div>
  );
}

// Column defs for CSV/print of a batch's output lots.
const BATCH_OUTPUT_COLS = [
  { label: 'Lot', align: 'left', key: 'lotNo' },
  { label: 'Output', align: 'left', key: 'item' },
  { label: 'Type', align: 'left', accessor: (o) => o.type === 'byproduct' ? 'by-product' : 'finished' },
  { label: 'Qty (kg)', align: 'right', accessor: (o) => Math.round(o.kg) },
  { label: 'Cost/kg (PKR)', align: 'right', accessor: (o) => o.costPerKg > 0 ? Math.round(o.costPerKg) : '' },
  { label: 'Value (PKR)', align: 'right', accessor: (o) => Math.round(o.valuePkr) },
];

// Lazy-loaded batch processing ledger — inputs (source lots), recorded costs
// and outputs (finished + by-product lots), with input/output reconciliation.
function BatchLedgerSection({ batchId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || data || !batchId) return;
    setLoading(true);
    reportingApi.batchLedger(batchId)
      .then(res => setData(res?.batch ? res : (res?.data || res)))
      .catch(() => setData({ error: true }))
      .finally(() => setLoading(false));
  }, [open, data, batchId]);
  const inputs = data?.inputs || [];
  const costs = data?.costs || [];
  const outputs = data?.outputs || [];
  const t = data?.totals || {};
  const mc = data?.manualCosts || {};
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 mb-2 hover:text-blue-700">
        <span className="inline-flex items-center gap-1.5"><Factory size={14} /> Processing ledger</span>
        <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (loading ? <p className="text-xs text-gray-400">Loading ledger…</p> : !data || data.error ? <p className="text-xs text-gray-400">Could not load ledger.</p> : (
        <div className="space-y-3">
          <LedgerExportBar
            title="Batch Processing Ledger"
            subtitle={`Batch ${data?.batch?.batchNo || ''}${data?.batch?.product ? ` · ${data.batch.product}` : ''}${data?.batch?.isBlend ? ' · blend' : ''}`}
            meta={[`Input ${(t.inputMt || 0).toFixed(2)} MT`, `Output ${(t.outputMt || 0).toFixed(2)} MT`, `Loss ${(t.lossMt || 0).toFixed(2)} MT`]}
            fileBase={`batch-ledger-${data?.batch?.batchNo || batchId}`}
            rows={outputs} columns={BATCH_OUTPUT_COLS}
            footerNote="Output lots from this batch (finished + by-product), valued at residual cost. Inputs &amp; costs shown on screen." />
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Inputs — source rice lots</p>
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr><th className="px-2 py-1.5 text-left font-medium">Lot</th><th className="px-2 py-1.5 text-left font-medium">Rice</th><th className="px-2 py-1.5 text-left font-medium">Supplier</th><th className="px-2 py-1.5 text-right font-medium">MT</th><th className="px-2 py-1.5 text-right font-medium">Cost</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {inputs.map((r, i) => (
                    <tr key={i}><td className="px-2 py-1.5 font-mono">{r.href ? <Link to={r.href} className="text-blue-600 hover:underline">{r.lotNo}</Link> : r.lotNo}</td><td className="px-2 py-1.5">{r.item}{r.variety ? ` · ${r.variety}` : ''}</td><td className="px-2 py-1.5 text-gray-600">{r.supplier}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.qtyMt.toFixed(2)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtPKR(r.costTotalPkr)}</td></tr>
                  ))}
                  {inputs.length === 0 && <tr><td colSpan={5} className="px-2 py-1.5 text-gray-400">No source lots recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {(costs.length > 0 || mc.milling > 0 || mc.other > 0) && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Recorded processing costs</p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
                {mc.milling > 0 && <div className="flex justify-between px-2 py-1.5"><span className="text-gray-600">Milling fee (manual)</span><span className="tabular-nums">{fmtPKR(mc.milling)}</span></div>}
                {mc.other > 0 && <div className="flex justify-between px-2 py-1.5"><span className="text-gray-600">Other expenses (manual)</span><span className="tabular-nums">{fmtPKR(mc.other)}</span></div>}
                {costs.map(c => <div key={c.id} className="flex justify-between px-2 py-1.5"><span className="text-gray-600 capitalize">{c.category}{c.notes ? ` · ${c.notes}` : ''}</span><span className="tabular-nums">{fmtPKR(c.amount)}</span></div>)}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Outputs — finished &amp; by-product</p>
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr><th className="px-2 py-1.5 text-left font-medium">Lot</th><th className="px-2 py-1.5 text-left font-medium">Output</th><th className="px-2 py-1.5 text-right font-medium">kg</th><th className="px-2 py-1.5 text-right font-medium">Cost/kg</th><th className="px-2 py-1.5 text-right font-medium">Value</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {outputs.map((o, i) => (
                    <tr key={i}><td className="px-2 py-1.5 font-mono">{o.href ? <Link to={o.href} className="text-blue-600 hover:underline">{o.lotNo}</Link> : o.lotNo}</td><td className="px-2 py-1.5">{o.item}<span className="text-gray-400"> · {o.type === 'byproduct' ? 'by-product' : 'finished'}</span></td><td className="px-2 py-1.5 text-right tabular-nums">{Math.round(o.kg).toLocaleString()}</td><td className="px-2 py-1.5 text-right tabular-nums">{o.costPerKg > 0 ? `Rs ${Math.round(o.costPerKg).toLocaleString()}` : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtPKR(o.valuePkr)}</td></tr>
                  ))}
                  {outputs.length === 0 && <tr><td colSpan={5} className="px-2 py-1.5 text-gray-400">No output lots yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 rounded-lg p-2"><p className="text-[11px] text-slate-500">Input</p><p className="text-sm font-bold text-slate-700">{(t.inputMt || 0).toFixed(2)} MT</p></div>
            <div className="bg-blue-50 rounded-lg p-2"><p className="text-[11px] text-blue-600">Output</p><p className="text-sm font-bold text-blue-700">{(t.outputMt || 0).toFixed(2)} MT</p></div>
            <div className="bg-amber-50 rounded-lg p-2"><p className="text-[11px] text-amber-600">Processing loss</p><p className="text-sm font-bold text-amber-700">{(t.lossMt || 0).toFixed(2)} MT</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab: Lots — one row per purchased lot, click for its full lifecycle ──
const LOT_STATUS_TONE = {
  'In stock': 'bg-emerald-100 text-emerald-700', 'Milled': 'bg-blue-100 text-blue-700',
  'Sold': 'bg-slate-100 text-slate-700', 'Part-sold': 'bg-amber-100 text-amber-700', 'Empty': 'bg-gray-100 text-gray-500',
};
const mt2 = (kg) => `${((parseFloat(kg) || 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT`;

function LotsTab({ params, statementHref, openDoc }) {
  const { from_date, to_date, entity } = params || {};
  const { data: lots = [], isLoading } = useLotTracker({ from: from_date, to: to_date, ...(entity ? { entity } : {}) });
  if (isLoading) return <Skeleton />;
  const rows = Array.isArray(lots) ? lots : [];
  if (rows.length === 0) return <Empty msg="No purchased lots in this period." />;

  const totRecv = rows.reduce((s, r) => s + (parseFloat(r.receivedKg) || 0), 0);
  const totValue = rows.reduce((s, r) => s + (parseFloat(r.landedTotal) || 0), 0);
  const totRemaining = rows.reduce((s, r) => s + (parseFloat(r.remainingKg) || 0), 0);
  const unpaid = rows.reduce((s, r) => s + (parseFloat(r.dueAmount) || 0), 0);

  return (
    <div className="space-y-5">
      <SectionHeader title="Lots — every purchased lot & its full lifecycle" subtitle="Each raw-rice lot you bought. Click a lot to track everything: purchase, trucks, quality, what's remaining, what was sold/milled, and the finished-rice buyers." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Lots" value={String(rows.length)} />
        <SummaryCell label="Received" value={mt2(totRecv)} />
        <SummaryCell label="On hand" value={mt2(totRemaining)} />
        <SummaryCell label="Landed value" value={fmtPKR(totValue)} />
      </div>
      <Table
        head={['Date', 'Lot', 'Supplier', 'Rice Type', 'Received', 'Landed', 'Status', 'Value', 'Margin']}
        align={['left', 'left', 'left', 'left', 'right', 'right', 'left', 'right', 'right']}
        rowClick={rows.map(r => () => openDoc?.({ kind: 'lot', title: r.lotNo, subtitle: r.supplier, data: r }))}
        rows={rows.map(r => {
          const href = statementHref?.('supplier', r.supplierId);
          return [
            r.date ? new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—',
            <span className="font-mono text-xs text-blue-600">{r.lotNo}</span>,
            href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-600 hover:underline">{r.supplier}</Link> : <span className="font-medium">{r.supplier}</span>,
            <span className="text-xs">{r.riceType || '—'}</span>,
            mt2(r.receivedKg),
            fmtPKR(r.landedCostPerKg ? r.landedCostPerKg * (parseFloat(r.receivedKg) || 0) : r.landedTotal),
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${LOT_STATUS_TONE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>,
            <span className="font-semibold text-gray-900">{fmtPKR(r.landedTotal)}</span>,
            r.hasSales
              ? <span className="inline-flex flex-col items-end leading-tight"><ProfitCell v={r.realizedMargin} /><span className={`text-[10px] ${(parseFloat(r.realizedMarginPct) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{(parseFloat(r.realizedMarginPct) || 0).toFixed(1)}%</span></span>
              : <span className="text-gray-400">—</span>,
          ];
        })}
      />
      <p className="text-[11px] text-gray-400">Margin = realized: revenue from what's been sold (this lot as raw + the finished/by-product it produced) minus the landed cost of those sold goods. Unsold stock isn't counted until it sells.</p>
    </div>
  );
}

// Slider: the full lifecycle of one lot.
function LotTrackerPanel({ lot, statementHref }) {
  const navigate = useNavigate();
  const q = lot.qualityJson || {};
  const qFields = [
    ['Moisture', lot.moisturePct ?? q.moisture, '%'], ['Broken', lot.brokenPct ?? q.broken, '%'],
    ['Foreign', q.foreign_matter, '%'], ['Chalky', q.chalky, '%'], ['Purity', q.purity, '%'], ['Grain size', q.grain_size, 'mm'],
  ].filter(([, v]) => v != null && v !== '');
  const Cell = ({ label, value }) => (
    <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className="text-sm text-gray-800">{value}</p></div>
  );
  const supHref = statementHref?.('supplier', lot.supplierId);

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <Cell label="Lot" value={<span className="font-mono">{lot.lotNo}</span>} />
        <Cell label="Supplier" value={supHref ? <Link to={supHref} className="text-blue-600 hover:underline">{lot.supplier}</Link> : (lot.supplier || '—')} />
        <Cell label="Rice type" value={`${lot.riceType || '—'}${lot.grade ? ` · ${lot.grade}` : ''}`} />
        <Cell label="Purchased" value={lot.date ? new Date(lot.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
        <Cell label="Status" value={<span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${LOT_STATUS_TONE[lot.status] || 'bg-gray-100 text-gray-600'}`}>{lot.status}</span>} />
        <Cell label="Warehouse" value={lot.warehouse || '—'} />
      </div>

      {/* Purchase & cost */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Purchase & cost</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Cell label="Received" value={`${mt2(lot.receivedKg)} · ${Math.round(lot.receivedKg).toLocaleString()} kg`} />
          <Cell label="Katta (bags)" value={lot.bags != null ? `${Number(lot.bags).toLocaleString()}${lot.bagWeightKg ? ` × ${lot.bagWeightKg} kg` : ''}` : '—'} />
          <Cell label="Rate / kg" value={lot.ratePerKg > 0 ? `Rs ${Math.round(lot.ratePerKg).toLocaleString()}` : '—'} />
          <Cell label="Landed / kg" value={lot.landedCostPerKg > 0 ? `Rs ${Math.round(lot.landedCostPerKg).toLocaleString()}` : '—'} />
          <Cell label="Landed total" value={fmtPKR(lot.landedTotal)} />
          <Cell label="Payment" value={<><StatusBadgeMini s={lot.paymentStatus} /> {lot.dueAmount > 0 ? <span className="text-xs text-rose-600">{fmtPKR(lot.dueAmount)} due</span> : <span className="text-xs text-emerald-600">paid</span>}</>} />
        </div>
      </div>

      {/* Quality */}
      {qFields.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Quality (lot)</h4>
          <div className="flex flex-wrap gap-2">
            {qFields.map(([k, v, u]) => <span key={k} className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs"><span className="text-gray-500">{k}</span> <span className="font-semibold">{v}{u}</span></span>)}
          </div>
        </div>
      )}

      {/* Vehicles */}
      {(lot.vehicles || []).length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Delivering trucks</h4>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {lot.vehicles.map((v, i) => {
              const vq = v.quality || {};
              const qbits = [['Moist', vq.moisture, '%'], ['Broken', vq.broken, '%'], ['Price/MT', vq.price_per_mt, '']].filter(([, x]) => x != null && x !== '');
              return (
                <div key={i} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{v.vehicleNo}{v.driverName ? <span className="text-gray-500 font-normal"> · {v.driverName}</span> : ''}</span>
                    <span className="text-xs text-gray-500">{v.weightMt ? `${v.weightMt} MT` : ''}{v.totalBags ? ` · ${v.totalBags} bags` : ''}</span>
                  </div>
                  {qbits.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-gray-500">{qbits.map(([k, x, u]) => <span key={k}>{k}: <span className="font-medium text-gray-700">{u === '' ? `Rs ${Math.round(x).toLocaleString()}` : `${x}${u}`}</span></span>)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Disposition */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Where it went</h4>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-emerald-50 rounded-lg p-2 text-center"><p className="text-[11px] text-emerald-600">Remaining</p><p className="text-sm font-bold text-emerald-700">{mt2(lot.remainingKg)}</p></div>
          <div className="bg-slate-50 rounded-lg p-2 text-center"><p className="text-[11px] text-slate-500">Sold (raw)</p><p className="text-sm font-bold text-slate-700">{mt2(lot.soldKg)}</p></div>
          <div className="bg-blue-50 rounded-lg p-2 text-center"><p className="text-[11px] text-blue-600">Milled</p><p className="text-sm font-bold text-blue-700">{mt2(lot.milledKg)}</p></div>
        </div>

        {(lot.milledInto || []).length > 0 && (
          <div className="text-sm mb-2">
            <span className="text-gray-500">Milled into: </span>
            {lot.milledInto.map((m, i) => (
              <span key={i}>{i > 0 ? ', ' : ''}{m.batchId ? <Link to={`/milling/${m.batchId}`} className="text-blue-600 hover:underline">{m.batchNo}</Link> : m.batchNo} ({mt2(m.kg)})</span>
            ))}
          </div>
        )}

        {(lot.buyers || []).length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-semibold text-gray-600 mb-1">Sold as raw to</p>
            {lot.buyers.map((b, i) => <BuyerRow key={i} b={b} statementHref={statementHref} />)}
          </div>
        )}

        {(lot.downstreamSales || []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Finished / by-product sold to (after milling)</p>
            {lot.downstreamSales.map((b, i) => <BuyerRow key={i} b={b} statementHref={statementHref} showOutput />)}
          </div>
        )}

        {(lot.buyers || []).length === 0 && (lot.downstreamSales || []).length === 0 && (lot.milledInto || []).length === 0 && (
          <p className="text-xs text-gray-400">Not yet sold or milled — fully in stock.</p>
        )}
      </div>

      {/* Realized margin */}
      {lot.hasSales && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Realized margin</h4>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                <tr><td className="px-3 py-2 text-gray-600">Revenue (sold so far)</td><td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(lot.realizedRevenue)}</td></tr>
                <tr><td className="px-3 py-2 text-gray-600">Cost of goods sold</td><td className="px-3 py-2 text-right tabular-nums">{fmtPKR(lot.realizedCost)}</td></tr>
                <tr className="bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-gray-800">Gross margin</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${lot.realizedMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtPKR(lot.realizedMargin)} ({(parseFloat(lot.realizedMarginPct) || 0).toFixed(1)}%)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Realized only — counts what's been sold (raw + finished/by-product); unsold stock isn't included yet.</p>
        </div>
      )}

      {/* Full chronological activity ledger (Phase 2) */}
      <LotLedgerSection lotId={lot.lotId} />

      <div className="flex flex-wrap gap-2">
        <Link to={`/reports/lot-ledger/${lot.lotId}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Layers size={14} /> Open complete Lot 360
        </Link>
        <button onClick={() => navigate(`/lot-inventory/${lot.lotId}`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
          <ExternalLink size={14} /> Open full lot detail
        </button>
      </div>
    </div>
  );
}

// Lazy-loaded chronological lot ledger — collapsed by default so the drawer
// stays light; fetches /reporting/lot-ledger/:id on first expand.
function LotLedgerSection({ lotId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || data || !lotId) return;
    setLoading(true);
    reportingApi.lotLedger(lotId)
      .then(res => setData(res?.events ? res : (res?.data || res)))
      .catch(() => setData({ events: [], error: true }))
      .finally(() => setLoading(false));
  }, [open, data, lotId]);
  const events = data?.events || [];
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 mb-2 hover:text-blue-700">
        <span className="inline-flex items-center gap-1.5"><Layers size={14} /> Full activity ledger</span>
        <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        loading ? <p className="text-xs text-gray-400">Loading ledger…</p>
        : events.length === 0 ? <p className="text-xs text-gray-400">No recorded movements.</p>
        : (
          <div className="space-y-2">
          <LedgerExportBar
            title="Lot Activity Ledger"
            subtitle={`Lot ${data?.lot?.lotNo || ''}${data?.lot?.riceType ? ` · ${data.lot.riceType}` : ''}${data?.lot?.supplier ? ` · ${data.lot.supplier}` : ''}`}
            meta={[`${events.length} movements`]}
            fileBase={`lot-ledger-${data?.lot?.lotNo || lotId}`}
            rows={events}
            columns={LOT_LEDGER_COLS}
            footerNote="Running balance is the lot's net weight after each movement. Source: lot_transactions."
          />
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Date</th>
                  <th className="px-2 py-1.5 text-left font-medium">Activity</th>
                  <th className="px-2 py-1.5 text-left font-medium">Counterparty</th>
                  <th className="px-2 py-1.5 text-right font-medium">In (kg)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Out (kg)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Balance (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{e.date ? new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                    <td className="px-2 py-1.5 font-medium text-gray-800">{e.label}</td>
                    <td className="px-2 py-1.5 text-gray-600 max-w-[10rem] truncate">{e.href ? <Link to={e.href} className="text-blue-600 hover:underline">{e.counterparty || '—'}</Link> : (e.counterparty || '—')}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{e.inKg ? Math.round(e.inKg).toLocaleString() : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{e.outKg ? Math.round(e.outKg).toLocaleString() : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{Math.round(e.balanceKg).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )
      )}
    </div>
  );
}

// Column defs for CSV/print of the lot activity ledger.
const LOT_LEDGER_COLS = [
  { label: 'Date', align: 'left', accessor: (e) => e.date ? new Date(e.date).toLocaleDateString('en-GB') : '' },
  { label: 'Activity', align: 'left', key: 'label' },
  { label: 'Counterparty', align: 'left', accessor: (e) => e.counterparty || '' },
  { label: 'Reference', align: 'left', accessor: (e) => e.reference || '' },
  { label: 'In (kg)', align: 'right', accessor: (e) => e.inKg ? Math.round(e.inKg) : '' },
  { label: 'Out (kg)', align: 'right', accessor: (e) => e.outKg ? Math.round(e.outKg) : '' },
  { label: 'Balance (kg)', align: 'right', accessor: (e) => Math.round(e.balanceKg) },
];

function BuyerRow({ b, statementHref, showOutput }) {
  const href = statementHref?.('customer', b.customerId);
  return (
    <div className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-1.5 mb-1 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{href ? <Link to={href} className="text-blue-600 hover:underline">{b.customer}</Link> : b.customer}</span>
        <span className="text-xs text-gray-400"> · {b.saleNo}{showOutput && b.outputItem ? ` · ${b.outputType === 'finished' ? 'Finished' : b.outputItem}` : ''}{b.sharePct != null && b.sharePct < 99.5 ? ` · ${Math.round(b.sharePct)}% share` : ''}</span>
      </div>
      <div className="text-right shrink-0">
        <span className="font-semibold text-gray-900">{fmtPKR(b.valuePkr)}</span>
        <span className="text-[11px] text-gray-400"> · {mt2(b.kg)}</span>
      </div>
    </div>
  );
}

function StatusBadgeMini({ s }) {
  const tone = (s || '').toLowerCase() === 'paid' ? 'bg-emerald-100 text-emerald-700' : (s || '').toLowerCase() === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{s || 'Pending'}</span>;
}

// ─── Tab: Production (mill efficiency + yield leaderboard) ─────────────
function ProductionTab({ params }) {
  const navigate = useNavigate();
  const dr = { dateFrom: params?.from_date, dateTo: params?.to_date };
  const { data: mills = [], isLoading } = useMillEfficiency(dr);
  const { data: leaders = [] } = useRecoveryLeaderboard(dr);
  const { data: operators = [] } = useOperatorProductivity(dr);
  const { data: utility = {} } = useUtilityConsumption(dr);
  if (isLoading) return <Skeleton />;
  const millRows = Array.isArray(mills) ? mills : [];
  const lbRows = Array.isArray(leaders) ? leaders : [];
  if (millRows.length === 0 && lbRows.length === 0) return <Empty msg="No production in this period." />;

  const totIn = millRows.reduce((s, m) => s + (parseFloat(m.totalInputMt ?? m.totalInputMT) || 0), 0);
  const totOut = millRows.reduce((s, m) => s + (parseFloat(m.totalOutputMt ?? m.totalOutputMT) || 0), 0);
  const avgYield = totIn > 0 ? (totOut / totIn) * 100 : 0;
  const avgUtil = millRows.length ? millRows.reduce((s, m) => s + (parseFloat(m.utilization) || 0), 0) / millRows.length : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Mills" value={String(millRows.length)} />
        <SummaryCell label="Input" value={`${totIn.toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`} />
        <SummaryCell label="Finished output" value={`${totOut.toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`} />
        <SummaryCell label="Avg yield" value={fmtPct(avgYield)} />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Mill efficiency" subtitle="Throughput, yield, utilisation & downtime per mill" />
        <Table
          head={['Mill', 'Capacity/day', 'Batches', 'Input MT', 'Output MT', 'Avg Yield', 'Utilisation', 'Downtime hrs']}
          align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={millRows.map(m => [
            m.millName || '—',
            `${parseFloat(m.capacityMtPerDay ?? m.capacityMTPerDay) || 0} MT`,
            m.batchesProcessed || 0,
            (parseFloat(m.totalInputMt ?? m.totalInputMT) || 0).toFixed(1),
            (parseFloat(m.totalOutputMt ?? m.totalOutputMT) || 0).toFixed(1),
            fmtPct(m.avgYield),
            fmtPct((parseFloat(m.utilization) || 0) * (parseFloat(m.utilization) <= 1 ? 100 : 1)),
            (parseFloat(m.downtimeHours) || 0).toFixed(1),
          ])}
        />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Yield leaderboard (by batch)" subtitle="Best recovery first" />
        <Table
          head={['Batch', 'Supplier', 'Product', 'Input MT', 'Finished MT', 'Yield %', 'Broken %']}
          align={['left', 'left', 'left', 'right', 'right', 'right', 'right']}
          rowClick={lbRows.map(b => b.id ? () => navigate(`/milling/${b.id}`) : null)}
          rows={[...lbRows].sort((a, b) => (parseFloat(b.yieldPct) || 0) - (parseFloat(a.yieldPct) || 0)).map(b => [
            <span className="font-mono text-xs text-blue-600">{b.batchNo}</span>,
            b.supplierName || '—',
            <span className="text-xs">{b.productName || '—'}</span>,
            (parseFloat(b.rawQtyMt ?? b.rawQtyMT) || 0).toFixed(1),
            (parseFloat(b.finishedQtyMt ?? b.finishedQtyMT) || 0).toFixed(1),
            <span className="font-medium">{fmtPct(b.yieldPct)}</span>,
            fmtPct(b.brokenPct),
          ])}
        />
      </div>

      {/* Operator productivity */}
      <div className="space-y-2">
        <SectionHeader title="Operator productivity" subtitle="Output & yield per operator" />
        {(Array.isArray(operators) ? operators : []).length === 0 ? (
          <Empty msg="No operator data — record operators on milling batches to populate this." />
        ) : (
          <Table
            head={['Operator', 'Batches', 'Output MT', 'Avg Yield', 'Hours', 'Output/hr (MT)']}
            align={['left', 'right', 'right', 'right', 'right', 'right']}
            rows={operators.map(o => [
              o.operatorName || '—', o.batches || 0,
              (parseFloat(o.totalOutputMt ?? o.totalOutputMT) || 0).toFixed(1),
              fmtPct(o.avgYield),
              (parseFloat(o.totalHours) || 0).toFixed(1),
              (parseFloat(o.outputPerHour) || 0).toFixed(2),
            ])}
          />
        )}
      </div>

      {/* Utility consumption */}
      <div className="space-y-2">
        <SectionHeader title="Utility consumption" subtitle={`Cost per MT processed${utility.totalProcessedMt ?? utility.totalProcessedMT ? ` — ${(parseFloat(utility.totalProcessedMt ?? utility.totalProcessedMT) || 0).toFixed(1)} MT processed` : ''}`} />
        {(Array.isArray(utility.byType) ? utility.byType : []).length === 0 ? (
          <Empty msg="No utility records — log electricity/fuel/etc. to populate this." />
        ) : (
          <Table
            head={['Utility', 'Unit', 'Consumption', 'Cost (PKR)', 'Cost/MT']}
            align={['left', 'left', 'right', 'right', 'right']}
            rows={utility.byType.map(u => [
              <span className="capitalize">{u.utilityType || '—'}</span>, u.unit || '—',
              (parseFloat(u.totalConsumption) || 0).toLocaleString(),
              fmtPKR(u.totalCost), fmtPKR(u.costPerMt ?? u.costPerMT),
            ])}
          />
        )}
      </div>
    </div>
  );
}

// ─── Tab: Cash Forecast (30-day projection) ───────────────────────────
function ForecastTab() {
  const { data = {}, isLoading } = useCashForecast({});
  if (isLoading) return <Skeleton />;
  const proj = Array.isArray(data.projection) ? data.projection : [];
  const cur = parseFloat(data.currentCash) || 0;
  const recv = parseFloat(data.totalExpectedReceipts) || 0;
  const pay = parseFloat(data.totalExpectedPayments) || 0;
  const endBal = proj.length ? (parseFloat(proj[proj.length - 1].projectedBalance) || 0) : cur;
  const chart = proj.map(d => ({ name: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), Balance: parseFloat(d.projectedBalance) || 0 }));

  return (
    <div className="space-y-5">
      <SectionHeader title="Cash Forecast — projected balance (next 30 days)" subtitle="Current cash plus expected receipts (from receivable due dates) less expected payments (payable due dates)." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Current cash" value={<span className={cur < 0 ? 'text-rose-600' : ''}>{fmtPKR(cur)}</span>} />
        <SummaryCell label="Expected in" value={<span className="text-emerald-600">{fmtPKR(recv)}</span>} />
        <SummaryCell label="Expected out" value={<span className="text-rose-600">{fmtPKR(pay)}</span>} />
        <SummaryCell label="Projected balance" value={<span className={endBal < 0 ? 'text-rose-600' : 'text-emerald-600'}>{fmtPKR(endBal)}</span>} />
      </div>
      {chart.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" interval={Math.ceil(chart.length / 8)} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
              <Tooltip formatter={(v) => fmtPKR(v)} />
              <Line type="monotone" dataKey="Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <Table
        head={['Date', 'Expected In', 'Expected Out', 'Net', 'Projected Balance']}
        align={['left', 'right', 'right', 'right', 'right']}
        rows={proj.map(d => [
          new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          fmtPKR(d.expectedReceipts), fmtPKR(d.expectedPayments),
          <span className={(parseFloat(d.netCashFlow) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtPKR(d.netCashFlow)}</span>,
          <span className={(parseFloat(d.projectedBalance) || 0) < 0 ? 'text-rose-600 font-medium' : ''}>{fmtPKR(d.projectedBalance)}</span>,
        ])}
      />
      <p className="text-[11px] text-gray-400">Forward-looking 30 days — the global date range filter does not apply here.</p>
    </div>
  );
}

// ─── Tab: KPIs (benchmark scorecard) ──────────────────────────────────
function KpiTab({ millScoped }) {
  const { data: rows = [], isLoading } = useKpiBenchmarks(millScoped ? { entity: 'mill' } : {});
  if (isLoading) return <Skeleton />;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return <Empty msg="No KPI benchmarks configured." />;
  const met = list.filter(k => k.status === 'Met').length;
  const missed = list.filter(k => k.status === 'Missed').length;
  const tone = (s) => s === 'Met' ? 'bg-emerald-100 text-emerald-700' : s === 'Missed' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-500';
  const fmtVal = (v, unit) => unit === '%' ? `${(parseFloat(v) || 0).toFixed(1)}%` : (parseFloat(v) || 0).toLocaleString();
  return (
    <div className="space-y-5">
      <SectionHeader title="KPI Scorecard" subtitle="Target vs actual against configured benchmarks" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="KPIs" value={String(list.length)} />
        <SummaryCell label="Met" value={<span className="text-emerald-600">{met}</span>} />
        <SummaryCell label="Missed" value={<span className="text-rose-600">{missed}</span>} />
        <SummaryCell label="On track" value={`${list.length ? Math.round((met / list.length) * 100) : 0}%`} />
      </div>
      <Table
        head={['KPI', 'Entity', 'Target', 'Actual', 'Variance', 'Status']}
        align={['left', 'left', 'right', 'right', 'right', 'left']}
        rows={list.map(k => [
          k.kpiName || '—',
          <span className="text-xs capitalize">{k.entity || '—'}</span>,
          fmtVal(k.target, k.unit),
          fmtVal(k.actual, k.unit),
          <span className={(parseFloat(k.variance) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtVal(k.variance, k.unit)}</span>,
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone(k.status)}`}>{k.status || 'Unknown'}</span>,
        ])}
      />
    </div>
  );
}

// ─── Tab: Orders ──────────────────────────────────────────────────────
function OrdersTab({ params }) {
  const { data: rows = [], isLoading } = useOrderProfitability(params);

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (parseFloat(b.grossProfit) || 0) - (parseFloat(a.grossProfit) || 0)),
    [rows]);

  const chartData = useMemo(() =>
    sorted.slice(0, 10).map(r => ({
      name: r.orderNo,
      Revenue: parseFloat(r.revenuePkr) || 0,
      Cost:    parseFloat(r.costs)      || 0,
      Profit:  parseFloat(r.grossProfit) || 0,
    })),
    [sorted]);

  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No orders in this period." />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Order-level Profitability" subtitle="Top 10 by gross profit (PKR) — revenue at locked FX rate, cost = operational + COGS" />
      <ChartBlock data={chartData} />
      <Table
        head={['Order', 'Customer', 'Status', 'Contract', 'Revenue (PKR)', 'Cost (PKR)', 'Profit (PKR)', 'Margin']}
        align={['left','left','left','right','right','right','right','right']}
        rows={sorted.map(r => [
          <Link to={`/export/${r.orderNo || r.id}`} className="text-blue-600 hover:underline font-medium">{r.orderNo}</Link>,
          r.customerName || '—',
          <StatusChip s={r.status} />,
          <span className="text-xs text-gray-600">{(r.currency || 'PKR')} {Number(r.contractValue || 0).toLocaleString()}</span>,
          fmtPKR(r.revenuePkr),
          fmtPKR(r.costs),
          <ProfitCell v={r.grossProfit} />,
          fmtPct(r.margin),
        ])}
      />
    </div>
  );
}

// ─── Tab: Customers ───────────────────────────────────────────────────
function CustomersTab({ params }) {
  const { data: rows = [], isLoading } = useCustomerProfitability(params);
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No customer activity in this period." />;

  const sorted = [...rows].sort((a, b) => (parseFloat(b.totalProfitPkr) || 0) - (parseFloat(a.totalProfitPkr) || 0));

  return (
    <div className="space-y-4">
      <SectionHeader title="Customer Profitability" subtitle="Ranked by total booked profit" />
      <Table
        head={['#', 'Customer', 'Country', 'Orders', 'Revenue (PKR)', 'Profit (PKR)', 'Avg Margin']}
        align={['left','left','left','right','right','right','right']}
        rows={sorted.map((r, i) => [
          i + 1,
          r.customerName || '—',
          r.country || '—',
          r.orderCount || 0,
          fmtPKR(r.totalRevenuePkr),
          <ProfitCell v={r.totalProfitPkr} />,
          fmtPct(r.avgMarginPct),
        ])}
      />
    </div>
  );
}

// ─── Tab: Countries ───────────────────────────────────────────────────
function CountriesTab({ params }) {
  const { data: rows = [], isLoading } = useCountryAnalysis(params);
  if (isLoading) return <Skeleton />;
  if (rows.length === 0) return <Empty msg="No country data for this period." />;

  const sorted = [...rows].sort((a, b) => (parseFloat(b.totalRevenuePkr) || 0) - (parseFloat(a.totalRevenuePkr) || 0));
  const chartData = sorted.slice(0, 8).map(r => ({
    name: r.country || '—',
    Revenue: parseFloat(r.totalRevenuePkr) || 0,
    Profit:  parseFloat(r.totalProfitPkr)  || 0,
  }));

  return (
    <div className="space-y-4">
      <SectionHeader title="Sales by Country" subtitle="Revenue and profit destination breakdown" />
      <ChartBlock data={chartData} />
      <Table
        head={['Country', 'Orders', 'Quantity (MT)', 'Revenue (PKR)', 'Profit (PKR)', 'Margin']}
        align={['left','right','right','right','right','right']}
        rows={sorted.map(r => [
          r.country || '—',
          r.orderCount || 0,
          (parseFloat(r.totalQtyMT) || 0).toFixed(1),
          fmtPKR(r.totalRevenuePkr),
          <ProfitCell v={r.totalProfitPkr} />,
          fmtPct(r.avgMarginPct),
        ])}
      />
    </div>
  );
}

// ─── Tab: Inventory ───────────────────────────────────────────────────
const fmtMT = (kg) => `${((parseFloat(kg) || 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MT`;

// Aging buckets derived from each lot's days-in-stock.
const AGE_BUCKETS = [
  ['0–30 days',  (d) => d <= 30],
  ['31–60 days', (d) => d > 30 && d <= 60],
  ['61–90 days', (d) => d > 60 && d <= 90],
  ['90+ days',   (d) => d > 90],
];

function StockBreakdown({ title, subtitle, query, groupHead, hideValue }) {
  const { data, isLoading } = query;
  if (isLoading) return null;
  const rows = data?.rows || [];
  if (rows.length === 0) return null;
  const grand = data?.grand || {};
  const head = hideValue
    ? [groupHead, 'Lots', 'Total', 'Available', 'Reserved']
    : [groupHead, 'Lots', 'Total', 'Available', 'Reserved', 'Value (PKR)'];
  const align = hideValue ? ['left', 'right', 'right', 'right', 'right'] : ['left', 'right', 'right', 'right', 'right', 'right'];
  return (
    <div className="space-y-2">
      <SectionHeader title={title} subtitle={subtitle} />
      <Table
        head={head}
        align={align}
        rows={[
          ...rows.map((r) => {
            const base = [r.name || '—', r.lotCount || 0, fmtMT(r.totalKg), fmtMT(r.availableKg), fmtMT(r.reservedKg)];
            return hideValue ? base : [...base, fmtPKR(r.valuePkr)];
          }),
          ...(grand.lotCount != null
            ? [(hideValue
                ? ['TOTAL', grand.lotCount, fmtMT(grand.totalKg), fmtMT(grand.availableKg), fmtMT(grand.reservedKg)]
                : ['TOTAL', grand.lotCount, fmtMT(grand.totalKg), fmtMT(grand.availableKg), fmtMT(grand.reservedKg), fmtPKR(grand.valuePkr)])
                .map((c, i) => <span key={i} className="font-semibold text-gray-900">{c}</span>)]
            : []),
        ]}
      />
    </div>
  );
}

function InventoryTab({ millScoped, hideValue }) {
  const navigate = useNavigate();
  const entity = millScoped ? 'mill' : '';
  const { data: lots = [], isLoading } = useStockAgingReport();   // per-lot array (qty > 0 only)
  const byType = usePrintableStock('type');
  const byWarehouse = usePrintableStock('warehouse');
  const bySubtype = usePrintableStock('subtype');
  const { data: valuation = {} } = useStockValuation();
  const { data: turnover = {} } = useStockTurnover();

  if (isLoading) return <Skeleton />;

  // The aging feed only carries lots with qty > 0, so it goes blank the moment
  // every lot is milled/sold down to zero — even though the stock breakdowns
  // still have rows. Render whenever EITHER source has data; only show the
  // empty state when both are genuinely empty.
  const lotsArr = Array.isArray(lots) ? lots : [];
  const hasAging = lotsArr.length > 0;
  const printableLoading = byType.isLoading || bySubtype.isLoading || byWarehouse.isLoading;
  const hasPrintable = ((byType.data?.rows?.length || 0) + (bySubtype.data?.rows?.length || 0) + (byWarehouse.data?.rows?.length || 0)) > 0;
  if (!hasAging && !hasPrintable && !printableLoading) {
    return <Empty msg="No stock on hand — every lot has been fully milled or sold." />;
  }

  // Headline totals — prefer the printable-stock grand (carries available/reserved),
  // fall back to summing the per-lot aging data so the tab is never blank.
  const grand = byType.data?.grand || {};
  const totalKg = grand.totalKg != null ? parseFloat(grand.totalKg) : lotsArr.reduce((s, l) => s + (parseFloat(l.qty) || 0) * 1000, 0);
  const availKg = grand.availableKg;
  const reservedKg = grand.reservedKg;
  const totalValue = grand.valuePkr != null ? parseFloat(grand.valuePkr) : lotsArr.reduce((s, l) => s + (parseFloat(l.totalValue) || 0), 0);
  const deadStock = lotsArr.filter((l) => l.isDeadStock);
  const deadValue = deadStock.reduce((s, l) => s + (parseFloat(l.totalValue) || 0), 0);

  // Aging buckets from days-in-stock. Value/% columns dropped in qty-only mode.
  const bucketRows = AGE_BUCKETS.map(([label, test]) => {
    const ls = lotsArr.filter((l) => test(parseInt(l.daysInStock, 10) || 0));
    const kg = ls.reduce((s, l) => s + (parseFloat(l.qty) || 0) * 1000, 0);
    const val = ls.reduce((s, l) => s + (parseFloat(l.totalValue) || 0), 0);
    return hideValue
      ? [label, ls.length, fmtMT(kg)]
      : [label, ls.length, fmtMT(kg), fmtPKR(val), totalValue > 0 ? `${(val / totalValue * 100).toFixed(1)}%` : '—'];
  });

  // Oldest lots — the 8 longest-held, most useful for spotting stale stock.
  const oldest = [...lotsArr].sort((a, b) => (b.daysInStock || 0) - (a.daysInStock || 0)).slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${hideValue ? 'lg:grid-cols-5' : 'lg:grid-cols-6'} gap-3`}>
        <SummaryCell label="Total lots" value={String(grand.lotCount ?? lotsArr.length)} />
        <SummaryCell label="Total weight" value={fmtMT(totalKg)} />
        <SummaryCell label="Available" value={availKg != null ? fmtMT(availKg) : '—'} />
        <SummaryCell label="Reserved" value={reservedKg != null ? fmtMT(reservedKg) : '—'} />
        {!hideValue && <SummaryCell label="Total value" value={fmtPKR(totalValue)} />}
        <SummaryCell
          label="Dead stock (90+d)"
          value={hideValue
            ? <span className={deadStock.length ? 'text-rose-600' : 'text-emerald-600'}>{deadStock.length} lots</span>
            : <span className={deadStock.length ? 'text-rose-600' : 'text-emerald-600'}>{deadStock.length} · {fmtPKR(deadValue)}</span>}
        />
      </div>

      <StockBreakdown title="By Type" subtitle="Unprocessed / finished / byproduct" query={byType} groupHead="Type" hideValue={hideValue} />
      <StockBreakdown title="By Category" subtitle="Finished, broken grades, CSR, short grain, powder, sweepings, blends" query={bySubtype} groupHead="Category" hideValue={hideValue} />
      <StockBreakdown title="By Warehouse" subtitle="Where the stock is held" query={byWarehouse} groupHead="Warehouse" hideValue={hideValue} />

      {/* Valuation (by type & warehouse) + turnover — surfaced from the
          stock-valuation / stock-turnover endpoints. Valuation hidden for
          the quantity-only Mill Operator view. */}
      {!hideValue && Array.isArray(valuation.byType) && valuation.byType.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <SectionHeader title="Valuation by type" subtitle="On-hand value at cost" />
            <Table head={['Type', 'Lots', 'Qty (MT)', 'Value (PKR)']} align={['left', 'right', 'right', 'right']}
              rows={valuation.byType.map(v => [
                <span className="capitalize">{v.type || '—'}</span>, v.lotCount || 0,
                (parseFloat(v.totalQty) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }), fmtPKR(v.totalValue),
              ])} />
          </div>
          <div className="space-y-2">
            <SectionHeader title="Valuation by warehouse" subtitle="Where the value sits" />
            <Table head={['Warehouse', 'Lots', 'Qty (MT)', 'Value (PKR)']} align={['left', 'right', 'right', 'right']}
              rows={(valuation.byWarehouse || []).map(v => [
                v.warehouseName || '—', v.lotCount || 0,
                (parseFloat(v.totalQty) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }), fmtPKR(v.totalValue),
              ])} />
          </div>
        </div>
      )}
      {Array.isArray(turnover.byType) && turnover.byType.length > 0 && (
        <div className="space-y-2">
          <SectionHeader title="Stock turnover" subtitle={`How long stock sits before it moves — overall avg ${(parseFloat(turnover.overallAvgDays) || 0).toFixed(0)} days`} />
          <Table head={['Type', 'Lots', 'Qty (MT)', 'Avg days held']} align={['left', 'right', 'right', 'right']}
            rows={turnover.byType.map(t => [
              <span className="capitalize">{t.type || '—'}</span>, t.lotCount || 0,
              (parseFloat(t.totalQty) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
              (parseFloat(t.avgDays) || 0).toFixed(0),
            ])} />
        </div>
      )}

      {hasAging ? (
        <>
          {/* Aging */}
          <div className="space-y-2">
            <SectionHeader title="Stock Aging" subtitle="How long stock has been held" />
            <Table
              head={hideValue ? ['Bucket', 'Lots', 'Weight'] : ['Bucket', 'Lots', 'Weight', 'Value (PKR)', '% of value']}
              align={hideValue ? ['left', 'right', 'right'] : ['left', 'right', 'right', 'right', 'right']}
              rows={bucketRows}
            />
          </div>

          {/* Oldest lots — click a lot to open its detail */}
          <div className="space-y-2">
            <SectionHeader title="Oldest Lots" subtitle="Longest-held stock first — click a lot for full detail" />
            <Table
              head={hideValue ? ['Lot No', 'Item', 'Type', 'Warehouse', 'Qty', 'Days held'] : ['Lot No', 'Item', 'Type', 'Warehouse', 'Qty', 'Value (PKR)', 'Days held']}
              align={hideValue ? ['left', 'left', 'left', 'left', 'right', 'right'] : ['left', 'left', 'left', 'left', 'right', 'right', 'right']}
              rowClick={oldest.map((l) => l.id ? () => navigate(`/lot-inventory/${l.id}`) : null)}
              rows={oldest.map((l) => {
                const daysCell = l.isDeadStock
                  ? <span className="inline-flex items-center gap-1 text-rose-600 font-medium"><AlertTriangle size={12} /> {l.daysInStock}</span>
                  : (l.daysInStock || 0);
                const base = [
                  <span className="font-medium text-blue-600">{l.lotNo || '—'}</span>,
                  l.itemName || '—', l.type || '—', l.warehouseName || '—',
                  `${(parseFloat(l.qty) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${l.unit || 'MT'}`,
                ];
                return hideValue ? [...base, daysCell] : [...base, fmtPKR(l.totalValue), daysCell];
              })}
            />
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          No lots are currently on hand (every lot has been fully milled or sold). The breakdowns above reflect the most recent lot records.
        </div>
      )}

      {/* Finished Goods Ledger (Phase 2) */}
      <FinishedGoodsLedgerSection entity={entity} hideValue={hideValue} />

      {/* Inventory Movement Ledger (Phase 2) */}
      <InventoryMovementLedgerSection entity={entity} hideValue={hideValue} />

      <div className="flex justify-end">
        <Link to="/reports/print" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm">
          Printable stock report <ExternalLink size={12} />
        </Link>
      </div>
    </div>
  );
}

// Column defs for CSV/print of the inventory + finished-goods ledgers.
const INVENTORY_LEDGER_COLS = [
  { label: 'Date', align: 'left', accessor: (r) => r.date ? new Date(r.date).toLocaleDateString('en-GB') : '' },
  { label: 'Movement', align: 'left', key: 'label' },
  { label: 'Lot', align: 'left', accessor: (r) => r.lotNo || r.batchNo || '' },
  { label: 'From → To', align: 'left', accessor: (r) => [r.fromWh, r.toWh].filter(Boolean).join(' → ') || r.reference || '' },
  { label: 'Direction', align: 'left', key: 'direction' },
  { label: 'Qty (kg)', align: 'right', accessor: (r) => Math.round(r.qtyKg) },
  { label: 'Cost (PKR)', align: 'right', accessor: (r) => r.costPkr > 0 ? Math.round(r.costPkr) : '' },
];
const FINISHED_GOODS_COLS = [
  { label: 'Output', align: 'left', accessor: (r) => gradeLabel(r.key) },
  { label: 'Type', align: 'left', accessor: (r) => r.type === 'byproduct' ? 'by-product' : 'finished' },
  { label: 'Lots', align: 'right', accessor: (r) => r.lots.length },
  { label: 'Produced (kg)', align: 'right', accessor: (r) => Math.round(r.producedKg) },
  { label: 'Sold (kg)', align: 'right', accessor: (r) => Math.round(r.soldKg) },
  { label: 'On hand (kg)', align: 'right', accessor: (r) => Math.round(r.onHandKg) },
  { label: 'Reserved (kg)', align: 'right', accessor: (r) => Math.round(r.reservedKg) },
  { label: 'Value (PKR)', align: 'right', accessor: (r) => Math.round(r.valuePkr) },
];

// Finished Goods Ledger — finished + by-product stock register grouped by
// grade/output (produced · sold · on-hand · reserved · value), expandable to lots.
function FinishedGoodsLedgerSection({ entity, hideValue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exp, setExp] = useState({});
  const [type, setType] = useState('');
  useEffect(() => {
    setLoading(true);
    reportingApi.finishedGoodsLedger({ ...(entity ? { entity } : {}), ...(type ? { type } : {}) })
      .then(res => setData(res?.rows ? res : (res?.data || res)))
      .catch(() => setData({ rows: [] }))
      .finally(() => setLoading(false));
  }, [entity, type]);
  const rows = data?.rows || [];
  const g = data?.grand || {};
  if (loading) return <Skeleton />;
  if (rows.length === 0 && !type) return null;
  const kg = (v) => `${Math.round(v || 0).toLocaleString()} kg`;
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <SectionHeader title="Finished Goods Ledger" subtitle={`Finished &amp; by-product stock register — produced, sold, on-hand, reserved${hideValue ? '' : ', value'}`} />
        <div className="flex items-center gap-2">
          <select value={type} onChange={e => setType(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none">
            <option value="">All outputs</option>
            <option value="finished">Finished only</option>
            <option value="byproduct">By-products only</option>
          </select>
          <LedgerExportBar title="Finished Goods Ledger" subtitle={hideValue ? 'On-hand finished &amp; by-product stock' : 'On-hand finished &amp; by-product stock at cost'}
            fileBase="finished-goods-ledger" rows={rows} columns={hideValue ? FINISHED_GOODS_COLS.filter(c => c.label !== 'Value (PKR)') : FINISHED_GOODS_COLS}
            footerNote={hideValue ? 'By-products grouped by grade; finished by product.' : 'Value = on-hand kg × cost/kg. By-products grouped by grade; finished by product.'} />
        </div>
      </div>
      {rows.length === 0 ? <Empty msg="No outputs match this filter." /> : (
      <div className="rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr><th className="px-3 py-2 text-left font-medium">Output</th><th className="px-3 py-2 text-right font-medium">Produced</th><th className="px-3 py-2 text-right font-medium">Sold</th><th className="px-3 py-2 text-right font-medium">On hand</th><th className="px-3 py-2 text-right font-medium">Reserved</th>{!hideValue && <th className="px-3 py-2 text-right font-medium">Value</th>}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <Fragment key={r.key}>
                <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExp(e => ({ ...e, [r.key]: !e[r.key] }))}>
                  <td className="px-3 py-2 font-medium text-gray-800"><ChevronRight size={13} className={`inline transition-transform mr-1 text-gray-400 ${exp[r.key] ? 'rotate-90' : ''}`} />{gradeLabel(r.key)}<span className="text-gray-400 font-normal"> · {r.type === 'byproduct' ? 'by-product' : 'finished'} · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{kg(r.producedKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{kg(r.soldKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{kg(r.onHandKg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.reservedKg > 0 ? kg(r.reservedKg) : '—'}</td>
                  {!hideValue && <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(r.valuePkr)}</td>}
                </tr>
                {exp[r.key] && r.lots.map(l => (
                  <tr key={l.lotId} className="bg-gray-50/50 text-xs">
                    <td className="px-3 py-1.5 pl-8"><Link to={l.href} className="font-mono text-blue-600 hover:underline">{l.lotNo}</Link>{l.isBlend ? <span className="text-gray-400"> · blend</span> : ''}{l.variety ? <span className="text-gray-400"> · {l.variety}</span> : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{kg(l.producedKg)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{kg(l.soldKg)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{kg(l.onHandKg)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-600">{l.reservedKg > 0 ? kg(l.reservedKg) : '—'}</td>
                    {!hideValue && <td className="px-3 py-1.5 text-right tabular-nums">{fmtPKR(l.valuePkr)}</td>}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="bg-gray-100 font-semibold text-gray-800">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{kg(g.producedKg)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{kg(g.soldKg)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{kg(g.onHandKg)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-600">{kg(g.reservedKg)}</td>
              {!hideValue && <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(g.valuePkr)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// Inventory Movement Ledger — chronological feed of every stock movement,
// filterable by type; each row links to its lot / batch / order.
function InventoryMovementLedgerSection({ entity, hideValue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const { data: warehouses = [] } = useWarehouses();
  useEffect(() => {
    setLoading(true);
    reportingApi.inventoryLedger({ ...(entity ? { entity } : {}), ...(type ? { movementType: type } : {}), ...(warehouseId ? { warehouseId } : {}), limit: 200 })
      .then(res => setData(res?.rows ? res : (res?.data || res)))
      .catch(() => setData({ rows: [] }))
      .finally(() => setLoading(false));
  }, [entity, type, warehouseId]);
  const rows = data?.rows || [];
  const types = [
    ['', 'All movements'], ['purchase_receipt', 'Purchase received'], ['production_issue', 'Issued to milling'],
    ['production_output', 'Milling output'], ['byproduct_output', 'By-product output'], ['local_sale', 'Local sale'],
    ['export_dispatch', 'Export dispatch'], ['transfer_out', 'Transfer out'], ['transfer_in', 'Transfer in'],
    ['adjustment_plus', 'Adjustment (+)'], ['adjustment_minus', 'Adjustment (−)'],
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <SectionHeader title="Inventory Movement Ledger" subtitle="Every stock movement — newest first" />
        <div className="flex items-center gap-2">
          {warehouses.length > 0 && (
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none">
              <option value="">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <select value={type} onChange={e => setType(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none">
            {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <LedgerExportBar title="Inventory Movement Ledger"
            subtitle={`Stock movements${type ? ` · ${(types.find(t => t[0] === type) || [])[1]}` : ''}${warehouseId ? ` · ${(warehouses.find(w => String(w.id) === String(warehouseId)) || {}).name || ''}` : ''}`}
            meta={[`${rows.length} rows`, ...(warehouseId ? [`Warehouse: ${(warehouses.find(w => String(w.id) === String(warehouseId)) || {}).name || warehouseId}`] : [])]}
            fileBase="inventory-movement-ledger" rows={rows} columns={hideValue ? INVENTORY_LEDGER_COLS.filter(c => c.label !== 'Cost (PKR)') : INVENTORY_LEDGER_COLS}
            footerNote="Source: inventory_movements. + inbound, − outbound." />
        </div>
      </div>
      {loading ? <Skeleton /> : rows.length === 0 ? <Empty msg="No movements recorded for this filter." /> : (
        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr><th className="px-3 py-2 text-left font-medium">Date</th><th className="px-3 py-2 text-left font-medium">Movement</th><th className="px-3 py-2 text-left font-medium">Lot</th><th className="px-3 py-2 text-left font-medium">Where</th><th className="px-3 py-2 text-right font-medium">Qty (kg)</th>{!hideValue && <th className="px-3 py-2 text-right font-medium">Cost</th>}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{r.date ? new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-800">{r.label}</td>
                  <td className="px-3 py-1.5">{r.lotId ? <Link to={r.href || `/lot-inventory/${r.lotId}`} className="font-mono text-blue-600 hover:underline">{r.lotNo || `#${r.lotId}`}</Link> : (r.batchNo ? <Link to={r.href} className="text-blue-600 hover:underline">{r.batchNo}</Link> : '—')}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs">{[r.fromWh, r.toWh].filter(Boolean).join(' → ') || r.reference || '—'}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${r.direction === 'out' ? 'text-rose-700' : 'text-emerald-700'}`}>{r.direction === 'out' ? '−' : '+'}{Math.round(r.qtyKg).toLocaleString()}</td>
                  {!hideValue && <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.costPkr > 0 ? fmtPKR(r.costPkr) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Quality ─────────────────────────────────────────────────────
function QualityScoreChip({ v }) {
  const n = parseFloat(v) || 0;
  const tone = n >= 70 ? 'bg-emerald-100 text-emerald-700' : n >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>{n.toFixed(1)}</span>;
}

function QualityTab({ params }) {
  const { data: rows = [], isLoading } = useSupplierQualityRanking(params);
  const dr = { dateFrom: params?.from_date, dateTo: params?.to_date };
  const { data: variety = [] } = useRecoveryByVariety(dr);
  if (isLoading) return <Skeleton />;
  const hasRanking = Array.isArray(rows) && rows.length > 0;
  const varietyRows = Array.isArray(variety) ? variety : [];
  if (!hasRanking && varietyRows.length === 0) return <Empty msg="No quality data yet — record arrival samples on milling batches to populate this report." />;

  // Backend returns: supplierName, totalBatches, totalQtyMT, avgYield, avgMoisture,
  // avgBroken, avgMoistureVariance, avgBrokenVariance, rejectionRate, qualityScore.
  const sorted = [...rows].sort((a, b) => (parseFloat(b.qualityScore) || 0) - (parseFloat(a.qualityScore) || 0));
  const totalBatches = rows.reduce((s, r) => s + (parseInt(r.totalBatches, 10) || 0), 0);
  const totalQty = rows.reduce((s, r) => s + (parseFloat(r.totalQtyMT) || 0), 0);
  const withYield = rows.filter((r) => (parseFloat(r.avgYield) || 0) > 0);
  const avgYieldAll = withYield.length ? withYield.reduce((s, r) => s + parseFloat(r.avgYield), 0) / withYield.length : 0;
  const best = sorted[0];
  const anyVariance = rows.some((r) => (parseFloat(r.avgMoistureVariance) || 0) > 0 || (parseFloat(r.avgBrokenVariance) || 0) > 0);

  return (
    <div className="space-y-6">
      {hasRanking && (<>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCell label="Suppliers" value={String(rows.length)} />
        <SummaryCell label="Milled batches" value={String(totalBatches)} />
        <SummaryCell label="Input" value={`${totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`} />
        <SummaryCell label="Avg yield" value={fmtPct(avgYieldAll)} />
      </div>

      {best && (parseFloat(best.avgYield) || 0) > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-900">
          <span className="font-semibold">Top supplier:</span> {best.supplierName} — {fmtPct(best.avgYield)} avg yield across {best.totalBatches} batch{best.totalBatches === 1 ? '' : 'es'} (quality score {(parseFloat(best.qualityScore) || 0).toFixed(1)}).
        </div>
      )}

      <div className="space-y-2">
        <SectionHeader title="Supplier Quality Ranking" subtitle="Best quality score first — yield, arrival moisture/broken & rejection by supplier" />
        <Table
          head={['#', 'Supplier', 'Batches', 'Input MT', 'Avg Yield', 'Moisture', 'Broken', 'Rejection', 'Score']}
          align={['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={sorted.map((r, i) => [
            i + 1,
            r.supplierName || '—',
            parseInt(r.totalBatches, 10) || 0,
            (parseFloat(r.totalQtyMT) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }),
            (parseFloat(r.avgYield) || 0) > 0 ? fmtPct(r.avgYield) : '—',
            (parseFloat(r.avgMoisture) || 0) > 0 ? fmtPct(r.avgMoisture) : '—',
            (parseFloat(r.avgBroken) || 0) > 0 ? fmtPct(r.avgBroken) : '—',
            `${(parseFloat(r.rejectionRate) || 0).toFixed(1)}%`,
            <QualityScoreChip v={r.qualityScore} />,
          ])}
        />
        <p className="text-[11px] text-gray-400">
          Quality score = avg yield − moisture/broken variance − rejection rate.
          {!anyVariance && ' Moisture/broken shown are arrival-sample averages; variance needs a second (post-milling) analysis to compute.'}
        </p>
      </div>
      </>)}

      {varietyRows.length > 0 && (
        <div className="space-y-2">
          <SectionHeader title="Recovery by variety" subtitle="Avg yield & broken % per rice variety, vs benchmark" />
          <Table
            head={['Variety', 'Batches', 'Avg Yield', 'Broken %', 'Benchmark', 'Variance']}
            align={['left', 'right', 'right', 'right', 'right', 'right']}
            rows={varietyRows.map(v => [
              v.variety || '—', v.batchCount || 0,
              fmtPct(v.avgYield), fmtPct(v.avgBrokenPct),
              v.benchmarkYield != null ? fmtPct(v.benchmarkYield) : '—',
              v.varianceFromBenchmark != null
                ? <span className={(parseFloat(v.varianceFromBenchmark) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtPct(v.varianceFromBenchmark)}</span>
                : '—',
            ])}
          />
        </div>
      )}
    </div>
  );
}

// ─── Shared subcomponents ────────────────────────────────────────────
function KpiTile({ icon: Icon, tone = 'gray', label, primary, secondary, loading }) {
  const tones = {
    blue:    { ring: 'ring-blue-100',    icon: 'text-blue-500 bg-blue-50' },
    emerald: { ring: 'ring-emerald-100', icon: 'text-emerald-500 bg-emerald-50' },
    amber:   { ring: 'ring-amber-100',   icon: 'text-amber-500 bg-amber-50' },
    violet:  { ring: 'ring-violet-100',  icon: 'text-violet-500 bg-violet-50' },
    rose:    { ring: 'ring-rose-100',    icon: 'text-rose-500 bg-rose-50' },
    gray:    { ring: 'ring-gray-100',    icon: 'text-gray-500 bg-gray-50' },
  };
  const t = tones[tone] || tones.gray;
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ring-1 ${t.ring}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        {Icon && <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}><Icon size={14} /></span>}
      </div>
      <div className="text-xl font-bold text-gray-900 leading-none">
        {loading ? <span className="inline-block w-16 h-4 bg-gray-100 rounded animate-pulse" /> : primary}
      </div>
      {secondary && <div className="text-[11px] text-gray-500 mt-1">{secondary}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function SummaryCell({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
      <div className="text-base font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function ChartBlock({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : v} />
          <Tooltip formatter={(v) => fmtPKR(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Revenue" fill="#3b82f6" />
          {Object.keys(data[0] || {}).includes('Cost')   && <Bar dataKey="Cost"   fill="#f59e0b" />}
          {Object.keys(data[0] || {}).includes('Profit') && <Bar dataKey="Profit" fill="#10b981" />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusChip({ s }) {
  const tone =
    s === 'Closed' || s === 'Arrived' ? 'bg-slate-100 text-slate-700'
    : s === 'Shipped' ? 'bg-cyan-100 text-cyan-700'
    : s === 'Cancelled' ? 'bg-rose-100 text-rose-700'
    : 'bg-blue-100 text-blue-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{s || '—'}</span>;
}

function ProfitCell({ v }) {
  const n = parseFloat(v) || 0;
  const cls = n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-600' : 'text-gray-500';
  return <span className={`font-semibold ${cls}`}>{fmtPKR(n)}</span>;
}

function Table({ head, align = [], rows, rowClick }) {
  if (!rows || rows.length === 0) return <Empty msg="No rows." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {head.map((h, i) => (
              <th key={i} className={`text-${align[i] || 'left'} py-2.5 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wider`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, ri) => {
            const onClick = rowClick?.[ri];
            return (
              <tr key={ri} onClick={onClick}
                className={`hover:bg-gray-50 ${onClick ? 'cursor-pointer' : ''}`}>
                {row.map((cell, ci) => (
                  <td key={ci} className={`text-${align[ci] || 'left'} py-2.5 px-3 text-gray-800`}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }) {
  return <div className="text-center text-sm text-gray-400 py-12">{msg}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-32 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
      <div className="h-8 bg-gray-100 rounded" />
    </div>
  );
}
