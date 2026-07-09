import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, CheckCircle, Circle, Eye, Upload, ExternalLink, Download, FolderOpen } from 'lucide-react';
import { documentLabels } from './constants';
import { documentsApi } from '../../documents/api/services';

// Documents issued externally (regulator / shipping line / fumigator / inspector)
// — upload-only; they cannot be system-generated.
const UPLOAD_ONLY = new Set(['phyto', 'fumigation', 'blDraft', 'blFinal', 'quality', 'custom']);
// Documents the system can render — clicking opens the preview.
const SYSTEM_GENERATED = new Set(['invoice', 'packingList', 'coo']);

// All document types shown on the tab (extends the base checklist with a
// Quality/Inspection certificate + a free-form custom upload slot).
const DOC_KEYS = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation', 'quality', 'custom'];
const LABELS = { ...documentLabels, quality: 'Quality / Inspection Certificate', custom: 'Other / Custom Document' };

const UPLOAD_HINTS = {
  phyto: 'Issued by Department of Plant Protection after inspection.',
  fumigation: 'Issued by your licensed fumigator after treatment.',
  blDraft: 'Provided by the shipping line after vessel booking.',
  blFinal: 'Final signed BL released by the shipping line.',
  quality: 'Third-party quality / pre-shipment inspection report.',
  custom: 'Any additional document for this shipment.',
};

export default function DocumentsTab({ order, onUpload, onApprove, onPreviewInvoice }) {
  const fileInputs = useRef({});

  // Actually-stored files uploaded for this order (global documents module).
  const { data: storedDocs = [], refetch: refetchStored } = useQuery({
    queryKey: ['export-order-docs', order?.id],
    queryFn: async () => {
      const res = await documentsApi.getByRef('export_order', order.id);
      return res?.data || res || [];
    },
    enabled: !!order?.id,
  });
  const storedByType = React.useMemo(() => {
    const m = {};
    for (const d of (Array.isArray(storedDocs) ? storedDocs : [])) {
      const key = d.doc_type || d.document_type || d.type;
      if (key && !m[key]) m[key] = d; // keep the latest (list is newest-first)
    }
    return m;
  }, [storedDocs]);

  const isReady = (key) => {
    const doc = order.documents?.[key];
    return (doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status)) || !!storedByType[key];
  };
  const confirmable = DOC_KEYS.filter((k) => k !== 'custom');
  const allChecked = confirmable.every(isReady);
  const checkedCount = confirmable.filter(isReady).length;
  const anyActivity = checkedCount > 0 || Object.keys(storedByType).length > 0;

  async function handleConfirm(key, e) {
    e?.stopPropagation();
    if (order.documents?.[key] && ['Approved', 'Final', 'Draft Uploaded'].includes(order.documents[key].status)) return;
    try { await onApprove(key); } catch (_) { /* parent toasts */ }
  }

  function pickFile(key) { fileInputs.current[key]?.click(); }
  async function onFileChosen(key, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (typeof onUpload === 'function') await onUpload(key, file);
    refetchStored();
  }
  async function downloadStored(key) {
    const d = storedByType[key];
    if (!d) return;
    try { await documentsApi.download(d.id, d.file_name || d.title || `${LABELS[key]}.pdf`); } catch (_) { /* toast handled upstream */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-gray-500">Generate, upload, view and download every document for this export order.</p>
          <p className="text-xs text-gray-400 mt-1">{checkedCount} of {confirmable.length} confirmed</p>
        </div>
        <button onClick={onPreviewInvoice}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2d5a87] transition-colors">
          <Eye className="w-4 h-4" /> Preview Proforma Invoice
        </button>
      </div>

      {/* Empty state — nothing generated or uploaded yet */}
      {!anyActivity && (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 text-center">
          <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">No documents have been generated or uploaded for this export order yet.</p>
          <p className="text-xs text-gray-400 mt-1">Generate a system document (Commercial Invoice, Packing List, CoO) below, or upload an external certificate on its row.</p>
        </div>
      )}

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Document Checklist</span>
          <span>{checkedCount}/{confirmable.length} {allChecked ? '— All confirmed!' : ''}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className={`h-2 rounded-full transition-all ${allChecked ? 'bg-emerald-500' : 'bg-blue-500'}`}
            style={{ width: `${(checkedCount / confirmable.length) * 100}%` }} />
        </div>
      </div>

      {/* Documents list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
        {DOC_KEYS.map((key) => {
          const doc = order.documents?.[key] || {};
          const stored = storedByType[key];
          const isChecked = isReady(key);
          const uploadOnly = UPLOAD_ONLY.has(key);
          const systemDoc = SYSTEM_GENERATED.has(key);

          return (
            <div key={key} className={`flex items-center gap-4 px-5 py-4 transition-colors ${isChecked ? 'bg-emerald-50/50' : 'hover:bg-gray-50'}`}>
              {isChecked ? <CheckCircle className="w-6 h-6 text-emerald-500 flex-shrink-0" /> : <Circle className="w-6 h-6 text-gray-300 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium ${isChecked ? 'text-emerald-800' : 'text-gray-900'}`}>{LABELS[key]}</p>
                  {uploadOnly && !stored && <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full"><ExternalLink className="w-2.5 h-2.5" /> Upload</span>}
                  {systemDoc && <span className="text-[10px] font-medium px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">System-generated</span>}
                  {stored && <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full"><FileText className="w-2.5 h-2.5" /> File attached</span>}
                </div>
                {uploadOnly && !stored && <p className="text-[11px] text-gray-500 mt-0.5">{UPLOAD_HINTS[key]}</p>}
                {stored && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{stored.file_name || stored.title}{stored.created_at ? ` · ${new Date(stored.created_at).toLocaleDateString('en-GB')}` : ''}</p>}
                {isChecked && doc.date && !stored && <p className="text-xs text-emerald-600 mt-0.5">Confirmed {doc.date}</p>}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* hidden file input for real uploads */}
                <input ref={(el) => { fileInputs.current[key] = el; }} type="file" className="hidden" onChange={(e) => onFileChosen(key, e)} />
                {systemDoc && (
                  <button onClick={onPreviewInvoice} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                {stored ? (
                  <button onClick={() => downloadStored(key)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100">
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                ) : (
                  <button onClick={() => pickFile(key)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100">
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                )}
                {key !== 'custom' && (isChecked ? (
                  <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">Ready</span>
                ) : (
                  <button onClick={(e) => handleConfirm(key, e)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100">
                    <CheckCircle className="w-3.5 h-3.5" /> Confirm Ready
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {allChecked && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-800">All documents confirmed</p>
          <p className="text-xs text-emerald-600 mt-1">Order is ready to advance to the next stage.</p>
        </div>
      )}
    </div>
  );
}
