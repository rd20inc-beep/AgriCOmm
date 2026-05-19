import { useMemo, useState } from 'react';
import { Building2, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import {
  useExpenseVendors,
  useCreateExpenseVendor,
  useUpdateExpenseVendor,
  useDeleteExpenseVendor,
} from '../../../../api/queries';
import { useApp } from '../../../../context/AppContext';
import SlideDrawer from '../../../../components/SlideDrawer';

const CATEGORIES = [
  'utilities', 'fuel', 'insurance', 'transport', 'maintenance',
  'packaging', 'rent', 'inspection', 'freight', 'commission',
];

const EMPTY = { category: 'utilities', name: '', sort_order: 0, is_active: true };

export default function ExpenseVendorsTab() {
  const { addToast } = useApp();
  const { data, isLoading, refetch } = useExpenseVendors({ includeInactive: true });
  const createMut = useCreateExpenseVendor();
  const updateMut = useUpdateExpenseVendor();
  const deleteMut = useDeleteExpenseVendor();

  const [filterCat, setFilterCat] = useState('all');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const vendors = data?.vendors || [];
  const filtered = useMemo(() => {
    if (filterCat === 'all') return vendors;
    return vendors.filter((v) => v.category === filterCat);
  }, [vendors, filterCat]);

  const counts = useMemo(() => {
    const m = {};
    for (const v of vendors) m[v.category] = (m[v.category] || 0) + 1;
    return m;
  }, [vendors]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY, category: filterCat !== 'all' ? filterCat : 'utilities' });
    setOpen(true);
  }
  function openEdit(v) {
    setEditingId(v.id);
    setForm({
      category: v.category,
      name: v.name,
      sort_order: Number(v.sort_order) || 0,
      is_active: !!v.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    const name = String(form.name || '').trim();
    if (!name) { addToast('Provider name is required', 'error'); return; }
    const payload = {
      category: form.category,
      name,
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: !!form.is_active,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`"${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`"${name}" added to ${payload.category}`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save', 'error');
    }
  }

  async function handleToggle(v) {
    try {
      await updateMut.mutateAsync({ id: v.id, data: { is_active: !v.is_active } });
      addToast(v.is_active ? `"${v.name}" hidden from drawer` : `"${v.name}" restored`, 'success');
    } catch (err) {
      addToast(err.message || 'Toggle failed', 'error');
    }
  }

  async function handleDelete(v) {
    if (!window.confirm(`Delete "${v.name}" from ${v.category}? This is permanent. (Use the toggle to hide instead.)`)) return;
    try {
      await deleteMut.mutateAsync(v.id);
      addToast(`"${v.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Expense Vendors</h2>
            <span className="text-xs text-gray-400 ml-1">presets for Add Expense drawer</span>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" /> Add Provider
          </button>
        </div>

        {/* Category filter chips */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setFilterCat('all')}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${
              filterCat === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All <span className="opacity-60">· {vendors.length}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setFilterCat(c)}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap capitalize transition-colors ${
                filterCat === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c} <span className="opacity-60">· {counts[c] || 0}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Provider Name</th>
                <th className="text-right px-4 py-3 font-medium">Sort</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No providers in this category yet.</td></tr>
              ) : (
                filtered.map((v) => (
                  <tr key={v.id} className={`hover:bg-gray-50 ${!v.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 capitalize text-gray-700">{v.category}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{v.name}</td>
                    <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{v.sort_order}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        v.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {v.is_active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => handleToggle(v)}
                          title={v.is_active ? 'Hide from drawer' : 'Show in drawer'}
                          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                        >
                          {v.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => openEdit(v)}
                          title="Edit"
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(v)}
                          title="Delete"
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SlideDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Edit Provider' : 'Add Provider'}
        subtitle="Shown in the Mill Finance Add Expense drawer"
        icon={Building2}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {createMut.isPending || updateMut.isPending ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Provider')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Provider Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. K-Electric, Maersk Line, PSO"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
            <p className="text-[11px] text-gray-400 mt-1">Use the same name you want shown on Money Out and journals.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort order</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => set('sort_order', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
            />
            <p className="text-[11px] text-gray-400 mt-1">Lower = appears first in the dropdown.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ev-active"
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="ev-active" className="text-sm text-gray-700">
              Active (shown in the Add Expense drawer)
            </label>
          </div>
        </div>
      </SlideDrawer>
    </>
  );
}
