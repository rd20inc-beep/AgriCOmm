import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { lotInventoryApi } from '../modules/inventory/api/services';

/**
 * Searchable bag-type picker with an inline "+ Add new" that quick-adds a bag
 * type (created immediately — bag types have no approval workflow). Mirrors
 * RiceTypePicker/SupplierPicker so the Create Export Order bag fields stay
 * consistent with the rest of the app's pickers.
 *
 * Props: label (node), value (bag type NAME string — bag selectors key by name),
 * onChange(name, bagTypeObj), bagTypes[], placeholder, addToast,
 * oncreated(bagType) — optional, called after a quick-add so the parent can
 * merge it into its own list; clearable (default true), sizeFilter (default true
 * → only show bag types that carry a size).
 */
const SIZE_OPTIONS = ['0.5', '1', '2', '5', '10', '20', '25', '40', '50', '100'];

export default function BagTypePicker({
  label, value, onChange, bagTypes = [], placeholder = 'Search bag type…',
  addToast, onCreated, clearable = true, sizeFilter = true,
}) {
  const [localTypes, setLocalTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', category: 'branded', size_kg: '25', material: 'PP Woven' });

  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const b of [...localTypes, ...bagTypes]) {
      if (b == null) continue;
      const key = b.id ?? b.name;
      if (seen.has(key)) continue;
      seen.add(key);
      if (sizeFilter && !(b.sizeKg || b.size_kg)) continue;
      out.push(b);
    }
    return out;
  }, [bagTypes, localTypes, sizeFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(b => (b.name || '').toLowerCase().includes(q));
  }, [merged, search]);

  const selected = merged.find(b => b.name === value);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!e.target.closest('[data-bagtype-picker]')) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const sizeOf = (b) => b?.sizeKg ?? b?.size_kg ?? null;

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) { addToast?.('Bag type name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await lotInventoryApi.quickAddBagType({
        name,
        category: draft.category,
        size_kg: draft.size_kg || null,
        material: draft.material.trim() || null,
      });
      const bt = res?.data?.bag_type || res?.bag_type || res?.data;
      if (!bt?.id) throw new Error('Server did not return the new bag type');
      const norm = { id: bt.id, name: bt.name, sizeKg: bt.size_kg, size_kg: bt.size_kg, category: bt.category, material: bt.material };
      setLocalTypes(prev => [norm, ...prev]);
      onChange(norm.name, norm);
      onCreated?.(norm);
      setAdding(false);
      setSearch('');
      setOpen(false);
      setDraft({ name: '', category: 'branded', size_kg: '25', material: 'PP Woven' });
      addToast?.(`Bag type “${name}” added`, 'success');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add bag type', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-bagtype-picker>
      <div className="flex items-center justify-between mb-1">
        {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
        <button type="button" onClick={() => { setAdding(v => !v); setOpen(false); }}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
          <Plus size={12} /> {adding ? 'Cancel' : 'Add new'}
        </button>
      </div>

      <div className="relative">
        {value && selected && !open ? (
          <div className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white flex items-center justify-between gap-2">
            <button type="button" onClick={() => { setOpen(true); setSearch(''); }} className="flex-1 text-left truncate text-gray-900 font-medium">
              {selected.name}
              {sizeOf(selected) && <span className="text-xs text-gray-400 ml-1">({sizeOf(selected)} kg)</span>}
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={() => { setOpen(true); setSearch(''); }} className="text-xs text-blue-600">Change</button>
              {clearable && <button type="button" onClick={() => onChange('', null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>}
            </div>
          </div>
        ) : (
          <>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white" />
            {open && (
              <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                {filtered.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-gray-500 text-center">No matches. Use “+ Add new”.</div>
                ) : filtered.map(b => (
                  <button key={b.id || b.name} type="button"
                    onClick={() => { onChange(b.name, b); setSearch(''); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 ${b.name === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}>
                    <span className="truncate">{b.name}</span>
                    {sizeOf(b) && <span className="text-xs text-gray-400 flex-shrink-0">{sizeOf(b)} kg</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Add new bag type</p>
          <input value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name * — e.g. PP Woven 25kg (Buyer Logo)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-3 gap-2">
            <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500">
              <option value="branded">Branded</option>
              <option value="empty">Empty</option>
              <option value="consumable">Consumable</option>
            </select>
            <select value={draft.size_kg} onChange={e => setDraft(d => ({ ...d, size_kg: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500">
              {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} kg</option>)}
            </select>
            <input value={draft.material} onChange={e => setDraft(d => ({ ...d, material: e.target.value }))} placeholder="Material"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={saving || !draft.name.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add bag type'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
