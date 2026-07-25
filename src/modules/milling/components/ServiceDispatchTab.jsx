import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Send, Truck, Trash2, Package, Boxes } from 'lucide-react';
import { serviceMillingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import SlideDrawer from '../../../components/SlideDrawer';

const num = (v) => parseFloat(v) || 0;
const kg = (v) => `${Math.round(num(v)).toLocaleString()} kg`;

/**
 * Dispatch tab for a service-milling batch — hand client-owned finished /
 * by-product stock back to the client. Not a sale: no GL, no revenue.
 */
export default function ServiceDispatchTab({ routeId, onChanged }) {
  const { addToast } = useApp();
  const { hasPermission } = useAuth();
  const canDispatch = hasPermission('service_milling', 'record_dispatch');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['service-dispatch', routeId],
    queryFn: async () => (await serviceMillingApi.getDispatchSummary(routeId))?.data || {},
    enabled: !!routeId,
  });

  const lots = data?.lots || [];
  const dispatches = data?.dispatches || [];
  const summary = data?.summary || { producedKg: 0, remainingKg: 0, dispatchedKg: 0 };

  const [lot, setLot] = useState(null); // lot being dispatched
  const [form, setForm] = useState({ qtyKg: '', bagCount: '', vehicleNo: '', driverName: '', dispatchDate: new Date().toISOString().split('T')[0], notes: '' });

  const createMut = useMutation({
    mutationFn: (payload) => serviceMillingApi.createDispatch(routeId, payload),
    onSuccess: () => { addToast('Dispatch recorded', 'success'); setLot(null); refetch(); onChanged?.(); },
    onError: (err) => addToast(err?.message || 'Failed to record dispatch', 'error'),
  });
  const deleteMut = useMutation({
    mutationFn: (dispatchId) => serviceMillingApi.deleteDispatch(dispatchId),
    onSuccess: () => { addToast('Dispatch reversed', 'success'); refetch(); onChanged?.(); },
    onError: (err) => addToast(err?.message || 'Failed to reverse dispatch', 'error'),
  });

  function openDispatch(l) {
    const bagW = num(l.bag_weight_kg) || 50;
    const avail = num(l.available_qty);
    setForm({
      qtyKg: avail > 0 ? String(Math.round(avail)) : '',
      bagCount: avail > 0 && bagW > 0 ? String(Math.round(avail / bagW)) : '',
      vehicleNo: '', driverName: '', dispatchDate: new Date().toISOString().split('T')[0], notes: '',
    });
    setLot(l);
  }

  function submit(e) {
    e.preventDefault();
    const qtyKg = num(form.qtyKg);
    if (qtyKg <= 0) { addToast('Enter a dispatch quantity', 'error'); return; }
    if (qtyKg - num(lot.available_qty) > 0.001) { addToast(`Only ${kg(lot.available_qty)} available`, 'error'); return; }
    createMut.mutate({
      lot_id: lot.id,
      qty_kg: qtyKg,
      bag_count: form.bagCount ? parseInt(form.bagCount, 10) : null,
      vehicle_no: form.vehicleNo.trim() || null,
      driver_name: form.driverName.trim() || null,
      dispatch_date: form.dispatchDate,
      notes: form.notes.trim() || null,
    });
  }

  if (isLoading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Loading dispatch…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Mini icon={Boxes} tone="text-indigo-500" label="Produced (client)" value={kg(summary.producedKg)} />
        <Mini icon={Send} tone="text-emerald-500" label="Dispatched" value={kg(summary.dispatchedKg)} />
        <Mini icon={Package} tone="text-amber-500" label="In Service Stock" value={kg(summary.remainingKg)} />
      </div>

      {/* Client-owned lots */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Boxes size={15} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Client-Owned Stock</h2>
        </div>
        {lots.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">No client-owned output yet. Record the yield first — the milled stock will appear here to dispatch.</p>
        ) : (
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 font-semibold">Lot</th>
                <th className="px-4 py-2 font-semibold">Item</th>
                <th className="px-4 py-2 font-semibold text-right">Available</th>
                <th className="px-4 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lots.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td data-label="Lot" className="px-4 py-2.5 font-medium text-gray-900">{l.lot_no}</td>
                  <td data-label="Item" className="px-4 py-2.5 text-gray-700">
                    {l.item_name}
                    {l.type === 'byproduct' && <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">by-product</span>}
                  </td>
                  <td data-label="Available" className="px-4 py-2.5 text-right text-gray-700">{kg(l.available_qty)}</td>
                  <td data-label="Actions" className="px-4 py-2.5 text-right">
                    {num(l.available_qty) > 0 && canDispatch ? (
                      <button onClick={() => openDispatch(l)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100">
                        <Send size={12} /> Dispatch
                      </button>
                    ) : <span className="text-xs text-gray-300">{num(l.available_qty) > 0 ? '—' : 'Dispatched'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* History */}
      {dispatches.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Truck size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Dispatch History</h2>
          </div>
          <table className="w-full text-sm mobile-cards">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 font-semibold">Dispatch #</th>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Lot</th>
                <th className="px-4 py-2 font-semibold">Vehicle</th>
                <th className="px-4 py-2 font-semibold text-right">Qty</th>
                <th className="px-4 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {dispatches.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td data-label="Dispatch #" className="px-4 py-2.5 font-medium text-gray-900">{d.dispatch_no}</td>
                  <td data-label="Date" className="mob-hide px-4 py-2.5 text-gray-600">{d.dispatch_date ? new Date(d.dispatch_date).toLocaleDateString('en-GB') : '—'}</td>
                  <td data-label="Lot" className="px-4 py-2.5 text-gray-600">{d.lot_no}</td>
                  <td data-label="Vehicle" className="mob-hide px-4 py-2.5 text-gray-600">{d.vehicle_no || '—'}{d.driver_name ? <span className="text-gray-400"> · {d.driver_name}</span> : null}</td>
                  <td data-label="Qty" className="px-4 py-2.5 text-right text-gray-700">{kg(d.qty_kg)}{d.bag_count ? <span className="text-gray-400"> · {d.bag_count} bags</span> : null}</td>
                  <td data-label="Actions" className="px-4 py-2.5 text-right">
                    {canDispatch && (
                      <button onClick={() => { if (window.confirm(`Reverse dispatch ${d.dispatch_no}? Stock returns to service inventory.`)) deleteMut.mutate(d.id); }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 size={12} /> Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dispatch drawer */}
      <SlideDrawer open={!!lot} onClose={() => setLot(null)} title="Dispatch to Client" icon={Send} size="lg">
        {lot && (
          <form onSubmit={submit} className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              Handing <span className="font-semibold">{lot.item_name}</span> ({lot.lot_no}) back to the client. Available: <span className="font-semibold">{kg(lot.available_qty)}</span>. This is not a sale — no invoice or GL.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG) *</label>
                <input type="number" step="0.01" min="0" required value={form.qtyKg}
                  onChange={(e) => setForm(p => ({ ...p, qtyKg: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bags</label>
                <input type="number" step="1" min="0" value={form.bagCount}
                  onChange={(e) => setForm(p => ({ ...p, bagCount: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle / Truck No</label>
                <input type="text" value={form.vehicleNo}
                  onChange={(e) => setForm(p => ({ ...p, vehicleNo: e.target.value }))}
                  placeholder="e.g. ABC-1234"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                <input type="text" value={form.driverName}
                  onChange={(e) => setForm(p => ({ ...p, driverName: e.target.value }))}
                  placeholder="e.g. Muhammad Ali"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
                <input type="date" value={form.dispatchDate}
                  onChange={(e) => setForm(p => ({ ...p, dispatchDate: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input type="text" value={form.notes}
                  onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g. Gate pass #123"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setLot(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button type="submit" disabled={createMut.isLoading} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                <Send size={16} /> Record Dispatch
              </button>
            </div>
          </form>
        )}
      </SlideDrawer>
    </div>
  );
}

function Mini({ icon: Icon, tone, label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <Icon size={15} className={tone} />
      </div>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
