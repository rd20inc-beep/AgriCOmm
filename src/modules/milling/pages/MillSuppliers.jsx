import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Truck, Search, Globe, Phone, FileText, Plus } from 'lucide-react';
import { useSuppliers } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { adminApi } from '../../admin/api/services';
import SlideDrawer from '../../../components/SlideDrawer';
import { LoadingSpinner, EmptyState } from '../../../components/LoadingState';

const EMPTY_SUP = { name: '', contact_person: '', phone: '', email: '', country: '', address: '' };

// Mill suppliers list — each row links to that supplier's statement/ledger.
export default function MillSuppliers() {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_SUP });
  const setD = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  async function saveSupplier() {
    if (!draft.name.trim()) { addToast('Supplier name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await adminApi.suppliersQuickAdd(draft);
      const created = res?.data?.data?.supplier;
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      addToast(created?.deduped ? `"${draft.name}" already exists` : `Supplier "${draft.name}" added`, 'success');
      setShowAdd(false);
      setDraft({ ...EMPTY_SUP });
    } catch (err) { addToast(err?.response?.data?.message || 'Failed to add supplier', 'error'); }
    setSaving(false);
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (suppliers || [])
      .filter(s => !term
        || (s.name || '').toLowerCase().includes(term)
        || (s.contact || '').toLowerCase().includes(term)
        || (s.phone || '').toLowerCase().includes(term))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [suppliers, search]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <Truck className="w-6 h-6 text-amber-600" />
          <h1 className="text-xl font-bold text-gray-900">Suppliers</h1>
        </div>
        <button onClick={() => { setDraft({ ...EMPTY_SUP }); setShowAdd(true); }}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700">
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Rice & material suppliers. Click a supplier to view their statement.</p>

      <div className="relative mb-4 max-w-sm">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {isLoading ? <LoadingSpinner /> : rows.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers yet" message="Add suppliers from a purchase or the supplier picker." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3 text-right">Statement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{s.contact || '—'}</div>
                    {s.phone && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{s.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {s.country ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-gray-400" />{s.country}</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/milling/finance?tab=suppliers&supplier=${s.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100">
                      <FileText className="w-3.5 h-3.5" /> View Statement
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Supplier"
        icon={Plus}
        size="md"
        footer={(
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={saveSupplier} disabled={saving} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Supplier'}
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Name *</label>
            <input type="text" value={draft.name} onChange={e => setD('name', e.target.value)} autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" placeholder="Supplier name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Contact Person</label>
              <input type="text" value={draft.contact_person} onChange={e => setD('contact_person', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Phone</label>
              <input type="text" value={draft.phone} onChange={e => setD('phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Email</label>
              <input type="email" value={draft.email} onChange={e => setD('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Country</label>
              <input type="text" value={draft.country} onChange={e => setD('country', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Address</label>
            <textarea value={draft.address} onChange={e => setD('address', e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500" placeholder="Optional" />
          </div>
          <p className="text-[11px] text-gray-400">Sent to admin for approval unless you have approval rights.</p>
        </div>
      </SlideDrawer>
    </div>
  );
}
