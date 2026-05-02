import React from 'react';
import { FileText, CheckCircle, Circle, Eye, Upload, ExternalLink } from 'lucide-react';
import { documentLabels } from './constants';

// Documents issued externally (regulator / shipping line / fumigator) —
// these are upload-only; they cannot be system-generated. Surface the
// upload action distinctly and label the row so users know what to do.
const UPLOAD_ONLY = new Set(['phyto', 'fumigation', 'blDraft', 'blFinal']);
// Documents the system can render — clicking opens the preview modal.
const SYSTEM_GENERATED = new Set(['invoice', 'packingList', 'coo']);

export default function DocumentsTab({ order, onUpload, onApprove, onPreviewInvoice }) {
  const docKeys = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation'];

  const isReady = (key) => {
    const doc = order.documents?.[key];
    return doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status);
  };
  const allChecked = docKeys.every(isReady);
  const checkedCount = docKeys.filter(isReady).length;

  async function handleConfirm(key, e) {
    e?.stopPropagation();
    if (isReady(key)) return;
    try { await onApprove(key); } catch (_) { /* parent toasts */ }
  }

  async function handleUpload(key, e) {
    e?.stopPropagation();
    if (typeof onUpload === 'function') onUpload(key);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Confirm each document is ready. Order advances to Awaiting Balance when all are checked.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {checkedCount} of {docKeys.length} confirmed
          </p>
        </div>
        <button
          onClick={onPreviewInvoice}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#2d5a87] transition-colors"
        >
          <Eye className="w-4 h-4" />
          Preview Proforma Invoice
        </button>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Document Checklist</span>
          <span>{checkedCount}/{docKeys.length} {allChecked ? '— All confirmed!' : ''}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${allChecked ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${(checkedCount / docKeys.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Document checklist */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
        {docKeys.map((key) => {
          const doc = order.documents?.[key] || {};
          const isChecked = isReady(key);
          const uploadOnly = UPLOAD_ONLY.has(key);
          const systemDoc = SYSTEM_GENERATED.has(key);

          return (
            <div
              key={key}
              className={`flex items-center gap-4 px-5 py-4 transition-colors ${
                isChecked ? 'bg-green-50/50' : 'hover:bg-gray-50'
              }`}
            >
              {isChecked ? (
                <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
              ) : (
                <Circle className="w-6 h-6 text-gray-300 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-medium ${isChecked ? 'text-green-800' : 'text-gray-900'}`}>
                    {documentLabels[key]}
                  </p>
                  {uploadOnly && !isChecked && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
                      <ExternalLink className="w-2.5 h-2.5" /> Upload only
                    </span>
                  )}
                  {systemDoc && !isChecked && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                      System-generated
                    </span>
                  )}
                </div>
                {uploadOnly && !isChecked && (
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {key === 'phyto' && 'Issued by Department of Plant Protection after inspection.'}
                    {key === 'fumigation' && 'Issued by your licensed fumigator after treatment.'}
                    {key === 'blDraft' && 'Provided by the shipping line after vessel booking.'}
                    {key === 'blFinal' && 'Final signed BL released by the shipping line.'}
                  </p>
                )}
                {isChecked && doc.date && (
                  <p className="text-xs text-green-600 mt-0.5">Confirmed {doc.date}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {!isChecked && uploadOnly && (
                  <button
                    onClick={(e) => handleUpload(key, e)}
                    className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                )}
                {!isChecked && systemDoc && (
                  <button
                    onClick={onPreviewInvoice}
                    className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                )}
                {!isChecked && (
                  <button
                    onClick={(e) => handleConfirm(key, e)}
                    className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Confirm Ready
                  </button>
                )}
                {isChecked && (
                  <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded-full">
                    Ready
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allChecked && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-green-800">All documents confirmed</p>
          <p className="text-xs text-green-600 mt-1">Order is ready to advance to the next stage.</p>
        </div>
      )}
    </div>
  );
}
