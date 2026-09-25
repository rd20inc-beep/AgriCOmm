import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, CheckCircle, Circle, Eye, Upload, ExternalLink, Download, FolderOpen, Loader2, Package } from 'lucide-react';
import { documentLabels } from './constants';
import { documentsApi } from '../../documents/api/services';
import api from '../../../api/client';
import { renderDocument, buildDocHtml } from './DocumentCenter';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';

// Documents issued externally (regulator / shipping line / fumigator / inspector)
// — upload-only; they cannot be system-generated.
const UPLOAD_ONLY = new Set(['phyto', 'fumigation', 'blDraft', 'blFinal', 'quality', 'custom']);
// Documents the system can render — clicking opens the preview.
const SYSTEM_GENERATED = new Set(['invoice', 'packingList', 'coo']);

// Documents issued OUTSIDE the system, which therefore only ever arrive as an
// upload. Everything else the system can generate is pulled from the canonical
// catalogue (/documents/available) so a file can be attached to ANY of them —
// this list used to be a hardcoded nine, which left Sales Contract, Proforma,
// Bank FI Request, ITRS, Statement of Origin and the rest with nowhere to
// upload to at all.
const EXTERNAL_KEYS = ['phyto', 'blFinal', 'fumigation', 'quality', 'custom'];

