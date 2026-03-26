import { useState, useMemo } from 'react';
import { FileText, Search, Filter, Eye, CheckCircle, RotateCcw, FileCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import ProformaInvoice from '../components/ProformaInvoice';

const docTypeLabels = {
  phyto: 'Phyto Certificate',
  blDraft: 'BL Draft',
  blFinal: 'BL Final',
  invoice: 'Invoice',
  packingList: 'Packing List',
  coo: 'Certificate of Origin',
  fumigation: 'Fumigation Certificate',
};

const docTypeKeys = Object.keys(docTypeLabels);

const allStatuses = ['All', 'Pending', 'Draft Uploaded', 'Approved', 'Under Review', 'Rejected'];

export default function Documents() {
  const { exportOrders, addToast, updateDocumentStatus, addActivityToOrder, companyProfileData } = useApp();

  const getOrderForDoc = (orderId) => exportOrders.find(o => o.id === orderId);

  const [orderFilter, setOrderFilter] = useState('All');
  const [docTypeFilter, setDocTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [previewModal, setPreviewModal] = useState(null);

  const allDocuments = useMemo(() => {
    const docs = [];
    exportOrders.forEach(order => {
      if (!order.documents) return;
      docTypeKeys.forEach(key => {
        const doc = order.documents[key];
        if (!doc) return;
        docs.push({
          orderId: order.id,
          customerName: order.customerName,
          docKey: key,
          docType: docTypeLabels[key],
          status: doc.status,
          uploadedBy: doc.uploadedBy,
          date: doc.date,
          version: doc.status === 'Approved' ? 'v1.0' : doc.status === 'Draft Uploaded' ? 'v0.1' : null,
        });
      });
    });
    return docs;
  }, [exportOrders]);

  const filteredDocuments = useMemo(() => {
    return allDocuments.filter(doc => {
      if (orderFilter !== 'All' && doc.orderId !== orderFilter) return false;
      if (docTypeFilter !== 'All' && doc.docKey !== docTypeFilter) return false;
      if (statusFilter !== 'All' && doc.status !== statusFilter) return false;
      return true;
    });
  }, [allDocuments, orderFilter, docTypeFilter, statusFilter]);

  const orderIds = useMemo(() => {
    return ['All', ...Array.from(new Set(exportOrders.map(o => o.id)))];
  }, [exportOrders]);

  const handleMarkApproved = (doc) => {
    updateDocumentStatus(doc.orderId, doc.docKey, 'Approved');
    addActivityToOrder(doc.orderId, {
      date: new Date().toISOString().split('T')[0],
      action: `${doc.docType} marked as Approved`,
      by: 'Admin',
    });
    addToast(`${doc.docType} for ${doc.orderId} marked as Approved`, 'success');
  };

  const handleRequestRevision = (doc) => {
    updateDocumentStatus(doc.orderId, doc.docKey, 'Under Review');
    addActivityToOrder(doc.orderId, {
      date: new Date().toISOString().split('T')[0],
      action: `Revision requested for ${doc.docType}`,
      by: 'Admin',
    });
    addToast(`Revision requested for ${doc.docType} on ${doc.orderId}`, 'info');
  };

  const totalDocs = allDocuments.length;
  const approvedDocs = allDocuments.filter(d => d.status === 'Approved').length;
  const pendingDocs = allDocuments.filter(d => d.status === 'Pending').length;
  const draftDocs = allDocuments.filter(d => d.status === 'Draft Uploaded').length;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track export documentation across all orders</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-green-600">
            <FileCheck className="w-4 h-4" />
            <span className="font-medium">{approvedDocs}</span> Approved
          </div>
          <div className="flex items-center gap-1.5 text-blue-600">
            <FileText className="w-4 h-4" />
            <span className="font-medium">{draftDocs}</span> Drafts
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <FileText className="w-4 h-4" />
            <span className="font-medium">{pendingDocs}</span> Pending
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
        <Filter className="w-4 h-4 text-gray-400" />

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Order</label>
          <select
            value={orderFilter}
            onChange={(e) => setOrderFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            {orderIds.map(id => (
              <option key={id} value={id}>{id === 'All' ? 'All Orders' : id}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Document Type</label>
          <select
            value={docTypeFilter}
            onChange={(e) => setDocTypeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="All">All Types</option>
            {docTypeKeys.map(key => (
              <option key={key} value={key}>{docTypeLabels[key]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            {allStatuses.map(s => (
              <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
            ))}
          </select>
        </div>

        <div className="text-xs text-gray-400 ml-auto">
          Showing {filteredDocuments.length} of {totalDocs} documents
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Order No</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Document Type</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Uploaded By</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Version</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDocuments.map((doc, idx) => (
                <tr key={`${doc.orderId}-${doc.docKey}-${idx}`} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-blue-600">{doc.orderId}</td>
                  <td className="px-4 py-3 text-gray-900">{doc.customerName}</td>
                  <td className="px-4 py-3 text-gray-900">{doc.docType}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{doc.uploadedBy || <span className="text-gray-400">-</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{doc.date || <span className="text-gray-400">-</span>}</td>
                  <td className="px-4 py-3 text-center">
                    {doc.version ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        {doc.version}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setPreviewModal(doc)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {doc.status !== 'Approved' && doc.status !== 'Pending' && (
                        <button
                          onClick={() => handleMarkApproved(doc)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Mark Approved"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {doc.status !== 'Pending' && (
                        <button
                          onClick={() => handleRequestRevision(doc)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 rounded transition-colors"
                          title="Request Revision"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDocuments.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No documents found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        isOpen={!!previewModal}
        onClose={() => setPreviewModal(null)}
        title={previewModal ? `${previewModal.docType} - ${previewModal.orderId}` : ''}
        size={previewModal && (previewModal.docKey === 'invoice' || previewModal.docKey === 'blDraft') ? 'lg' : 'md'}
      >
        {previewModal && (
          <div className="space-y-4">
            {(() => {
              const order = getOrderForDoc(previewModal.orderId);
              // Show full proforma invoice for invoice and BL documents
              if (order && (previewModal.docKey === 'invoice' || previewModal.docKey === 'blDraft')) {
                return <ProformaInvoice order={order} companyProfile={companyProfileData} />;
              }
              // For other doc types, show summary card
              return (
                <div className="bg-gray-50 rounded-lg p-5 border border-gray-200 text-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                    <div>
                      <p className="font-bold text-gray-900 text-base">{previewModal.docType}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Ref: {previewModal.orderId} / {new Date().getFullYear()}</p>
                    </div>
                    <div className="text-right">
                      <img src="/logo.jpg" alt="Logo" className="w-12 h-12 object-contain rounded" />
                    </div>
                  </div>
                  {order && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-500">Buyer:</span> <span className="font-medium">{order.customerName}</span></div>
                      <div><span className="text-gray-500">Destination:</span> <span className="font-medium">{order.country}</span></div>
                      <div><span className="text-gray-500">Product:</span> <span className="font-medium">{order.productName}</span></div>
                      <div><span className="text-gray-500">Quantity:</span> <span className="font-medium">{order.qtyMT} MT</span></div>
                      <div><span className="text-gray-500">Incoterm:</span> <span className="font-medium">{order.incoterm}</span></div>
                      <div><span className="text-gray-500">Port:</span> <span className="font-medium">{order.destinationPort || '—'}</span></div>
                    </div>
                  )}
                  <div className="text-center pt-2 text-[10px] text-gray-400 border-t border-dashed border-gray-300">
                    Document preview — full PDF available in production
                  </div>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Order:</span>
                <span className="ml-2 font-medium text-gray-900">{previewModal.orderId}</span>
              </div>
              <div>
                <span className="text-gray-500">Type:</span>
                <span className="ml-2 font-medium text-gray-900">{previewModal.docType}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <span className="ml-2"><StatusBadge status={previewModal.status} /></span>
              </div>
              <div>
                <span className="text-gray-500">Uploaded By:</span>
                <span className="ml-2 font-medium text-gray-900">{previewModal.uploadedBy || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Date:</span>
                <span className="ml-2 font-medium text-gray-900">{previewModal.date || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Version:</span>
                <span className="ml-2 font-medium text-gray-900">{previewModal.version || 'N/A'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              {previewModal.status !== 'Approved' && previewModal.status !== 'Pending' && (
                <button
                  onClick={() => {
                    handleMarkApproved(previewModal);
                    setPreviewModal(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  Mark Approved
                </button>
              )}
              {previewModal.status !== 'Pending' && (
                <button
                  onClick={() => {
                    handleRequestRevision(previewModal);
                    setPreviewModal(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Request Revision
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
