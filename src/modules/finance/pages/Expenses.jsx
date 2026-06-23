import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, DollarSign, Search, Check, Loader2, CreditCard, Download,
  Wallet, Building2, Zap, Truck, Receipt, Briefcase, Coins, Ship,
  Factory, User, FileText, Calendar, X, Eye,
} from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { downloadCSV } from '../../../utils/csvExport';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../../context/AppContext';
import api from '../../../api/client';
import { useExpenseVendors } from '../../../api/queries';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';

// ─── Formatting ──────────────────────────────────────────────────────
function fmtPKR(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10_000_000) return `Rs ${(v / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(v) >= 100_000) return `Rs ${(v / 100_000).toFixed(2)}L`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(v).toLocaleString()}`;
}
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
function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/api/expenses', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}
function usePayExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/api/expenses/${id}/pay`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

// ─── Category catalogue ─────────────────────────────────────────────
// Each category declares the *kind* of vendor it usually has so the
// form can show the right suggestions instead of always offering the
// full suppliers list (which is meant for rice suppliers).
//
// vendorKind:
//   'utility'  → utility companies (KE, SSGC, WAPDA, etc.)
//   'supplier' → real rows from suppliersList (rice transport vendors)
//   'bank'     → bank accounts (charges, fees)
//   'landlord' → free text (rent)
//   'agent'    → free text (clearing agent, freight forwarder)
//   'staff'    → free text (salaries, wages)
//   'free'     → free text only
const TYPES = [
  { value: 'general',  label: 'General / Office', icon: Briefcase },
  { value: 'mill',     label: 'Mill Operations',  icon: Factory },
  { value: 'export',   label: 'Export Order',     icon: Ship },
  { value: 'personal', label: 'Personal / Owner', icon: User },
];

// apiCategory: when set, the Provider input fetches the dropdown
// options from the DB-backed expense_vendors table (managed in Admin →
// Expense Vendors) instead of the hardcoded vendorKind suggestions.
// Anything else falls through to the legacy vendorKind path below.
const CATEGORIES = {
  general: [
    { value: 'utility_bill',      label: 'Utility Bill (Electricity, Gas, Water)', icon: Zap,         vendorKind: 'utility',  apiCategory: 'utilities' },
    { value: 'rent',              label: 'Office / Warehouse Rent',                icon: Building2,    vendorKind: 'landlord', apiCategory: 'rent' },
    { value: 'insurance',         label: 'Insurance',                              icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'license',           label: 'License / Permit',                       icon: FileText,     vendorKind: 'free' },
    { value: 'professional_fees', label: 'Professional Fees (Audit, Legal, Tax)',  icon: Briefcase,    vendorKind: 'free' },
    { value: 'office_supplies',   label: 'Office Supplies',                        icon: Receipt,      vendorKind: 'free' },
    { value: 'bank_charges',      label: 'Bank Charges',                           icon: Coins,        vendorKind: 'bank' },
    { value: 'inspection',        label: 'Inspection Fee',                         icon: FileText,     vendorKind: 'free',     apiCategory: 'inspection' },
    { value: 'transport',         label: 'Transport / Delivery',                   icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'miscellaneous',     label: 'Other / Miscellaneous',                  icon: Receipt,      vendorKind: 'free' },
  ],
  mill: [
    { value: 'electricity',       label: 'Electricity',                            icon: Zap,          vendorKind: 'utility',  apiCategory: 'utilities' },
    { value: 'diesel',            label: 'Diesel / Fuel',                          icon: Truck,        vendorKind: 'free',     apiCategory: 'fuel' },
    { value: 'maintenance',       label: 'Maintenance / Repair',                   icon: Briefcase,    vendorKind: 'free',     apiCategory: 'maintenance' },
    { value: 'labor',             label: 'Labor / Daily Wages',                    icon: User,         vendorKind: 'staff' },
    { value: 'salaries',          label: 'Salaries',                               icon: User,         vendorKind: 'staff' },
    { value: 'transport',         label: 'Transport (Rice)',                       icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'inspection',        label: 'Inspection / Testing',                   icon: FileText,     vendorKind: 'free',     apiCategory: 'inspection' },
    { value: 'fumigation',        label: 'Fumigation',                             icon: FileText,     vendorKind: 'free' },
    { value: 'bags',              label: 'Bags / Packaging',                       icon: Receipt,      vendorKind: 'supplier', apiCategory: 'packaging' },
    { value: 'rent',              label: 'Mill Rent',                              icon: Building2,    vendorKind: 'landlord', apiCategory: 'rent' },
    { value: 'insurance',         label: 'Mill Insurance',                         icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'miscellaneous',     label: 'Other Mill Expense',                     icon: Receipt,      vendorKind: 'free' },
  ],
  export: [
    { value: 'clearing',          label: 'Clearing / Customs',                     icon: Ship,         vendorKind: 'agent',    apiCategory: 'inspection' },
    { value: 'freight',           label: 'Freight / Shipping',                     icon: Ship,         vendorKind: 'agent',    apiCategory: 'freight' },
    { value: 'transport',         label: 'Transport (Port / Inland)',              icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'inspection',        label: 'Inspection (SGS, etc.)',                 icon: FileText,     vendorKind: 'agent',    apiCategory: 'inspection' },
    { value: 'insurance',         label: 'Cargo Insurance',                        icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'commission',        label: 'Agent Commission',                       icon: Briefcase,    vendorKind: 'agent',    apiCategory: 'commission' },
    { value: 'documentation',     label: 'Documentation Fees',                     icon: FileText,     vendorKind: 'agent' },
    { value: 'bags',              label: 'Bags / Special Packing',                 icon: Receipt,      vendorKind: 'supplier', apiCategory: 'packaging' },
    { value: 'miscellaneous',     label: 'Other Export Cost',                      icon: Receipt,      vendorKind: 'free' },
  ],
  personal: [
    { value: 'personal_expense',  label: 'Personal Expense',                       icon: User,         vendorKind: 'free' },
    { value: 'travel',            label: 'Travel',                                 icon: Truck,        vendorKind: 'free' },
    { value: 'entertainment',     label: 'Entertainment / Meals',                  icon: Receipt,      vendorKind: 'free' },
    { value: 'vehicle',           label: 'Vehicle / Fuel',                         icon: Truck,        vendorKind: 'free' },
    { value: 'medical',           label: 'Medical',                                icon: FileText,     vendorKind: 'free' },
    { value: 'miscellaneous',     label: 'Other Personal',                         icon: Receipt,      vendorKind: 'free' },
  ],
};

// Common Pakistani utility companies — pre-populated suggestions for
// utility / electricity categories so users don't have to type them.
const UTILITY_VENDORS = [
  'K-Electric (KE)',
  'WAPDA / DISCOs',
  'LESCO',
  'IESCO',
  'GEPCO',
  'FESCO',
  'MEPCO',
  'SSGC (Sui Southern Gas)',
  'SNGPL (Sui Northern Gas)',
  'KWSB (Karachi Water)',
  'WASA',
  'PTCL',
  'Internet Provider',
];

const STATUS_COLORS = {
  Unpaid: 'bg-rose-100 text-rose-800',
  Partial: 'bg-amber-100 text-amber-800',
  Paid: 'bg-emerald-100 text-emerald-800',
};

// ─── Page ────────────────────────────────────────────────────────────
export default function Expenses() {
  const { addToast, suppliersList, bankAccountsList, millingBatches, exportOrders } = useApp();
  const { queryParams: rangeParams } = useFinanceDateRange();
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [detailExpense, setDetailExpense] = useState(null);
  const { data: expenses = [], isLoading } = useExpenses({
    ...(typeFilter ? { expense_type: typeFilter } : {}),
    ...(statusFilter ? { payment_status: statusFilter } : {}),
    ...rangeParams,
    limit: 100,
  });
  const { data: summary = {} } = useExpenseSummary();
  const createMut = useCreateExpense();
  const payMut = usePayExpense();

  const safeExpenses = Array.isArray(expenses) ? expenses : [];
  const safeBatches = Array.isArray(millingBatches) ? millingBatches : [];
  const safeOrders = Array.isArray(exportOrders) ? exportOrders : [];

  const filtered = search
    ? safeExpenses.filter(e =>
        (e.vendor_name || e.supplier_name_joined || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.expense_no || '').toLowerCase().includes(search.toLowerCase())
      )
    : safeExpenses;

  // ─── Form ───
  const [showForm, setShowForm] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Allow ?action=new (used by the Finance Purchases "+Add Purchase"
  // dropdown) to deep-link straight into the new-expense form.
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowForm(true);
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const initForm = {
    expense_type: 'general', category: 'utility_bill',
    amount: '', currency: 'PKR', vendor_name: '', supplier_id: '',
    expense_date: new Date().toISOString().split('T')[0], due_date: '',
    invoice_reference: '', description: '',
    batch_id: '', order_id: '', owner_name: '',
    pay_now: false, bank_account_id: '', payment_method: 'bank',
  };
  const [form, setForm] = useState(initForm);

  const setF = (k, v) => setForm(p => {
    const u = { ...p, [k]: v };
    if (k === 'expense_type') {
      u.category = (CATEGORIES[v] || CATEGORIES.general)[0].value;
      u.batch_id = '';
      u.order_id = '';
      u.owner_name = '';
      u.supplier_id = '';
      u.vendor_name = '';
    }
    if (k === 'category') {
      // When the category changes, the vendor kind likely changed too —
      // clear stale supplier_id so we don't carry over a rice supplier
      // into a utility-bill row.
      u.supplier_id = '';
      u.vendor_name = '';
    }
    return u;
  });

  const cats = CATEGORIES[form.expense_type] || CATEGORIES.general;
  const currentCat = cats.find(c => c.value === form.category) || cats[0];
  const vendorKind = currentCat.vendorKind;

  // Pull the DB-backed vendor presets so the Provider field reflects
  // whatever is managed in Admin → Expense Vendors.
  const { data: vendorData } = useExpenseVendors();
  const apiCategory = currentCat.apiCategory;
  const apiVendors = useMemo(() => {
    if (!apiCategory) return null;
    const list = vendorData?.byCategory?.[apiCategory] || [];
    return list.map(v => v.name);
  }, [apiCategory, vendorData]);
  const showBatchPicker = form.expense_type === 'mill';
  const showOrderPicker = form.expense_type === 'export';
  const showOwnerField = form.expense_type === 'personal';

  // ─── Pay modal ───
  const [payId, setPayId] = useState(null);
  const [payForm, setPayForm] = useState({ bank_account_id: '', payment_method: 'bank', payment_reference: '', due_date: '', paid_date: new Date().toISOString().split('T')[0], notes: '' });

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.amount) { addToast('Amount is required', 'error'); return; }
    if (!form.category) { addToast('Category is required', 'error'); return; }
    try {
      const payload = {
        expense_type: form.expense_type === 'personal' ? 'general' : form.expense_type,
        category: form.category,
        subcategory: form.expense_type === 'personal' ? 'personal' : null,
        amount: Number(form.amount),
        currency: form.currency,
        // Only send supplier_id when the kind actually maps to suppliers.
        // Utility / landlord / bank / staff / free always go via free-text vendor_name.
        supplier_id: vendorKind === 'supplier' && form.supplier_id ? Number(form.supplier_id) : null,
        vendor_name: form.vendor_name || (showOwnerField ? form.owner_name : null),
        expense_date: form.expense_date,
        due_date: form.due_date || null,
        invoice_reference: form.invoice_reference || null,
        description: form.description + (showOwnerField && form.owner_name ? ` [Owner: ${form.owner_name}]` : ''),
        batch_id: form.batch_id ? Number(form.batch_id) : null,
        order_id: form.order_id ? Number(form.order_id) : null,
        pay_now: form.pay_now,
        bank_account_id: form.pay_now && form.bank_account_id ? Number(form.bank_account_id) : null,
        payment_method: form.pay_now ? form.payment_method : null,
      };
      await createMut.mutateAsync(payload);
      addToast('Expense recorded', 'success');
      setShowForm(false);
      setForm(initForm);
    } catch (err) { addToast(err?.response?.data?.message || err.message, 'error'); }
  }

  async function handlePay() {
    // Cash & Cheque don't draw from a tracked account (same as Money In/Out).
    const needsAccount = payForm.payment_method !== 'cash' && payForm.payment_method !== 'cheque';
    if (needsAccount && !payForm.bank_account_id) { addToast('Select bank account', 'error'); return; }
    try {
      await payMut.mutateAsync({ id: payId, data: payForm });
      addToast('Payment recorded', 'success');
      setPayId(null);
    } catch (err) { addToast(err?.response?.data?.message || err.message, 'error'); }
  }

  return (
    <div className="space-y-5 pb-4">
      {/* ─── Hero band ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-rose-900 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Wallet size={14} /> Business Expenses
            </div>
            <h1 className="text-3xl font-bold leading-tight">{fmtPKR(summary.total_amount_pkr)}</h1>
            <p className="text-sm opacity-80 mt-1">
              {summary.total_expenses || 0} expenses ·
              <span className="text-rose-300 font-medium"> {fmtPKR(summary.unpaid_amount_pkr)} unpaid</span>
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
              ], `expenses-${new Date().toISOString().split('T')[0]}.csv`)}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors"
            >
              <Download size={12} /> CSV
            </button>
            <button onClick={() => setShowForm(true)}
              className="bg-white text-slate-900 hover:bg-gray-100 px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 shadow-sm transition-colors">
              <Plus size={14} /> New Expense
            </button>
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
            No expenses recorded yet — click <strong>New Expense</strong> to add the first one.
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

      {/* ═══ FORM (modal-style card) ═══════════════════════════════ */}
      {showForm && (
        <ExpenseForm
          form={form}
          setF={setF}
          cats={cats}
          currentCat={currentCat}
          vendorKind={vendorKind}
          apiVendors={apiVendors}
          apiCategory={apiCategory}
          suppliersList={suppliersList || []}
          bankAccountsList={bankAccountsList || []}
          safeBatches={safeBatches}
          safeOrders={safeOrders}
          showBatchPicker={showBatchPicker}
          showOrderPicker={showOrderPicker}
          showOwnerField={showOwnerField}
          createMut={createMut}
          handleCreate={handleCreate}
          onCancel={() => { setShowForm(false); setForm(initForm); }}
        />
      )}

      {/* ═══ TABLE ════════════════════════════════════════════════ */}
      <ExpenseTable
        loading={isLoading}
        rows={filtered}
        onPay={(e) => { setPayId(e.id); setPayForm({ bank_account_id: '', payment_method: 'bank', payment_reference: '', due_date: '', paid_date: new Date().toISOString().split('T')[0], notes: '' }); }}
        onView={setDetailExpense}
      />

      {/* Expense detail — right slide-over */}
      {detailExpense && (() => {
        const e = detailExpense;
        const Row = ({ label, value }) => (
          <div className="flex justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-xs text-gray-500">{label}</span>
            <span className="text-sm font-medium text-gray-900 text-right">{value || '—'}</span>
          </div>
        );
        const amt = e.currency === 'PKR' ? fmtPKR(e.amount) : `${e.currency} ${Number(e.amount).toLocaleString()}`;
        return (
          <SlideDrawer open={!!detailExpense} onClose={() => setDetailExpense(null)}
            title={e.expense_no || 'Expense'} subtitle={e.created_by_name ? `Created by ${e.created_by_name}` : undefined}
            icon={Receipt} size="md"
            footer={e.payment_status !== 'Paid' ? (
              <button onClick={() => { setDetailExpense(null); setPayId(e.id); setPayForm({ bank_account_id: '', payment_method: 'bank', payment_reference: '', due_date: '', paid_date: new Date().toISOString().split('T')[0], notes: '' }); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
                <CreditCard size={16} /> Record Payment
              </button>
            ) : (
              <p className="w-full text-center text-sm text-gray-500 inline-flex items-center justify-center gap-1.5"><Check size={15} className="text-emerald-600" /> Paid in full</p>
            )}>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">Amount</p>
                <p className="text-xl font-bold text-gray-900">{amt}</p>
              </div>
              <div>
                <Row label="Type" value={<span className="capitalize">{e.expense_type}</span>} />
                <Row label="Category" value={<span className="capitalize">{(e.category || '').replace(/_/g, ' ')}</span>} />
                <Row label="Date" value={e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-GB') : '—'} />
                <Row label="Vendor" value={e.vendor_name || e.supplier_name_joined} />
                <Row label="Description" value={e.description} />
                <Row label="Linked to" value={e.batch_no || e.order_no} />
                <Row label="Payment status" value={e.payment_status} />
                {e.payment_status === 'Paid' && (() => {
                  const method = { cash: 'Cash', bank: 'Bank Transfer', bank_transfer: 'Bank Transfer', cheque: 'Cheque', online: 'Online' }[e.payment_method] || e.payment_method;
                  const where = e.bank_type === 'cash' ? (e.bank_name || 'Cash') : (e.bank_name || (e.payment_method === 'cash' ? 'Cash (in hand)' : '—'));
                  return (
                    <>
                      <Row label="Paid via" value={method} />
                      <Row label="Paid from" value={where} />
                      {e.payment_reference && <Row label="Reference / Cheque" value={e.payment_reference} />}
                      {e.paid_date && <Row label="Paid on" value={new Date(e.paid_date).toLocaleDateString('en-GB')} />}
                    </>
                  );
                })()}
                <Row label="Created by" value={<span className="inline-flex items-center gap-1.5"><User size={13} className="text-gray-400" />{e.created_by_name || '—'}</span>} />
                <Row label="Created at" value={e.created_at ? new Date(e.created_at).toLocaleString('en-GB') : '—'} />
              </div>
            </div>
          </SlideDrawer>
        );
      })()}

      {/* Record payment — right slide-over (consistent with the detail drawer
          and the other pay/receive flows), not a centered dialog */}
      {payId && (() => {
        const pe = filtered.find((x) => String(x.id) === String(payId));
        const amt = pe ? (pe.currency === 'PKR' ? fmtPKR(pe.amount) : `${pe.currency} ${Number(pe.amount).toLocaleString()}`) : '';
        return (
          <SlideDrawer open={!!payId} onClose={() => setPayId(null)}
            title="Record Payment" subtitle={pe?.expense_no} icon={CreditCard} size="md"
            footer={
              <button onClick={handlePay} disabled={payMut.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {payMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm Payment
              </button>
            }>
            <div className="space-y-4">
              {pe && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
                  <p className="text-xs text-gray-500">Paying{pe.vendor_name || pe.supplier_name_joined ? ` ${pe.vendor_name || pe.supplier_name_joined}` : ''}</p>
                  <p className="text-lg font-semibold text-gray-900 tabular-nums">{amt}</p>
                </div>
              )}

              {/* Payment Method — first; it drives whether an account is needed
                  (mirrors the Money In / Money Out drawers). Cash & Cheque don't
                  pick an account. */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Payment Method</label>
                <select value={payForm.payment_method}
                  onChange={e => { const m = e.target.value; setPayForm(p => ({ ...p, payment_method: m, bank_account_id: (m === 'cash' || m === 'cheque') ? '' : p.bank_account_id })); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="bank">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                </select>
              </div>

              {/* Cheque details — number (optional) + the date it clears */}
              {payForm.payment_method === 'cheque' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Cheque # <span className="text-gray-300">(optional)</span></label>
                    <input type="text" value={payForm.payment_reference} onChange={e => setPayForm(p => ({ ...p, payment_reference: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. 004512" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Cheque date</label>
                    <input type="date" value={payForm.due_date} onChange={e => setPayForm(p => ({ ...p, due_date: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              )}

              {/* Pay From Account — only for account-based methods (Bank / Online) */}
              {payForm.payment_method !== 'cash' && payForm.payment_method !== 'cheque' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Pay From Account</label>
                  <select value={payForm.bank_account_id} onChange={e => setPayForm(p => ({ ...p, bank_account_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select bank account…</option>
                    {(bankAccountsList || []).map(b => (
                      <option key={b.id} value={b.id}>{b.name} — {b.bankName || ''} ({b.currency || 'PKR'} {Math.round(parseFloat(b.currentBalance) || 0).toLocaleString()})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Payment date */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Payment date</label>
                <input type="date" value={payForm.paid_date} onChange={e => setPayForm(p => ({ ...p, paid_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes <span className="text-gray-300">(optional)</span></label>
                <input type="text" value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder={pe ? `Payment for ${pe.expense_no}` : 'Payment note'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </SlideDrawer>
        );
      })()}
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

function ExpenseForm({
  form, setF, cats, currentCat, vendorKind, apiVendors, apiCategory,
  suppliersList, bankAccountsList, safeBatches, safeOrders,
  showBatchPicker, showOrderPicker, showOwnerField,
  createMut, handleCreate, onCancel,
}) {
  return (
    <form onSubmit={handleCreate} className="bg-white rounded-xl border border-blue-200 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Record New Expense</h3>
        <button type="button" onClick={onCancel} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X size={16} /></button>
      </div>

      {/* Type tiles */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-2 tracking-wider">What kind of expense?</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TYPES.map(t => {
            const Icon = t.icon;
            const active = form.expense_type === t.value;
            return (
              <button key={t.value} type="button" onClick={() => setF('expense_type', t.value)}
                className={`p-3 rounded-lg border-2 text-left transition-all flex items-center gap-2 ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <Icon size={16} className={active ? 'text-blue-500' : 'text-gray-400'} />
                <span className="text-sm font-semibold">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category grid (icon cards instead of select) */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-2 tracking-wider">Category *</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {cats.map(c => {
            const Icon = c.icon;
            const active = form.category === c.value;
            return (
              <button key={c.value} type="button" onClick={() => setF('category', c.value)}
                className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                  active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <span className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${active ? 'bg-blue-100 text-blue-600' : 'bg-gray-50 text-gray-500'}`}>
                  <Icon size={14} />
                </span>
                <span className={`text-xs font-medium leading-tight ${active ? 'text-blue-900' : 'text-gray-700'}`}>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount + Date row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Amount *</label>
          <div className="flex">
            <select value={form.currency} onChange={e => setF('currency', e.target.value)}
              className="border border-r-0 border-gray-300 rounded-l-lg px-2 py-2.5 text-sm bg-gray-50 outline-none w-20">
              <option>PKR</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
            <input
              type="number" min="0" step="any"
              value={form.amount}
              onChange={e => setF('amount', e.target.value)}
              placeholder="0.00"
              className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
              required
              autoFocus
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Date *</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="date" value={form.expense_date} onChange={e => setF('expense_date', e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
        </div>
      </div>

      {/* Vendor — kind-aware */}
      {!showOwnerField && (
        <VendorSection
          vendorKind={vendorKind}
          apiVendors={apiVendors}
          apiCategory={apiCategory}
          form={form}
          setF={setF}
          suppliersList={suppliersList}
          bankAccountsList={bankAccountsList}
        />
      )}

      {/* Owner selector for personal expenses */}
      {showOwnerField && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Owner *</label>
          <select value={form.owner_name} onChange={e => setF('owner_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">Select owner</option>
            <option value="Akmal Amin">Akmal Amin</option>
            <option value="Anzal Amin">Anzal Amin</option>
            <option value="Afnan Amin">Afnan Amin</option>
          </select>
        </div>
      )}

      {/* Reference + Description */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Invoice / Reference</label>
          <input type="text" value={form.invoice_reference} onChange={e => setF('invoice_reference', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bill / receipt number" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Description</label>
          <input type="text" value={form.description} onChange={e => setF('description', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="What is this expense for?" />
        </div>
      </div>

      {/* Linkage */}
      {showBatchPicker && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <label className="block text-[11px] font-semibold text-blue-800 uppercase mb-1 tracking-wider">Link to Milling Batch</label>
          <select value={form.batch_id} onChange={e => setF('batch_id', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">No specific batch — general mill expense</option>
            {safeBatches.filter(b => !['Closed', 'Cancelled', 'Rejected'].includes(b.status)).map(b =>
              <option key={b.id} value={b.dbId || b.id}>
                {b.id} — {b.supplierName || 'Unknown'} ({Number(b.rawQtyMT || 0).toFixed(1)} MT) [{b.status}]
              </option>
            )}
          </select>
          <p className="text-[11px] text-blue-600 mt-1">If linked, this cost appears on the batch's Costs tab automatically.</p>
        </div>
      )}

      {showOrderPicker && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <label className="block text-[11px] font-semibold text-emerald-800 uppercase mb-1 tracking-wider">Link to Export Order</label>
          <select value={form.order_id} onChange={e => setF('order_id', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">No specific order — general export expense</option>
            {safeOrders.filter(o => !['Closed', 'Cancelled'].includes(o.status)).map(o =>
              <option key={o.id} value={o.dbId || o.id}>
                {o.id} — {o.customerName} ({Number(o.qtyMT || 0).toFixed(1)} MT, {o.country}) [{o.status}]
              </option>
            )}
          </select>
          <p className="text-[11px] text-emerald-700 mt-1">If linked, this cost appears on the order's Financials tab.</p>
        </div>
      )}

      {/* Payment */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.pay_now} onChange={e => setF('pay_now', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Pay now (debit bank account)</span>
        </label>
        {form.pay_now && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Bank Account *</label>
              <select value={form.bank_account_id} onChange={e => setF('bank_account_id', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">Select bank</option>
                {bankAccountsList.map(b => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Method</label>
              <select value={form.payment_method} onChange={e => setF('payment_method', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="bank">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="online">Online</option>
              </select>
            </div>
          </div>
        )}
        {!form.pay_now && <p className="text-[11px] text-gray-400 mt-1">Will be saved as unpaid — mark it paid later.</p>}
      </div>

      <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button type="submit" disabled={createMut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
          Record Expense
        </button>
      </div>
    </form>
  );
}

function VendorSection({ vendorKind, apiVendors, apiCategory, form, setF, suppliersList, bankAccountsList }) {
  // DB-backed apiVendors wins when the current category is mapped to
  // an expense_vendors row (Admin → Expense Vendors). Falls back to
  // the legacy vendorKind suggestions when no mapping exists.
  const useApi = Array.isArray(apiVendors) && apiVendors.length > 0;

  // Build the suggestion list and helper text per vendorKind.
  const config = useMemo(() => {
    if (useApi) {
      return {
        title: 'Provider',
        help: `Pick from ${apiCategory} providers (manage in Admin → Expense Vendors), or type a custom one.`,
        listId: `expense-api-${apiCategory}`,
        options: apiVendors,
        placeholder: `Select a ${apiCategory} provider…`,
      };
    }
    switch (vendorKind) {
      case 'utility':
        return {
          title: 'Billing Company',
          help: 'Pick the utility / telco company billing this expense, or type a custom one.',
          listId: 'expense-utility-vendors',
          options: UTILITY_VENDORS,
          placeholder: 'e.g. K-Electric, SSGC, WAPDA',
        };
      case 'bank':
        return {
          title: 'Bank',
          help: 'Bank issuing the charges — pick from your bank accounts or type one.',
          listId: 'expense-bank-vendors',
          options: bankAccountsList.map(b => b.bankName || b.name).filter(Boolean),
          placeholder: 'e.g. Habib Bank Limited',
        };
      case 'landlord':
        return {
          title: 'Landlord / Property Owner',
          help: 'Person or company you pay rent to.',
          listId: null,
          options: [],
          placeholder: 'e.g. Mr. Akhtar Hussain',
        };
      case 'agent':
        return {
          title: 'Agent / Service Provider',
          help: 'Clearing agent, freight forwarder, surveyor, etc.',
          listId: null,
          options: [],
          placeholder: 'e.g. Karachi Clearing Agency',
        };
      case 'staff':
        return {
          title: 'Staff / Worker',
          help: 'Employee or daily-wage worker.',
          listId: null,
          options: [],
          placeholder: 'e.g. Shift A — 12 workers',
        };
      case 'supplier':
        return {
          title: 'Supplier',
          help: 'Pick a supplier from your master list, or type a one-off vendor.',
          options: [],
          listId: null,
          placeholder: 'e.g. Custom supplier name',
          supplierDropdown: true,
        };
      case 'free':
      default:
        return {
          title: 'Vendor',
          help: 'Free text — the company or person paid.',
          listId: null,
          options: [],
          placeholder: 'Vendor name',
        };
    }
  }, [vendorKind, bankAccountsList, useApi, apiVendors, apiCategory]);

  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">{config.title}</label>
      {config.supplierDropdown ? (
        <div className="space-y-2">
          <select value={form.supplier_id} onChange={e => {
              setF('supplier_id', e.target.value);
              const s = suppliersList.find(s => String(s.id) === e.target.value);
              if (s) setF('vendor_name', s.name);
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">— Pick a supplier —</option>
            {suppliersList.map(s => <option key={s.id} value={s.id}>{s.name}{s.country ? ` · ${s.country}` : ''}</option>)}
          </select>
          {!form.supplier_id && (
            <input type="text" value={form.vendor_name} onChange={e => setF('vendor_name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={config.placeholder} />
          )}
        </div>
      ) : (
        <>
          <input
            type="text"
            list={config.listId || undefined}
            value={form.vendor_name}
            onChange={e => setF('vendor_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={config.placeholder}
          />
          {config.listId && (
            <datalist id={config.listId}>
              {config.options.map(opt => <option key={opt} value={opt} />)}
            </datalist>
          )}
        </>
      )}
      <p className="text-[11px] text-gray-500 mt-1">{config.help}</p>
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
      <div className="overflow-x-auto">
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
              <td className="py-2.5 px-4">
                <p className="font-mono text-xs text-gray-700">{e.expense_no}</p>
                <p className="text-[10px] text-gray-400 capitalize">{e.expense_type}</p>
              </td>
              <td className="py-2.5 px-4 text-gray-600">{e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-GB') : '—'}</td>
              <td className="py-2.5 px-4">
                <p className="font-medium text-gray-900 truncate max-w-[240px]">
                  {e.vendor_name || e.supplier_name_joined || '—'}
                </p>
                {e.description && <p className="text-[11px] text-gray-500 truncate max-w-[240px]">{e.description}</p>}
              </td>
              <td className="py-2.5 px-4">
                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                  {(e.category || '').replace(/_/g, ' ')}
                </span>
              </td>
              <td className="py-2.5 px-4 text-right font-bold text-gray-900">
                {e.currency === 'PKR' ? fmtPKR(e.amount) : `${e.currency} ${Number(e.amount).toLocaleString()}`}
              </td>
              <td className="py-2.5 px-4 text-xs">
                {e.batch_no ? <span className="text-blue-600 font-medium">{e.batch_no}</span>
                 : e.order_no ? <span className="text-emerald-600 font-medium">{e.order_no}</span>
                 : <span className="text-gray-400">—</span>}
              </td>
              <td className="py-2.5 px-4">
                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[e.payment_status] || 'bg-gray-100'}`}>
                  {e.payment_status}
                </span>
              </td>
              <td className="py-2.5 px-4 text-right">
                <div className="inline-flex items-center gap-1.5">
                  {e.payment_status === 'Unpaid' && (
                    <button onClick={() => onPay(e)}
                      className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded hover:bg-emerald-100 inline-flex items-center gap-1">
                      <CreditCard size={12} /> Pay
                    </button>
                  )}
                  <button onClick={() => onView?.(e)} className="text-blue-600 hover:text-blue-800 p-1" title="View details">
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
