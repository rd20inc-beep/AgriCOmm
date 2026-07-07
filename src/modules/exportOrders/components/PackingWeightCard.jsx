import { useEffect, useMemo, useState, useCallback } from 'react';
import { Scale, Save, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { useApp } from '../../../context/AppContext';

const kg = (v) => `${Math.round((parseFloat(v) || 0)).toLocaleString()} kg`;
const pct = (v) => `${(parseFloat(v) || 0).toFixed(2)}%`;

// Packed-weight variance (Phase 1). The mill enters the actual packed NET rice +
// packing-material weight; the card computes gross, variance vs the order qty, and
// an Over/Under/Within-tolerance status. Above tolerance needs Owner/Admin sign-off.
export default function PackingWeightCard({ order, onUpdated }) {
  const { hasPermission, user } = useAuth();
  const { requestOwnerApproval } = useOwnerAuth();
  const { addToast } = useApp();
  const canRecord = hasPermission('milling', 'edit');
  const canApprove = user?.role === 'Owner' || user?.role === 'Super Admin';
  const orderId = order.dbId || order.id;

  const [data, setData] = useState(null);
  const [form, setForm] = useState({ packed: '', material: '', tolerance: '0.5', reason: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/export-orders/${orderId}/packing-weight`);
      const d = res?.data || res;
      setData(d);
      const r = d.record;
      setForm({
        packed: r ? String(r.packed_net_rice_kg) : (d.suggestedPackedNetKg ? String(d.suggestedPackedNetKg) : ''),
        material: r ? String(r.packing_material_kg) : '',
        tolerance: r ? String(r.tolerance_pct) : '0.5',
        reason: r?.variance_reason || '',
      });
    } catch { /* card just hides its data */ }
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  const requiredNet = data?.requiredNetKg || (parseFloat(order.qtyMT || order.qty_mt) || 0) * 1000;
  // Live client-side preview (mirrors the server compute).
  const preview = useMemo(() => {
    const net = parseFloat(form.packed) || 0;
    const mat = parseFloat(form.material) || 0;
    const tol = parseFloat(form.tolerance);
    const tolerance = Number.isFinite(tol) ? tol : 0.5;
    const gross = net + mat;
    const varianceKg = net - requiredNet;
    const variancePct = requiredNet > 0 ? (varianceKg / requiredNet) * 100 : 0;
    const within = Math.abs(variancePct) <= tolerance;
    const status = within ? 'within' : (varianceKg > 0 ? 'over' : 'under');
    return { gross, varianceKg, variancePct, status, within };
  }, [form, requiredNet]);

  const rec = data?.record;
  const statusLabel = { within: 'Within Tolerance', over: 'Over Packed', under: 'Under Packed' };
  const statusTone = { within: 'bg-emerald-100 text-emerald-700', over: 'bg-amber-100 text-amber-700', under: 'bg-amber-100 text-amber-700' };

  async function save() {
    if (!(parseFloat(form.packed) >= 0)) { addToast?.('Enter the packed net rice weight', 'error'); return; }
    setSaving(true);
    try {
      await api.put(`/api/export-orders/${orderId}/packing-weight`, {
        packed_net_rice_kg: parseFloat(form.packed) || 0,
        packing_material_kg: parseFloat(form.material) || 0,
        tolerance_pct: parseFloat(form.tolerance) || 0.5,
        variance_reason: form.reason || null,
      });
      addToast?.('Packed weight saved');
      await load();
      onUpdated?.();
    } catch (e) { addToast?.(e?.response?.data?.message || e.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  }

  async function approve() {
    try {
      await requestOwnerApproval((ownerId) => api.post(`/api/export-orders/${orderId}/packing-weight/approve`, { authorized_by_owner_id: ownerId }));
      addToast?.('Packed-weight variance approved');
      await load();
      onUpdated?.();
    } catch (e) { if (e?.message !== 'Owner authorization cancelled') addToast?.(e?.response?.data?.message || e.message || 'Approval failed', 'error'); }
  }

  const Row = ({ label, value, strong }) => (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? 'font-semibold text-gray-900 tabular-nums' : 'text-gray-800 tabular-nums'}>{value}</span>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-2">
        <Scale size={15} /> Packing Weight &amp; Variance
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Summary (all roles) */}
        <div className="space-y-2">
          <Row label="Order Required Net" value={kg(requiredNet)} />
          <Row label="Packed Net Rice" value={kg(canRecord ? form.packed : (rec?.packed_net_rice_kg || 0))} />
          {(canRecord || (rec && parseFloat(rec.packing_material_kg) > 0)) && (
            <Row label="Packing Material" value={kg(canRecord ? form.material : (rec?.packing_material_kg || 0))} />
          )}
          <Row label="Gross Weight" value={kg(canRecord ? preview.gross : (rec?.gross_weight_kg || 0))} />
          <div className="border-t border-gray-100 pt-2 mt-1 space-y-2">
            <Row label={preview.varianceKg >= 0 ? 'Extra Packed' : 'Short Packed'} value={kg(Math.abs(canRecord ? preview.varianceKg : (rec?.variance_kg || 0)))} strong />
            <Row label="Variance" value={`${(canRecord ? preview.varianceKg : rec?.variance_kg) >= 0 ? '+' : '−'}${pct(Math.abs(canRecord ? preview.variancePct : (rec?.variance_pct || 0)))}`} strong />
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Status</span>
              {(() => { const s = canRecord ? preview.status : (rec?.variance_status || 'within'); return (
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${statusTone[s]}`}>{statusLabel[s]}</span>
              ); })()}
            </div>
            {rec && rec.approval_status !== 'not_required' && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Approval</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${rec.approval_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : rec.approval_status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                  {rec.approval_status === 'pending' ? 'Approval Required' : rec.approval_status}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Entry (mill only) */}
        {canRecord ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Packed Net Rice (KG)</label>
              <input type="number" min="0" value={form.packed} onChange={(e) => setForm((p) => ({ ...p, packed: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none tabular-nums" placeholder="e.g. 25000" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Packing Material (KG)</label>
                <input type="number" min="0" value={form.material} onChange={(e) => setForm((p) => ({ ...p, material: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none tabular-nums" placeholder="bags + pallet" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tolerance %</label>
                <input type="number" min="0" step="0.05" value={form.tolerance} onChange={(e) => setForm((p) => ({ ...p, tolerance: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none tabular-nums" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Variance Reason</label>
              <input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Why the packed weight differs (optional)" />
            </div>
            {!preview.within && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Over tolerance — this needs Owner/Admin approval before the order can complete.</span>
              </div>
            )}
            <button onClick={save} disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
              <Save size={15} /> {saving ? 'Saving…' : 'Save Packed Weight'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center text-sm text-gray-400">
            {rec ? 'Recorded by the mill.' : 'The mill has not recorded packed weight yet.'}
          </div>
        )}
      </div>

      {/* Owner/Admin approval */}
      {canApprove && rec && rec.approval_status === 'pending' && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm text-amber-700">This variance is over tolerance and needs sign-off.</span>
          <button onClick={approve}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
            <CheckCircle2 size={15} /> Approve Variance
          </button>
        </div>
      )}
    </div>
  );
}
