import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PartyLink from '../../../../shared/components/PartyLink';
import { Truck, Plus, MapPin, Pencil, Trash2, Star, BookOpen } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateSupplier, useUpdateSupplier, useDeleteSupplier } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';
import FieldError from '../../../../shared/components/FieldError';
import useConfirm from '../../../../hooks/useConfirm';

// Note: the suppliers table column is `address` (matching customers).
// We label it "Location" in the UI for our trade convention but post
// it as `address` so the createCrud insert doesn't 500 on an unknown
// column.
const EMPTY = { name: '', type: 'Rice Supplier', address: '', contact_person: '' };

export default function SuppliersTab() {
  const { suppliersList, addToast } = useApp();
  const navigate = useNavigate();
  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();
  const deleteMut = useDeleteSupplier();
  const [confirm, confirmDialog] = useConfirm();
  const saving = createMut.isPending || updateMut.isPending;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(e => (e[k] ? { ...e, [k]: null } : e)); };

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setErrors({}); setOpen(true); };
  const openEdit = (s) => {
    setEditingId(s.id);
    setErrors({});
    setForm({
      name: s.name || '',
      type: s.type || 'Rice Supplier',
      address: s.address || s.location || '',
      contact_person: s.contact || s.contact_person || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) { setErrors({ name: 'Supplier name is required' }); return; }
    const payload = {
      name,
      type: form.type,
      address: form.address.trim(),
      contact_person: form.contact_person.trim(),
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Supplier "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Supplier "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  // Toggle the favorite flag — fire-and-forget update, list refreshes
  // via the mutation's invalidation.
  const toggleFavorite = async (s) => {
    try {
      await updateMut.mutateAsync({ id: s.id, data: { is_favorite: !s.isFavorite } });
    } catch (err) {
      addToast(err.message || 'Failed to update favorite', 'error');
    }
  };

  // Favorites at the top, then alphabetical.
  const sortedSuppliers = useMemo(() => {
    return [...(suppliersList || [])].sort((a, b) => {
      if (!!a.isFavorite !== !!b.isFavorite) return a.isFavorite ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [suppliersList]);

  const handleDelete = async (s) => {
    if (!await confirm({
      title: `Delete supplier "${s.name}"?`,
      consequence: 'This cannot be undone.',
      confirmLabel: 'Delete',
    })) return;
    try {
      await deleteMut.mutateAsync(s.id);
      addToast(`Supplier "${s.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the supplier may be in use by a milling batch or lot)', 'error');
    }
  };

  return (
    <>
      {confirmDialog}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-600" />
            Suppliers
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact Person</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedSuppliers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td data-label="" className="mob-hide text-center px-2 py-3">
                    <button
                      onClick={() => toggleFavorite(s)}
                      title={s.isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
                      aria-label={s.isFavorite ? `Remove ${s.name} from favorites` : `Mark ${s.name} as favorite`}
                      className="p-1 rounded hover:bg-amber-50 transition-colors"
                    >
                      <Star className={`w-4 h-4 ${s.isFavorite ? 'fill-amber-400 text-amber-500' : 'text-gray-300'}`} />
                    </button>
                  </td>
                  <td data-label="ID" className="mob-hide px-4 py-3 text-gray-500 font-mono text-xs">{s.id}</td>
                  <td data-label="Name" className="px-4 py-3 font-medium"><PartyLink type="supplier" id={s.id} name={s.name} /></td>
                  <td data-label="Type" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.type === 'Rice Supplier' ? 'bg-blue-100 text-blue-700' :
                      s.type === 'Broker' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {s.type}
                    </span>
                  </td>
                  <td data-label="Location" className="mob-hide px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      {s.location}
                    </span>
                  </td>
                  <td data-label="Contact Person" className="mob-hide px-4 py-3 text-gray-900">{s.contact}</td>
                  <td data-label="Actions" className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => navigate(`/finance/statements?type=supplier&id=${s.id}`)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600" title="View ledger" aria-label={`View ledger for ${s.name}`}>
                        <BookOpen className="w-4 h-4" />
                      </button>
                      <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit" aria-label={`Edit ${s.name}`}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(s)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete" aria-label={`Delete ${s.name}`}>
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

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Supplier' : 'Add New Supplier'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Supplier name" aria-invalid={!!errors.name} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <FieldError error={errors.name} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="Rice Supplier">Rice Supplier</option>
              <option value="Broker">Broker</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input type="text" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. Lahore, Punjab" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
            <input type="text" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} placeholder="Contact person name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Supplier'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
