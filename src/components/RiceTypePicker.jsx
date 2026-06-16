import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { lotInventoryApi } from '../modules/inventory/api/services';

/**
 * Searchable rice-type (product) picker with an inline "+ Add new" that
 * quick-adds a product (pending admin approval for non-admins). Mirrors the
 * New Purchase Lot drawer's rice-type field so the two stay consistent.
 *
 * Props: label (node), value (product_id string), onChange(id), products[],
 * placeholder, addToast, clearable (default true), emptyHint (node).
 */
function PendingBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 flex-shrink-0">
      Pending
    </span>
  );
}

export default function RiceTypePicker({ label, value, onChange, products = [], placeholder = 'Search rice type…', addToast, clearable = true }) {
  const [localProducts, setLocalProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', code: '', grade: '' });

  // Merge any just-added products on top, dedupe by id, drop by-products.
  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of [...localProducts, ...products]) {
      if (p == null || seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.is_byproduct || p.isByproduct) continue;
      out.push(p);
    }
    return out;
  }, [products, localProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(p => (p.name || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q));
  }, [merged, search]);

  const selected = merged.find(p => String(p.id) === String(value));
  const isAutoSku = (code) => !code || /^PRD[-_]\d{6,}/i.test(code) || /\d{8,}/.test(code) || code.length > 18;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!e.target.closest('[data-ricetype-picker]')) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) { addToast?.('Rice type name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await lotInventoryApi.quickAddProduct({
        name, code: draft.code.trim() || null, grade: draft.grade.trim() || null, category: 'Rice',
      });
      const product = res?.data?.product || res?.product || res?.data;
      if (!product?.id) throw new Error('Server did not return the new product');
      setLocalProducts(prev => [{ id: product.id, name: product.name, code: product.code, grade: product.grade, is_byproduct: false, approval_status: product.approval_status }, ...prev]);
      onChange(String(product.id));
      setAdding(false);
      setSearch('');
      setOpen(false);
      setDraft({ name: '', code: '', grade: '' });
      const pending = product.approval_status === 'pending';
      addToast?.(pending ? `Rice type “${name}” added — pending admin approval` : `Rice type “${name}” added`, pending ? 'info' : 'success');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to add rice type', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-ricetype-picker>
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
              {selected.name || selected.code}
              {selected.grade && <span className="text-xs text-gray-400 ml-1">({selected.grade})</span>}
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
                ) : filtered.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { onChange(String(p.id)); setSearch(''); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 ${String(p.id) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'}`}>
                    <span className="truncate">
                      {!isAutoSku(p.code) && <span className="font-mono text-xs text-gray-500 mr-1.5">{p.code}</span>}
                      {p.name}
                      {p.grade && <span className="text-xs text-gray-400 ml-1">({p.grade})</span>}
                    </span>
                    {p.approval_status === 'pending' && <PendingBadge />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Add new rice type</p>
          <input value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Name * — e.g. 1121 Basmati Sella"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <div className="grid grid-cols-2 gap-3">
            <input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} placeholder="Code"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            <input value={draft.grade} onChange={e => setDraft(d => ({ ...d, grade: e.target.value }))} placeholder="Grade"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={saving || !draft.name.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add rice type'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
