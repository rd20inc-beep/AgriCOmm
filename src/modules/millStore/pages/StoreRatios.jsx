import { useState } from 'react';
import { Plus, Edit3, Loader2, Gauge } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import {
  useMillStoreRatios,
  useMillStoreItems,
} from '../api/queries';
import { millStoreApi } from '../api/services';
import { useQueryClient } from '@tanstack/react-query';

export default function StoreRatios() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const { data: ratios = [], isLoading } = useMillStoreRatios();
  const { data: items = [] } = useMillStoreItems({ limit: 500 });
  const safeRatios = Array.isArray(ratios) ? ratios : [];
  const safeItems = Array.isArray(items) ? items : [];

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ item_id: '', product_id: '', unit_per_mt: '', notes: '' });
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  function startEdit(ratio) {
    setEditId(ratio.id);
    setForm({
      item_id: ratio.item_id,
      product_id: ratio.product_id || '',
      unit_per_mt: ratio.unit_per_mt,
      notes: ratio.notes || '',
    });
    setShowForm(true);
  }

  function startNew() {
    setEditId(null);
    setForm({ item_id: '', product_id: '', unit_per_mt: '', notes: '' });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.item_id || !form.unit_per_mt) {
      addToast('Item and ratio are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        item_id: Number(form.item_id),
        product_id: form.product_id ? Number(form.product_id) : null,
        unit_per_mt: Number(form.unit_per_mt),
        notes: form.notes || null,
      };
      if (editId) {
        await millStoreApi.updateRatio(editId, payload);
        addToast('Ratio updated', 'success');
      } else {
        await millStoreApi.createRatio(payload);
        addToast('Ratio created', 'success');
      }
      qc.invalidateQueries({ queryKey: ['mill-store'] });
      setShowForm(false);
      setEditId(null);
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consumption Ratios</h1>
          <p className="text-sm text-gray-500 mt-0.5">How much of each item is consumed per MT of raw paddy</p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> Add Ratio
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">{editId ? 'Edit Ratio' : 'New Ratio'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Item *</label>
              <select
                value={form.item_id}
                onChange={(e) => setF('item_id', e.target.value)}
                className="form-input w-full text-sm"
                required
                disabled={!!editId}
              >
                <option value="">Select item</option>
                {safeItems.map(i => (
                  <option key={i.id} value={i.id}>{i.code} — {i.name} ({i.unit})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Units per MT of raw paddy *</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.unit_per_mt}
                onChange={(e) => setF('unit_per_mt', e.target.value)}
                className="form-input w-full text-sm"
                placeholder="e.g. 13 (bags) or 0.35 (kg)"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setF('notes', e.target.value)}
              className="form-input w-full text-sm"
              placeholder="e.g. 1 MT raw → ~0.65 MT finished → 13 bags"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Gauge size={16} />}
              {editId ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">{[0,1,2].map(i => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>
      ) : safeRatios.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Gauge size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No consumption ratios defined yet.</p>
          <p className="text-xs text-gray-400 mt-1">Add ratios so the system can auto-suggest materials when recording batch consumption.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Item</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Category</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Per MT</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Product</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Notes</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {safeRatios.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-gray-900">{r.item_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{r.item_code || '—'}</p>
                  </td>
                  <td className="py-2.5 px-4 text-gray-600 capitalize">{r.item_category || '—'}</td>
                  <td className="py-2.5 px-4 text-right font-bold text-gray-900">
                    {Number(r.unit_per_mt)} {r.item_unit}
                  </td>
                  <td className="py-2.5 px-4 text-gray-600">{r.product_name || 'All products'}</td>
                  <td className="py-2.5 px-4 text-gray-500 text-xs max-w-xs truncate">{r.notes || '—'}</td>
                  <td className="py-2.5 px-4 text-right">
                    <button onClick={() => startEdit(r)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                      <Edit3 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Help text */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-800 font-medium mb-1">How ratios work</p>
        <p className="text-xs text-blue-700">
          When recording consumption on a batch, the system multiplies each ratio's "per MT" value by the batch's raw paddy quantity
          to suggest how much of each item to consume. For example: a 10 MT batch with a bag ratio of 13/MT suggests 130 bags.
          You can override the suggestion before confirming.
        </p>
      </div>
    </div>
  );
}
