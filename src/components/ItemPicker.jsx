import { useState, useMemo, useEffect } from 'react';
import { Search, Plus } from 'lucide-react';
import { millStoreApi } from '../modules/millStore/api/services';

const CATEGORIES = ['packaging', 'operational', 'fuel', 'maintenance'];
const UNITS = ['piece', 'kg', 'liter', 'meter', 'roll', 'bag', 'box', 'set'];

/**
 * Searchable mill-store item picker with an inline "+ Add new" that creates a
 * store item (code/name/category/unit). On add, calls onItemAdded(item) so the
 * parent can share the new item across all purchase lines, and selects it here.
 *
 * Props: label, value (item_id string), onChange(id), items[], onItemAdded(item),
 * addToast, placeholder, category (when set, locks the picker + quick-add to that
 * category; for 'packaging' the quick-add also collects Bag Kg + Tare Kg).
 */
export default function ItemPicker({ label, value, onChange, items = [], onItemAdded, addToast, placeholder = 'Search item…', category = null }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', code: '', category: category || 'packaging', unit: 'piece', reorder_level: '', capacity_kg: '', tare_weight_kg: '' });

  // When a category is locked from the parent, keep the draft + default unit in sync.
  useEffect(() => {
    if (!category) return;
    setDraft(d => ({ ...d, category, unit: d.unit === 'piece' && category === 'packaging' ? 'bag' : d.unit }));
  }, [category]);

  const draftCat = category || draft.category;

  const filtered = useMemo(() => {
    const byCat = category ? items.filter(i => i.category === category) : items;
    const q = search.trim().toLowerCase();
    if (!q) return byCat;
    return byCat.filter(i => (i.name || '').toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q));
  }, [items, search, category]);

  const selected = items.find(i => String(i.id) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!e.target.closest('[data-item-picker]')) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function saveDraft() {
    const name = draft.name.trim();
    const code = draft.code.trim().toUpperCase();
    if (!name || !code) { addToast?.('Item name and code are required', 'error'); return; }
    if (draftCat === 'packaging' && !(Number(draft.capacity_kg) > 0)) {
      addToast?.('Enter the Bag Kg (how much rice one bag holds)', 'error'); return;
    }
    setSaving(true);
    try {
      const res = await millStoreApi.createItem({
        code, name, category: draftCat, unit: draft.unit,
        reorder_level: draft.reorder_level ? Number(draft.reorder_level) : 0,
        ...(draftCat === 'packaging' ? {
          capacity_kg: draft.capacity_kg ? Number(draft.capacity_kg) : null,
          tare_weight_kg: draft.tare_weight_kg ? Number(draft.tare_weight_kg) : null,
        } : {}),
      });
      const item = res?.data?.item || res?.item || res?.data;
      if (!item?.id) throw new Error('Server did not return the new item');
      onItemAdded?.(item);
      onChange(String(item.id));
      setAdding(false); setSearch(''); setOpen(false);
      setDraft({ name: '', code: '', category: category || 'packaging', unit: category === 'packaging' ? 'bag' : 'piece', reorder_level: '', capacity_kg: '', tare_weight_kg: '' });
      addToast?.(`Item “${name}” added`, 'success');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add item', 'error');
    } finally {
      setSaving(false);
    }
  }

  const INPUT = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500';

  return (
    <div data-item-picker>
      <div className="flex items-center justify-between mb-1">
        {label ? <label className="block text-[10px] font-semibold text-gray-500 uppercase">{label}</label> : <span />}
        <button type="button" onClick={() => { setAdding(v => !v); setOpen(false); }}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
          <Plus size={12} /> {adding ? 'Cancel' : 'Add new'}
        </button>
      </div>

      <div className="relative">
        {value && selected && !open ? (
          <button type="button" onClick={() => { setOpen(true); setSearch(''); }}
            className="w-full text-left px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 flex items-center justify-between gap-2">
            <span className="truncate text-gray-900 font-medium">{selected.code} — {selected.name} <span className="text-xs text-gray-400">({selected.unit})</span></span>
            <span className="text-xs text-blue-600 flex-shrink-0">Change</span>
          </button>
        ) : (
          <>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
            {open && (
              <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                {filtered.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-gray-500 text-center">No matches. Use “+ Add new”.</div>
                ) : filtered.map(i => (
                  <button key={i.id} type="button"
                    onClick={() => { onChange(String(i.id)); setSearch(''); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate ${String(i.id) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}>
                    <span className="font-mono text-xs text-gray-500 mr-1.5">{i.code}</span>{i.name} <span className="text-xs text-gray-400">({i.unit})</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Add new item</p>
          <input value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name * — e.g. PP Bag 50kg" className={INPUT} />
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))} placeholder="Code * — e.g. PP-50" className={INPUT} />
            <input type="number" min="0" value={draft.reorder_level} onChange={e => setDraft(d => ({ ...d, reorder_level: e.target.value }))} placeholder="Reorder level" className={INPUT} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {category ? (
              <div className={`${INPUT} bg-white/70 flex items-center text-gray-500 capitalize`}>{category}</div>
            ) : (
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className={INPUT}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            )}
            <select value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} className={INPUT}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {draftCat === 'packaging' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-blue-700 uppercase mb-0.5">Bag Kg *</label>
                <input type="number" min="0" step="any" value={draft.capacity_kg}
                  onChange={e => setDraft(d => ({ ...d, capacity_kg: e.target.value }))}
                  placeholder="rice per bag — e.g. 50" className={INPUT} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-blue-700 uppercase mb-0.5">Tare Kg</label>
                <input type="number" min="0" step="any" value={draft.tare_weight_kg}
                  onChange={e => setDraft(d => ({ ...d, tare_weight_kg: e.target.value }))}
                  placeholder="empty bag wt — e.g. 0.12" className={INPUT} />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={saving || !draft.name.trim() || !draft.code.trim() || (draftCat === 'packaging' && !(Number(draft.capacity_kg) > 0))}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add item'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
