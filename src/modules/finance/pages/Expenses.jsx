import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, DollarSign, Filter, Search, Check, Loader2, CreditCard,
} from 'lucide-react';
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

function usePayExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/api/expenses/${id}/pay`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

const TYPES = ['general', 'mill', 'export'];
const CATEGORIES = {
  general: ['utility_bill', 'rent', 'insurance', 'license', 'professional_fees', 'office_supplies', 'bank_charges', 'inspection', 'miscellaneous'],
  mill: ['electricity', 'diesel', 'maintenance', 'labor', 'inspection', 'fumigation', 'salaries', 'transport', 'rent', 'insurance', 'miscellaneous'],
  export: ['clearing', 'freight', 'inspection', 'insurance', 'commission', 'documentation', 'bags', 'transport', 'miscellaneous'],
};
const STATUS_COLORS = { Unpaid: 'bg-red-100 text-red-800', Partial: 'bg-amber-100 text-amber-800', Paid: 'bg-green-100 text-green-800' };

export default function Expenses() {
  const navigate = useNavigate();
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
  const filtered = search
    ? safeExpenses.filter(e =>
        (e.vendor_name || e.supplier_name_joined || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.expense_no || '').toLowerCase().includes(search.toLowerCase())
      )
    : safeExpenses;

  // ─── Form state ───
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    expense_type: 'general', category: 'utility_bill', subcategory: '',
    amount: '', currency: 'PKR', vendor_name: '', supplier_id: '',
    expense_date: new Date().toISOString().split('T')[0], due_date: '',
    invoice_reference: '', description: '', notes: '',
    batch_id: '', order_id: '',
    pay_now: false, bank_account_id: '', payment_method: 'bank',
  });
  const setF = (k, v) => setForm(p => {
    const u = { ...p, [k]: v };
    if (k === 'expense_type') u.category = (CATEGORIES[v] || CATEGORIES.general)[0];
    return u;
  });

  // ─── Pay modal ───
  const [payId, setPayId] = useState(null);
  const [payForm, setPayForm] = useState({ bank_account_id: '', payment_method: 'bank', payment_reference: '' });

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.amount || !form.category) { addToast('Amount and category required', 'error'); return; }
    try {
      await createMut.mutateAsync({
        ...form,
        amount: Number(form.amount),
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        batch_id: form.batch_id ? Number(form.batch_id) : null,
        order_id: form.order_id ? Number(form.order_id) : null,
        bank_account_id: form.pay_now && form.bank_account_id ? Number(form.bank_account_id) : null,
      });
      addToast('Expense recorded', 'success');
      setShowForm(false);
      setForm(f => ({ ...f, amount: '', description: '', invoice_reference: '', notes: '', vendor_name: '', batch_id: '', order_id: '' }));
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
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus size={16} /> Record Expense
        </button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase font-medium">Total Recorded</p>
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
            <p className="text-xs text-gray-400">{t.count} expenses</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="form-input pl-9 py-1.5 text-sm w-full" />
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
            {s || 'Any Status'}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">New Expense</h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Type</label>
              <select value={form.expense_type} onChange={e => setF('expense_type', e.target.value)} className="form-input w-full text-sm">
                {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Category *</label>
              <select value={form.category} onChange={e => setF('category', e.target.value)} className="form-input w-full text-sm">
                {(CATEGORIES[form.expense_type] || []).map(c => <option key={c} value={c} className="capitalize">{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Amount *</label>
              <div className="flex gap-1">
                <select value={form.currency} onChange={e => setF('currency', e.target.value)} className="form-input w-20 text-sm">
                  <option>PKR</option><option>USD</option>
                </select>
                <input type="number" min="0" step="any" value={form.amount} onChange={e => setF('amount', e.target.value)}
                  className="form-input flex-1 text-sm" placeholder="0" required />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Vendor / Supplier</label>
              <select value={form.supplier_id} onChange={e => { setF('supplier_id', e.target.value); const s = (suppliersList||[]).find(s => String(s.id) === e.target.value); if (s) setF('vendor_name', s.name); }}
                className="form-input w-full text-sm">
                <option value="">Select or type below</option>
                {(suppliersList || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!form.supplier_id && (
                <input type="text" value={form.vendor_name} onChange={e => setF('vendor_name', e.target.value)}
                  className="form-input w-full text-sm mt-1" placeholder="Or type vendor name" />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Date *</label>
              <input type="date" value={form.expense_date} onChange={e => setF('expense_date', e.target.value)} className="form-input w-full text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Invoice Ref</label>
              <input type="text" value={form.invoice_reference} onChange={e => setF('invoice_reference', e.target.value)} className="form-input w-full text-sm" placeholder="Invoice #" />
            </div>
          </div>

          {/* Link to batch/order */}
          {form.expense_type === 'mill' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Link to batch (optional)</label>
              <select value={form.batch_id} onChange={e => setF('batch_id', e.target.value)} className="form-input w-full text-sm max-w-sm">
                <option value="">None — general mill expense</option>
                {(Array.isArray(millingBatches) ? millingBatches : []).filter(b => b.status !== 'Closed').map(b =>
                  <option key={b.id} value={b.dbId || b.id}>{b.id} — {b.supplierName || 'Unknown'} ({b.rawQtyMT} MT)</option>
                )}
              </select>
            </div>
          )}
          {form.expense_type === 'export' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Link to order (optional)</label>
              <select value={form.order_id} onChange={e => setF('order_id', e.target.value)} className="form-input w-full text-sm max-w-sm">
                <option value="">None — general export expense</option>
                {(Array.isArray(exportOrders) ? exportOrders : []).filter(o => o.status !== 'Closed').map(o =>
                  <option key={o.id} value={o.dbId || o.id}>{o.id} — {o.customerName} ({o.qtyMT} MT)</option>
                )}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => setF('description', e.target.value)} className="form-input w-full text-sm" placeholder="What is this expense for?" />
          </div>

          {/* Pay now toggle */}
          <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.pay_now} onChange={e => setF('pay_now', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600" />
              <span className="text-sm font-medium text-gray-700">Pay now</span>
            </label>
            {form.pay_now && (
              <select value={form.bank_account_id} onChange={e => setF('bank_account_id', e.target.value)} className="form-input text-sm flex-1">
                <option value="">Select bank account</option>
                {(bankAccountsList || []).map(b => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
              </select>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={createMut.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <DollarSign size={16} />}
              Record Expense
            </button>
          </div>
        </form>
      )}

      {/* Expenses table */}
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
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Vendor</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Category</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Amount</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Linked</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-gray-900 text-xs font-mono">{e.expense_no}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{e.expense_type}</p>
                  </td>
                  <td className="py-2.5 px-4 text-gray-600">{e.expense_date ? new Date(e.expense_date).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="py-2.5 px-4 text-gray-900">{e.vendor_name || e.supplier_name_joined || '—'}</td>
                  <td className="py-2.5 px-4">
                    <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">{(e.category || '').replace(/_/g, ' ')}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold text-gray-900">
                    {e.currency === 'PKR' ? fmtPKR(e.amount) : `$${Number(e.amount).toLocaleString()}`}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-gray-500">
                    {e.batch_no ? <span className="text-blue-600">{e.batch_no}</span> : e.order_no ? <span className="text-blue-600">{e.order_no}</span> : '—'}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[e.payment_status] || 'bg-gray-100'}`}>{e.payment_status}</span>
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
                className="form-input w-full text-sm">
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
