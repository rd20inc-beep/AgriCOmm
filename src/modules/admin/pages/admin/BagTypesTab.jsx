import { useState } from 'react';
import { ShoppingBag, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateBagType, useUpdateBagType, useDeleteBagType } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';
import FieldError from '../../../../shared/components/FieldError';
import useConfirm from '../../../../hooks/useConfirm';

const EMPTY = { name: '', category: 'empty', sizeKg: '25', material: '', description: '', reorderLevel: '100' };

export default function BagTypesTab() {
  const { bagTypesList, addToast } = useApp();
  const createMut = useCreateBagType();
  const updateMut = useUpdateBagType();
  const deleteMut = useDeleteBagType();
  const [confirm, confirmDialog] = useConfirm();
  const saving = createMut.isPending || updateMut.isPending;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(e => (e[k] ? { ...e, [k]: null } : e)); };

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setErrors({}); setOpen(true); };
  const openEdit = (b) => {
    setEditingId(b.id);
    setErrors({});
    // Postgres numeric columns come back as strings like "25.00" — coerce
    // through parseFloat so the value matches the <option> ("25", not "25.00").
    const sizeNum = parseFloat(b.sizeKg);
    const reorderNum = parseInt(b.reorderLevel, 10);
    setForm({
      name: b.name || '',
      category: b.category || 'empty',
      sizeKg: !isNaN(sizeNum) ? String(sizeNum) : '25',
      material: b.material || '',
      description: b.description || '',
      reorderLevel: !isNaN(reorderNum) ? String(reorderNum) : '100',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) { setErrors({ name: 'Bag type name is required' }); return; }
    const payload = {
      name,
      category: form.category,
      size_kg: parseFloat(form.sizeKg) || null,
      material: form.material.trim() || null,
      description: form.description.trim() || null,
      reorder_level: parseInt(form.reorderLevel) || 0,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Bag type "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Bag type "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (b) => {
    if (!await confirm({
      title: `Delete bag type "${b.name}"?`,
      consequence: 'This cannot be undone.',
      confirmLabel: 'Delete',
    })) return;
    try {
      await deleteMut.mutateAsync(b.id);
      addToast(`Bag type "${b.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the bag type may be referenced by stock)', 'error');
    }
  };

  return (
    <>
      {confirmDialog}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-cyan-600" />
            Bag Types
          </h2>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Bag Type
          </button>
        </div>
        <div className="px-4 py-2 flex gap-3 text-xs text-gray-500 border-b border-gray-100">
          <span>Empty: <strong>{bagTypesList.filter(b => b.category === 'empty').length}</strong></span>
          <span>Branded: <strong>{bagTypesList.filter(b => b.category === 'branded').length}</strong></span>
          <span>Consumable: <strong>{bagTypesList.filter(b => b.category === 'consumable').length}</strong></span>
        </div>
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Size (kg)</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Material</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Description</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Reorder Level</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bagTypesList.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td data-label="ID" className="mob-hide px-4 py-3 text-gray-500 font-mono text-xs">{b.id}</td>
                  <td data-label="Name" className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate" title={b.name}>{b.name}</td>
                  <td data-label="Category" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      b.category === 'empty' ? 'bg-gray-100 text-gray-700' :
                      b.category === 'branded' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {b.category}
                    </span>
                  </td>
                  <td data-label="Size (kg)" className="px-4 py-3 text-right font-medium text-gray-900">{b.sizeKg || '—'}</td>
                  <td data-label="Material" className="mob-hide px-4 py-3 text-gray-600">{b.material || '—'}</td>
                  <td data-label="Description" className="mob-hide px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate" title={b.description || undefined}>{b.description || '—'}</td>
                  <td data-label="Reorder Level" className="mob-hide px-4 py-3 text-right text-gray-900">{b.reorderLevel}</td>
                  <td data-label="Actions" className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(b)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit" aria-label={`Edit ${b.name}`}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(b)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete" aria-label={`Delete ${b.name}`}>
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

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Bag Type' : 'Add Bag Type'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. PP Woven 25kg" aria-invalid={!!errors.name} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <FieldError error={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="empty">Empty</option>
                <option value="branded">Branded</option>
                <option value="consumable">Consumable</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Size (kg)</label>
              <select value={form.sizeKg} onChange={e => set('sizeKg', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                <option value="0.5">0.5 kg</option>
                <option value="1">1 kg</option>
                <option value="2">2 kg</option>
                <option value="5">5 kg</option>
                <option value="10">10 kg</option>
                <option value="20">20 kg (master)</option>
                <option value="25">25 kg</option>
                <option value="40">40 kg (master)</option>
                <option value="50">50 kg</option>
                <option value="100">100 kg</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Material</label>
            <input type="text" value={form.material} onChange={e => set('material', e.target.value)} placeholder="e.g. PP Woven" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
            <input type="number" value={form.reorderLevel} onChange={e => set('reorderLevel', e.target.value)} placeholder="100" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Bag Type'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
