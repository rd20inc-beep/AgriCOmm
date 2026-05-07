import { useState, useMemo } from 'react';
import { Tag, Plus, Pencil, Trash2, ChevronRight } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import {
  useProductCategories,
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeleteProductCategory,
} from '../../../../api/queries';
import Modal from '../../../../components/Modal';

const EMPTY = { name: '', parentId: '', groupKey: '', description: '' };

export default function CategoriesTab() {
  const { addToast } = useApp();
  const { data: categories = [] } = useProductCategories();
  const createMut = useCreateProductCategory();
  const updateMut = useUpdateProductCategory();
  const deleteMut = useDeleteProductCategory();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const safeCategories = Array.isArray(categories) ? categories : [];
  const topLevel = useMemo(() => safeCategories.filter(c => !c.parentId), [safeCategories]);
  const childrenOf = (parentId) => safeCategories.filter(c => c.parentId === parentId);

  const openCreate = (parentId = '') => {
    setEditingId(null);
    setForm({ ...EMPTY, parentId: parentId ? String(parentId) : '' });
    setOpen(true);
  };
  const openEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name || '',
      parentId: c.parentId ? String(c.parentId) : '',
      groupKey: c.groupKey || '',
      description: c.description || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { addToast('Category name is required', 'error'); return; }
    const payload = {
      name,
      parent_id: form.parentId ? parseInt(form.parentId, 10) : null,
      group_key: form.groupKey.trim() || null,
      description: form.description.trim() || null,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Category "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Category "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"? Subcategories will become top-level.`)) return;
    try {
      await deleteMut.mutateAsync(c.id);
      addToast(`Category "${c.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-600" />
            Product Categories
            <span className="text-xs font-normal text-gray-500">· top-level groups + subcategories</span>
          </h2>
          <button
            onClick={() => openCreate('')}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {topLevel.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">No categories yet — add one to get started.</div>
          )}
          {topLevel.map(parent => {
            const kids = childrenOf(parent.id);
            return (
              <div key={parent.id} className="px-6 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-gray-900">{parent.name}</span>
                    {parent.groupKey && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 uppercase tracking-wide">
                        {parent.groupKey}
                      </span>
                    )}
                    {parent.description && <span className="ml-2 text-xs text-gray-500">— {parent.description}</span>}
                  </div>
                  <div className="inline-flex gap-1">
                    <button onClick={() => openCreate(parent.id)} className="px-2 py-1 rounded hover:bg-emerald-50 text-emerald-600 text-xs font-medium" title="Add subcategory">
                      + Subcategory
                    </button>
                    <button onClick={() => openEdit(parent)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(parent)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {kids.length > 0 && (
                  <div className="mt-2 ml-6 space-y-1">
                    {kids.map(k => (
                      <div key={k.id} className="flex items-center justify-between text-sm px-3 py-1.5 bg-gray-50 rounded-md">
                        <div className="flex items-center gap-2">
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-800">{k.name}</span>
                          {k.description && <span className="text-xs text-gray-500">— {k.description}</span>}
                        </div>
                        <div className="inline-flex gap-1">
                          <button onClick={() => openEdit(k)} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(k)} className="p-1 rounded hover:bg-red-50 text-red-600" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Category' : 'Add Category'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Basmati Rice / Bran" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Parent Category</label>
            <select value={form.parentId} onChange={e => set('parentId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="">— None (top-level group)</option>
              {topLevel.filter(t => t.id !== editingId).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Leave empty for a top-level group, or select a parent to create a subcategory.</p>
          </div>
          {!form.parentId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Key</label>
              <input type="text" value={form.groupKey} onChange={e => set('groupKey', e.target.value)} placeholder="ready_rice / by_products / raw_rice" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              <p className="text-xs text-gray-400 mt-1">Stable key used by stock reports for grouping. Lower-case with underscores.</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">{editingId ? 'Save Changes' : 'Add Category'}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
