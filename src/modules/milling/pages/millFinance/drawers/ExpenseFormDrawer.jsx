import { useMemo, useState } from 'react';
import { TrendingDown, X, Sparkles, RefreshCw } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import {
  useCreateMillExpense, useCategorizeExpense, useExpenseVendors, useMillExpenseHeads,
  useCreateMillExpenseHead, useMillWorkers,
} from '../../../../../api/queries';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { todayLocalISO } from '../../../../../shared/utils/format';
import { EXPENSE_CATS, CAT_DETAIL, RECURRENCES } from '../constants';

const EMPTY_EXP = { category: 'utilities', vendor_preset: '', vendor_name: '', subcategory: '', employee_id: '', is_recurring: false, recurrence: 'monthly', description: '', amount: '', expense_date: '', reference: '', notes: '' };

// Only the (legacy) salaries head needs the employee list, so it is loaded
// only when that head is picked — never just because the drawer opened.
function SalaryEmployeeFields({ expForm, setExpForm }) {
  const { data: workers = [] } = useMillWorkers({ entity: 'mill' });
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-600">Employee <span className="text-gray-400 font-normal">· who is this salary for?</span></label>
      <select
        value={expForm.employee_id}
        onChange={e => {
          const id = e.target.value;
          const w = workers.find(x => String(x.id) === id);
          setExpForm(p => ({ ...p, employee_id: id, vendor_name: id === '__other' ? '' : (w?.name || '') }));
        }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
      >
        <option value="">Select employee…</option>
        {workers.filter(w => w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}{w.role ? ` · ${w.role}` : ''}</option>)}
        <option value="__other">Other (contractor / batch)</option>
      </select>
      {expForm.employee_id === '__other' && (
        <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
          placeholder="e.g. external contractor / May payroll batch"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" autoFocus />
      )}
      <p className="text-[11px] text-gray-400">For monthly payroll across all staff, use <span className="font-medium">Payroll → Post Payroll Run</span> instead.</p>
    </div>
  );
}

/**
 * Record a mill expense — a Mill Finance primary action. Saving creates a
 * business_expense + payable + journal (POST /milling/expenses, milling.create);
 * nothing is paid here. Mounted only while open, so it starts blank each time.
 */
