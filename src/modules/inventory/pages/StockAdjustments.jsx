import { useState, useEffect } from 'react';
import { AlertTriangle, Plus, CheckCircle, XCircle, Search, Shield } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { lotInventoryApi } from '../api/services';
import { useLotInventory } from '../api/queries';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import SearchSelect from '../components/SearchSelect';

const ADJ_TYPES = [
  { value: 'shortage_found', label: 'Shortage Found', color: 'red' },
  { value: 'excess_found', label: 'Excess Found', color: 'green' },
  { value: 'damaged', label: 'Damaged', color: 'red' },
  { value: 'spoiled', label: 'Spoiled', color: 'red' },
  { value: 'moisture_loss', label: 'Moisture Loss', color: 'amber' },
  { value: 'bag_loss', label: 'Bag Loss', color: 'amber' },
  { value: 'manual_correction', label: 'Manual Correction', color: 'blue' },
];

const PKR = (v) => 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString();

export default function StockAdjustments() {
  const { addToast } = useApp();
  const { data: lots = [] } = useLotInventory({});
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ lot_id: '', adjustmentType: 'shortage_found', quantityKg: '', reason: '' });
  const [reconciliation, setReconciliation] = useState(null);

  function loadAdjustments() {
    const params = filter !== 'all' ? { status: filter } : {};
    lotInventoryApi.listAdjustments(params)
      .then(res => setAdjustments(res?.data?.adjustments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadAdjustments(); }, [filter]);

  async function handleCreate() {
    if (!form.lot_id || !form.quantityKg) { addToast('Lot and quantity required', 'error'); return; }
    try {
      await lotInventoryApi.createAdjustment({
        lotId: parseInt(form.lot_id),
        adjustmentType: form.adjustmentType,
        quantityKg: parseFloat(form.quantityKg),
        reason: form.reason,
      });
      addToast('Adjustment created — pending approval');
      setShowModal(false);
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
      addToast(`Reconciliation complete: ${res?.data?.discrepancies?.length || 0} discrepancies`);
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  const pendingCount = adjustments.filter(a => a.approval_status === 'pending_approval').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Adjustments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Shortage, excess, damage, and corrections with approval workflow</p>
        </div>
        <div className="flex gap-2">
          <button onClick={runReconciliation} className="btn btn-sm bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100">
            <Shield className="w-3.5 h-3.5" /> Run Reconciliation
          </button>
          <button onClick={() => setShowModal(true)} className="btn btn-sm bg-red-600 text-white hover:bg-red-700">
            <Plus className="w-3.5 h-3.5" /> New Adjustment
          </button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium text-amber-800">{pendingCount} adjustment{pendingCount > 1 ? 's' : ''} pending approval</span>
        </div>
      )}

      {/* Reconciliation Results */}
      {reconciliation && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Reconciliation Report</h3>
          <div className="flex gap-4 mb-3 text-sm">
            <span className="text-gray-500">Total lots: <strong>{reconciliation.total}</strong></span>
            <span className="text-green-600">Reconciled: <strong>{reconciliation.reconciled}</strong></span>
            <span className="text-red-600">Discrepancies: <strong>{reconciliation.discrepancies?.length || 0}</strong></span>
          </div>
          {reconciliation.discrepancies?.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">Lot</th><th className="text-right py-2">System (MT)</th><th className="text-right py-2">Ledger (KG)</th><th className="text-right py-2">Discrepancy</th></tr></thead>
              <tbody>
                {reconciliation.discrepancies.map(d => (
                  <tr key={d.lotId} className="border-b border-gray-100 hover:bg-red-50">
                    <td className="py-2 font-medium text-blue-600">{d.lotNo}</td>
                    <td className="py-2 text-right">{d.systemQtyMT?.toFixed(2)} MT</td>
                    <td className="py-2 text-right">{d.ledgerQtyKg?.toFixed(0)} KG</td>
                    <td className="py-2 text-right text-red-600 font-medium">{d.discrepancyKg?.toFixed(0)} KG</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'pending_approval', 'approved', 'rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Adjustments Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b">
            <th className="text-left px-4 py-3">Lot</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-right px-4 py-3">Qty (KG)</th>
            <th className="text-left px-4 py-3">Reason</th>
            <th className="text-right px-4 py-3">Cost Impact</th>
            <th className="text-left px-4 py-3">Requested By</th>
            <th className="text-center px-4 py-3">Status</th>
            <th className="text-center px-4 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {adjustments.map(a => (
              <tr key={a.id} className={`hover:bg-gray-50 ${a.approval_status === 'pending_approval' ? 'bg-amber-50/30' : ''}`}>
                <td className="px-4 py-3 font-medium text-blue-600">{a.lot_no || `LOT-${a.lot_id}`}</td>
                <td className="px-4 py-3 capitalize">{(a.adjustment_type || '').replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-right font-medium">{parseFloat(a.quantity_kg)?.toLocaleString()} KG</td>
                <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{a.reason || '—'}</td>
                <td className="px-4 py-3 text-right">{PKR(a.total_cost_impact)}</td>
                <td className="px-4 py-3 text-gray-600">{a.requested_by_name || '—'}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={a.approval_status?.replace('_', ' ')} /></td>
                <td className="px-4 py-3 text-center">
                  {a.approval_status === 'pending_approval' && (
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => handleApprove(a.id)} className="p-1.5 text-green-600 bg-green-50 rounded hover:bg-green-100" title="Approve">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleReject(a.id)} className="p-1.5 text-red-600 bg-red-50 rounded hover:bg-red-100" title="Reject">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {adjustments.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No adjustments found</td></tr>
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
              onChange={v => setForm(p => ({ ...p, lot_id: v }))}
              options={lots.map(l => ({ value: l.id, label: l.lotNo, sub: `${l.itemName} — ${parseFloat(l.qty).toFixed(1)} MT` }))}
              placeholder="Search lot..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select value={form.adjustmentType} onChange={e => setForm(p => ({ ...p, adjustmentType: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {ADJ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG) *</label>
              <input type="number" value={form.quantityKg} onChange={e => setForm(p => ({ ...p, quantityKg: e.target.value }))} placeholder="e.g. 500" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} rows={2} placeholder="Describe the adjustment reason..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none" />
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
