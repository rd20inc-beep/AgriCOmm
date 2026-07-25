import { useMemo, useState } from 'react';
import { Truck, Plus, Pencil, Trash2, Eye, EyeOff, History } from 'lucide-react';
import {
  useHaulers,
  useHauler,
  useCreateHauler,
  useUpdateHauler,
  useDeleteHauler,
} from '../../../../api/queries';
import { useApp } from '../../../../context/AppContext';
import SlideDrawer from '../../../../components/SlideDrawer';

const EMPTY = {
  name: '', contact_person: '', phone: '', email: '',
  address: '', ntn: '', vehicle_types: '', notes: '', is_active: true,
};

const fmt = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

// Read-only history drawer — lots carried, weight, and freight charges for one
// hauler (basic history; the per-hauler payment ledger is intentionally deferred).
function HaulerHistoryDrawer({ id, open, onClose }) {
  const { data, isLoading } = useHauler(open ? id : null);
  const hauler = data?.hauler;
  const lots = data?.lots || [];
  const totals = data?.totals || {};
  return (
    <SlideDrawer open={open} onClose={onClose} title={hauler?.name || 'Hauler'} subtitle="Transport history" icon={History}>
      {isLoading ? (
        <div className="py-10 text-center text-gray-400">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Lots</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{totals.lots || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Weight (kg)</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{fmt(totals.weight_kg)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-[11px] uppercase text-gray-400">Freight (Rs)</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{fmt(totals.freight_total)}</p>
            </div>
          </div>
          {(hauler?.phone || hauler?.contact_person) && (
            <p className="text-sm text-gray-600">
              {hauler.contact_person}{hauler.contact_person && hauler.phone ? ' · ' : ''}{hauler.phone}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase">
                  <th className="text-left px-3 py-2 font-medium">Lot</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-right px-3 py-2 font-medium">Weight (kg)</th>
                  <th className="text-right px-3 py-2 font-medium">Freight (Rs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lots.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">No lots carried yet.</td></tr>
                ) : lots.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-medium text-gray-900">{l.lot_no}</td>
                    <td className="px-3 py-2 text-gray-500">{l.purchase_date ? String(l.purchase_date).slice(0, 10) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(l.received_net_weight_kg || l.net_weight_kg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(l.transport_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            Freight charges shown from the lot records. Per-hauler payments &amp; outstanding
            are tracked with the vendor payables and are not itemised here.
          </p>
        </div>
      )}
    </SlideDrawer>
  );
}

export default function HaulersTab() {
  const { addToast } = useApp();
  const { data: haulers = [], isLoading } = useHaulers({ includeInactive: true });
  const createMut = useCreateHauler();
  const updateMut = useUpdateHauler();
  const deleteMut = useDeleteHauler();

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [historyId, setHistoryId] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return haulers;
    return haulers.filter((h) =>
      (h.name || '').toLowerCase().includes(s) ||
      (h.contact_person || '').toLowerCase().includes(s) ||
      (h.phone || '').toLowerCase().includes(s));
  }, [haulers, q]);

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(h) {
    setEditingId(h.id);
    setForm({
      name: h.name || '', contact_person: h.contact_person || '', phone: h.phone || '',
      email: h.email || '', address: h.address || '', ntn: h.ntn || '',
      vehicle_types: h.vehicle_types || '', notes: h.notes || '', is_active: !!h.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    const name = String(form.name || '').trim();
    if (!name) { addToast('Hauler name is required', 'error'); return; }
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: form });
        addToast(`"${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(form);
        addToast(`"${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save', 'error');
    }
  }

  async function handleToggle(h) {
    try {
      await updateMut.mutateAsync({ id: h.id, data: { is_active: !h.is_active } });
      addToast(h.is_active ? `"${h.name}" hidden` : `"${h.name}" restored`, 'success');
    } catch (err) { addToast(err.message || 'Toggle failed', 'error'); }
  }

  async function handleDelete(h) {
    if (!window.confirm(`Delete "${h.name}"? If it has been used anywhere it will be hidden instead.`)) return;
    try {
      await deleteMut.mutateAsync(h.id);
      addToast(`"${h.name}" removed`, 'success');
    } catch (err) { addToast(err.message || 'Delete failed', 'error'); }
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Transport / Haulers</h2>
            <span className="text-xs text-gray-400 ml-1">freight contractors — separate from suppliers</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search haulers…"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              <Plus className="w-4 h-4" /> Add Hauler
            </button>
          </div>
        </div>

        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No haulers yet. Add your first transport contractor.</td></tr>
              ) : (
                filtered.map((h) => (
                  <tr key={h.id} className={`hover:bg-gray-50 ${!h.is_active ? 'opacity-50' : ''}`}>
                    <td data-label="Name" className="px-4 py-3 font-medium text-gray-900">{h.name}</td>
                    <td data-label="Contact" className="mob-hide px-4 py-3 text-gray-700">{h.contact_person || '—'}</td>
                    <td data-label="Phone" className="px-4 py-3 text-gray-700">{h.phone || '—'}</td>
                    <td data-label="Status" className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        h.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {h.is_active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setHistoryId(h.id)} title="History"
                          className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded">
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleToggle(h)} title={h.is_active ? 'Hide' : 'Show'}
                          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded">
                          {h.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => openEdit(h)} title="Edit"
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(h)} title="Delete"
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded">
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
        title={editingId ? 'Edit Hauler' : 'Add Hauler'}
        subtitle="Transport contractor for purchase-lot freight"
        icon={Truck}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {createMut.isPending || updateMut.isPending ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Hauler')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hauler name *</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Malik Goods Transport"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact person</label>
              <input type="text" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">NTN / Tax ID</label>
              <input type="text" value={form.ntn} onChange={(e) => set('ntn', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle types / fleet</label>
            <input type="text" value={form.vehicle_types} onChange={(e) => set('vehicle_types', e.target.value)}
              placeholder="e.g. Mazda, 22-wheeler, Shehzore"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
            <textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
          <div className="flex items-center gap-2">
            <input id="hauler-active" type="checkbox" checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <label htmlFor="hauler-active" className="text-sm text-gray-700">Active (shown in the transport picker)</label>
          </div>
        </div>
      </SlideDrawer>

      <HaulerHistoryDrawer id={historyId} open={!!historyId} onClose={() => setHistoryId(null)} />
    </>
  );
}
