import { useState } from 'react';
import { AlertTriangle, Check, X, Plus, Loader2, Clock } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import {
  useMillStoreAdjustments,
  useMillStoreItems,
  useRequestAdjustment,
  useApproveAdjustment,
  useRejectAdjustment,
} from '../api/queries';

const ADJ_TYPES = [
  { value: 'damage', label: 'Damage' },
  { value: 'wastage', label: 'Wastage' },
  { value: 'correction', label: 'Correction' },
  { value: 'count', label: 'Stock Count' },
];

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
};

export default function StoreAdjustments() {
  const { addToast } = useApp();
  const { user, hasPermission } = useAuth();
  const canApprove = hasPermission('mill_store', 'approve_adjustment');

  const [statusFilter, setStatusFilter] = useState('Pending');
  const { data: adjustments = [], isLoading } = useMillStoreAdjustments({ status: statusFilter || undefined });
  const { data: items = [] } = useMillStoreItems({ limit: 500 });
  const safeAdj = Array.isArray(adjustments) ? adjustments : [];
  const safeItems = Array.isArray(items) ? items : [];

  const requestMut = useRequestAdjustment();
  const approveMut = useApproveAdjustment();
  const rejectMut = useRejectAdjustment();

  // Request form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item_id: '', adjustment_type: 'damage', quantity_delta: '', reason: '' });
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Reject modal
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  async function handleRequest(e) {
    e.preventDefault();
    if (!form.item_id || !form.quantity_delta || !form.reason) {
      addToast('All fields are required', 'error');
      return;
    }
    try {
      await requestMut.mutateAsync({
        item_id: Number(form.item_id),
        adjustment_type: form.adjustment_type,
        quantity_delta: Number(form.quantity_delta),
        reason: form.reason,
      });
      addToast('Adjustment requested — pending admin approval', 'success');
      setShowForm(false);
      setForm({ item_id: '', adjustment_type: 'damage', quantity_delta: '', reason: '' });
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  async function handleApprove(id) {
    try {
      await approveMut.mutateAsync(id);
      addToast('Adjustment approved — stock updated', 'success');
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      addToast('Rejection reason is required', 'error');
      return;
    }
    try {
      await rejectMut.mutateAsync({ id: rejectId, rejection_reason: rejectReason });
      addToast('Adjustment rejected', 'success');
      setRejectId(null);
      setRejectReason('');
    } catch (err) {
      addToast(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Adjustments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Damage, wastage, corrections — requires admin approval</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> Request Adjustment
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {['Pending', 'Approved', 'Rejected', ''].map(s => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Request form */}
      {showForm && (
        <form onSubmit={handleRequest} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">New Adjustment Request</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Item *</label>
              <select value={form.item_id} onChange={(e) => setF('item_id', e.target.value)} className="form-input w-full text-sm" required>
                <option value="">Select item</option>
                {safeItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Type *</label>
              <select value={form.adjustment_type} onChange={(e) => setF('adjustment_type', e.target.value)} className="form-input w-full text-sm">
                {ADJ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Quantity (+/-) *</label>
              <input
                type="number"
                step="any"
                value={form.quantity_delta}
                onChange={(e) => setF('quantity_delta', e.target.value)}
                className="form-input w-full text-sm"
                placeholder="-5 (decrease) or +10 (increase)"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Reason *</label>
            <textarea
              value={form.reason}
              onChange={(e) => setF('reason', e.target.value)}
              className="form-input w-full text-sm"
              rows={2}
              placeholder="Explain why this adjustment is needed..."
              required
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={requestMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {requestMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Submit Request
            </button>
          </div>
        </form>
      )}

      {/* Adjustments list */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}</div>
      ) : safeAdj.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Clock size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No {statusFilter.toLowerCase() || ''} adjustments found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Item</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Type</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Qty</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Reason</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Requested By</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Status</th>
                {canApprove && <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {safeAdj.map(a => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-gray-900">{a.item_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{a.item_code}</p>
                  </td>
                  <td className="py-2.5 px-4 capitalize text-gray-700">{a.adjustment_type}</td>
                  <td className={`py-2.5 px-4 text-right font-bold ${Number(a.quantity_delta) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {Number(a.quantity_delta) > 0 ? '+' : ''}{Number(a.quantity_delta)} {a.item_unit}
                  </td>
                  <td className="py-2.5 px-4 text-gray-600 max-w-xs truncate">{a.reason}</td>
                  <td className="py-2.5 px-4 text-gray-600">{a.requested_by_name || '—'}</td>
                  <td className="py-2.5 px-4">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[a.status] || 'bg-gray-100'}`}>
                      {a.status}
                    </span>
                    {a.status === 'Rejected' && a.rejection_reason && (
                      <p className="text-[10px] text-red-500 mt-0.5 truncate max-w-[150px]">{a.rejection_reason}</p>
                    )}
                    {a.status === 'Approved' && a.approved_by_name && (
                      <p className="text-[10px] text-green-600 mt-0.5">by {a.approved_by_name}</p>
                    )}
                  </td>
                  {canApprove && (
                    <td className="py-2.5 px-4 text-right">
                      {a.status === 'Pending' && (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => handleApprove(a.id)}
                            disabled={approveMut.isPending}
                            className="p-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100"
                            title="Approve"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => { setRejectId(a.id); setRejectReason(''); }}
                            className="p-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100"
                            title="Reject"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRejectId(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Reject Adjustment</h3>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Reason for rejection *</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="form-input w-full text-sm"
                rows={3}
                placeholder="Why is this adjustment being rejected?"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRejectId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleReject}
                disabled={rejectMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {rejectMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
