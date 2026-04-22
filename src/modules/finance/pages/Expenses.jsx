import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, DollarSign, Search, Check, Loader2, CreditCard, User, Download,
} from 'lucide-react';
import { downloadCSV } from '../../../utils/csvExport';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../../context/AppContext';
import api from '../../../api/client';

function fmtPKR(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `Rs ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `Rs ${(v / 1_000).toFixed(0)}K`;
  return `Rs ${Math.round(v).toLocaleString()}`;
}

function unwrap(res, key) {
  const d = res?.data?.data || res?.data || res;
  return key ? (d?.[key] ?? d) : d;
}

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

const TYPES = [
  { value: 'general', label: 'General / Office' },
  { value: 'mill', label: 'Mill Operations' },
  { value: 'export', label: 'Export Order' },
  { value: 'personal', label: 'Personal / Owner' },
];

const CATEGORIES = {
  general: [
    { value: 'utility_bill', label: 'Utility Bill (Electricity, Gas, Water)' },
    { value: 'rent', label: 'Office / Warehouse Rent' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'license', label: 'License / Permit' },
    { value: 'professional_fees', label: 'Professional Fees (Audit, Legal, Tax)' },
    { value: 'office_supplies', label: 'Office Supplies' },
    { value: 'bank_charges', label: 'Bank Charges' },
    { value: 'inspection', label: 'Inspection Fee' },
    { value: 'transport', label: 'Transport / Delivery' },
    { value: 'miscellaneous', label: 'Other / Miscellaneous' },
  ],
  mill: [
    { value: 'electricity', label: 'Electricity' },
    { value: 'diesel', label: 'Diesel / Fuel' },
    { value: 'maintenance', label: 'Maintenance / Repair' },
    { value: 'labor', label: 'Labor / Daily Wages' },
    { value: 'salaries', label: 'Salaries' },
    { value: 'transport', label: 'Transport (Paddy / Rice)' },
    { value: 'inspection', label: 'Inspection / Testing' },
    { value: 'fumigation', label: 'Fumigation' },
    { value: 'bags', label: 'Bags / Packaging' },
    { value: 'rent', label: 'Mill Rent' },
    { value: 'insurance', label: 'Mill Insurance' },
    { value: 'miscellaneous', label: 'Other Mill Expense' },
  ],
  export: [
    { value: 'clearing', label: 'Clearing / Customs' },
    { value: 'freight', label: 'Freight / Shipping' },
    { value: 'transport', label: 'Transport (Port / Inland)' },
    { value: 'inspection', label: 'Inspection (SGS, etc.)' },
    { value: 'insurance', label: 'Cargo Insurance' },
    { value: 'commission', label: 'Agent Commission' },
    { value: 'documentation', label: 'Documentation Fees' },
    { value: 'bags', label: 'Bags / Special Packing' },
    { value: 'miscellaneous', label: 'Other Export Cost' },
  ],
  personal: [
    { value: 'personal_expense', label: 'Personal Expense' },
    { value: 'travel', label: 'Travel' },
    { value: 'entertainment', label: 'Entertainment / Meals' },
    { value: 'vehicle', label: 'Vehicle / Fuel' },
    { value: 'medical', label: 'Medical' },
    { value: 'miscellaneous', label: 'Other Personal' },
  ],
};

const STATUS_COLORS = {
  Unpaid: 'bg-red-100 text-red-800',
  Partial: 'bg-amber-100 text-amber-800',
  Paid: 'bg-green-100 text-green-800',
};

export default function Expenses() {
  const { addToast, suppliersList, bankAccountsList, millingBatches, exportOrders } = useApp();
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const { data: expenses = [], isLoading } = useExpenses({
    ...(typeFilter ? { expense_type: typeFilter } : {}),
    ...(statusFilter ? { payment_status: statusFilter } : {}),
    limit: 100,
  });
  const { data: summary = {} } = useExpenseSummary();
  const createMut = useCreateExpense();
  const payMut = usePayExpense();

  const safeExpenses = Array.isArray(expenses) ? expenses : [];
  const safeBatches = Array.isArray(millingBatches) ? millingBatches : [];
  const safeOrders = Array.isArray(exportOrders) ? exportOrders : [];

  // Owner users for personal expenses
  const ownerUsers = useMemo(() => {
    // We don't have a users list in AppContext, so we'll use a text field
    return [];
  }, []);

  const filtered = search
    ? safeExpenses.filter(e =>
        (e.vendor_name || e.supplier_name_joined || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.expense_no || '').toLowerCase().includes(search.toLowerCase())
      )
    : safeExpenses;

  // ─── Form ───
  const [showForm, setShowForm] = useState(false);
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
    // Reset context fields when type changes
    if (k === 'expense_type') {
      u.category = (CATEGORIES[v] || CATEGORIES.general)[0].value;
      u.batch_id = '';
      u.order_id = '';
      u.owner_name = '';
    }
    return u;
  });

  const cats = CATEGORIES[form.expense_type] || CATEGORIES.general;
  const showBatchPicker = form.expense_type === 'mill';
  const showOrderPicker = form.expense_type === 'export';
  const showOwnerField = form.expense_type === 'personal';

  // ─── Pay modal ───
  const [payId, setPayId] = useState(null);
  const [payForm, setPayForm] = useState({ bank_account_id: '', payment_method: 'bank', payment_reference: '' });

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
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
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
      addToast('Expense recorded successfully', 'success');
      setShowForm(false);
      setForm(initForm);
    } catch (err) { addToast(err?.response?.data?.message || err.message, 'error'); }
  }

  async function handlePay() {
    if (!payForm.bank_account_id) { addToast('Select bank account', 'error'); return; }
    try {
      await payMut.mutateAsync({ id: payId, data: payForm });
      addToast('Payment recorded', 'success');
      setPayId(null);
    } catch (err) { addToast(err?.response?.data?.message || err.message, 'error'); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Business Expenses</h2>
          <p className="text-sm text-gray-500">Record and track all operational costs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCSV(filtered, [
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
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            <Download size={14} /> CSV
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus size={16} /> Record Expense
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Total</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(summary.total_amount_pkr)}</p>
          <p className="text-xs text-gray-400">{summary.total_expenses || 0} expenses</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Unpaid</p>
          <p className="text-xl font-bold text-red-600 mt-1">{fmtPKR(summary.unpaid_amount_pkr)}</p>
          <p className="text-xs text-gray-400">{summary.unpaid_count || 0} pending</p>
        </div>
        {(summary.by_type || []).slice(0, 2).map(t => (
          <div key={t.expense_type} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase font-medium capitalize">{t.expense_type}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(t.total_pkr)}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="w-full pl-9 pr-4 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {['', 'general', 'mill', 'export'].map(t => (
          <button key={t || 'all'} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t || 'All'}
          </button>
        ))}
        <span className="text-gray-300">|</span>
        {['', 'Unpaid', 'Paid'].map(s => (
          <button key={s || 'any'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s || 'Any'}
          </button>
        ))}
      </div>

      {/* ═══ CREATE FORM ═══ */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-blue-200 p-5 space-y-4">
          <h3 className="text-base font-semibold text-gray-900">Record New Expense</h3>

          {/* Row 1: Type selector (cards) */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">What type of expense?</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => setF('expense_type', t.value)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    form.expense_type === t.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  <span className="text-sm font-semibold">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Category + Amount (always visible) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Category *</label>
              <select value={form.category} onChange={e => setF('category', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {cats.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Amount *</label>
              <div className="flex">
                <select value={form.currency} onChange={e => setF('currency', e.target.value)}
                  className="border border-r-0 border-gray-300 rounded-l-lg px-2 py-2.5 text-sm bg-gray-50 outline-none w-20">
                  <option>PKR</option><option>USD</option>
                </select>
                <input
                  type="number" min="0" step="any"
                  value={form.amount}
                  onChange={e => setF('amount', e.target.value)}
                  placeholder="Enter amount"
                  className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Date *</label>
              <input type="date" value={form.expense_date} onChange={e => setF('expense_date', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
          </div>

          {/* Row 3: Context-specific fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Vendor / Supplier (not for personal) */}
            {!showOwnerField && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Vendor / Supplier</label>
                <select value={form.supplier_id} onChange={e => {
                  setF('supplier_id', e.target.value);
                  const s = (suppliersList || []).find(s => String(s.id) === e.target.value);
                  if (s) setF('vendor_name', s.name);
                }} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">Select or type below</option>
                  {(suppliersList || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!form.supplier_id && (
                  <input type="text" value={form.vendor_name} onChange={e => setF('vendor_name', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none mt-1" placeholder="Or type vendor name" />
                )}
              </div>
            )}

            {/* Owner selector for personal expenses */}
            {showOwnerField && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Owner Name *</label>
                <select value={form.owner_name} onChange={e => setF('owner_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">Select owner</option>
                  <option value="Akmal Amin">Akmal Amin</option>
                  <option value="Anzal Amin">Anzal Amin</option>
                  <option value="Afnan Amin">Afnan Amin</option>
                </select>
              </div>
            )}

            {/* Invoice / Reference */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Invoice / Reference</label>
              <input type="text" value={form.invoice_reference} onChange={e => setF('invoice_reference', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bill / receipt number" />
            </div>
          </div>

          {/* Row 4: Link to batch or order (dynamic based on type) */}
          {showBatchPicker && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="block text-xs font-semibold text-blue-800 uppercase mb-1">Link to Milling Batch (cost will show on batch)</label>
              <select value={form.batch_id} onChange={e => setF('batch_id', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">No specific batch — general mill expense</option>
                {safeBatches.filter(b => !['Closed', 'Cancelled', 'Rejected'].includes(b.status)).map(b =>
                  <option key={b.id} value={b.dbId || b.id}>
                    {b.id} — {b.supplierName || 'Unknown'} ({Number(b.rawQtyMT || 0).toFixed(1)} MT) [{b.status}]
                  </option>
                )}
              </select>
              <p className="text-[11px] text-blue-600 mt-1">If linked, this cost will appear on the batch's Costs tab automatically.</p>
            </div>
          )}

          {showOrderPicker && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <label className="block text-xs font-semibold text-green-800 uppercase mb-1">Link to Export Order (cost will show on order)</label>
              <select value={form.order_id} onChange={e => setF('order_id', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">No specific order — general export expense</option>
                {safeOrders.filter(o => !['Closed', 'Cancelled'].includes(o.status)).map(o =>
                  <option key={o.id} value={o.dbId || o.id}>
                    {o.id} — {o.customerName} ({Number(o.qtyMT || 0).toFixed(1)} MT, {o.country}) [{o.status}]
                  </option>
                )}
              </select>
              <p className="text-[11px] text-green-600 mt-1">If linked, this cost will appear on the order's Financials tab automatically.</p>
            </div>
          )}

          {/* Row 5: Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => setF('description', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What is this expense for?" />
          </div>

          {/* Row 6: Payment */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={form.pay_now} onChange={e => setF('pay_now', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600" />
              <span className="text-sm font-medium text-gray-700">Pay now (debit bank account)</span>
            </label>
            {form.pay_now && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Bank Account *</label>
                  <select value={form.bank_account_id} onChange={e => setF('bank_account_id', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                    <option value="">Select bank</option>
                    {(bankAccountsList || []).map(b => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Method</label>
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
            {!form.pay_now && (
              <p className="text-xs text-gray-400">Will be saved as unpaid — you can mark it paid later.</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => { setShowForm(false); setForm(initForm); }}
              className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={createMut.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
              Record Expense
            </button>
          </div>
        </form>
      )}

      {/* ═══ TABLE ═══ */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">{[0,1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <DollarSign size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No expenses found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Ref</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Date</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Description</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Category</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Amount</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Linked To</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-4">
                    <p className="font-mono text-xs text-gray-500">{e.expense_no}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{e.expense_type}</p>
                  </td>
                  <td className="py-2.5 px-4 text-gray-600">{e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="py-2.5 px-4">
                    <p className="text-gray-900 truncate max-w-[200px]">{e.description || e.vendor_name || e.supplier_name_joined || '—'}</p>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                      {(e.category || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold text-gray-900">
                    {e.currency === 'PKR' ? fmtPKR(e.amount) : `$${Number(e.amount).toLocaleString()}`}
                  </td>
                  <td className="py-2.5 px-4 text-xs">
                    {e.batch_no ? <span className="text-blue-600 font-medium">{e.batch_no}</span>
                     : e.order_no ? <span className="text-green-600 font-medium">{e.order_no}</span>
                     : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[e.payment_status] || 'bg-gray-100'}`}>
                      {e.payment_status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {e.payment_status === 'Unpaid' && (
                      <button onClick={() => { setPayId(e.id); setPayForm({ bank_account_id: '', payment_method: 'bank', payment_reference: '' }); }}
                        className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded hover:bg-green-100">
                        <CreditCard size={12} className="inline mr-1" />Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pay modal */}
      {payId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPayId(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Record Payment</h3>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Bank Account *</label>
              <select value={payForm.bank_account_id} onChange={e => setPayForm(p => ({ ...p, bank_account_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none bg-white">
                <option value="">Select</option>
                {(bankAccountsList || []).map(b => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPayId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handlePay} disabled={payMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {payMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
