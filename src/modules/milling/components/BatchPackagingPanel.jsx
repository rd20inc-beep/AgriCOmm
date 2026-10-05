import React, { useMemo, useState, useEffect } from 'react';
import { Boxes, Plus, Trash2, Loader2, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../api/client';
import { useMillStoreItems } from '../../millStore/api/queries';
import useCanSeeCost from '../../../hooks/useCanSeeCost';

// Packaging recorded ON the batch, line by line.
//
// A batch could only ever state one bag size, so "300 katta and 500 P.P. bags"
// could not be said at all. Each line names a real packaging item from Mill
// Store, so its type decides which stock it moves and its own price decides what
// it costs — a 25 kg P.P. bag can no longer be taken for a 25 kg katta.
//
//   Received  the empty bags that come free as the rice is milled out of them.
//             They go INTO store stock, and their cost leaves this batch.
//   Used      bags drawn from store to pack this batch's output. Katta spent on
//             by-products comes back INTO the batch's cost.

const num = (v) => Number(parseFloat(v) || 0);
const rs = (v) => `Rs ${num(v).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABEL = {
  katta: 'Katta', pp_bag: 'P.P. Bag', master_bag: 'Master Bag', polythene: 'Polythene', other: 'Other',
};
// The order the mill thinks in: what the rice arrived in, then what it leaves in.
const TYPE_ORDER = ['katta', 'pp_bag', 'master_bag', 'polythene', 'other'];
// Only a katta or a P.P. bag can be RECEIVED. A master bag and a polythene sheet
// are bought into store and only ever used — nothing frees them, because no rice
// arrives in them. Offering them under Received would add stock nobody bought
// and credit its cost against the batch, inventing both.
const RECEIVABLE_TYPES = ['katta', 'pp_bag'];

const inputCls = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none';

const sizeOf = (it) => {
  const v = parseFloat(it.size_value);
  if (!Number.isFinite(v) || v <= 0) return '';
  const n = Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  return `${n} ${it.size_unit === 'lb' ? 'LBS' : 'KG'}`;
};

export default function BatchPackagingPanel({ batchId, batchStatus, addToast }) {
  // Packaging cost (Rs / unit, line cost, effect on batch cost) is hidden from
  // roles without reports.view_cost; a blank unit cost falls back to the store
  // average on the server, as it always has.
  const showCost = useCanSeeCost();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['batch-packaging', batchId],
    queryFn: async () => (await api.get(`/api/milling/batches/${batchId}/packaging`))?.data || { lines: [], adjustments: {} },
    enabled: !!batchId,
  });
  // Only packaging items can go on a packaging line. Via the shared hook rather
  // than a fresh fetch, so the response shape is unwrapped the one way the rest
  // of the app already does it.
  const { data: items = [] } = useMillStoreItems({ category: 'packaging', limit: 300 });

  const save = useMutation({
    mutationFn: (lines) => api.put(`/api/milling/batches/${batchId}/packaging`, { lines }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch-packaging', batchId] });
      qc.invalidateQueries({ queryKey: ['milling', 'batch', batchId] });
      // Store stock moved, so anything showing it is now stale.
      // Store stock moved, so every view of it is stale. Every storeKeys entry
      // is prefixed 'mill-store', so this one prefix covers items and stock.
      qc.invalidateQueries({ queryKey: ['mill-store'] });
    },
  });

  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  // Load the saved lines once, and again whenever a save brings fresh ones back.
  useEffect(() => {
    if (!data?.lines) return;
    setRows(data.lines.map((l) => ({
      mill_item_id: String(l.mill_item_id),
      direction: l.direction,
      output_type: l.output_type || '',
      quantity: String(num(l.quantity)),
      unit_cost_pkr: l.unitCostPkr == null ? '' : String(l.unitCostPkr),
    })));
    setDirty(false);
  }, [data?.lines]);

  const locked = batchStatus === 'Cancelled' || batchStatus === 'Rejected';
  const itemById = useMemo(() => Object.fromEntries((items || []).map((i) => [String(i.id), i])), [items]);

  // Grouped so the picker reads as the mill thinks, not as one long list.
  const grouped = useMemo(() => {
    const by = {};
    for (const it of items || []) {
      const t = TYPE_ORDER.includes(it.pack_type) ? it.pack_type : 'other';
      (by[t] ||= []).push(it);
    }
    for (const t of Object.keys(by)) by[t].sort((a, b) => (num(a.size_value) - num(b.size_value)) || String(a.name).localeCompare(b.name));
    return by;
  }, [items]);

  const set = (idx, patch) => { setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); setDirty(true); };
  const addRow = (direction) => { setRows((r) => [...r, { mill_item_id: '', direction, output_type: direction === 'consumed' ? 'finished' : '', quantity: '', unit_cost_pkr: '' }]); setDirty(true); };
  const removeRow = (idx) => { setRows((r) => r.filter((_, i) => i !== idx)); setDirty(true); };

  // What each line costs, at the item's current price unless one was typed over.
  const lineCost = (r) => {
    const it = itemById[r.mill_item_id];
    const unit = r.unit_cost_pkr !== '' ? num(r.unit_cost_pkr) : num(it?.avg_cost_per_unit);
    return num(r.quantity) * unit;
  };

  const received = rows.filter((r) => r.direction === 'received');
  const consumed = rows.filter((r) => r.direction === 'consumed');
  const receivedCost = received.reduce((s, r) => s + lineCost(r), 0);
  // Only katta on BY-PRODUCTS comes back into the cost — bags on the finished
  // rice are part of what was packed and sold.
  const byproductKattaCost = consumed
    .filter((r) => itemById[r.mill_item_id]?.pack_type === 'katta' && r.output_type === 'byproduct')
    .reduce((s, r) => s + lineCost(r), 0);
  const netAdjustment = byproductKattaCost - receivedCost;

  const problems = rows
    .map((r, i) => {
      if (!r.mill_item_id) return `Line ${i + 1}: choose a packaging item.`;
      if (!(num(r.quantity) > 0)) return `Line ${i + 1}: enter how many.`;
      if (r.direction === 'received' && r.output_type) return `Line ${i + 1}: a received line is not against an output.`;
      if (r.direction === 'received' && !RECEIVABLE_TYPES.includes(itemById[r.mill_item_id]?.pack_type)) {
        return `Line ${i + 1}: ${itemById[r.mill_item_id]?.name || 'that item'} cannot be received — nothing frees it. Record it as used instead.`;
      }
      return null;
    })
    .filter(Boolean);
  // One line per item per direction per output, or an edit would stack duplicates.
  const keys = rows.map((r) => `${r.mill_item_id}|${r.direction}|${r.output_type}`);
  const dupe = keys.find((k, i) => k.split('|')[0] && keys.indexOf(k) !== i);
  if (dupe) problems.push('The same item appears twice for the same purpose — combine those lines.');

  async function submit() {
    try {
      await save.mutateAsync(rows.map((r) => ({
        mill_item_id: Number(r.mill_item_id),
        direction: r.direction,
        quantity: num(r.quantity),
        output_type: r.direction === 'consumed' ? (r.output_type || null) : null,
        ...(r.unit_cost_pkr !== '' ? { unit_cost_pkr: num(r.unit_cost_pkr) } : {}),
      })));
      addToast?.('Packaging saved — store stock updated', 'success');
    } catch (err) {
      addToast?.(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to save packaging', 'error');
    }
  }

  const picker = (idx, r) => (
    <select value={r.mill_item_id} onChange={(e) => set(idx, { mill_item_id: e.target.value, unit_cost_pkr: '' })} className={inputCls}>
      <option value="">Select packaging…</option>
      {TYPE_ORDER
        .filter((t) => (r.direction === 'received' ? RECEIVABLE_TYPES.includes(t) : true))
        .filter((t) => grouped[t]?.length).map((t) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {grouped[t].map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}{sizeOf(it) ? ` — ${sizeOf(it)}` : ''}{!showCost ? '' : num(it.avg_cost_per_unit) > 0 ? ` (${rs(it.avg_cost_per_unit)})` : ' (no price set)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  const table = (direction, list) => (
    <div className="overflow-x-auto mobile-cards">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase text-gray-500">
            <th className="py-1 pr-2 w-[38%]">Packaging</th>
            <th className="py-1 pr-2">Type</th>
            {direction === 'consumed' && <th className="py-1 pr-2">Used on</th>}
            <th className="py-1 pr-2 text-right">Qty</th>
            {showCost && <th className="py-1 pr-2 text-right">Rs / unit</th>}
            {showCost && <th className="py-1 pr-2 text-right">Cost</th>}
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={(direction === 'consumed' ? 7 : 6) - (showCost ? 0 : 2)} className="colspan-empty py-2 text-xs text-gray-400">
              {direction === 'received'
                ? 'Nothing recorded. Add the katta and P.P. bags this batch freed — they go into store stock.'
                : 'Nothing recorded. Add the bags, masters and polythene drawn from store to pack this batch.'}
            </td></tr>
          )}
          {list.map((r) => {
            const idx = rows.indexOf(r);
            const it = itemById[r.mill_item_id];
            return (
              <tr key={idx} className="border-t border-gray-100">
                <td data-label="Packaging" className="py-1.5 pr-2">{picker(idx, r)}</td>
                <td data-label="Type" className="py-1.5 pr-2 text-gray-600">
                  {it ? TYPE_LABEL[it.pack_type] || 'Other' : '—'}
                  {it && sizeOf(it) && <span className="block text-[11px] text-gray-400">{sizeOf(it)}</span>}
                </td>
                {direction === 'consumed' && (
                  <td data-label="Used on" className="py-1.5 pr-2">
                    <select value={r.output_type} onChange={(e) => set(idx, { output_type: e.target.value })} className={inputCls}>
                      <option value="finished">Finished rice</option>
                      <option value="byproduct">By-products</option>
                    </select>
                  </td>
                )}
                <td data-label="Qty" className="py-1.5 pr-2">
                  <input type="number" min="0" step="1" value={r.quantity} onChange={(e) => set(idx, { quantity: e.target.value })} className={`${inputCls} text-right`} />
                </td>
                {showCost && <td data-label="Rs / unit" className="py-1.5 pr-2">
                  <input type="number" min="0" step="0.01" value={r.unit_cost_pkr}
                    placeholder={it ? String(num(it.avg_cost_per_unit)) : ''}
                    onChange={(e) => set(idx, { unit_cost_pkr: e.target.value })} className={`${inputCls} text-right`} />
                </td>}
                {showCost && <td data-label="Cost" className="py-1.5 pr-2 text-right font-medium text-gray-900">{rs(lineCost(r))}</td>}
                <td className="py-1.5 text-right">
                  <button onClick={() => removeRow(idx)} disabled={locked} className="text-gray-400 hover:text-red-600 disabled:opacity-40" title="Remove this line">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (isLoading) return <div className="text-sm text-gray-400 py-8 text-center">Loading packaging…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Boxes className="w-4 h-4 text-blue-600" /> Packaging on this batch</h3>
          <p className="text-xs text-gray-500 mt-1 leading-snug max-w-2xl">
            Each line names a real item from Mill Store, so katta, P.P. bags and master bags keep
            their own stock and their own price. Saving moves store stock by the change only, so
            correcting a figure posts the difference rather than counting it twice.
          </p>
        </div>
        <button onClick={submit} disabled={locked || !dirty || problems.length > 0 || save.isPending}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
      </div>

      {problems.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs text-amber-900">
          {problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      )}

      <div className="border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Received — katta &amp; P.P. bags freed into store</h4>
          <button onClick={() => addRow('received')} disabled={locked} className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {table('received', received)}
      </div>

      <div className="border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Used — drawn from store to pack</h4>
          <button onClick={() => addRow('consumed')} disabled={locked} className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {table('consumed', consumed)}
      </div>

      {/* What this does to the batch's expenses, spelled out — the formula is
          easy to get backwards, so the arithmetic is shown rather than implied. */}
      {showCost && (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Effect on this batch&rsquo;s cost</h4>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-600">Less: katta &amp; P.P. bags freed into store</span><span className="font-medium text-emerald-700">− {rs(receivedCost)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Add: katta used on by-products</span><span className="font-medium text-red-600">+ {rs(byproductKattaCost)}</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
            <span className="text-gray-700">Net adjustment</span>
            <span className={netAdjustment < 0 ? 'text-emerald-700' : 'text-red-600'}>{netAdjustment < 0 ? '−' : '+'} {rs(Math.abs(netAdjustment))}</span>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2 leading-snug">
          Katta and P.P. bags freed are stock the mill now holds, so their cost leaves this batch.
          Katta spent bagging by-products is gone, so it stays in. Bags used on the finished rice
          are part of what was packed and are already in the packing cost. Masters and polythene are
          only ever used, never freed, so they are not credited here.
        </p>
      </div>
      )}
    </div>
  );
}
