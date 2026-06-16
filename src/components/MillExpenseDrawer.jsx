import { useState, useEffect, useMemo } from 'react';
import { TrendingDown } from 'lucide-react';
import SlideDrawer from './SlideDrawer';
import { useCreateMillExpense, useExpenseVendors } from '../api/queries';

const EXPENSE_CATS = [
  'salaries', 'utilities', 'rent', 'maintenance', 'insurance',
  'transport', 'fuel', 'packaging', 'inspection', 'freight',
  'commission', 'miscellaneous',
];

/**
 * Shared "Add Mill Expense" slide-over. Same form/behavior as the Mill Finance
 * dashboard's Add Expense, reusable from Operations and elsewhere. Saving
 * creates a business_expense + payable + journal (via useCreateMillExpense).
 *
 * Props: open, onClose, addToast, prefill ({category, description, amount}),
 * onSaved (optional callback after a successful save).
 */
export default function MillExpenseDrawer({ open, onClose, addToast, prefill, onSaved }) {
  const createExpMut = useCreateMillExpense();
  const { data: vendorData } = useExpenseVendors();

  const VENDOR_OPTIONS = useMemo(() => {
    const map = {};
    const byCat = vendorData?.byCategory || {};
    for (const cat of Object.keys(byCat)) map[cat] = (byCat[cat] || []).map(v => v.name);
    return map;
  }, [vendorData]);

  const [form, setForm] = useState({
    category: 'salaries', vendor_preset: '', vendor_name: '', description: '',
    amount: '', expense_date: new Date().toISOString().split('T')[0], reference: '', notes: '',
  });

  // Reset (and apply any prefill) each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setForm({
      category: prefill?.category || 'salaries',
      vendor_preset: '', vendor_name: '',
      description: prefill?.description || '',
      amount: prefill?.amount != null ? String(prefill.amount) : '',
      expense_date: new Date().toISOString().split('T')[0],
      reference: '', notes: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    if (!form.amount) { addToast?.('Amount required', 'error'); return; }
    const vendorName = (form.vendor_preset && form.vendor_preset !== '__other')
      ? form.vendor_preset
      : (form.vendor_name || null);
    try {
      await createExpMut.mutateAsync({
        category: form.category,
        description: form.description,
        amount: form.amount,
        expense_date: form.expense_date,
        reference: form.reference,
        notes: form.notes,
        vendor_name: vendorName,
      });
      addToast?.('Expense recorded — also visible on Finance dashboard', 'success');
      onSaved?.();
      onClose?.();
    } catch (e) {
      addToast?.(e.message, 'error');
    }
  }

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title="Add Mill Expense"
      subtitle="Flows into Finance Dashboard, Money Out, and GL"
      icon={TrendingDown}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleSave} disabled={createExpMut.isPending}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {createExpMut.isPending ? 'Saving…' : 'Save Expense'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
            <select value={form.category}
              onChange={e => setForm(p => ({ ...p, category: e.target.value, vendor_preset: '', vendor_name: '' }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white">
              {EXPENSE_CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) *</label>
            <input type="number" min="0" step="0.01" value={form.amount}
              onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums" />
          </div>
        </div>

        {VENDOR_OPTIONS[form.category] ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">
              Provider <span className="text-gray-400 font-normal">· choose from common {form.category} providers</span>
            </label>
            <select value={form.vendor_preset}
              onChange={e => setForm(p => ({ ...p, vendor_preset: e.target.value, vendor_name: '' }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white">
              <option value="">Select a provider…</option>
              {VENDOR_OPTIONS[form.category].map(v => <option key={v} value={v}>{v}</option>)}
              <option value="__other">Other (specify below)</option>
            </select>
            {form.vendor_preset === '__other' && (
              <input type="text" value={form.vendor_name} autoFocus
                onChange={e => setForm(p => ({ ...p, vendor_name: e.target.value }))}
                placeholder="Enter provider name"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor / Payee <span className="text-gray-400 font-normal">· optional</span></label>
            <input type="text" value={form.vendor_name}
              onChange={e => setForm(p => ({ ...p, vendor_name: e.target.value }))}
              placeholder={form.category === 'salaries' ? 'e.g. May payroll batch' : 'Who is being paid?'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <input type="text" value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="e.g. March electricity bill"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={form.expense_date}
              onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
            <input type="text" value={form.reference}
              onChange={e => setForm(p => ({ ...p, reference: e.target.value }))}
              placeholder="Invoice or bill #"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea rows={2} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
        </div>
        <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
          Saving creates a <span className="font-medium">business_expense</span> + <span className="font-medium">payable</span> + journal entry. The expense becomes payable on Money Out.
        </div>
      </div>
    </SlideDrawer>
  );
}
