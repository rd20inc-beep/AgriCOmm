import { useState } from 'react';
import { Warehouse, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';
import FieldError from '../../../../shared/components/FieldError';
import useConfirm from '../../../../hooks/useConfirm';

const EMPTY = { name: '', entity: 'mill', type: 'raw' };

export default function WarehousesTab() {
  const { warehousesList, addToast } = useApp();
  const createMut = useCreateWarehouse();
  const updateMut = useUpdateWarehouse();
  const deleteMut = useDeleteWarehouse();
  const [confirm, confirmDialog] = useConfirm();
  const saving = createMut.isPending || updateMut.isPending;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(e => (e[k] ? { ...e, [k]: null } : e)); };

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setErrors({}); setOpen(true); };
  const openEdit = (w) => {
    setEditingId(w.id);
    setErrors({});
    setForm({
      name: w.name || '',
      entity: w.entity || 'mill',
      type: w.type || 'raw',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) { setErrors({ name: 'Warehouse name is required' }); return; }
    const payload = { name, entity: form.entity, type: form.type };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Warehouse "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Warehouse "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (w) => {
    if (!await confirm({
      title: `Delete warehouse "${w.name}"?`,
      consequence: 'This cannot be undone.',
      confirmLabel: 'Delete',
    })) return;
    try {
      await deleteMut.mutateAsync(w.id);
      addToast(`Warehouse "${w.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed (the warehouse may hold inventory lots)', 'error');
    }
  };

  return (
    <>
      {confirmDialog}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-teal-600" />
            Warehouses
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Warehouse Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Entity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {warehousesList.map(w => (
                <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                  <td data-label="ID" className="mob-hide px-4 py-3 text-gray-500 font-mono text-xs">{w.id}</td>
                  <td data-label="Warehouse Name" className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate" title={w.name}>{w.name}</td>
                  <td data-label="Entity" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      w.entity === 'mill' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {w.entity === 'mill' ? 'Mill' : 'Export'}
                    </span>
                  </td>
                  <td data-label="Type" className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      w.type === 'raw' ? 'bg-amber-100 text-amber-700' :
                      w.type === 'finished' ? 'bg-emerald-100 text-emerald-700' :
                      w.type === 'byproduct' ? 'bg-purple-100 text-purple-700' :
                      'bg-cyan-100 text-cyan-700'
                    }`}>
                      {(w.type || '').charAt(0).toUpperCase() + (w.type || '').slice(1)}
                    </span>
                  </td>
                  <td data-label="Actions" className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(w)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit" aria-label={`Edit ${w.name}`}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(w)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete" aria-label={`Delete ${w.name}`}>
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

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Warehouse' : 'Add New Warehouse'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Warehouse name" aria-invalid={!!errors.name} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            <FieldError error={errors.name} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
            <select value={form.entity} onChange={(e) => set('entity', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="mill">Mill</option>
              <option value="export">Export</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="raw">Raw</option>
              <option value="finished">Finished</option>
              <option value="byproduct">Byproduct</option>
              <option value="transit">Transit</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Warehouse'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
