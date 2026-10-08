import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import {
  ShoppingCart, Package, Factory, Ship, Receipt,
  Search, Download, RefreshCw, CheckCircle, Clock, X, Plus, ChevronDown, Printer, Eye, DollarSign,
} from 'lucide-react';
import NewPurchaseDrawer from '../../../components/NewPurchaseDrawer';
import { usePurchases } from '../../../api/queries';
import { useAuth } from '../../../context/AuthContext';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { isSettleable, canRecordVariant } from '../../../components/payments/paymentVariants';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import { downloadCSV } from '../../../utils/csvExport';
import { useApp } from '../../../context/AppContext';
import { shortenRef } from '../utils/refs';
import PartyLink from '../../../shared/components/PartyLink';
import { todayLocalISO, fmtPKR, fmtMoney, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import StatusBadge from '../../../shared/components/StatusBadge';

// Exact to the paisa (purchase totals are reconciled line by line).
const fmtFull = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });

const SOURCES = [
  { value: 'all',         label: 'All',        icon: ShoppingCart, accent: 'gray' },
  { value: 'lot',         label: 'Raw / Stock', icon: Package,     accent: 'amber' },
  { value: 'mill_store',  label: 'Mill Store', icon: Factory,     accent: 'orange' },
  { value: 'export_cost', label: 'Export Costs', icon: Ship,      accent: 'blue' },
  { value: 'expense',     label: 'Expenses',   icon: Receipt,     accent: 'rose' },
];

const SOURCE_META = Object.fromEntries(SOURCES.map(s => [s.value, s]));

