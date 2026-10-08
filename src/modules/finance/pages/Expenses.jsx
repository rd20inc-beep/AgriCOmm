import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, CreditCard, Download, Wallet, Eye } from 'lucide-react';
import { downloadCSV } from '../../../utils/csvExport';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { useFinanceDrawers } from '../drawers/drawersContext';
import { TYPES } from '../utils/expenseCatalogue';
import ExpenseCreateDrawer from '../components/ExpenseCreateDrawer';
import { todayLocalISO, fmtPKR, fmtMoney, fmtDate } from '../../../shared/utils/format';
import StatusBadge from '../../../shared/components/StatusBadge';

// ─── Formatting ──────────────────────────────────────────────────────
// Exact to the paisa, in the expense's own currency (PKR / USD / EUR / GBP).
const fmtAmt = (v, currency) => fmtMoney(v, currency || 'PKR', { decimals: 2 });
function unwrap(res, key) {
  const d = res?.data?.data || res?.data || res;
  return key ? (d?.[key] ?? d) : d;
}

// ─── React-Query hooks ───────────────────────────────────────────────
function useExpenses(params = {}) {
  return useQuery({
    queryKey: ['expenses', 'list', params],
    queryFn: async () => { const r = await api.get('/api/expenses', params); return unwrap(r, 'expenses') || []; },
  });
}
function useExpenseSummary() {
  return useQuery({
    queryKey: ['expenses', 'summary'],
    queryFn: async () => { const r = await api.get('/api/expenses/summary'); return unwrap(r, 'summary') || {}; },
  });
}

