import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import OrderRefLink from '../../../shared/components/OrderRefLink';
import {
  ShoppingCart, Package, Factory, Ship, Receipt,
  Search, Download, RefreshCw, CheckCircle, Clock, X, Plus, ChevronDown, Printer, Eye, User, DollarSign,
} from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { usePurchases, usePayPurchase, useBankAccounts, usePurchasePaymentTrail } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import { downloadCSV } from '../../../utils/csvExport';
import { useApp } from '../../../context/AppContext';
import { shortenRef } from '../utils/refs';
import PartyLink from '../../../shared/components/PartyLink';
import { favStar } from '../../../shared/utils/favorites';

function fmtPKR(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_00_00_000) return `Rs ${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1_00_000) return `Rs ${(v / 1_00_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const fmtFull = (n) => `Rs ${(parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const methodLabel = (m) => ({ cash: 'Cash', bank_transfer: 'Bank Transfer', bank: 'Bank Transfer', cheque: 'Cheque', lc: 'Letter of Credit', online: 'Online' }[m] || (m ? String(m).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'));

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
  unpaid:  'bg-red-50 text-red-700 border-red-200',
};
function statusTone(s) {
  const k = String(s || 'pending').toLowerCase();
  return STATUS_TONE[k] || STATUS_TONE.pending;
}

const ADD_OPTIONS = [
  { label: 'Raw / Stock Lot',     description: 'Raw rice, finished rice, byproduct lots', icon: Package, to: '/lot-inventory?action=new' },
  { label: 'Mill Store Purchase', description: 'Spare parts, packaging, fuel',          icon: Factory,  to: '/mill-store/purchases/new' },
  { label: 'Export Cost',         description: 'Freight, commission, certificates — pick an order', icon: Ship, to: '/export' },
  { label: 'Business Expense',    description: 'Utilities, salaries, admin',            icon: Receipt,  to: '/finance/expenses?action=new' },
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
  const { addToast, companyProfileData } = useApp();
  const { queryParams: rangeParams, rangeKey } = useFinanceDateRange();
  const [source, setSource] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [addOpen, setAddOpen] = useState(false);
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

  // Payment drawer state — opens when user clicks the status pill on a row.
  const [payTarget, setPayTarget] = useState(null);
  const [detailPurchase, setDetailPurchase] = useState(null);
  const { data: payTrail, isLoading: payTrailLoading } = usePurchasePaymentTrail(detailPurchase?.source, detailPurchase?.refId, !!detailPurchase);
  const { data: bankAccounts = [] } = useBankAccounts();
  const payMut = usePayPurchase();

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
          <p className="text-sm text-gray-500 mt-0.5">Every purchase recorded across the company — raw rice, mill store, export costs, and expenses.</p>
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
                          onClick={() => { setAddOpen(false); navigate(opt.to); }}
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
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg">
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
              <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">Purchases</div>
              <div className="text-xs text-gray-600">
                {filteredTotals.count} purchases · Total {fmtPKR(filteredTotals.totalPkr)} · Paid {fmtPKR(filteredTotals.paidPkr)} · Open {fmtPKR(filteredTotals.openPkr)}
              </div>
            </div>
          </div>
        </div>

      {/* KPIs — recompute from filtered */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Total Spend" primary={fmtPKR(filteredTotals.totalPkr)} secondary={`${filteredTotals.count} purchases`} tone="gray" />
        <KpiTile label="Paid" primary={fmtPKR(filteredTotals.paidPkr)} secondary="Settled" tone="emerald" />
        <KpiTile label="Open" primary={fmtPKR(filteredTotals.openPkr)} secondary="Pending / Unpaid / Partial" tone="rose" />
        <KpiTile label="Avg per purchase" primary={fmtPKR(filteredTotals.count > 0 ? filteredTotals.totalPkr / filteredTotals.count : 0)} secondary="In current view" tone="blue" />
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
                    <td data-label="Date" className="mob-hide px-4 py-2.5 text-gray-700 whitespace-nowrap">{p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td data-label="Ref" className="px-4 py-2.5 font-medium text-gray-900">
                      <RefLink p={p} />
                    </td>
                    <td data-label="Source" className="mob-hide px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <SrcIcon size={12} className="text-gray-400" />
                        {meta?.label || p.source}
                      </span>
                    </td>
                    <td data-label="Supplier" className="px-4 py-2.5 text-gray-700 truncate max-w-[180px]"><PartyLink type="supplier" id={p.supplierId} name={p.supplierName} /></td>
                    <td data-label="Category" className="mob-hide px-4 py-2.5 text-gray-600 capitalize text-xs">{p.category ? String(p.category).replace(/_/g, ' ') : '—'}</td>
                    <td data-label="Amount" className="px-4 py-2.5 text-right tabular-nums">
                      <span className="font-medium text-gray-900">{fmtFull(p.amountPkr)}</span>
                      {(p.currency || 'PKR') !== 'PKR' && parseFloat(p.amount) > 0 && (
                        <div className="text-[10px] text-gray-400">{p.currency} {Math.round(parseFloat(p.amount)).toLocaleString()}</div>
                      )}
                    </td>
                    <td data-label="Status" className="px-4 py-2.5">
                      {String(p.paymentStatus || 'pending').toLowerCase() === 'paid' ? (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusTone(p.paymentStatus)}`}>
                          {String(p.paymentStatus)}
                        </span>
                      ) : (
                        <button
                          onClick={() => setPayTarget(p)}
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border hover:shadow-sm hover:scale-105 transition-transform cursor-pointer ${statusTone(p.paymentStatus)}`}
                          title="Record payment"
                        >
                          {String(p.paymentStatus || 'Pending')} →
                        </button>
                      )}
                    </td>
                    <td data-label="Created" className="mob-hide px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]">{p.createdByName || '—'}</td>
                    <td data-label="Approved" className="mob-hide px-4 py-2.5 text-gray-600 text-xs truncate max-w-[140px]">
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
                        {String(p.paymentStatus || 'pending').toLowerCase() !== 'paid' && (
                          <button onClick={() => setPayTarget(p)}
                            className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                            <DollarSign size={12} /> Pay
                          </button>
                        )}
                        <button onClick={() => setDetailPurchase(p)} className="text-blue-600 hover:text-blue-800 p-1" title="View details">
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

      {payTarget && (
        <PayPurchaseDrawer
          purchase={payTarget}
          bankAccounts={bankAccounts}
          isPending={payMut.isPending}
          onClose={() => setPayTarget(null)}
          onSubmit={async (form) => {
            try {
              await payMut.mutateAsync({
                source: payTarget.source,
                source_id: payTarget.refId,
                amount: form.amount,
                bank_account_id: form.paymentMethod === 'cash' ? null : (form.bankAccountId || null),
                payment_method: form.paymentMethod,
                payment_date: form.paymentDate,
                payment_reference: form.reference || null,
                due_date: form.dueDate || null,
                notes: form.notes || null,
              });
              addToast(`Payment of Rs ${Number(form.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded`, 'success');
              setPayTarget(null);
            } catch (err) {
              addToast(err?.message || 'Failed to record payment', 'error');
            }
          }}
        />
      )}

      {/* Purchase detail — right slide-over */}
      {detailPurchase && (() => {
        const p = detailPurchase;
        const Row = ({ label, value }) => (
          <div className="flex justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-xs text-gray-500">{label}</span>
            <span className="text-sm font-medium text-gray-900 text-right">{value || '—'}</span>
          </div>
        );
        const isPaid = String(p.paymentStatus || 'pending').toLowerCase() === 'paid';
        return (
          <SlideDrawer open={!!detailPurchase} onClose={() => setDetailPurchase(null)}
            title={shortenRef(p.ref) || p.ref || p.refId || 'Purchase'}
            subtitle={p.createdByName ? `Created by ${p.createdByName}` : undefined} icon={Receipt} size="md"
            footer={!isPaid ? (
              <button onClick={() => { setDetailPurchase(null); setPayTarget(p); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
                <DollarSign size={16} /> Record Payment
              </button>
            ) : (
              <p className="w-full text-center text-sm text-gray-500 inline-flex items-center justify-center gap-1.5"><CheckCircle size={15} className="text-emerald-600" /> Paid in full</p>
            )}>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">Amount</p>
                <p className="text-xl font-bold text-gray-900">{fmtFull(p.amountPkr)}</p>
                {(p.currency || 'PKR') !== 'PKR' && parseFloat(p.amount) > 0 && (
                  <p className="text-xs text-gray-400">{p.currency} {Math.round(parseFloat(p.amount)).toLocaleString()}</p>
                )}
              </div>
              <div>
                <Row label="Source" value={SOURCE_META[p.source]?.label || p.source} />
                <Row label="Date" value={p.date ? new Date(p.date).toLocaleDateString('en-GB') : '—'} />
                <Row label="Supplier" value={p.supplierName} />
                <Row label="Category" value={p.category ? <span className="capitalize">{String(p.category).replace(/_/g, ' ')}</span> : '—'} />
                <Row label="Reference" value={p.ref} />
                <Row label="Payment status" value={p.paymentStatus || 'Pending'} />
                <Row label="Created by" value={<span className="inline-flex items-center gap-1.5"><User size={13} className="text-gray-400" />{p.createdByName || '—'}</span>} />
                <Row label="Approved by" value={p.approvedByName} />
              </div>

              {/* Payments made — where & how each was given. */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Payments Made</h3>
                {payTrailLoading ? (
                  <p className="text-xs text-gray-400 py-1">Loading…</p>
                ) : (payTrail?.payments?.length ? (
                  <div className="space-y-2">
                    {payTrail.payments.map((pm, i) => {
                      let from = [pm.accountName, pm.bankName].filter(Boolean).join(' · ');
                      if (!from) from = pm.method === 'cash' ? 'Cash (in hand)' : '—';
                      const noDetail = pm.synthesized && !pm.method && !pm.accountName;
                      return (
                        <div key={i} className="border border-gray-200 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-emerald-700">{fmtFull(pm.amount)}</span>
                            <span className="text-xs text-gray-500">{pm.date ? new Date(pm.date).toLocaleDateString('en-GB') : '—'}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            {noDetail ? (
                              <span className="italic text-gray-400">Settled — payment account/method not recorded</span>
                            ) : (
                              <>
                                <span>Type: <span className="font-medium text-gray-700">{methodLabel(pm.method)}</span></span>
                                <span>From: <span className="font-medium text-gray-700">{from}</span></span>
                                {pm.reference && <span>Ref: <span className="font-medium text-gray-700">{pm.reference}</span></span>}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-1">No payments recorded yet.</p>
                ))}
              </div>
            </div>
          </SlideDrawer>
        );
      })()}
    </div>
  );
}

function PayPurchaseDrawer({ purchase, bankAccounts, isPending, onClose, onSubmit }) {
  const outstanding = useMemo(() => {
    // Best-effort outstanding — the listPurchases endpoint doesn't yet
    // return paid_amount, so default to the full amount and let the user
    // adjust. Partial payments are clamped server-side.
    return parseFloat(purchase.amountPkr) || 0;
  }, [purchase]);

  const [amount, setAmount] = useState(String(Math.round(outstanding)));
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState(bankAccounts.find(a => (a.currency || 'PKR') === 'PKR')?.id || '');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const sourceMeta = SOURCE_META[purchase.source] || { label: purchase.source };
  const SrcIcon = sourceMeta.icon || Receipt;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-stretch justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Record Payment</h2>
            <p className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
              <SrcIcon size={12} /> {sourceMeta.label} · {purchase.ref || '—'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseFloat(amount);
            if (!n || n <= 0) return;
            onSubmit({ amount: n, paymentMethod, bankAccountId, paymentDate, reference, dueDate, notes });
          }}
          className="flex-1 overflow-y-auto p-5 space-y-4"
        >
          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Supplier</span>
              <span className="font-medium"><PartyLink type="supplier" id={purchase.supplierId} name={purchase.supplierName} /></span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total</span>
              <span className="font-medium text-gray-900">Rs {(outstanding).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Current status</span>
              <span className={`px-2 py-0.5 rounded-full border ${statusTone(purchase.paymentStatus)}`}>
                {purchase.paymentStatus || 'Pending'}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Amount paying (PKR)</label>
            <input
              type="number" min="0" step="0.01" required
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
            <p className="text-[11px] text-gray-400 mt-1">Defaults to full amount. Lower it for partial payment.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Paid from</label>
            <div className="inline-flex bg-gray-100 rounded-lg p-0.5 mb-2">
              {['bank', 'cash', 'cheque'].map(m => (
                <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${paymentMethod === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {paymentMethod !== 'cash' && (
              <select
                value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              >
                <option value="">Select a bank account…</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {favStar(a)}{a.name} · {a.bankName || '—'} ({a.currency || 'PKR'} {(parseFloat(a.currentBalance) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Payment date</label>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Reference</label>
              <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                placeholder="Cheque/TXN #" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {paymentMethod === 'cheque' && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Cheque date <span className="text-gray-400">(when it clears)</span></label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </form>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={isPending}
            className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900">Cancel</button>
          <button onClick={(e) => {
              const form = e.currentTarget.closest('.bg-white').querySelector('form');
              form.requestSubmit();
            }} disabled={isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg">
            <CheckCircle size={14} />
            {isPending ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </div>
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
