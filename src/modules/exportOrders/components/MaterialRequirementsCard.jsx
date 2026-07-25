import { useCallback, useEffect, useState } from 'react';
import { Boxes, AlertTriangle, ShoppingCart } from 'lucide-react';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';

const n0 = (v) => Math.round(parseFloat(v) || 0).toLocaleString();

// Proactive material requirements (before packing): bags / master bags / polythene
// / pallets needed for the order vs mill stock, with a shortage per item and a
// one-click "raise purchase requests" for the mill.
export default function MaterialRequirementsCard({ order }) {
  const { addToast } = useApp();
  const { hasPermission } = useAuth();
  const canRaise = hasPermission('milling', 'edit') || hasPermission('inventory', 'create');
  const orderId = order.dbId || order.id;

  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [raising, setRaising] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/export-orders/${orderId}/material-requirements`);
      const d = res?.data || res;
      setLines(d?.lines || []);
    } catch { setLines([]); }
    finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  const shortages = lines.filter((l) => (parseFloat(l.shortage) || 0) > 0);

  async function raise() {
    setRaising(true);
    try {
      const res = await api.post(`/api/export-orders/${orderId}/material-requirements/raise`, {});
      const d = res?.data || res;
      addToast(d?.count ? `${d.count} purchase request(s) raised for Mill/Owner approval` : 'No shortages to raise');
      await load();
    } catch (e) { addToast(e?.response?.data?.message || e.message || 'Failed', 'error'); }
    finally { setRaising(false); }
  }

  if (!loading && lines.length === 0) return null; // container/bulk or nothing to pack

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2"><Boxes size={15} /> Packing Material Requirements</h3>
        {canRaise && shortages.length > 0 && (
          <button onClick={raise} disabled={raising}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60">
            <ShoppingCart size={14} /> {raising ? 'Raising…' : `Raise Purchase Requests (${shortages.length})`}
          </button>
        )}
      </div>
      {loading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Calculating…</div>
      ) : (
        <table className="w-full text-sm mobile-cards">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b">
              <th className="text-left py-2">Material</th>
              <th className="text-right py-2">Required</th>
              <th className="text-right py-2">In Stock</th>
              <th className="text-right py-2">Shortage</th>
              <th className="text-right py-2">Est. Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lines.map((l, i) => {
              const short = parseFloat(l.shortage) || 0;
              return (
                <tr key={i}>
                  <td data-label="Material" className="py-2 text-gray-800">{l.label}</td>
                  <td data-label="Required" className="py-2 text-right tabular-nums">{n0(l.required)} {l.unit}</td>
                  <td data-label="In Stock" className="mob-hide py-2 text-right tabular-nums text-gray-500">{n0(l.available)}</td>
                  <td data-label="Shortage" className={`py-2 text-right tabular-nums font-medium ${short > 0 ? 'text-amber-700' : 'text-emerald-600'}`}>
                    {short > 0 ? `${n0(short)} short` : 'OK'}
                  </td>
                  <td data-label="Est. Cost" className="mob-hide py-2 text-right tabular-nums text-gray-500">{l.est_amount != null ? `Rs ${n0(l.est_amount)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {shortages.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={13} /> {shortages.length} material(s) short — raise purchase requests so Finance can procure before packing.
        </p>
      )}
    </div>
  );
}