// ─── Page ────────────────────────────────────────────────────────────
// Money Out ▸ Expenses. Recording one is the New expense drawer (also the
// Finance header's + Expense); a row opens the expense's Document drawer
// (details, payments, link supplier) and Pay opens the shared Payment form
// (PUT /api/expenses/:id/pay). The buttons ask what the routes ask:
// creating is finance.allocate_cost, paying is finance.confirm_payment.
export default function Expenses() {
  const { queryParams: rangeParams } = useFinanceDateRange();
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const canCreate = hasPermission('finance', 'allocate_cost');
  const canPay = hasPermission('finance', 'confirm_payment');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const { data: expenses = [], isLoading } = useExpenses({
    ...(typeFilter ? { expense_type: typeFilter } : {}),
    ...(statusFilter ? { payment_status: statusFilter } : {}),
    ...rangeParams,
    limit: 100,
  });
  const { data: summary = {} } = useExpenseSummary();

  const safeExpenses = Array.isArray(expenses) ? expenses : [];
  const filtered = search
    ? safeExpenses.filter(e =>
        (e.vendor_name || e.supplier_name_joined || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.expense_no || '').toLowerCase().includes(search.toLowerCase())
      )
    : safeExpenses;

  // ?action=new (the Finance Purchases "+Add Purchase" dropdown and older
  // links) opens the New expense drawer.
  const [showForm, setShowForm] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const formOpen = showForm || (canCreate && searchParams.get('action') === 'new');
  function closeForm() {
    setShowForm(false);
    if (searchParams.has('action')) {
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }

  const openDetail = (e) => drawers?.openDocument({ docKind: 'expense', row: e, id: e.id });
  const openPay = (e) => drawers?.openPayment({ docKind: 'expense', row: e });

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Hero band ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-red-900 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Wallet size={14} /> Business Expenses
            </div>
            <h1 className="text-3xl font-bold leading-tight">{fmtPKR(summary.total_amount_pkr)}</h1>
            <p className="text-sm opacity-80 mt-1">
              {summary.total_expenses || 0} expenses ·
              <span className="text-red-300 font-medium"> {fmtPKR(summary.unpaid_amount_pkr)} unpaid</span>
              <span className="opacity-60"> · {summary.unpaid_count || 0} pending</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => downloadCSV(filtered, [
                { key: 'expense_no', label: 'Ref' },
                { key: 'expense_date', label: 'Date' },
                { key: 'expense_type', label: 'Type' },
                { key: 'category', label: 'Category' },
                { key: 'amount', label: 'Amount' },
                { key: 'currency', label: 'Currency' },
                { key: 'vendor_name', label: 'Vendor' },
                { key: 'description', label: 'Description' },
                { key: 'payment_status', label: 'Status' },
              ], `expenses-${todayLocalISO()}.csv`)}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors"
            >
              <Download size={12} /> CSV
            </button>
            {canCreate && (
              <button onClick={() => setShowForm(true)} data-action="new-expense"
                className="bg-white text-slate-900 hover:bg-gray-100 px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 shadow-sm transition-colors">
                <Plus size={14} /> New Expense
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Type tiles ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(summary.by_type || []).map(t => {
          const T = TYPES.find(x => x.value === t.expense_type);
          if (!T) return null;
          const Icon = T.icon;
          return (
            <button key={t.expense_type}
              onClick={() => setTypeFilter(typeFilter === t.expense_type ? '' : t.expense_type)}
              className={`bg-white rounded-xl border p-4 text-left transition-all hover:shadow-sm ${typeFilter === t.expense_type ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{T.label}</span>
                <span className="w-7 h-7 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center"><Icon size={14} /></span>
              </div>
              <div className="text-xl font-bold text-gray-900 leading-none">{fmtPKR(t.total_pkr)}</div>
              <div className="text-[11px] text-gray-500 mt-1">{t.count || 0} entries</div>
            </button>
          );
        })}
        {(summary.by_type || []).length === 0 && (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400 col-span-2 lg:col-span-4">
            No expenses recorded yet{canCreate ? <> — click <strong>New Expense</strong> to add the first one</> : ''}.
          </div>
        )}
      </div>

      {/* ─── Filters ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor, description, ref..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <FilterPills
          options={[{ v: '', l: 'All types' }, { v: 'general', l: 'General' }, { v: 'mill', l: 'Mill' }, { v: 'export', l: 'Export' }]}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        <FilterPills
          options={[{ v: '', l: 'Any status' }, { v: 'Unpaid', l: 'Unpaid' }, { v: 'Paid', l: 'Paid' }]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* ═══ TABLE ════════════════════════════════════════════════ */}
      <ExpenseTable
        loading={isLoading}
        rows={filtered}
        onPay={canPay ? openPay : null}
        onView={openDetail}
      />

      {formOpen && <ExpenseCreateDrawer open onClose={closeForm} />}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function FilterPills({ options, value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 bg-gray-50 rounded-lg p-0.5">
      {options.map(o => (
        <button key={o.v || 'all'} onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${value === o.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function ExpenseTable({ loading, rows, onPay, onView }) {
  if (loading) {
    return <div className="animate-pulse space-y-2">{[0,1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <Wallet size={36} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">No expenses match the current filters.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto mobile-cards">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Ref / Type</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Date</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Vendor / Description</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Category</th>
            <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Amount</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Linked To</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Status</th>
            <th className="text-right py-2.5 px-4 font-semibold text-gray-600"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(e => (
            <tr key={e.id} className="hover:bg-gray-50">
              <td data-label="Ref / Type" className="py-2.5 px-4">
                <p className="font-mono text-xs text-gray-700">{e.expense_no}</p>
                <p className="text-[10px] text-gray-400 capitalize">{e.expense_type}</p>
              </td>
              <td data-label="Date" className="mob-hide py-2.5 px-4 text-gray-600">{fmtDate(e.expense_date)}</td>
              <td data-label="Vendor / Description" className="py-2.5 px-4">
                <p className="font-medium text-gray-900 truncate max-w-[240px]" title={e.vendor_name || e.supplier_name_joined || undefined}>
                  {e.vendor_name || e.supplier_name_joined || '—'}
                </p>
                {e.description && <p className="text-[11px] text-gray-500 truncate max-w-[240px]" title={e.description}>{e.description}</p>}
              </td>
              <td data-label="Category" className="mob-hide py-2.5 px-4">
                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                  {(e.category || '').replace(/_/g, ' ')}
                </span>
              </td>
              <td data-label="Amount" className="py-2.5 px-4 text-right font-bold text-gray-900">
                {fmtAmt(e.amount, e.currency)}
              </td>
              <td data-label="Linked To" className="mob-hide py-2.5 px-4 text-xs">
                {e.batch_no ? <span className="text-blue-600 font-medium">{e.batch_no}</span>
                 : e.order_no ? <span className="text-emerald-600 font-medium">{e.order_no}</span>
                 : <span className="text-gray-400">—</span>}
              </td>
              <td data-label="Status" className="py-2.5 px-4">
                <StatusBadge status={e.payment_status} />
              </td>
              <td data-label="Actions" className="py-2.5 px-4 text-right">
                <div className="inline-flex items-center gap-1.5">
                  {e.payment_status !== 'Paid' && onPay && (
                    <button onClick={() => onPay(e)} data-action="pay"
                      className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                      <CreditCard size={12} /> Pay
                    </button>
                  )}
                  <button onClick={() => onView?.(e)} className="text-blue-600 hover:text-blue-800 p-1" title="View details" aria-label="View details">

                    <Eye size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
