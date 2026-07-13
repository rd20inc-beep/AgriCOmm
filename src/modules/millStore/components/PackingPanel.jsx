import { useMemo, useState } from 'react';
import { Boxes, Package, Plus, Loader2, ClipboardList } from 'lucide-react';
import { usePackingHistory, usePackBatch, useMillStoreItems, useBatchKatta } from '../api/queries';
import { useExportOrder } from '../../../api/queries';

const num = (v) => Number(v) || 0;
const fmtKg = (v) => `${num(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;

// Bag the finished rice of a milling batch. Consuming N bags of a packaging item
// deducts store stock and records the packed (net), tare and gross weight.
export default function PackingPanel({ batchId, batchStatus, addToast, exportOrderId }) {
  const { data = {}, isLoading } = usePackingHistory(batchId);
  const { data: katta } = useBatchKatta(batchId);
  const { data: bagItems = [] } = useMillStoreItems({ category: 'packaging', limit: 200 });
  // When the batch is for an export order, show the buyer's packing requirement.
  const { data: exportOrder } = useExportOrder(exportOrderId || null);
  const pack = usePackBatch();

  const [bagItemId, setBagItemId] = useState('');
  const [bags, setBags] = useState('');
  // Optional outer master bag + polythene sheet (shown for small bags ≤15 kg).
  const [addMP, setAddMP] = useState(false);
  const [masterId, setMasterId] = useState('');
  const [masterQtyManual, setMasterQtyManual] = useState('');
  const [polyId, setPolyId] = useState('');
  const [polyQtyManual, setPolyQtyManual] = useState('');

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

  // Master bag + polythene: only relevant when the small bag is ≤15 kg. Master
  // qty auto = packed weight ÷ master capacity (rounded up, editable); polythene
  // auto = one per small bag (editable). Both are stocked packaging items.
  const needsMP = capacity > 0 && capacity <= 15;
  const masterSel = useMemo(() => bagItems.find((b) => String(b.id) === String(masterId)), [bagItems, masterId]);
  const masterCap = num(masterSel?.capacity_kg);
  const masterAvail = num(masterSel?.quantity_available);
  const masterAuto = masterCap > 0 ? Math.ceil(projPacked / masterCap) : 0;
  const masterQty = masterQtyManual !== '' ? num(masterQtyManual) : masterAuto;
  const masterCost = masterQty * num(masterSel?.avg_cost_per_unit);

  const polySel = useMemo(() => bagItems.find((b) => String(b.id) === String(polyId)), [bagItems, polyId]);
  const polyAvail = num(polySel?.quantity_available);
  const polyAuto = bagsN; // one sheet per small bag
  const polyQty = polyQtyManual !== '' ? num(polyQtyManual) : polyAuto;
  const polyCost = polyQty * num(polySel?.avg_cost_per_unit);

  const mpActive = needsMP && addMP;
  // Packing-material shortages are allowed (non-blocking) — consume what's in
  // stock, flag the shortfall + purchase alert. So the gate no longer blocks on
  // available stock; it only requires a valid bag + count on an open batch.
  const bagShort = bagsN > available;
  const masterShort = mpActive && masterId && masterQty > masterAvail;
  const polyShort = mpActive && polyId && polyQty > polyAvail;
  const hasShortage = bagShort || masterShort || polyShort;

  const canPack =
    !!selected && capacity > 0 && bagsN > 0 && batchStatus !== 'Closed'
    && (!mpActive || !masterId || masterQty > 0) && (!mpActive || !polyId || polyQty > 0);

  async function submit() {
    try {
      const payload = { bag_item_id: Number(bagItemId), bags_count: bagsN };
      if (mpActive && masterId && masterQty > 0) { payload.master_bag_item_id = Number(masterId); payload.master_bags_count = masterQty; }
      if (mpActive && polyId && polyQty > 0) { payload.poly_item_id = Number(polyId); payload.poly_count = polyQty; }
      const res = await pack.mutateAsync({ batchId, data: payload });
      const shortages = res?.data?.shortages || res?.shortages || [];
      if (shortages.length) {
        addToast?.(`Packed with material shortage — purchase required: ${shortages.map((s) => `${s.short} ${s.unit} ${s.item}`).join(', ')}`, 'warning');
      } else {
        addToast?.('Packed — stock deducted, weight & cost recorded', 'success');
      }
      setBags(''); setMasterQtyManual(''); setPolyQtyManual('');
    } catch (err) {
      addToast?.(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to pack', 'error');
    }
  }

  if (isLoading) return <div className="text-sm text-gray-400 py-8 text-center">Loading packing…</div>;

  return (
    <div className="space-y-5">
      {/* Katta accounting — auto at yield: empty bags freed from the milled raw
          vs katta used to pack the outputs. */}
      {katta && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Boxes size={16} className="text-amber-600" />
            <h4 className="text-sm font-semibold text-amber-900">Katta (bags){katta.capacityKg ? ` · ${katta.capacityKg} kg each` : ''}</h4>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-[11px] uppercase tracking-wide text-amber-700">Freed from raw</p><p className="text-lg font-bold text-emerald-700">+{num(katta.freed).toLocaleString()}</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-amber-700">Packed into output</p><p className="text-lg font-bold text-red-600">−{num(katta.packed).toLocaleString()}</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-amber-700">Net to store</p><p className="text-lg font-bold text-gray-900">{katta.net >= 0 ? '+' : ''}{num(katta.net).toLocaleString()}</p></div>
          </div>

          {/* Per bag size — freed / packed / net */}
          {katta.bySize?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-amber-200">
              <p className="text-[11px] uppercase tracking-wide text-amber-700 mb-1.5">By size</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-amber-700 text-left"><th className="py-1 pr-3 font-medium">Katta</th><th className="py-1 px-2 text-right font-medium">Freed</th><th className="py-1 px-2 text-right font-medium">Packed</th><th className="py-1 pl-2 text-right font-medium">In store</th></tr></thead>
                  <tbody>
                    {katta.bySize.map((s, i) => (
                      <tr key={i} className="border-t border-amber-100">
                        <td className="py-1 pr-3 font-medium text-gray-800">{s.size} kg</td>
                        <td className="py-1 px-2 text-right text-emerald-700">+{num(s.freed).toLocaleString()}</td>
                        <td className="py-1 px-2 text-right text-red-600">{s.packed > 0 ? `−${num(s.packed).toLocaleString()}` : '—'}</td>
                        <td className="py-1 pl-2 text-right font-semibold text-gray-900">{num(s.net).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Katta packed per output */}
          {katta.lots?.some((l) => l.bags > 0) && (
            <div className="mt-3 pt-3 border-t border-amber-200">
              <p className="text-[11px] uppercase tracking-wide text-amber-700 mb-1.5">Packed per output</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-800">
                {katta.lots.filter((l) => l.bags > 0).map((l, i) => (
                  <span key={i}>{l.item_name || l.lot_no}: <span className="font-semibold">{l.bags}</span>{l.sizeKg ? <span className="text-amber-600"> ×{l.sizeKg}kg</span> : null}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Buyer's packing requirement — shown when the batch is linked to an
          export order, so the operator packs to match what the buyer ordered. */}
      {exportOrder && (() => {
        const items = Array.isArray(exportOrder.items) ? exportOrder.items : [];
        const multi = items.length > 1;
        const recv = exportOrder.receivingMode || exportOrder.receiving_mode;
        const oType = exportOrder.bagType || exportOrder.bag_type;
        const oSize = exportOrder.bagSizeKg || exportOrder.bag_size_kg;
        const oBrand = exportOrder.bagBrand || exportOrder.bag_brand;
        const orderNo = exportOrder.orderNo || exportOrder.order_no || exportOrderId;
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                <ClipboardList size={16} /> Buyer's packing requirement
              </div>
              <a href={`/export/${orderNo}`} className="text-xs font-medium text-blue-600 hover:underline">{orderNo} ↗</a>
            </div>
            {(recv || exportOrder.totalBags) && (
              <p className="text-xs text-blue-800 mb-2">Receiving: <b className="capitalize">{recv || '—'}</b>{exportOrder.totalBags ? ` · ${Number(exportOrder.totalBags).toLocaleString()} bags` : ''}</p>
            )}
            {multi ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-blue-700/70 uppercase">
                      <th className="py-1 pr-3">Product</th>
                      <th className="py-1 pr-3">Bag Type</th>
                      <th className="py-1 pr-3 text-right">Bag Size</th>
                      <th className="py-1 pr-3 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const t = it.bagType || it.bag_type || oType;
                      const s = it.bagSizeKg || it.bag_size_kg || oSize;
                      const q = it.qtyMT || it.qty_mt;
                      return (
                        <tr key={it.id || i} className="border-t border-blue-100">
                          <td className="py-1 pr-3 font-medium text-blue-900">{it.productName || it.product_name || '—'}</td>
                          <td className="py-1 pr-3">{t || '—'}</td>
                          <td className="py-1 pr-3 text-right">{s ? `${s} kg` : '—'}</td>
                          <td className="py-1 pr-3 text-right">{q ? `${q} MT` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-blue-800">
                <span>Bag type: <b>{oType || '—'}</b></span>
                <span>Bag size: <b>{oSize ? `${oSize} kg` : '—'}</b></span>
                {oBrand && <span>Brand: <b>{oBrand}</b></span>}
              </div>
            )}
            <p className="text-[11px] text-blue-600/80 mt-2">Pack the finished rice to match this. Bag stock is managed in Mill Store.</p>
          </div>
        );
      })()}

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
              {bagShort && <span className="text-amber-600">Short {bagsN - available} {selected.unit} — packing allowed, purchase required.</span>}
            </div>
          )}

          {/* Master (outer) bag + polythene — small bags ≤15 kg are collected into
              a larger sack lined with a polythene sheet; their cost folds in. */}
          {needsMP && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input type="checkbox" checked={addMP} onChange={(e) => setAddMP(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600" />
                Add master bag &amp; polythene sheet
                <span className="text-xs font-normal text-gray-400">(bag is {capacity} kg ≤ 15)</span>
              </label>

              {addMP && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Master bag */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Master (outer) bag</p>
                    <select value={masterId} onChange={(e) => { setMasterId(e.target.value); setMasterQtyManual(''); }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white mb-2">
                      <option value="">Select master bag…</option>
                      {bagItems.filter((b) => String(b.id) !== String(bagItemId)).map((b) => (
                        <option key={b.id} value={b.id}>{b.name} {b.capacity_kg ? `(${Number(b.capacity_kg)}kg)` : ''}</option>
                      ))}
                    </select>
                    {masterId && (
                      <>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" step="1"
                            value={masterQtyManual !== '' ? masterQtyManual : String(masterAuto)}
                            onChange={(e) => setMasterQtyManual(e.target.value)}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                          <span className="text-xs text-gray-500">bags{masterCap > 0 ? ` · auto ${masterAuto} (${fmtKg(projPacked)} ÷ ${masterCap}kg)` : ''}</span>
                        </div>
                        <div className="mt-1.5 text-xs text-gray-500 flex flex-wrap gap-x-3">
                          <span>In stock: <b className={masterQty > masterAvail ? 'text-red-600' : ''}>{masterAvail}</b></span>
                          {num(masterSel?.avg_cost_per_unit) > 0 && <span>Cost: <b>Rs {(masterCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>}
                        </div>
                        {masterShort && <p className="text-xs text-amber-600 mt-1">Short {masterQty - masterAvail} — packing allowed, purchase required.</p>}
                      </>
                    )}
                  </div>

                  {/* Polythene sheet */}
                  <div className="bg-white border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Polythene sheet</p>
                    <select value={polyId} onChange={(e) => { setPolyId(e.target.value); setPolyQtyManual(''); }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white mb-2">
                      <option value="">Select polythene…</option>
                      {bagItems.filter((b) => String(b.id) !== String(bagItemId)).map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    {polyId && (
                      <>
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" step="1"
                            value={polyQtyManual !== '' ? polyQtyManual : String(polyAuto)}
                            onChange={(e) => setPolyQtyManual(e.target.value)}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                          <span className="text-xs text-gray-500">sheets · auto {polyAuto} (1 per bag)</span>
                        </div>
                        <div className="mt-1.5 text-xs text-gray-500 flex flex-wrap gap-x-3">
                          <span>In stock: <b className={polyQty > polyAvail ? 'text-red-600' : ''}>{polyAvail}</b></span>
                          {num(polySel?.avg_cost_per_unit) > 0 && <span>Cost: <b>Rs {(polyCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>}
                        </div>
                        {polyShort && <p className="text-xs text-amber-600 mt-1">Short {polyQty - polyAvail} — packing allowed, purchase required.</p>}
                      </>
                    )}
                  </div>
                </div>
              )}
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
                    <td className="py-2 px-3 text-gray-900">
                      <span className="inline-flex items-center gap-1.5"><Package size={13} className="text-gray-400" />{l.bag_item_name || l.bag_item_code || '—'}</span>
                      {(num(l.master_bags_count) > 0 || num(l.poly_count) > 0) && (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {num(l.master_bags_count) > 0 ? `+${num(l.master_bags_count)} ${l.master_bag_name || 'master'}` : ''}
                          {num(l.master_bags_count) > 0 && num(l.poly_count) > 0 ? ', ' : ''}
                          {num(l.poly_count) > 0 ? `${num(l.poly_count)} ${l.poly_name || 'poly'}` : ''}
                        </div>
                      )}
                    </td>
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
