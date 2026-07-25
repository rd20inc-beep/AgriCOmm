import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, X, Truck } from 'lucide-react';
import { haulersApi } from '../modules/inventory/api/services';

/**
 * Searchable transport/hauler picker with an inline "+ Add new" that creates a
 * hauler in the dedicated haulers registry (item #5) — NOT the suppliers list.
 * Mirrors SupplierPicker's shape so it drops into the same forms.
 *
 * Props: label (node), value (hauler_id string), onChange(id), haulers[]
 * (optional pre-loaded list; the picker also self-loads once on mount),
 * placeholder, addToast, clearable (default true), onCreated(hauler).
 */
export default function HaulerPicker({ label, value, onChange, haulers = [], placeholder = 'Search hauler…', addToast, clearable = true, onCreated }) {
  const [localHaulers, setLocalHaulers] = useState([]);
  const [loaded, setLoaded] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', contact_person: '', phone: '' });

  // Self-load the active haulers once so the picker works even when the parent
  // did not pass a list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await haulersApi.list();
        const list = res?.data?.haulers || res?.haulers || [];
        if (!cancelled) setLoaded(list);
      } catch { /* non-fatal — parent-supplied list still works */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of [...localHaulers, ...haulers, ...loaded]) {
      if (h == null || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
    return out;
  }, [haulers, localHaulers, loaded]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(h => (h.name || '').toLowerCase().includes(q)
      || (h.phone || '').toLowerCase().includes(q));
  }, [merged, search]);

  const selected = merged.find(h => String(h.id) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!e.target.closest('[data-hauler-picker]')) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) { addToast?.('Hauler name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await haulersApi.create({
        name, contact_person: draft.contact_person.trim() || null, phone: draft.phone.trim() || null,
      });
      const hauler = res?.data?.hauler || res?.hauler || res?.data;
      if (!hauler?.id) throw new Error('Server did not return the new hauler');
      const normalized = { id: hauler.id, name: hauler.name, phone: hauler.phone, is_active: true };
      setLocalHaulers(prev => [normalized, ...prev]);
      onCreated?.(normalized);
      onChange(String(hauler.id));
      setAdding(false);
      setSearch('');
      setOpen(false);
      setDraft({ name: '', contact_person: '', phone: '' });
      addToast?.(`Hauler “${name}” added`, 'success');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add hauler', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-hauler-picker>
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
            <button type="button" onClick={() => { setOpen(true); setSearch(''); }} className="flex-1 text-left truncate text-gray-900 font-medium inline-flex items-center gap-2">
              <Truck size={14} className="text-gray-400 flex-shrink-0" />{selected.name}
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
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
                ) : filtered.map(h => (
                  <button key={h.id} type="button"
                    onClick={() => { onChange(String(h.id)); setSearch(''); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 ${String(h.id) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}>
                    <span className="truncate">{h.name}</span>
                    {h.phone && <span className="text-xs text-gray-400 flex-shrink-0">{h.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Add new hauler</p>
          <input value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name * — e.g. Malik Goods Transport"
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
              {saving ? 'Adding…' : 'Add hauler'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
