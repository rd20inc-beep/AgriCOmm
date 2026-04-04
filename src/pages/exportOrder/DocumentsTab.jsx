import React from 'react';
import { FileText, CheckCircle, Circle, Eye } from 'lucide-react';
import { documentLabels } from './constants';

export default function DocumentsTab({ order, onUpload, onApprove, onPreviewInvoice }) {
  const docKeys = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation'];

  const allChecked = docKeys.every(key => {
    const doc = order.documents?.[key];
    return doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status);
  });
  const checkedCount = docKeys.filter(key => {
    const doc = order.documents?.[key];
    return doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status);
  }).length;

  function handleToggle(key) {
    const doc = order.documents?.[key];
    const isChecked = doc && ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status);

    if (isChecked) {
      // Already checked — no un-check for now
      return;
    }
    // Mark as confirmed (Draft Uploaded → then approve)
    onUpload(key, null); // marks as Draft Uploaded
    setTimeout(() => onApprove(key), 500); // then approve
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
        {docKeys.map(key => {
          const doc = order.documents?.[key] || {};
          const isChecked = ['Approved', 'Final', 'Draft Uploaded'].includes(doc.status);

          return (
            <div
              key={key}
              onClick={() => handleToggle(key)}
              className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
                isChecked ? 'bg-green-50/50' : 'hover:bg-gray-50'
              }`}
            >
              {isChecked ? (
                <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
              ) : (
                <Circle className="w-6 h-6 text-gray-300 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isChecked ? 'text-green-800' : 'text-gray-900'}`}>
                  {documentLabels[key]}
                </p>
                {isChecked && doc.date && (
                  <p className="text-xs text-green-600 mt-0.5">Confirmed {doc.date}</p>
                )}
              </div>
              {isChecked && (
                <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded-full flex-shrink-0">
                  Ready
                </span>
              )}
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