// The system's own key vocabulary differs from the checklist's older one, so a
// generated type that already has a slot is not listed twice.
const CANONICAL_ALIAS = {
  'commercial-invoice': 'invoice',
  'bill-of-lading': 'blDraft',
  'certificate-of-origin': 'coo',
  'packing-list': 'packingList',
};
// checklist key → the system's own doc type, for rendering a generated copy.
const CANONICAL_BY_ALIAS = Object.fromEntries(
  Object.entries(CANONICAL_ALIAS).map(([canonical, alias]) => [alias, canonical]),
);
const BASE_LABELS = {
  ...documentLabels,
  quality: 'Quality / Inspection Certificate',
  custom: 'Other / Custom Document',
};

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
  const { hasPermission } = useAuth();
  const { addToast } = useApp();
  // Only an Owner / Super Admin can make a change take effect. Everyone else
  // can upload, replace and request deletion freely — they are never blocked,
  // their changes simply wait.
  const canApprove = hasPermission('documents', 'approve');

  // Actually-stored files uploaded for this order (global documents module).
  // MUST be the numeric id: document_store.linked_id is an integer column and
  // the transform sets order.id to the ORDER NUMBER ("EX-006"), which the upload
  // never used. Uploads were written against the numeric id while this read
  // asked for "EX-006" - parseInt made that NaN and the request 500'd, so an
  // uploaded file could never be seen again.
  const orderDbId = order?.dbId || order?.id;
  const { data: storedDocs = [], refetch: refetchStored } = useQuery({
    queryKey: ['export-order-docs', orderDbId],
    queryFn: async () => {
      const res = await documentsApi.getByRef('export_order', orderDbId);
      // The endpoint answers { success, data: { documents: [...] } }, so res.data
      // is an OBJECT. Returning it straight through handed an object to the
      // Array.isArray() guard below, which silently produced an empty list even
      // when files existed - the second reason an upload could never be seen.
      return res?.data?.documents || res?.documents || (Array.isArray(res) ? res : []);
    },
    enabled: !!orderDbId,
  });
  // ALL files per type, newest first. This used to keep only the first one, so
  // a second upload against the same document type replaced the first on screen
  // and the earlier file became unreachable even though it was still stored.
  // Every document type the system knows about, so each one gets an upload slot.
  const { data: catalogue = [] } = useQuery({
    queryKey: ['export-order-doc-catalogue', orderDbId],
    queryFn: async () => {
      const res = await api.get(`/api/export-orders/${orderDbId}/documents/available`);
      return (res?.data?.documents || res?.documents || []);
    },
    enabled: !!orderDbId,
    staleTime: 5 * 60 * 1000,
  });

  // EXTERNAL first (they need chasing from third parties), then everything the
  // system generates, minus the ones already covered under an older key.
  const { DOC_KEYS, LABELS } = React.useMemo(() => {
    const labels = { ...BASE_LABELS };
    const keys = [...EXTERNAL_KEYS.filter((k) => k !== 'custom')];
    for (const d of catalogue) {
      const key = CANONICAL_ALIAS[d.key] || d.key;
      if (!labels[key]) labels[key] = d.label || key;
      if (!keys.includes(key)) keys.push(key);
    }
    // Custom stays last: it is the catch-all for anything with no slot of its own.
    keys.push('custom');
    return { DOC_KEYS: keys, LABELS: labels };
  }, [catalogue]);

  const storedByType = React.useMemo(() => {
    const m = {};
    for (const d of (Array.isArray(storedDocs) ? storedDocs : [])) {
      const key = d.doc_type || d.document_type || d.type;
      if (!key) continue;
      (m[key] ||= []).push(d);
    }
    return m;
  }, [storedDocs]);
  // The LIVE file for a type is the latest APPROVED one. A pending upload or a
  // pending deletion does not change what the order counts as its document, so
  // preview/download keep pointing at the approved copy until an owner acts.
  const liveOf = (key) => {
    const list = storedByType[key] || [];
    return list.find((f) => f.status === 'Approved' && f.pending_action !== 'delete') || null;
  };
  const latestOf = (key) => liveOf(key) || (storedByType[key] || [])[0];

  const isReady = (key) => {
    const doc = order.documents?.[key];
    // Green means the document is actually in place — an approved file, or the
    // order's own confirmation. A file still awaiting approval is not yet one.
    return (doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status)) || !!liveOf(key);
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
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    // Sequential, not Promise.all: each upload writes a document_store row and
    // bumps the order's document status, and the server is happier with one at
    // a time than with ten parallel multipart writes.
    for (const file of files) {
      // Pass the label too: the page's own map only knows the original seven
      // types, so anything else was stored as its raw key ("custom - EX-006").
      if (typeof onUpload === 'function') await onUpload(key, file, LABELS[key]);
    }
    refetchStored();
  }
  // Open an uploaded file in a new tab. Every stored document can be previewed,
  // not just the three the system renders itself — a green row with a file
  // attached used to offer Download only, so the only way to look at a
  // phytosanitary or BL scan was to save it first.
  async function previewStored(key, doc) {
    const d = doc || latestOf(key);
    if (!d) return;
    try {
      const opened = await documentsApi.open(d.id, d.file_name || d.title);
      if (!opened) await documentsApi.download(d.id, d.file_name || d.title || `${LABELS[key]}.pdf`);
    } catch (_) { /* toast handled upstream */ }
  }

  // Multi-select for a single combined download. Keyed by document type: a type
  // contributes its live uploaded file if it has one, otherwise the system's
  // generated rendering of it.
  const [selected, setSelected] = React.useState(() => new Set());
  const [bundling, setBundling] = React.useState(false);
  const toggleSelected = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectableKeys = React.useMemo(
    // ANY attached file counts, not just the approved one — selecting a type
    // with five uploads used to contribute a single file, and a type whose
    // uploads were all awaiting approval contributed nothing at all.
    () => DOC_KEYS.filter((k) => (storedByType[k] || []).length || CANONICAL_BY_ALIAS[k] || catalogue.some((d) => d.key === k)),
    [DOC_KEYS, storedByType, catalogue],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableKeys));

  async function downloadSelected(format = 'pdf') {
    if (!selected.size) return;
    setBundling(format);
    try {
      // Re-read the file list first. Approving a deletion elsewhere (the queue
      // in Admin ▸ Approvals) removes rows this tab may still be holding, and
      // sending a deleted id produced a one-page "nothing to merge" PDF that
      // looked simply blank.
      const fresh = await refetchStored();
      const current = fresh?.data;
      if (Array.isArray(current)) {
        const alive = new Set(current.map((f) => f.id));
        for (const key of selected) {
          const stale = (storedByType[key] || []).some((f) => !alive.has(f.id));
          if (stale) addToast?.('The document list had changed — using the latest files.', 'info');
        }
      }
      const uploadedIds = [];
      const generated = [];
      for (const key of selected) {
        const files = storedByType[key] || [];
        if (files.length) {
          // Oldest first, so a multi-page certificate scanned as separate files
          // reads in the order it was uploaded.
          [...files].reverse().forEach((f) => uploadedIds.push(f.id));
          continue;
        }
        // No uploaded file — render the system's own version, exactly as the
        // Document Center would, so the PDF in the zip matches a single download.
        const docType = CANONICAL_BY_ALIAS[key] || key;
        try {
          const res = await api.get(`/api/export-orders/${orderDbId}/documents/${docType}/current`);
          const payload = res?.data || res;
          const doc = payload?.document || payload;
          if (!doc) continue;
          const html = payload.editedHtml || renderDocument({ ...doc, _docType: docType }, doc.style || {});
          generated.push({
            docType,
            filename: LABELS[key] || docType,
            html: buildDocHtml(html, docType, LABELS[key] || docType, { autoPrint: false, orientation: 'portrait' }),
          });
        } catch { /* skipped; the server lists what it could not include */ }
      }
      if (!uploadedIds.length && !generated.length) {
        addToast?.('Nothing to download for the selected documents.', 'error');
        return;
      }
      await api.downloadPost(
        `/api/export-orders/${orderDbId}/documents/bundle`,
        { uploadedIds, generated, zipName: `${order.id} documents`, format },
        `${order.id} documents.${format === 'pdf' ? 'pdf' : 'zip'}`,
      );
      addToast?.(`Downloaded ${uploadedIds.length + generated.length} document(s)${format === 'pdf' ? ' as one PDF' : ' as a ZIP'}.`, 'success');
    } catch (e) {
      addToast?.(e?.data?.message || e.message || 'Download failed', 'error');
    } finally { setBundling(false); }
  }

  // How many FILES the selection will produce — a type can hold several, so the
  // count on the button is not the number of ticks.
  const selectedFileCount = React.useMemo(() => {
    let n = 0;
    for (const key of selected) {
      const files = (storedByType[key] || []).length;
      n += files || 1; // no file yet → one generated copy
    }
    return n;
  }, [selected, storedByType]);

  async function act(fn, okMsg) {
    try { await fn(); addToast?.(okMsg, 'success'); refetchStored(); }
    catch (e) { addToast?.(e?.data?.message || e.message || 'Action failed', 'error'); }
  }
  const requestDelete = (f) => act(() => documentsApi.requestDelete(f.id), 'Deletion requested — awaiting owner approval.');
  const cancelDelete = (f) => act(() => documentsApi.cancelDelete(f.id), 'Deletion request withdrawn.');
  const approveFile = (f) => act(() => documentsApi.approve(f.id, {}), f.pending_action === 'delete' ? 'Deletion approved — document removed.' : 'Approved — this version is now live.');
  const rejectFile = (f) => act(() => documentsApi.reject(f.id, {}), 'Rejected.');

  async function downloadStored(key, doc) {
    const d = doc || latestOf(key);
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

      {/* Bulk download bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white rounded-xl border border-gray-200 px-4 py-2.5">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300" />
          Select all ({selectableKeys.length})
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadSelected('pdf')}
            disabled={!selected.size || !!bundling}
            title="Every selected document combined into one PDF"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {bundling === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {bundling === 'pdf' ? 'Combining…' : `Download as one PDF${selectedFileCount ? ` (${selectedFileCount})` : ''}`}
          </button>
          <button
            onClick={() => downloadSelected('zip')}
            disabled={!selected.size || !!bundling}
            title="Keep the documents as separate files inside a ZIP"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {bundling === 'zip' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
            {bundling === 'zip' ? 'Zipping…' : 'ZIP'}
          </button>
        </div>
      </div>

      {/* Documents list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
        {DOC_KEYS.map((key) => {
          const doc = order.documents?.[key] || {};
          const files = storedByType[key] || [];
          const stored = files[0];
          const pendingCount = files.filter((f) => f.status !== 'Approved' || f.pending_action === 'delete').length;
          const isChecked = isReady(key);
          const uploadOnly = UPLOAD_ONLY.has(key);
          const systemDoc = SYSTEM_GENERATED.has(key);

          return (
            <div key={key} className={`flex items-center gap-4 px-5 py-4 transition-colors ${isChecked ? 'bg-emerald-50/50' : 'hover:bg-gray-50'}`}>
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => toggleSelected(key)}
                disabled={!selectableKeys.includes(key)}
                title={selectableKeys.includes(key) ? 'Include in the combined download' : 'Nothing to download for this document yet'}
                className="rounded border-gray-300 flex-shrink-0 disabled:opacity-30"
              />
              {isChecked ? <CheckCircle className="w-6 h-6 text-emerald-500 flex-shrink-0" /> : <Circle className="w-6 h-6 text-gray-300 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium ${isChecked ? 'text-emerald-800' : 'text-gray-900'}`}>{LABELS[key]}</p>
                  {uploadOnly && !stored && <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full"><ExternalLink className="w-2.5 h-2.5" /> Upload</span>}
                  {systemDoc && <span className="text-[10px] font-medium px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">System-generated</span>}
                  {stored && <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full"><FileText className="w-2.5 h-2.5" /> {files.length > 1 ? `${files.length} files attached` : 'File attached'}</span>}
                  {pendingCount > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">{pendingCount} awaiting approval</span>}
                </div>
                {uploadOnly && !stored && <p className="text-[11px] text-gray-500 mt-0.5">{UPLOAD_HINTS[key]}</p>}
                {/* Every attached file, not just the newest — a document type
                    can legitimately carry several (a BL plus its amendment, a
                    multi-page scan sent as separate images). */}
                {files.map((f) => {
                  const pendingDelete = f.pending_action === 'delete';
                  const live = f.status === 'Approved' && !pendingDelete;
                  return (
                    <div key={f.id} className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-[11px] text-gray-500 truncate">
                        {f.file_name || f.title}{f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString('en-GB')}` : ''}
                      </p>
                      {/* What this file's state actually means, in words */}
                      {pendingDelete ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200" title={f.pending_by_name ? `Requested by ${f.pending_by_name}` : undefined}>deletion awaiting approval</span>
                      ) : live ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">approved</span>
                      ) : f.status === 'Rejected' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">rejected</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">awaiting approval</span>
                      )}
                      <button onClick={() => previewStored(key, f)} className="text-[11px] text-blue-600 hover:underline flex-shrink-0">view</button>
                      <button onClick={() => downloadStored(key, f)} className="text-[11px] text-gray-500 hover:underline flex-shrink-0">download</button>
                      {canApprove ? (
                        <>
                          {(f.status !== 'Approved' || pendingDelete) && (
                            <button onClick={() => approveFile(f)} className="text-[11px] text-emerald-700 hover:underline flex-shrink-0">approve</button>
                          )}
                          {!pendingDelete && f.status !== 'Rejected' && (
                            <button onClick={() => rejectFile(f)} className="text-[11px] text-red-600 hover:underline flex-shrink-0">reject</button>
                          )}
                          {pendingDelete && (
                            <button onClick={() => cancelDelete(f)} className="text-[11px] text-gray-500 hover:underline flex-shrink-0">keep</button>
                          )}
                        </>
                      ) : pendingDelete ? (
                        <button onClick={() => cancelDelete(f)} className="text-[11px] text-gray-500 hover:underline flex-shrink-0">withdraw</button>
                      ) : (
                        <button onClick={() => requestDelete(f)} className="text-[11px] text-red-600 hover:underline flex-shrink-0">request delete</button>
                      )}
                    </div>
                  );
                })}
                {isChecked && doc.date && !stored && <p className="text-xs text-emerald-600 mt-0.5">Confirmed {doc.date}</p>}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* hidden file input for real uploads */}
                <input ref={(el) => { fileInputs.current[key] = el; }} type="file" multiple className="hidden" onChange={(e) => onFileChosen(key, e)} />
                {/* Preview: the uploaded file when there is one, otherwise the
                    system's own rendering for the three it can generate. Passing
                    the key matters — all three used to open the invoice. */}
                {stored ? (
                  <button onClick={() => previewStored(key)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                ) : systemDoc && (
                  <button onClick={() => onPreviewInvoice?.(key)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                <button onClick={() => pickFile(key)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100">
                  <Upload className="w-3.5 h-3.5" /> {stored ? 'Add file' : 'Upload'}
                </button>
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
