import { useState, useMemo } from 'react';
import {
  ShieldCheck, Clock, CheckCircle, XCircle, AlertTriangle, Search,
  ChevronDown, ChevronUp, Eye, ThumbsUp, ThumbsDown, User, Calendar,
  DollarSign, FileText, RefreshCw, Send,
} from 'lucide-react';
import { usePendingApprovals, useMyApprovalRequests, useApproveRequest, useRejectRequest } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import Modal from '../../../components/Modal';

const TYPE_LABELS = {
  payment_confirmation: 'Payment Confirmation',
  stock_adjustment: 'Stock Adjustment',
  internal_transfer: 'Internal Transfer',
  manual_journal: 'Manual Journal Entry',
  cost_edit: 'Cost Edit',
  order_close: 'Order Close',
  quality_override: 'Quality Override',
  price_change: 'Price Change',
};

const TYPE_COLORS = {
  payment_confirmation: 'bg-emerald-100 text-emerald-700',
  stock_adjustment: 'bg-blue-100 text-blue-700',
  internal_transfer: 'bg-violet-100 text-violet-700',
  manual_journal: 'bg-indigo-100 text-indigo-700',
  cost_edit: 'bg-amber-100 text-amber-700',
  order_close: 'bg-gray-100 text-gray-700',
  quality_override: 'bg-orange-100 text-orange-700',
  price_change: 'bg-red-100 text-red-700',
};

const PRIORITY_COLORS = {
  Urgent: 'bg-red-100 text-red-700 border-red-200',
  High: 'bg-orange-100 text-orange-700 border-orange-200',
  Normal: 'bg-gray-100 text-gray-700 border-gray-200',
  Low: 'bg-gray-50 text-gray-500 border-gray-200',
};

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-gray-100 text-gray-600',
  Expired: 'bg-gray-100 text-gray-500',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount, currency = 'USD') {
  if (!amount) return '—';
  if (currency === 'PKR') return 'Rs ' + Math.round(amount).toLocaleString('en-PK');
  return '$' + parseFloat(amount).toLocaleString('en-US');
}

function timeUntilExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 48) return `${Math.floor(hours / 24)}d left`;
  return `${hours}h left`;
}

