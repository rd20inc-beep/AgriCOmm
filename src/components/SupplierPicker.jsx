import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { lotInventoryApi } from '../modules/inventory/api/services';

/**
 * Searchable supplier picker with an inline "+ Add new" that quick-adds a
 * supplier (pending admin approval for non-admins). Mirrors the New Purchase
 * Lot drawer's supplier field. Sibling of RiceTypePicker.
 *
 * Props: label (node), value (supplier_id string), onChange(id), suppliers[],
 * placeholder, addToast, clearable (default false).
 */
function PendingBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 flex-shrink-0">
      Pending
    </span>
  );
}

export default function SupplierPicker({ label, value, onChange, suppliers = [], placeholder = 'Search supplier…', addToast, clearable = false }) {
  const [localSuppliers, setLocalSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', contact_person: '', phone: '' });

  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of [...localSuppliers, ...suppliers]) {
      if (s == null || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
    return out;
  }, [suppliers, localSuppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(s => (s.name || '').toLowerCase().includes(q));
  }, [merged, search]);

  const selected = merged.find(s => String(s.id) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!e.target.closest('[data-supplier-picker]')) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) { addToast?.('Supplier name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await lotInventoryApi.quickAddSupplier({
        name, contact_person: draft.contact_person.trim() || null, phone: draft.phone.trim() || null,
      });
      const supplier = res?.data?.supplier || res?.supplier || res?.data;
      if (!supplier?.id) throw new Error('Server did not return the new supplier');
      setLocalSuppliers(prev => [{ id: supplier.id, name: supplier.name, is_active: true, approval_status: supplier.approval_status }, ...prev]);
      onChange(String(supplier.id));
      setAdding(false);
      setSearch('');
      setOpen(false);
      setDraft({ name: '', contact_person: '', phone: '' });
      const pending = supplier.approval_status === 'pending';
      addToast?.(pending ? `Supplier “${name}” added — pending admin approval` : `Supplier “${name}” added`, pending ? 'info' : 'success');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add supplier', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-supplier-picker>
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
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selected.approval_status === 'pending' && <PendingBadge />}
              <button type="button" onClick={() => { setOpen(true); setSearch(''); }} className="text-xs text-blue-600">Change</button>
              {clearable && <button type="button" onClick={() => onChange('')} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>}
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
                ) : filtered.map(s => (
                  <button key={s.id} type="button"
                    onClick={() => { onChange(String(s.id)); setSearch(''); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 ${String(s.id) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}>
                    <span className="truncate">{s.name}</span>
                    {s.approval_status === 'pending' && <PendingBadge />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Add new supplier</p>
          <input value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name * — e.g. Al Hafeez Rice Traders"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-2 gap-3">
            <input value={draft.contact_person} onChange={e => setDraft(d => ({ ...d, contact_person: e.target.value }))} placeholder="Contact person"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            <input value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={saving || !draft.name.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add supplier'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
