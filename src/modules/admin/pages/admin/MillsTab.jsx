import { useState } from 'react';
import { Factory, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useMills, useCreateMill, useUpdateMill, useDeleteMill } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';

const EMPTY = { name: '', location: '', capacityMtPerDay: '', status: 'Active', contactPerson: '', phone: '', notes: '' };

export default function MillsTab() {
  const { addToast } = useApp();
  const { data: mills = [], isLoading } = useMills();
  const createMut = useCreateMill();
  const updateMut = useUpdateMill();
  const deleteMut = useDeleteMill();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (m) => {
    setEditingId(m.id);
    // Postgres numeric → string trap (see BagTypesTab note)
    const cap = parseFloat(m.capacityMtPerDay);
    setForm({
      name: m.name || '',
      location: m.location || '',
      capacityMtPerDay: !isNaN(cap) ? String(cap) : '',
      status: m.status || 'Active',
      contactPerson: m.contactPerson || '',
      phone: m.phone || '',
      notes: m.notes || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { addToast('Mill name is required', 'error'); return; }
    const payload = {
      name,
      location: form.location.trim() || null,
      capacity_mt_per_day: parseFloat(form.capacityMtPerDay) || null,
      status: form.status || 'Active',
      contact_person: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Mill "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Mill "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`Delete mill "${m.name}"? This cannot be undone.`)) return;
    try {
      await deleteMut.mutateAsync(m.id);
      addToast(`Mill "${m.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the mill may have milling batches)', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Factory className="w-5 h-5 text-gray-600" />
            Mills
            <span className="ml-2 text-xs font-normal text-gray-500">({mills.length} mills)</span>
          </h2>
          <button onClick={openCreate} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Mill
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Location</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Capacity (MT/day)</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Contact</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading mills...</td></tr>
              ) : mills.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No mills configured yet.</td></tr>
              ) : mills.map(mill => (
                <tr key={mill.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-gray-900">{mill.name}</td>
                  <td className="py-3 px-4 text-gray-600">{mill.location || '—'}</td>
                  <td className="py-3 px-4 text-right text-gray-900">{mill.capacityMtPerDay || '—'}</td>
                  <td className="py-3 px-4 text-gray-600">{mill.contactPerson || '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      mill.status === 'Active' ? 'bg-green-100 text-green-700' :
                      mill.status === 'Maintenance' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {mill.status || 'Active'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(mill)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(mill)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Mill' : 'Add Mill'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mill Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Agri Rice Mill" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="City" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (MT/day)</label>
              <input type="number" value={form.capacityMtPerDay} onChange={e => set('capacityMtPerDay', e.target.value)} placeholder="50" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                <option value="Active">Active</option>
                <option value="Maintenance">Maintenance</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input type="text" value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)} placeholder="Name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Phone number" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes" rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">{editingId ? 'Save Changes' : 'Add Mill'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
