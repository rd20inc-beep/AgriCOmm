import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Package, Factory, Ship, Receipt,
  Search, Download, RefreshCw, CheckCircle, Clock, X,
} from 'lucide-react';
import { usePurchases } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import { downloadCSV } from '../../../utils/csvExport';

function fmtPKR(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_00_00_000) return `Rs ${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1_00_000) return `Rs ${(v / 1_00_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(v).toLocaleString()}`;
}
const fmtFull = (n) => `Rs ${Math.round(parseFloat(n) || 0).toLocaleString()}`;

const SOURCES = [
  { value: 'all',         label: 'All',        icon: ShoppingCart, accent: 'gray' },
  { value: 'lot',         label: 'Raw / Stock', icon: Package,     accent: 'amber' },
  { value: 'mill_store',  label: 'Mill Store', icon: Factory,     accent: 'orange' },
  { value: 'export_cost', label: 'Export Costs', icon: Ship,      accent: 'blue' },
  { value: 'expense',     label: 'Expenses',   icon: Receipt,     accent: 'rose' },
];

const SOURCE_META = Object.fromEntries(SOURCES.map(s => [s.value, s]));

const STATUS_TONE = {
  paid:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-gray-50 text-gray-600 border-gray-200',
  unpaid:  'bg-rose-50 text-rose-700 border-rose-200',
};
function statusTone(s) {
  const k = String(s || 'pending').toLowerCase();
  return STATUS_TONE[k] || STATUS_TONE.pending;
}

export default function Purchases() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const [source, setSource] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const params = { ...rangeParams, source: source !== 'all' ? source : undefined, limit: 500 };
  const { data, isLoading, error, refetch } = usePurchases(params);
  const purchases = data?.purchases || [];
  const totals = data?.totals || { totalPkr: 0, count: 0, bySource: {}, byStatus: {} };

  const filtered = useMemo(() => {
    return purchases.filter(p => {
      if (statusFilter !== 'All' && String(p.paymentStatus || 'Pending').toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        if (!(
          (p.ref || '').toLowerCase().includes(t) ||
          (p.supplierName || '').toLowerCase().includes(t) ||
          (p.category || '').toLowerCase().includes(t) ||
          (p.createdByName || '').toLowerCase().includes(t) ||
          (p.approvedByName || '').toLowerCase().includes(t)
        )) return false;
      }
      return true;
    });
  }, [purchases, statusFilter, searchTerm]);

  // Re-aggregate from the filtered set so KPI tiles reflect what's on screen
  const filteredTotals = useMemo(() => {
    const out = { totalPkr: 0, count: filtered.length, paidPkr: 0, openPkr: 0 };
    for (const p of filtered) {
      const amt = parseFloat(p.amountPkr) || 0;
      out.totalPkr += amt;
      const s = String(p.paymentStatus || 'pending').toLowerCase();
      if (s === 'paid') out.paidPkr += amt;
      else out.openPkr += amt;
    }
    return out;
  }, [filtered]);

  function exportCsv() {
    const rows = filtered.map(p => ({
      Date: p.date || '',
      Source: SOURCE_META[p.source]?.label || p.source,
      Ref: p.ref || '',
      Supplier: p.supplierName || '',
      Category: p.category || '',
      Amount_PKR: Math.round(parseFloat(p.amountPkr) || 0),
      Currency: p.currency || 'PKR',
      Status: p.paymentStatus || 'Pending',
      Created_By: p.createdByName || '',
      Approved_By: p.approvedByName || '',
    }));
    downloadCSV(rows, `purchases-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (isLoading) return <LoadingSpinner message="Loading purchases…" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-gray-700" />
            Purchases
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Every purchase recorded across the company — raw paddy, mill store, export costs, and expenses.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPIs — recompute from filtered */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Total Spend" primary={fmtPKR(filteredTotals.totalPkr)} secondary={`${filteredTotals.count} purchases`} tone="gray" />
        <KpiTile label="Paid" primary={fmtPKR(filteredTotals.paidPkr)} secondary="Settled" tone="emerald" />
        <KpiTile label="Open" primary={fmtPKR(filteredTotals.openPkr)} secondary="Pending / Unpaid / Partial" tone="rose" />
        <KpiTile label="Avg per purchase" primary={fmtPKR(filteredTotals.count > 0 ? filteredTotals.totalPkr / filteredTotals.count : 0)} secondary="In current view" tone="blue" />
      </div>

      {/* Source pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {SOURCES.map(s => {
          const Icon = s.icon;
          const isActive = source === s.value;
          const sourceTotal = totals.bySource ? totals.bySource[s.value] : null;
          return (
            <button
              key={s.value}
              onClick={() => setSource(s.value)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
              }`}
            >
              <Icon size={14} />
              {s.label}
              {s.value !== 'all' && sourceTotal != null && (
                <span className={`text-[10px] ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>
                  {fmtPKR(sourceTotal)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search ref / supplier / category / approver…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-900 transition-colors"
          />
        </div>
        <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
          {['All', 'Paid', 'Partial', 'Pending', 'Unpaid'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{filtered.length} of {purchases.length}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No purchases match the current filters.
                  </td>
                </tr>
              ) : filtered.map(p => {
                const meta = SOURCE_META[p.source];
                const SrcIcon = meta?.icon || Receipt;
                return (
                  <tr key={`${p.source}-${p.refId}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      <RefLink p={p} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <SrcIcon size={12} className="text-gray-400" />
                        {meta?.label || p.source}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 truncate max-w-[180px]">{p.supplierName || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize text-xs">{p.category ? String(p.category).replace(/_/g, ' ') : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="font-medium text-gray-900">{fmtFull(p.amountPkr)}</span>
                      {(p.currency || 'PKR') !== 'PKR' && parseFloat(p.amount) > 0 && (
                        <div className="text-[10px] text-gray-400">{p.currency} {Math.round(parseFloat(p.amount)).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusTone(p.paymentStatus)}`}>
                        {String(p.paymentStatus || 'Pending')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]">{p.createdByName || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]">
                      {p.approvedByName ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle size={11} /> {p.approvedByName}
                        </span>
                      ) : p.source === 'expense' ? (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <Clock size={11} /> Pending
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RefLink({ p }) {
  if (p.source === 'lot') {
    return <Link to={`/lot-inventory/${p.ref}`} className="text-blue-600 hover:underline">{p.ref}</Link>;
  }
  if (p.source === 'export_cost') {
    return <Link to={`/export/${p.ref}`} className="text-blue-600 hover:underline">{p.ref}</Link>;
  }
  return <span>{p.ref || '—'}</span>;
}

function KpiTile({ label, primary, secondary, tone = 'gray' }) {
  const ring = {
    emerald: 'ring-emerald-100',
    rose:    'ring-rose-100',
    blue:    'ring-blue-100',
    gray:    'ring-gray-100',
  }[tone] || 'ring-gray-100';
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ring-1 ${ring}`}>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{primary}</p>
      {secondary && <p className="text-[11px] text-gray-500 mt-0.5">{secondary}</p>}
    </div>
  );
}
