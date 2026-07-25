import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PartyLink from '../../../../shared/components/PartyLink';
import { Users, Plus, Globe, Mail, Phone, Pencil, Trash2, Star, BookOpen } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateCustomer, useUpdateCustomer, useDeleteCustomer } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';

const EMPTY = { name: '', country: '', contact_person: '', email: '', phone: '' };

export default function CustomersTab() {
  const { customersList, addToast } = useApp();
  const navigate = useNavigate();
  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();
  const deleteMut = useDeleteCustomer();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name || '',
      country: c.country || '',
      contact_person: c.contact || c.contact_person || '',
      email: c.email || '',
      phone: c.phone || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { addToast('Customer name is required', 'error'); return; }
    const payload = {
      name,
      country: form.country.trim(),
      contact_person: form.contact_person.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Customer "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Customer "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const toggleFavorite = async (c) => {
    try {
      await updateMut.mutateAsync({ id: c.id, data: { is_favorite: !c.isFavorite } });
    } catch (err) {
      addToast(err.message || 'Failed to update favorite', 'error');
    }
  };

  const sortedCustomers = useMemo(() => {
    return [...(customersList || [])].sort((a, b) => {
      if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [customersList]);

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
    try {
      await deleteMut.mutateAsync(c.id);
      addToast(`Customer "${c.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the customer may be in use by an order)', 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Customers
          </h2>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add New
          </button>
        </div>
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-center px-2 py-3 font-semibold text-gray-600 w-10" title="Favorite"><Star className="w-3.5 h-3.5 inline text-gray-400" /></th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact Person</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedCustomers.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td data-label="" className="mob-hide text-center px-2 py-3">
                    <button
                      onClick={() => toggleFavorite(c)}
                      title={c.isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
                      className="p-1 rounded hover:bg-amber-50 transition-colors"
                    >
                      <Star className={`w-4 h-4 ${c.isFavorite ? 'fill-amber-400 text-amber-500' : 'text-gray-300'}`} />
                    </button>
                  </td>
                  <td data-label="ID" className="mob-hide px-4 py-3 text-gray-500 font-mono text-xs">{c.id}</td>
                  <td data-label="Name" className="px-4 py-3 font-medium"><PartyLink type="customer" id={c.id} name={c.name} /></td>
                  <td data-label="Country" className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5 text-gray-400" />
                      {c.country}
                    </span>
                  </td>
                  <td data-label="Contact Person" className="mob-hide px-4 py-3 text-gray-900">{c.contact}</td>
                  <td data-label="Email" className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      {c.email}
                    </span>
                  </td>
                  <td data-label="Phone" className="mob-hide px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-gray-400" />
                      {c.phone}
                    </span>
                  </td>
                  <td data-label="Actions" className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => navigate(`/finance/statements?type=customer&id=${c.id}`)}
                        className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600"
                        title="View ledger"
                      >
                        <BookOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        title="Delete"
                      >
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

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Edit Customer' : 'Add New Customer'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Customer name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <input type="text" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="e.g. Nigeria" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
            <input type="text" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} placeholder="Contact person name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="email@example.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 234 567 890" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">{editingId ? 'Save Changes' : 'Add Customer'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
