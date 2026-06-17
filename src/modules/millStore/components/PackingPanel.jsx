import { useMemo, useState } from 'react';
import { Boxes, Package, Plus, Loader2 } from 'lucide-react';
import { usePackingHistory, usePackBatch, useMillStoreItems } from '../api/queries';

const num = (v) => Number(v) || 0;
const fmtKg = (v) => `${num(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;

// Bag the finished rice of a milling batch. Consuming N bags of a packaging item
// deducts store stock and records the packed (net), tare and gross weight.
export default function PackingPanel({ batchId, batchStatus, addToast }) {
  const { data = {}, isLoading } = usePackingHistory(batchId);
  const { data: bagItems = [] } = useMillStoreItems({ category: 'packaging', limit: 200 });
  const pack = usePackBatch();

  const [bagItemId, setBagItemId] = useState('');
  const [bags, setBags] = useState('');

  const logs = data.logs || [];
  const finishedKg = num(data.finishedKg);
  const packedKg = num(data.packedKg);
  const remainingKg = num(data.remainingKg);

  const selected = useMemo(() => bagItems.find((b) => String(b.id) === String(bagItemId)), [bagItems, bagItemId]);
  const capacity = num(selected?.capacity_kg);
  const tare = num(selected?.tare_weight_kg);
  const available = num(selected?.quantity_available);
  const bagsN = num(bags);
  const projPacked = bagsN * capacity;
  const projTare = bagsN * tare;

  const canPack =
    !!selected && capacity > 0 && bagsN > 0 && bagsN <= available && batchStatus !== 'Closed';

  async function submit() {
    try {
      await pack.mutateAsync({ batchId, data: { bag_item_id: Number(bagItemId), bags_count: bagsN } });
      addToast?.('Packed — bags deducted, weight recorded', 'success');
      setBags('');
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to pack', 'error');
    }
  }

  if (isLoading) return <div className="text-sm text-gray-400 py-8 text-center">Loading packing…</div>;

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Finished produced" value={fmtKg(finishedKg)} />
        <Stat label="Packed" value={fmtKg(packedKg)} tone="blue" />
        <Stat label="Remaining" value={fmtKg(remainingKg)} tone={remainingKg > 0.5 ? 'amber' : 'green'} />
        <Stat label="Bags used" value={String(num(data.totalBags))} />
      </div>

      {/* Pack form */}
      {batchStatus === 'Closed' ? (
        <p className="text-xs text-gray-400">Batch is closed — packing is locked.</p>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
            <Boxes size={16} className="text-blue-600" /> Pack into bags
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bag type</label>
              <select value={bagItemId} onChange={(e) => setBagItemId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Select a bag…</option>
                {bagItems.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.capacity_kg ? `(${Number(b.capacity_kg)}kg)` : '(no capacity set)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Number of bags</label>
              <input type="number" min="0" step="1" value={bags} onChange={(e) => setBags(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0" />
            </div>
            <div className="flex items-end">
              <button onClick={submit} disabled={!canPack || pack.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {pack.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Pack
              </button>
            </div>
          </div>

          {selected && (
            <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-x-5 gap-y-1">
              <span>In stock: <b>{available}</b> {selected.unit}</span>
              <span>Capacity: <b>{capacity || '—'}</b> kg/bag</span>
              <span>Tare: <b>{tare || '—'}</b> kg/bag</span>
              {bagsN > 0 && capacity > 0 && (
                <span className="text-gray-900">→ packs <b>{fmtKg(projPacked)}</b> net{tare > 0 ? `, ${fmtKg(projTare)} tare, ${fmtKg(projPacked + projTare)} gross` : ''}</span>
              )}
              {selected && capacity <= 0 && <span className="text-amber-600">Set this bag's capacity in Mill Store first.</span>}
              {bagsN > available && <span className="text-red-600">Not enough bags in stock.</span>}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Packing history</p>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No packing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                  <th className="text-left py-2 px-3">Date</th>
                  <th className="text-left py-2 px-3">Bag</th>
                  <th className="text-right py-2 px-3">Bags</th>
                  <th className="text-right py-2 px-3">Net</th>
                  <th className="text-right py-2 px-3">Tare</th>
                  <th className="text-right py-2 px-3">Gross</th>
                  <th className="text-left py-2 px-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-600">{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</td>
                    <td className="py-2 px-3 text-gray-900 inline-flex items-center gap-1.5"><Package size={13} className="text-gray-400" />{l.bag_item_name || l.bag_item_code || '—'}</td>
                    <td className="py-2 px-3 text-right font-medium">{num(l.bags_count)}</td>
                    <td className="py-2 px-3 text-right">{fmtKg(l.packed_weight_kg)}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{fmtKg(l.tare_weight_kg)}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmtKg(l.gross_weight_kg)}</td>
                    <td className="py-2 px-3 text-gray-600">{l.packed_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'gray' }) {
  const tones = { gray: 'text-gray-900', blue: 'text-blue-600', amber: 'text-amber-600', green: 'text-emerald-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
      <div className={`text-lg font-bold mt-1 ${tones[tone]}`}>{value}</div>
    </div>
  );
}