// The API sends payment status in either case ('paid' / 'Paid'); StatusBadge
// keys on the title-cased word.
function statusLabel(s) {
  const t = String(s || 'Pending');
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

const ADD_OPTIONS = [
  { label: 'Raw / Stock Lot',     description: 'Raw rice, finished rice, byproduct lots', icon: Package, to: '/lot-inventory?action=new' },
  { label: 'Mill Store Purchase', description: 'Spare parts, packaging, fuel',          icon: Factory,  drawer: 'store' },
  { label: 'Export Cost',         description: 'Freight, commission, certificates — pick an order', icon: Ship, to: '/export' },
  { label: 'Business Expense',    description: 'Utilities, salaries, admin',            icon: Receipt,  to: '/finance/money-out/expenses?action=new' },
];

const RANGE_LABEL = {
  today:   'Today',
  week:    'This Week',
  month:   'This Month',
  quarter: 'This Quarter',
  year:    'This Year',
};

export default function Purchases() {
  const navigate = useNavigate();
  const { companyProfileData } = useApp();
  const { queryParams: rangeParams, rangeKey } = useFinanceDateRange();
  const [source, setSource] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [showStorePurchase, setShowStorePurchase] = useState(false);
  const addRef = useRef(null);
  const [, setUrlParams] = useSearchParams();

  function handlePrint() {
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  // A row opens its Document drawer (payments made, Pay); Pay opens the
  // shared Payment form (POST /api/finance/purchases/pay), shown only to a
  // role that route admits. The status is a status, not a button.
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const docOf = (p) => ({ docKind: 'purchase', row: p, id: p.refId, source: p.source });
  const canPay = (p) => isSettleable(docOf(p)) && canRecordVariant('pay_purchase', hasPermission);

  function clearDateRange() {
    setUrlParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('range');
      return next;
    }, { replace: true });
  }
  function clearAllFilters() {
    setSource('all');
    setStatusFilter('All');
    setSearchTerm('');
    clearDateRange();
  }

  useEffect(() => {
    if (!addOpen) return;
    function onClickAway(e) { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); }
    function onEsc(e) { if (e.key === 'Escape') setAddOpen(false); }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [addOpen]);

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
    downloadCSV(rows, `purchases-${todayLocalISO()}.csv`);
  }

  if (isLoading) return <LoadingSpinner message="Loading purchases…" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-gray-500">Every purchase recorded across the company — raw rice, mill store, export costs, and expenses.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Add purchase — opens a dropdown that routes to the right creator,
              since each purchase type lives in a different module (lots,
              mill store, export costs, expenses). */}
          <div className="relative" ref={addRef}>
            <button
              onClick={() => setAddOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
            >
              <Plus size={14} /> Add Purchase
              <ChevronDown size={13} className={`transition-transform ${addOpen ? 'rotate-180' : ''}`} />
            </button>
            {addOpen && (
              <div className="absolute right-0 mt-1.5 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-700">What are you adding?</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Each type is recorded in its own module; this jumps you straight there.</p>
                </div>
                <ul>
                  {ADD_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    return (
                      <li key={opt.label}>
                        <button
                          onClick={() => {
                            setAddOpen(false);
                            if (opt.drawer === 'store') setShowStorePurchase(true);
                            else navigate(opt.to);
                          }}
                          className="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-700 flex-shrink-0 mt-0.5">
                            <Icon size={15} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                            <p className="text-[11px] text-gray-500">{opt.description}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <Printer size={14} /> Print
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => refetch()} aria-label="Refresh" title="Refresh" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="print-report">
        {/* Print-only header */}
        <div className="hidden print:block mb-4">
          <div className="border-b-2 border-gray-900 pb-2 flex items-end justify-between">
            <div>
              <div className="text-base font-bold uppercase tracking-wider">
                {companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES'}
              </div>
              <div className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Purchases</div>
              <div className="text-xs text-gray-600">
                {filteredTotals.count} purchases · Total {fmtFull(filteredTotals.totalPkr)} · Paid {fmtFull(filteredTotals.paidPkr)} · Open {fmtFull(filteredTotals.openPkr)}
              </div>
            </div>
          </div>
        </div>

      {/* KPIs — recompute from filtered */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Total Spend" primary={fmtFull(filteredTotals.totalPkr)} secondary={`${filteredTotals.count} purchases`} tone="gray" />
        <KpiTile label="Paid" primary={fmtFull(filteredTotals.paidPkr)} secondary="Settled" tone="emerald" />
        <KpiTile label="Open" primary={fmtFull(filteredTotals.openPkr)} secondary="Pending / Unpaid / Partial" tone="rose" />
        <KpiTile label="Avg per purchase" primary={fmtFull(filteredTotals.count > 0 ? filteredTotals.totalPkr / filteredTotals.count : 0)} secondary="In current view" tone="blue" />
      </div>

      {/* Active filter chips — surface every constraint that could be hiding rows,
          including the global date range from FinanceLayout's header dropdown. */}
      {(rangeKey || source !== 'all' || statusFilter !== 'All' || searchTerm) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-gray-500 font-medium">Active filters:</span>
          {rangeKey && (
            <button onClick={clearDateRange}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
              Date: {RANGE_LABEL[rangeKey] || rangeKey}
              <X size={11} />
            </button>
          )}
          {source !== 'all' && (
            <button onClick={() => setSource('all')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100">
              Source: {SOURCE_META[source]?.label || source}
              <X size={11} />
            </button>
          )}
          {statusFilter !== 'All' && (
            <button onClick={() => setStatusFilter('All')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100">
              Status: {statusFilter}
              <X size={11} />
            </button>
          )}
          {searchTerm && (
            <button onClick={() => setSearchTerm('')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200">
              Search: "{searchTerm}"
              <X size={11} />
            </button>
          )}
          <button onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-gray-900 underline ml-1">
            Clear all
          </button>
        </div>
      )}

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
                  {fmtFull(sourceTotal)}
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
          {['All', 'Paid', 'Partial', 'Pending'].map(s => (
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
        <div className="overflow-x-auto mobile-cards">
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
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm">
                    {purchases.length === 0 ? (
                      <div className="text-gray-400 space-y-3">
                        <p>No purchases recorded {rangeKey ? <>in <span className="font-semibold text-gray-600">{RANGE_LABEL[rangeKey] || rangeKey}</span>.</> : 'yet.'}</p>
                        {rangeKey && (
                          <button onClick={clearDateRange} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium">
                            Show all time
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-400 space-y-3">
                        <p>{purchases.length} {purchases.length === 1 ? 'purchase' : 'purchases'} loaded, but none match the current filters.</p>
                        <button onClick={clearAllFilters} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium">
                          Clear all filters
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : filtered.map(p => {
                const meta = SOURCE_META[p.source];
                const SrcIcon = meta?.icon || Receipt;
                return (
                  <tr key={`${p.source}-${p.refId}`} className="hover:bg-gray-50">
                    <td data-label="Date" className="mob-hide px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td data-label="Ref" className="px-4 py-2.5 font-medium text-gray-900">
                      <RefLink p={p} />
                    </td>
                    <td data-label="Source" className="mob-hide px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <SrcIcon size={12} className="text-gray-400" />
                        {meta?.label || p.source}
                      </span>
                    </td>
                    <td data-label="Supplier" className="px-4 py-2.5 text-gray-700 truncate max-w-[180px]" title={p.supplierName || undefined}><PartyLink type="supplier" id={p.supplierId} name={p.supplierName} /></td>
                    <td data-label="Category" className="mob-hide px-4 py-2.5 text-gray-600 capitalize text-xs">{p.category ? String(p.category).replace(/_/g, ' ') : '—'}</td>
                    <td data-label="Amount" className="px-4 py-2.5 text-right tabular-nums">
                      <span className="font-medium text-gray-900">{fmtFull(p.amountPkr)}</span>
                      {(p.currency || 'PKR') !== 'PKR' && parseFloat(p.amount) > 0 && (
                        <div className="text-[10px] text-gray-400">{fmtMoney(p.amount, p.currency)}</div>
                      )}
                    </td>
                    <td data-label="Status" className="px-4 py-2.5">
                      <StatusBadge status={statusLabel(p.paymentStatus)} />
                    </td>
                    <td data-label="Created" className="mob-hide px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]" title={p.createdByName || undefined}>{p.createdByName || '—'}</td>
                    <td data-label="Approved" className="mob-hide px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]" title={p.approvedByName || undefined}>
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
                    <td data-label="Actions" className="px-4 py-2.5 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        {canPay(p) && (
                          <button onClick={() => drawers?.openPayment(docOf(p))} data-action="pay"
                            className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                            <DollarSign size={12} /> Pay
                          </button>
                        )}
                        <button onClick={() => drawers?.openDocument(docOf(p))} className="text-blue-600 hover:text-blue-800 p-1" title="View details" aria-label="View details">
                          <Eye size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>{/* /.print-report */}

      <NewPurchaseDrawer open={showStorePurchase} onClose={() => setShowStorePurchase(false)} onSaved={() => refetch()} />
    </div>
  );
}

function RefLink({ p }) {
  const short = shortenRef(p.ref) || p.ref || '—';
  if (p.source === 'lot') {
    return <OrderRefLink to={`/lot-inventory/${p.ref}`} module="inventory" className="text-blue-600 hover:underline whitespace-nowrap">{short}</OrderRefLink>;
  }
  if (p.source === 'export_cost') {
    return <OrderRefLink to={`/export/${p.ref}`} module="export_orders" className="text-blue-600 hover:underline whitespace-nowrap">{short}</OrderRefLink>;
  }
  return <span title={p.ref || ''} className="whitespace-nowrap">{short}</span>;
}

function KpiTile({ label, primary, secondary, tone = 'gray' }) {
  const ring = {
    emerald: 'ring-emerald-100',
    rose:    'ring-red-100',
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
