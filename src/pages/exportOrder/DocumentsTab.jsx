import React, { useRef } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { FileText, Upload, CheckCircle, Eye, Paperclip } from 'lucide-react';
import { documentLabels } from './constants';

export default function DocumentsTab({ order, onUpload, onApprove, onPreviewInvoice }) {
  const docKeys = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation'];
  const fileInputRefs = useRef({});

  const handleFileSelect = (docKey) => {
    // Create a hidden file input and trigger it
    if (!fileInputRefs.current[docKey]) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png';
      input.style.display = 'none';
      input.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          onUpload(docKey, file);
        }
        input.value = ''; // reset for re-upload
      });
      document.body.appendChild(input);
      fileInputRefs.current[docKey] = input;
    }
    fileInputRefs.current[docKey].click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Upload and approve all required export documents. Order advances to Awaiting Balance when all are approved.
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {docKeys.map(key => {
        const doc = order.documents?.[key] || { status: 'Pending', uploadedBy: null, date: null };
        const isApproved = ['Approved', 'Final'].includes(doc.status);
        const isUploaded = ['Draft Uploaded', 'Under Review'].includes(doc.status);
        const isPending = !isApproved && !isUploaded;

        return (
          <div key={key} className={`bg-white rounded-xl shadow-sm border p-5 ${isApproved ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className={`w-4 h-4 ${isApproved ? 'text-green-500' : 'text-gray-400'}`} />
                <h4 className="text-sm font-semibold text-gray-900">{documentLabels[key]}</h4>
              </div>
              <StatusBadge status={doc.status} />
            </div>
            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Status</span>
                <span className="text-gray-700">{doc.status || 'Pending'}</span>
              </div>
              {doc.filePath && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">File</span>
                  <span className="text-blue-600 flex items-center gap-1"><Paperclip className="w-3 h-3" /> Attached</span>
                </div>
              )}
              {doc.date && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Date</span>
                  <span className="text-gray-700">{doc.date}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isPending && (
                <button
                  onClick={() => handleFileSelect(key)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Upload Document
                </button>
              )}
              {isUploaded && (
                <>
                  <button
                    onClick={() => handleFileSelect(key)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors"
                  >
                    <Upload className="w-3 h-3" />
                    Re-upload
                  </button>
                  <button
                    onClick={() => onApprove(key)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors"
                  >
                    <CheckCircle className="w-3 h-3" />
                    Approve
                  </button>
                </>
              )}
              {isApproved && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle className="w-3 h-3" />
                  Approved
                </span>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