export default function ExpenseFormDrawer({ onClose, prefill }) {
  const { addToast } = useApp();
  const [expForm, setExpForm] = useState(() => ({
    ...EMPTY_EXP,
    expense_date: todayLocalISO(),
    category: prefill?.category || 'utilities',
    description: prefill?.description || '',
    amount: prefill?.amount != null ? String(prefill.amount) : '',
  }));
  const createExpMut = useCreateMillExpense();
  const categorizeMut = useCategorizeExpense();
  const { data: vendorData } = useExpenseVendors();
  // category → [name] for the Provider dropdown (Admin → Expense Vendors).
  const VENDOR_OPTIONS = useMemo(() => {
    const map = {};
    const byCat = vendorData?.byCategory || {};
    for (const cat of Object.keys(byCat)) map[cat] = (byCat[cat] || []).map((v) => v.name);
    return map;
  }, [vendorData]);
  // Expense heads are server-side; EXPENSE_CATS is the fallback while the list loads.
  const { data: headsData } = useMillExpenseHeads();
  const expenseHeads = (headsData && headsData.length) ? headsData : EXPENSE_CATS;
  const [addingHead, setAddingHead] = useState(false);
  const [newHead, setNewHead] = useState('');
  const headMut = useCreateMillExpenseHead();

  const saveHead = async () => {
    const name = newHead.trim();
    if (!name) return;
    try {
      const res = await headMut.mutateAsync(name);
      const saved = res?.data?.head || name.toLowerCase();
      setExpForm(p => ({ ...p, category: saved, vendor_preset: '', vendor_name: '', subcategory: '', employee_id: '' }));
      setAddingHead(false); setNewHead('');
      addToast(`Added "${saved}" — it will be on the list from now on`, 'success');
    } catch (e) {
      addToast(e?.data?.message || e?.message || 'Could not add that head', 'error');
    }
  };

  // AI category suggestion — only on an explicit click, never on open.
  async function handleSuggestCategory() {
    const description = expForm.description?.trim();
    const vendor_name = expForm.vendor_name?.trim();
    if (!description && !vendor_name) return;
    try {
      const res = await categorizeMut.mutateAsync({ description, vendor_name });
      const d = res?.data || res;
      if (d?.aiEnabled === false) { addToast(d.message || 'AI is off.', 'info'); return; }
      if (d?.category) {
        setExpForm(p => ({
          ...p,
          category: d.category,
          vendor_preset: '', vendor_name: '', employee_id: '',
          subcategory: (d.category !== 'salaries' && d.subcategory) ? d.subcategory : '',
        }));
      }
    } catch (e) { addToast(`Could not suggest a category: ${e?.message || e}`, 'error'); }
  }

  async function handleAddExpense() {
    if (!expForm.amount) { addToast('Amount required', 'error'); return; }
    // Preset wins unless "Other" is picked or the category has no presets.
    const vendorName = (expForm.vendor_preset && expForm.vendor_preset !== '__other')
      ? expForm.vendor_preset
      : (expForm.vendor_name || null);
    const empId = (expForm.category === 'salaries' && /^\d+$/.test(expForm.employee_id)) ? Number(expForm.employee_id) : null;
    try {
      await createExpMut.mutateAsync({
        category: expForm.category,
        subcategory: expForm.subcategory || null,
        description: expForm.description,
        amount: expForm.amount,
        expense_date: expForm.expense_date,
        reference: expForm.reference,
        notes: expForm.notes,
        vendor_name: vendorName,
        employee_id: empId,
        is_recurring: !!expForm.is_recurring,
        recurrence: expForm.is_recurring ? expForm.recurrence : null,
      });
      addToast('Expense recorded — also visible on Finance dashboard', 'success');
      onClose();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  return (
    <SlideDrawer
      open
      onClose={onClose}
      title="Record Mill Expense"
      subtitle="Flows into Finance Dashboard, Money Out, and GL"
      icon={TrendingDown}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button
            onClick={handleAddExpense}
            disabled={createExpMut.isPending}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {createExpMut.isPending ? 'Saving…' : 'Save Expense'}
          </button>
        </div>
      }
    >
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
          {/* Heads come from the server (built-ins + any added + anything
              already used), so an operator can book a cost that nobody
              thought of when this list was written — a lunch, a tea run, a
              one-off charge — without waiting for a developer. */}
          {addingHead ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={newHead} maxLength={40}
                onChange={e => setNewHead(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); saveHead(); }
                  if (e.key === 'Escape') { setAddingHead(false); setNewHead(''); }
                }}
                placeholder="e.g. lunch"
                className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              <button type="button" onClick={saveHead} disabled={headMut.isPending || !newHead.trim()}
                className="px-2.5 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {headMut.isPending ? '…' : 'Add'}
              </button>
              <button aria-label="Cancel" type="button" onClick={() => { setAddingHead(false); setNewHead(''); }}
                className="px-2 py-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
            </div>
          ) : (
            <select
              value={expForm.category}
              onChange={e => {
                if (e.target.value === '__add__') { setAddingHead(true); return; }
                setExpForm(p => ({ ...p, category: e.target.value, vendor_preset: '', vendor_name: '', subcategory: '', employee_id: '' }));
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
            >
              {expenseHeads.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              <option value="__add__">+ Add a new head…</option>
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) *</label>
          <input
            type="number" min="0" step="0.01"
            value={expForm.amount}
            onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
          />
        </div>
      </div>

      {/* ─── Dynamic fields per category ─────────────────────── */}
      {expForm.category === 'salaries' ? (
            <SalaryEmployeeFields expForm={expForm} setExpForm={setExpForm} />
      ) : (
        <>
          {VENDOR_OPTIONS[expForm.category] ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">
                Provider <span className="text-gray-400 font-normal">· common {expForm.category} providers</span>
              </label>
              <select
                value={expForm.vendor_preset}
                onChange={e => setExpForm(p => ({ ...p, vendor_preset: e.target.value, vendor_name: '' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                <option value="">Select a provider…</option>
                {VENDOR_OPTIONS[expForm.category].map(v => <option key={v} value={v}>{v}</option>)}
                <option value="__other">Other (specify below)</option>
              </select>
              {expForm.vendor_preset === '__other' && (
                <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                  placeholder="Enter provider name" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" autoFocus />
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vendor / Payee <span className="text-gray-400 font-normal">· optional</span></label>
              <input type="text" value={expForm.vendor_name} onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                placeholder="Who is being paid?" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          )}

          {/* Category-specific detail → subcategory */}
          {CAT_DETAIL[expForm.category] && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{CAT_DETAIL[expForm.category].label} <span className="text-gray-400 font-normal">· optional</span></label>
              {CAT_DETAIL[expForm.category].options ? (
                <select value={expForm.subcategory} onChange={e => setExpForm(p => ({ ...p, subcategory: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white">
                  <option value="">Select…</option>
                  {CAT_DETAIL[expForm.category].options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type="text" value={expForm.subcategory} onChange={e => setExpForm(p => ({ ...p, subcategory: e.target.value }))}
                  placeholder={CAT_DETAIL[expForm.category].placeholder} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
              )}
            </div>
          )}
        </>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">Description</label>
          <button
            type="button"
            onClick={handleSuggestCategory}
            disabled={categorizeMut.isPending || !(expForm.description?.trim() || expForm.vendor_name?.trim())}
            title="Let AI pick the category from the description"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-40"
          >
            <Sparkles className={`w-3 h-3 ${categorizeMut.isPending ? 'animate-pulse' : ''}`} /> {categorizeMut.isPending ? 'Thinking…' : 'Suggest category'}
          </button>
        </div>
        <input
          type="text"
          value={expForm.description}
          onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))}
          placeholder="e.g. March electricity bill"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input
            type="date"
            value={expForm.expense_date}
            onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
          <input
            type="text"
            value={expForm.reference}
            onChange={e => setExpForm(p => ({ ...p, reference: e.target.value }))}
            placeholder="Invoice or bill #"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          rows={2}
          value={expForm.notes}
          onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>
      {/* ─── Recurring ───────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={expForm.is_recurring} onChange={e => setExpForm(p => ({ ...p, is_recurring: e.target.checked }))} className="rounded border-gray-300" />
          <span className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-gray-400" /> Recurring expense</span>
        </label>
        {expForm.is_recurring && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">Repeats</span>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              {RECURRENCES.map(r => (
                <button key={r} type="button" onClick={() => setExpForm(p => ({ ...p, recurrence: r }))}
                  className={`px-2.5 py-1 text-xs rounded-md capitalize ${expForm.recurrence === r ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>{r}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
        Saving creates a <span className="font-medium">business_expense</span> + <span className="font-medium">payable</span> + journal entry. The expense becomes payable on Money Out.
      </div>
    </div>
    </SlideDrawer>
  );
}