export default function Approvals() {
  const { addToast } = useApp();
  const [activeTab, setActiveTab] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');

  const { data: pendingApprovals = [], isLoading: pendingLoading, error: pendingError, refetch: refetchPending } = usePendingApprovals();
  const { data: myRequests = [], isLoading: myLoading, refetch: refetchMy } = useMyApprovalRequests();

  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();

  const currentList = activeTab === 'pending' ? pendingApprovals : myRequests;
  const isLoading = activeTab === 'pending' ? pendingLoading : myLoading;

  const types = useMemo(() => ['All', ...new Set(currentList.map(a => a.approvalType).filter(Boolean))], [currentList]);

  const filtered = useMemo(() => {
    return currentList.filter(a => {
      if (typeFilter !== 'All' && a.approvalType !== typeFilter) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        (a.entityRef || '').toLowerCase().includes(term) ||
        (a.approvalType || '').toLowerCase().includes(term) ||
        (a.notes || '').toLowerCase().includes(term) ||
        (a.requestedByName || '').toLowerCase().includes(term)
      );
    });
  }, [currentList, typeFilter, searchTerm]);

  async function handleApprove(approval) {
    try {
      await approveMutation.mutateAsync({ id: approval.id, data: { notes: approvalNotes } });
      addToast(`Approved: ${approval.entityRef || approval.approvalType}`, 'success');
      setSelectedApproval(null);
      setApprovalNotes('');
    } catch (err) {
      addToast(err.message || 'Approval failed', 'error');
    }
  }

  async function handleReject(approval) {
    if (!rejectReason.trim()) {
      addToast('Rejection reason is required', 'error');
      return;
    }
    try {
      await rejectMutation.mutateAsync({ id: approval.id, data: { reason: rejectReason } });
      addToast(`Rejected: ${approval.entityRef || approval.approvalType}`, 'success');
      setSelectedApproval(null);
      setRejectModalOpen(false);
      setRejectReason('');
    } catch (err) {
      addToast(err.message || 'Rejection failed', 'error');
    }
  }

  // Summary stats
  const stats = useMemo(() => ({
    total: pendingApprovals.length,
    urgent: pendingApprovals.filter(a => a.priority === 'Urgent' || a.priority === 'High').length,
    expiringSoon: pendingApprovals.filter(a => {
      if (!a.expiresAt) return false;
      const hours = (new Date(a.expiresAt) - new Date()) / (1000 * 60 * 60);
      return hours > 0 && hours < 24;
    }).length,
    totalAmount: pendingApprovals.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0),
  }), [pendingApprovals]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Approval Workflow
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Maker-checker approval queue</p>
        </div>
        <button
          onClick={() => { refetchPending(); refetchMy(); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Pending</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Urgent / High</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{stats.urgent}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Expiring &lt;24h</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{stats.expiringSoon}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Amount</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(stats.totalAmount)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pending' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Pending Approvals ({pendingApprovals.length})
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'my' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Requests ({myRequests.length})
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search approvals..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none">
          {types.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : TYPE_LABELS[t] || t}</option>)}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner message="Loading approvals..." />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ShieldCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">
            {activeTab === 'pending' ? 'No pending approvals' : 'No requests submitted'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(approval => {
            const expiry = timeUntilExpiry(approval.expiresAt);
            return (
              <div
                key={approval.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[approval.approvalType] || 'bg-gray-100 text-gray-700'}`}>
                        {TYPE_LABELS[approval.approvalType] || approval.approvalType}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[approval.priority] || ''}`}>
                        {approval.priority}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[approval.status] || ''}`}>
                        {approval.status}
                      </span>
                      {expiry && expiry !== 'Expired' && (
                        <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                          <Clock className="w-3 h-3" />
                          {expiry}
                        </span>
                      )}
                      {expiry === 'Expired' && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          Expired
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-1">
                      <span className="font-medium text-gray-900">{approval.entityRef || `${approval.entityType} #${approval.entityId}`}</span>
                      {approval.amount > 0 && (
                        <span className="font-semibold text-gray-900 flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {formatCurrency(approval.amount, approval.currency)}
                        </span>
                      )}
                    </div>

                    {approval.notes && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{approval.notes}</p>
                    )}

                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {approval.requestedByName || 'Unknown'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(approval.requestedAt || approval.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setSelectedApproval(approval)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Details
                    </button>
                    {activeTab === 'pending' && approval.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(approval)}
                          disabled={approveMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          onClick={() => { setSelectedApproval(approval); setRejectModalOpen(true); }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <Modal isOpen={!!selectedApproval && !rejectModalOpen} onClose={() => setSelectedApproval(null)} title="Approval Request Detail" size="lg">
        {selectedApproval && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Type</p>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium mt-1 ${TYPE_COLORS[selectedApproval.approvalType] || ''}`}>
                  {TYPE_LABELS[selectedApproval.approvalType] || selectedApproval.approvalType}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Priority</p>
                <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium mt-1 ${PRIORITY_COLORS[selectedApproval.priority] || ''}`}>
                  {selectedApproval.priority}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Entity</p>
                <p className="text-sm text-gray-900 mt-1">{selectedApproval.entityRef || `${selectedApproval.entityType} #${selectedApproval.entityId}`}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Amount</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{formatCurrency(selectedApproval.amount, selectedApproval.currency)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Requested By</p>
                <p className="text-sm text-gray-900 mt-1">{selectedApproval.requestedByName || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Requested At</p>
                <p className="text-sm text-gray-900 mt-1">{formatDate(selectedApproval.requestedAt || selectedApproval.createdAt)}</p>
              </div>
              {selectedApproval.approvedBy && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Approved/Rejected By</p>
                  <p className="text-sm text-gray-900 mt-1">{selectedApproval.approvedByName || selectedApproval.approvedBy}</p>
                </div>
              )}
              {selectedApproval.rejectionReason && (
                <div className="col-span-2">
                  <p className="text-xs font-medium text-gray-500 uppercase">Rejection Reason</p>
                  <p className="text-sm text-red-600 mt-1 bg-red-50 rounded p-2">{selectedApproval.rejectionReason}</p>
                </div>
              )}
            </div>

            {selectedApproval.notes && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Notes</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selectedApproval.notes}</p>
              </div>
            )}

            {/* Current vs Proposed Data */}
            {(selectedApproval.currentData || selectedApproval.proposedData) && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Proposed Changes</h3>
                <div className="grid grid-cols-2 gap-4">
                  {selectedApproval.currentData && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-2">Current</p>
                      <pre className="bg-gray-50 rounded-lg p-3 text-xs overflow-x-auto max-h-48 text-gray-600">
                        {JSON.stringify(selectedApproval.currentData, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selectedApproval.proposedData && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-2">Proposed</p>
                      <pre className="bg-green-50 rounded-lg p-3 text-xs overflow-x-auto max-h-48 text-green-700">
                        {JSON.stringify(selectedApproval.proposedData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Approval Actions */}
            {activeTab === 'pending' && selectedApproval.status === 'Pending' && (
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                <input
                  type="text"
                  placeholder="Add approval notes (optional)..."
                  value={approvalNotes}
                  onChange={e => setApprovalNotes(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={() => handleApprove(selectedApproval)}
                  disabled={approveMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => setRejectModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal isOpen={rejectModalOpen} onClose={() => { setRejectModalOpen(false); setRejectReason(''); }} title="Reject Request" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Please provide a reason for rejecting this request. This will be visible to the requestor.
          </p>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Enter rejection reason (required)..."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setRejectModalOpen(false); setRejectReason(''); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedApproval && handleReject(selectedApproval)}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
