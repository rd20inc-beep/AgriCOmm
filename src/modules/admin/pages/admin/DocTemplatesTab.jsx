import { useState } from 'react';
import { Files, Plus, Pencil, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import {
  useDocumentTemplates,
  useCreateDocumentTemplate,
  useUpdateDocumentTemplate,
  useDeleteDocumentTemplate,
} from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';

const EMPTY = {
  name: '',
  doc_type: 'proforma_invoice',
  entity: 'export',
  template_content: '',
  is_active: true,
};

const DOC_TYPES = [
  { value: 'proforma_invoice', label: 'Proforma Invoice' },
  { value: 'commercial_invoice', label: 'Commercial Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'bl_draft', label: 'Bill of Lading (Draft)' },
  { value: 'coo', label: 'Certificate of Origin' },
  { value: 'phyto', label: 'Phytosanitary Certificate' },
  { value: 'fumigation', label: 'Fumigation Certificate' },
  { value: 'inspection_report', label: 'Inspection Report' },
  { value: 'export_form', label: 'Export Form' },
  { value: 'other', label: 'Other' },
];

const ENTITIES = ['export', 'milling', 'finance', 'inventory', 'general'];

export default function DocTemplatesTab() {
  const { addToast } = useApp();
  const { data: templates = [], isLoading } = useDocumentTemplates();
  const createMut = useCreateDocumentTemplate();
  const updateMut = useUpdateDocumentTemplate();
  const deleteMut = useDeleteDocumentTemplate();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({
      name: t.name || '',
      doc_type: t.docType || t.doc_type || 'proforma_invoice',
      entity: t.entity || 'export',
      template_content: t.templateContent || t.template_content || '',
      is_active: t.isActive !== false,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { addToast('Template name is required', 'error'); return; }
    const payload = {
      name,
      doc_type: form.doc_type,
      entity: form.entity,
      template_content: form.template_content || null,
      is_active: !!form.is_active,
    };
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: payload });
        addToast(`Template "${name}" updated`, 'success');
      } else {
        await createMut.mutateAsync(payload);
        addToast(`Template "${name}" added`, 'success');
      }
      setOpen(false);
    } catch (err) {
      addToast(`Failed to save: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await deleteMut.mutateAsync(t.id);
      addToast(`Template "${t.name}" deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Files className="w-5 h-5 text-gray-600" />
            Document Templates
            <span className="ml-2 text-xs font-normal text-gray-500">({templates.length})</span>
          </h2>
          <button onClick={openCreate} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Template
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Document Type</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Entity</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading templates...</td></tr>
              ) : templates.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No templates yet — click Add Template.</td></tr>
              ) : templates.map(t => {
                const docTypeLabel = DOC_TYPES.find(d => d.value === (t.docType || t.doc_type))?.label || t.docType || t.doc_type;
                const active = t.isActive !== false;
                return (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-900">{t.name}</td>
                    <td className="py-3 px-4 text-gray-700">{docTypeLabel}</td>
                    <td className="py-3 px-4 text-gray-600 capitalize">{t.entity || '—'}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="m-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700">
          Templates here describe metadata + custom HTML. The document renderers in the order's Documents tab still drive the standard layouts; this list lets you keep the catalog of available document types in sync with the renderers.
        </div>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editingId ? 'Edit Template' : 'Add Template'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Proforma Invoice — Default" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Document Type *</label>
              <select value={form.doc_type} onChange={e => set('doc_type', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
              <select value={form.entity} onChange={e => set('entity', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {ENTITIES.map(e => <option key={e} value={e} className="capitalize">{e}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Content (optional HTML)</label>
            <textarea value={form.template_content} onChange={e => set('template_content', e.target.value)} placeholder="Custom HTML body. Leave blank to use the built-in renderer." rows={6} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y" />
            <p className="text-[11px] text-gray-500 mt-1">Variables like {'{{order.invoiceNumber}}'} are interpolated by the renderer.</p>
          </div>
          <div className="flex items-center gap-2">
            <input id="tpl-active" type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="tpl-active" className="text-sm text-gray-700">Active (available to renderers)</label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">{editingId ? 'Save Changes' : 'Add Template'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
