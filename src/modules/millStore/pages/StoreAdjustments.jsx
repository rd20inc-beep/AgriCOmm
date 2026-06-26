import { useState, useMemo } from 'react';
import { Check, X, Plus, Loader2, Clock, RefreshCw, Info } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import {
  useMillStoreAdjustments,
  useMillStoreItems,
  useRequestAdjustment,
  useApproveAdjustment,
  useRejectAdjustment,
} from '../api/queries';
import {
  AdjustmentTypeChip,
  AdjustmentKPIBar,
  AdjustmentFilters,
  STORE_ADJ_TYPES,
  findStoreType,
  themeFor,
} from '../../../shared/components/adjustments';

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
};

function periodStart() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function StoreAdjustments() {
  const { addToast } = useApp();
  const { requestOwnerApproval } = useOwnerAuth();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('mill_store', 'approve_adjustment');

  // Single source-of-truth filter object — matches StockAdjustments shape.
  const [filters, setFilters] = useState({ status: 'Pending', types: [], fromDate: '', toDate: '' });
  const { data: adjustments = [], isLoading, refetch } = useMillStoreAdjustments({
    status: filters.status === 'all' || filters.status === '' ? undefined : filters.status,
  });
  const { data: items = [] } = useMillStoreItems({ limit: 500 });
  const safeAdj = Array.isArray(adjustments) ? adjustments : [];
  const safeItems = Array.isArray(items) ? items : [];
  // We also need the unfiltered list for KPI math; refetch with no status applied is wasteful,
  // so KPIs derive from the currently-loaded slice. For 'Pending' default that means the
  // KPI cards reflect "pending" only. Safe trade-off until backend exposes a stats endpoint.
  const allForKpis = safeAdj;

  const requestMut = useRequestAdjustment();
  const approveMut = useApproveAdjustment();
  const rejectMut = useRejectAdjustment();

  // Request form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item_id: '', adjustment_type: 'damage', quantity_delta: '', reason: '' });
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Reject modal
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // Client-side filters for type + date — backend only filters by status today.
  const visibleAdj = useMemo(() => {
    return safeAdj.filter((a) => {
      if (filters.types.length > 0 && !filters.types.includes(a.adjustment_type)) return false;
      if (filters.fromDate && a.created_at && new Date(a.created_at) < new Date(filters.fromDate)) return false;
      if (filters.toDate) {
        const cutoff = new Date(filters.toDate);
        cutoff.setHours(23, 59, 59, 999);
        if (a.created_at && new Date(a.created_at) > cutoff) return false;
      }
      return true;
    });
  }, [safeAdj, filters.types, filters.fromDate, filters.toDate]);

  const kpis = useMemo(() => {
    const since = periodStart();
    const inPeriod = allForKpis.filter((a) => a.created_at && new Date(a.created_at) >= since);
    const pendingCount = allForKpis.filter((a) => a.status === 'Pending').length;
    const decided = inPeriod.filter((a) => a.status === 'Approved' || a.status === 'Rejected').length;
    const approved = inPeriod.filter((a) => a.status === 'Approved').length;
    return {
      pendingCount,
      periodCount: inPeriod.length,
      // Mill store doesn't track per-row cost impact; pass null so the card hides.
      periodImpact: null,
      approvalRate: decided > 0 ? approved / decided : null,
    };
  }, [allForKpis]);

  // Cost-impact preview disabled for store adjustments (no cost field on
  // the request) — but we can still show the affected item summary.
  const itemPreview = useMemo(() => {
    const item = safeItems.find((i) => Number(i.id) === Number(form.item_id));
    if (!item || !form.quantity_delta) return null;
    const delta = parseFloat(form.quantity_delta);
    if (Number.isNaN(delta) || delta === 0) return null;
    const onHand = parseFloat(item.qty_on_hand ?? item.quantity_on_hand ?? 0) || 0;
    return {
      item,
      delta,
      newOnHand: onHand + delta,
      below: onHand + delta < 0,
    };
  }, [form.item_id, form.quantity_delta, safeItems]);

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
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Store Adjustments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Damage, wastage and corrections — requires admin approval</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch && refetch()} className="btn btn-sm btn-secondary" title="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus size={16} /> Request Adjustment
          </button>
        </div>
      </div>

      {/* KPI bar (cost impact omitted — store doesn't track it) */}
      <AdjustmentKPIBar
        pendingCount={kpis.pendingCount}
        periodCount={kpis.periodCount}
        periodImpact={kpis.periodImpact}
        approvalRate={kpis.approvalRate}
      />

      {/* Filters */}
      <AdjustmentFilters
        value={filters}
        onChange={setFilters}
        types={STORE_ADJ_TYPES}
        statuses={['all', 'Pending', 'Approved', 'Rejected']}
        formatStatusLabel={(s) => (s === 'all' ? 'All' : s)}
      />

      {/* Request form */}
      {showForm && (
        <form onSubmit={handleRequest} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">New Adjustment Request</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Item *</label>
              <select value={form.item_id} onChange={(e) => setF('item_id', e.target.value)} className="form-input w-full text-sm" required>
                <option value="">Select item</option>
                {safeItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
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
                placeholder="-5 (decrease) or 10 (increase)"
                required
              />
            </div>
          </div>

          {/* Type chips */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Type *</label>
            <div className="flex flex-wrap gap-2">
              {STORE_ADJ_TYPES.map((t) => {
                const selected = form.adjustment_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setF('adjustment_type', t.value)}
                    className={`transition-all ${selected ? 'ring-2 ring-blue-500 ring-offset-1 rounded-full' : 'opacity-60 hover:opacity-100'}`}
                  >
                    <AdjustmentTypeChip type={t} size="lg" />
                  </button>
                );
              })}
            </div>
            {form.adjustment_type && (
              <p className="text-[11px] text-gray-500 mt-2 leading-snug">{findStoreType(form.adjustment_type)?.desc}</p>
            )}
          </div>

          {/* Item-impact preview */}
          {itemPreview && (
            <div className={`rounded-lg p-3 border ${itemPreview.below ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="flex items-start gap-2 text-sm">
                <Info size={14} className={`mt-0.5 ${itemPreview.below ? 'text-red-600' : 'text-blue-600'}`} />
                <div>
                  <div className="font-medium text-gray-900">
                    New on-hand: <span className={itemPreview.below ? 'text-red-700' : 'text-blue-700'}>
                      {itemPreview.newOnHand} {itemPreview.item.unit}
                    </span>
                    {itemPreview.below && <span className="ml-2 text-[11px] text-red-700">(would go negative — adjust quantity)</span>}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {itemPreview.item.code} · {itemPreview.item.name}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Reason *</label>
            <textarea
              value={form.reason}
              onChange={(e) => setF('reason', e.target.value)}
              className="form-input w-full text-sm"
              rows={2}
              placeholder="Explain why this adjustment is needed…"
              required
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button
              type="submit"
              disabled={requestMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {requestMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Submit Request
            </button>
          </div>
        </form>
      )}

      {/* List */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}</div>
      ) : visibleAdj.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Clock size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No adjustments match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <th className="text-left py-2.5 px-4">Item</th>
                <th className="text-left py-2.5 px-4">Type</th>
                <th className="text-right py-2.5 px-4">Qty</th>
                <th className="text-left py-2.5 px-4">Reason</th>
                <th className="text-left py-2.5 px-4">Requested By</th>
                <th className="text-left py-2.5 px-4">Status</th>
                {canApprove && <th className="text-right py-2.5 px-4">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleAdj.map((a) => {
                const type = findStoreType(a.adjustment_type);
                const t = themeFor(type ? type.color : 'slate');
                const isPending = a.status === 'Pending';
                return (
                  <tr key={a.id} className={`hover:bg-gray-50 ${isPending ? t.rowTint : ''}`}>
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-gray-900">{a.item_name}</p>
                      <p className="text-xs text-gray-500 font-mono">{a.item_code}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <AdjustmentTypeChip type={type} />
                    </td>
                    <td className={`py-2.5 px-4 text-right font-bold ${Number(a.quantity_delta) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {Number(a.quantity_delta) > 0 ? '+' : ''}{Number(a.quantity_delta)} {a.item_unit}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600 max-w-xs truncate" title={a.reason}>{a.reason}</td>
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
                        {isPending && (
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
                );
              })}
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
