import React from 'react';
import StatusBadge from '../../components/StatusBadge';
import { FileText, Upload, CheckCircle, Eye } from 'lucide-react';
import { documentLabels } from './constants';

export default function DocumentsTab({ order, onUpload, onApprove, onPreviewInvoice }) {
  const docKeys = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation'];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
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
        return (
          <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <h4 className="text-sm font-semibold text-gray-900">{documentLabels[key]}</h4>
              </div>
              <StatusBadge status={doc.status} />
            </div>
            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Uploaded By</span>
                <span className="text-gray-700">{doc.uploadedBy || '\u2014'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Date</span>
                <span className="text-gray-700">{doc.date || '\u2014'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {doc.status === 'Pending' && (
                <button
                  onClick={() => onUpload(key)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Upload Draft
                </button>
              )}
              {(doc.status === 'Draft Uploaded' || doc.status === 'Under Review') && (
                <>
                  <button
                    onClick={() => onUpload(key)}
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
                    Mark Approved
                  </button>
                </>
              )}
              {['Approved', 'Final'].includes(doc.status) && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                  <CheckCircle className="w-3 h-3" />
                  Complete
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
