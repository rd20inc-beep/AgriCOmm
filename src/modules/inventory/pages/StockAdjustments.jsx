import { useState, useEffect, useMemo } from 'react';
import { Plus, CheckCircle, XCircle, Shield, RefreshCw, Info } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { lotInventoryApi } from '../../../api/services';
import { useLotInventory } from '../../../api/queries';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import SearchSelect from '../../../components/SearchSelect';
import {
  AdjustmentTypeChip,
  AdjustmentKPIBar,
  AdjustmentFilters,
  STOCK_ADJ_TYPES,
  findStockType,
  themeFor,
} from '../../../shared/components/adjustments';

const PKR = (v) => 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString();

// Period for KPI calc — last 30 days, computed once per render.
function periodStart() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function StockAdjustments() {
  const { addToast } = useApp();
  const { requestOwnerApproval } = useOwnerAuth();
  const { data: lots = [] } = useLotInventory({});
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'all', types: [], fromDate: '', toDate: '' });
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ lot_id: '', adjustmentType: 'shortage_found', quantityKg: '', reason: '' });
  const [reconciliation, setReconciliation] = useState(null);
  const [expanded, setExpanded] = useState(null); // adjustment id whose reason is expanded

  function loadAdjustments() {
    setLoading(true);
    // Backend currently only filters by status; type/date filters are applied client-side below.
    const params = filters.status !== 'all' && filters.status !== '' ? { status: filters.status } : {};
    lotInventoryApi.listAdjustments(params)
      .then(res => setAdjustments(res?.data?.adjustments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadAdjustments(); }, [filters.status]);

  // Apply client-side filters: type chips + date range.
  const visibleAdjustments = useMemo(() => {
    return adjustments.filter((a) => {
      if (filters.types.length > 0 && !filters.types.includes(a.adjustment_type)) return false;
      if (filters.fromDate && a.created_at && new Date(a.created_at) < new Date(filters.fromDate)) return false;
      if (filters.toDate) {
        const cutoff = new Date(filters.toDate);
        cutoff.setHours(23, 59, 59, 999);
        if (a.created_at && new Date(a.created_at) > cutoff) return false;
      }
      return true;
    });
  }, [adjustments, filters.types, filters.fromDate, filters.toDate]);

  // KPI bar values — across the FULL adjustments list (not just visible ones)
  // so the numbers don't shift as the user changes filters.
  const kpis = useMemo(() => {
    const since = periodStart();
    const inPeriod = adjustments.filter((a) => a.created_at && new Date(a.created_at) >= since);
    const pendingCount = adjustments.filter((a) => a.approval_status === 'pending_approval').length;
    const periodCount = inPeriod.length;
    const periodImpact = inPeriod
      .filter((a) => a.approval_status === 'approved')
      .reduce((s, a) => s + Math.abs(parseFloat(a.total_cost_impact) || 0), 0);
    const decided = inPeriod.filter((a) => a.approval_status === 'approved' || a.approval_status === 'rejected').length;
    const approved = inPeriod.filter((a) => a.approval_status === 'approved').length;
    const approvalRate = decided > 0 ? approved / decided : null;
    return { pendingCount, periodCount, periodImpact, approvalRate };
  }, [adjustments]);

  // Cost-impact preview while filling the modal — shows the operator what
  // they're about to write off before they submit.
  const costPreview = useMemo(() => {
    const lot = lots.find((l) => Number(l.id) === Number(form.lot_id));
    if (!lot) return null;
    const qty = parseFloat(form.quantityKg) || 0;
    if (qty <= 0) return null;
    const costPerKg = parseFloat(lot.landedCostPerKg) || parseFloat(lot.ratePerKg) || 0;
    const type = findStockType(form.adjustmentType);
    const sign = type ? type.sign : '-';
    return {
      qty,
      costPerKg,
      total: costPerKg * qty,
      direction: sign === '+' ? 'add' : sign === '-' ? 'remove' : 'change',
      lotNo: lot.lotNo,
      lotName: lot.itemName,
      lotQtyMT: parseFloat(lot.qty),
    };
  }, [form.lot_id, form.quantityKg, form.adjustmentType, lots]);

  async function handleCreate() {
    if (!form.lot_id || !form.quantityKg) { addToast('Lot and quantity are required', 'error'); return; }
    try {
      await lotInventoryApi.createAdjustment({
        lotId: parseInt(form.lot_id),
        adjustmentType: form.adjustmentType,
        quantityKg: parseFloat(form.quantityKg),
        reason: form.reason,
      });
      addToast('Adjustment submitted — pending approval');
      setShowModal(false);
      setForm({ lot_id: '', adjustmentType: 'shortage_found', quantityKg: '', reason: '' });
      loadAdjustments();
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  async function handleApprove(id) {
    try {
      await lotInventoryApi.approveAdjustment(id);
      addToast('Adjustment approved — stock updated');
      loadAdjustments();
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  async function handleReject(id) {
    try {
      await lotInventoryApi.rejectAdjustment(id, { reason: 'Rejected by manager' });
      addToast('Adjustment rejected');
      loadAdjustments();
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  async function runReconciliation() {
    try {
      const res = await lotInventoryApi.getReconciliation();
      setReconciliation(res?.data || null);
      addToast(`Reconciliation complete — ${res?.data?.discrepancies?.length || 0} discrepancies`);
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Adjustments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Shortage, excess, damage and corrections — with approval workflow</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadAdjustments} className="btn btn-sm btn-secondary" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={runReconciliation} className="btn btn-sm bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100">
            <Shield className="w-3.5 h-3.5" /> Run Reconciliation
          </button>
          <button onClick={() => setShowModal(true)} className="btn btn-sm bg-red-600 text-white hover:bg-red-700">
            <Plus className="w-3.5 h-3.5" /> New Adjustment
          </button>
        </div>
      </div>

      {/* KPI bar */}
      <AdjustmentKPIBar
        pendingCount={kpis.pendingCount}
        periodCount={kpis.periodCount}
        periodImpact={kpis.periodImpact}
        approvalRate={kpis.approvalRate}
      />

      {/* Reconciliation panel — appears once user runs it */}
      {reconciliation && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Shield size={14} className="text-purple-500" /> Reconciliation Report
            </h3>
            <button onClick={() => setReconciliation(null)} className="text-xs text-gray-400 hover:text-gray-700">Dismiss</button>
          </div>
          <div className="flex gap-4 mb-3 text-sm">
            <span className="text-gray-500">Total lots: <strong className="text-gray-900">{reconciliation.total}</strong></span>
            <span className="text-emerald-600">Reconciled: <strong>{reconciliation.reconciled}</strong></span>
            <span className="text-red-600">Discrepancies: <strong>{reconciliation.discrepancies?.length || 0}</strong></span>
          </div>
          {reconciliation.discrepancies?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-gray-500">
                    <th className="text-left py-2">Lot</th>
                    <th className="text-right py-2">System (kg)</th>
                    <th className="text-right py-2">Ledger (KG)</th>
                    <th className="text-right py-2">Discrepancy</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.discrepancies.map((d) => (
                    <tr key={d.lotId} className="border-b border-gray-100 hover:bg-red-50">
                      <td className="py-2 font-medium text-blue-600">{d.lotNo}</td>
                      <td className="py-2 text-right">{Math.round((d.systemQtyMT || 0) * 1000).toLocaleString()} kg</td>
                      <td className="py-2 text-right">{d.ledgerQtyKg?.toFixed(0)} KG</td>
                      <td className="py-2 text-right text-red-600 font-medium">{d.discrepancyKg?.toFixed(0)} KG</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <AdjustmentFilters
        value={filters}
        onChange={setFilters}
        types={STOCK_ADJ_TYPES}
        statuses={['all', 'pending_approval', 'approved', 'rejected']}
      />

      {/* Adjustments table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left px-4 py-3">Lot</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Qty (KG)</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-right px-4 py-3">Cost Impact</th>
              <th className="text-left px-4 py-3">Requested By</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && visibleAdjustments.map((a) => {
              const type = findStockType(a.adjustment_type);
              const t = themeFor(type ? type.color : 'slate');
              const isPending = a.approval_status === 'pending_approval';
              const isExpanded = expanded === a.id;
              return (
                <tr
                  key={a.id}
                  className={`hover:bg-gray-50 ${isPending ? t.rowTint : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-blue-600 align-top">{a.lot_no || `LOT-${a.lot_id}`}</td>
                  <td className="px-4 py-3 align-top">
                    <AdjustmentTypeChip type={type} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium align-top">
                    {parseFloat(a.quantity_kg)?.toLocaleString()} KG
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[260px] align-top">
                    {a.reason ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : a.id)}
                        className="text-left w-full"
                      >
                        <span className={isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate inline-block max-w-full'}>
                          {a.reason}
                        </span>
                        {a.reason.length > 60 && (
                          <span className="block text-[10px] text-blue-500 hover:underline mt-0.5">
                            {isExpanded ? 'Show less' : 'Show more'}
                          </span>
                        )}
                      </button>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <span className={(parseFloat(a.total_cost_impact) || 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                      {PKR(a.total_cost_impact)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 align-top">{a.requested_by_name || '—'}</td>
                  <td className="px-4 py-3 text-center align-top">
                    <StatusBadge status={a.approval_status?.replace('_', ' ')} />
                  </td>
                  <td className="px-4 py-3 text-center align-top">
                    {isPending && (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => handleApprove(a.id)} className="p-1.5 text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100" title="Approve">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleReject(a.id)} className="p-1.5 text-red-600 bg-red-50 rounded hover:bg-red-100" title="Reject">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && visibleAdjustments.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No adjustments match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* New Adjustment Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New Stock Adjustment" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lot *</label>
            <SearchSelect
              value={form.lot_id}
              onChange={(v) => setForm((p) => ({ ...p, lot_id: v }))}
              options={lots.map((l) => ({ value: l.id, label: l.lotNo, sub: `${l.itemName} — ${Math.round(parseFloat(l.qty) || 0).toLocaleString()} kg` }))}
              placeholder="Search lot…"
            />
          </div>

          {/* Type as chips */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
            <div className="flex flex-wrap gap-2">
              {STOCK_ADJ_TYPES.map((t) => {
                const selected = form.adjustmentType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, adjustmentType: t.value }))}
                    className={`transition-all ${selected ? 'ring-2 ring-blue-500 ring-offset-1 rounded-full' : 'opacity-60 hover:opacity-100'}`}
                  >
                    <AdjustmentTypeChip type={t} size="lg" />
                  </button>
                );
              })}
            </div>
            {form.adjustmentType && (
              <p className="text-[11px] text-gray-500 mt-2 leading-snug">{findStockType(form.adjustmentType)?.desc}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG) *</label>
            <input
              type="number"
              value={form.quantityKg}
              onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))}
              placeholder="e.g. 500"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>

          {/* Cost-impact preview */}
          {costPreview && (
            <div className={`rounded-lg p-3 border ${costPreview.direction === 'add' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-start gap-2 text-sm">
                <Info size={14} className={`mt-0.5 ${costPreview.direction === 'add' ? 'text-emerald-600' : 'text-red-600'}`} />
                <div>
                  <div className="font-medium text-gray-900">
                    {costPreview.direction === 'add' ? 'Adds ' : costPreview.direction === 'remove' ? 'Writes off ' : 'Changes '}
                    <span className={costPreview.direction === 'add' ? 'text-emerald-700' : 'text-red-700'}>
                      {PKR(costPreview.total)}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {costPreview.qty.toLocaleString()} KG × {PKR(costPreview.costPerKg)}/kg ·
                    Lot {costPreview.lotNo} ({costPreview.lotName} · {Math.round(costPreview.lotQtyMT || 0).toLocaleString()} kg on hand)
                  </div>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              rows={2}
              placeholder="Describe what happened — for the audit trail."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">Submit for Approval</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
