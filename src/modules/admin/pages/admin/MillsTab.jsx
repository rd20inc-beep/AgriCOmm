import { useState } from 'react';
import { Factory, Plus } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useMills, useCreateMill } from '../../../../api/queries';
import Modal from '../../../../components/Modal';

export default function MillsTab() {
  const { addToast } = useApp();
  const { data: mills = [], isLoading } = useMills();
  const createMillMut = useCreateMill();

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', location: '', capacityMtPerDay: '', contactPerson: '', phone: '', notes: '' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const resetForm = () => setForm({ name: '', location: '', capacityMtPerDay: '', contactPerson: '', phone: '', notes: '' });

  const handleSave = async () => {
    if (!form.name.trim()) { addToast('Mill name is required', 'error'); return; }
    try {
      await createMillMut.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim() || null,
        capacity_mt_per_day: parseFloat(form.capacityMtPerDay) || null,
        contact_person: form.contactPerson.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
      });
      addToast(`Mill "${form.name.trim()}" created`, 'success');
      resetForm();
      setShowModal(false);
    } catch (err) {
      addToast(`Failed to create mill: ${err.message}`, 'error');
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
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading mills...</td></tr>
              ) : mills.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No mills configured yet.</td></tr>
              ) : mills.map(mill => (
                <tr key={mill.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-gray-900">{mill.name}</td>
                  <td className="py-3 px-4 text-gray-600">{mill.location || '—'}</td>
                  <td className="py-3 px-4 text-right text-gray-900">{mill.capacityMtPerDay || '—'}</td>
                  <td className="py-3 px-4 text-gray-600">{mill.contactPerson || '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      mill.status === 'active' ? 'bg-green-100 text-green-700' :
                      mill.status === 'maintenance' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {mill.status || 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Mill" size="md">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input type="text" value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)} placeholder="Name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Phone number" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes" rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">Save Mill</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
