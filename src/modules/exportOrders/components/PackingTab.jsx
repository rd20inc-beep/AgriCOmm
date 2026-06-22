import { useState } from 'react';
import { Package, Edit3, Save, X, Plus, Trash2 } from 'lucide-react';
import api from '../../../api/client';

const BAG_TYPE_OPTIONS = ['PP Bag', 'BOPP Bag', 'Jute Bag', 'Non-Woven', 'Paper Bag', 'Custom'];

// Map an order item (camelCase from transformOrder, or raw snake_case) to a full
// export_order_items row. The order-update endpoint DELETES + re-inserts items,
// so every field must be sent or it would be lost on save.
function itemToPayload(it) {
  return {
    product_id: it.productId ?? it.product_id ?? null,
    product_name: it.productName || it.product_name || null,
    qty_mt: it.qtyMT ?? it.qty_mt ?? 0,
    price_per_mt: it.pricePerMT ?? it.price_per_mt ?? 0,
    hs_code: it.hsCode || it.hs_code || null,
    packing: it.packing || null,
    bag_size_kg: it.bagSizeKg ?? it.bag_size_kg ?? null,
    bag_count: it.bagCount ?? it.bag_count ?? null,
    bag_type: it.bagType || it.bag_type || null,
    bag_quality: it.bagQuality || it.bag_quality || null,
    bag_brand: it.bagBrand || it.bag_brand || null,
    bag_color: it.bagColor || it.bag_color || null,
    bag_printing: it.bagPrinting || it.bag_printing || null,
    master_bag_size_kg: it.masterBagSizeKg ?? it.master_bag_size_kg ?? null,
    master_bag_type: it.masterBagType || it.master_bag_type || null,
    quality_description: it.qualityDescription || it.quality_description || null,
    broken_pct_target: it.brokenPctTarget ?? it.broken_pct_target ?? null,
    notes: it.notes || null,
  };
}

export default function PackingTab({ order, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const bagSpec = {
    type: order.bagType || order.bag_type || '',
    quality: order.bagQuality || order.bag_quality || '',
    sizeKg: order.bagSizeKg || order.bag_size_kg || '',
    weightGm: order.bagWeightGm || order.bag_weight_gm || '',
    printing: order.bagPrinting || order.bag_printing || '',
    color: order.bagColor || order.bag_color || '',
    brand: order.bagBrand || order.bag_brand || '',
  };
  const receivingMode = order.receivingMode || order.receiving_mode || '';
  const totalBags = order.totalBags || order.total_bags || 0;
  const packingNotes = order.packingNotes || order.packing_notes || '';
  const packingLines = order.packingLines || order.packing_lines || [];
  // Per-item packing (multi-product P.I.) — each line can carry its own bag.
  const items = order.items || [];
  const itemBag = (it) => ({
    type: it.bagType || it.bag_type || '',
    sizeKg: it.bagSizeKg || it.bag_size_kg || '',
    brand: it.bagBrand || it.bag_brand || '',
    masterKg: it.masterBagSizeKg || it.master_bag_size_kg || '',
    product: it.productName || it.product_name || '',
    lineNo: it.lineNo || it.line_no || '',
  });
  const hasItemPacking = items.length > 1 && items.some((it) => {
    const b = itemBag(it); return b.type || b.sizeKg || b.brand;
  });

  function startEdit() {
    setForm({
      bag_type: bagSpec.type, bag_quality: bagSpec.quality,
      bag_size_kg: bagSpec.sizeKg, bag_weight_gm: bagSpec.weightGm,
      bag_printing: bagSpec.printing, bag_color: bagSpec.color, bag_brand: bagSpec.brand,
      receiving_mode: receivingMode, packing_notes: packingNotes,
      packing_lines: packingLines.length > 0
        ? packingLines.map(l => ({ bag_type: l.bagType || l.bag_type || '', bag_quality: l.bagQuality || l.bag_quality || '', fill_weight_kg: l.fillWeightKg || l.fill_weight_kg || 25, bag_count: l.bagCount || l.bag_count || '', bag_printing: l.bagPrinting || l.bag_printing || '', notes: l.notes || '' }))
        : [],
      // Full per-item rows so editing one field (bag type) doesn't drop the rest
      // on the delete+reinsert update. Omitted entirely when there are no items
      // (single-product order) so the endpoint keeps its single-product path.
      items: items.length > 0 ? items.map(itemToPayload) : undefined,
    });
    setEditing(true);
  }

  function updateItem(idx, field, value) {
    setForm(f => ({ ...f, items: f.items.map((r, i) => i === idx ? { ...r, [field]: value } : r) }));
  }

  function addLine() {
    setForm({ ...form, packing_lines: [...form.packing_lines, { bag_type: '', bag_quality: '', fill_weight_kg: 25, bag_count: '', bag_printing: '', notes: '' }] });
  }

  function removeLine(idx) {
    setForm({ ...form, packing_lines: form.packing_lines.filter((_, i) => i !== idx) });
  }

  function updateLine(idx, field, value) {
    const lines = [...form.packing_lines];
    lines[idx] = { ...lines[idx], [field]: value };
    setForm({ ...form, packing_lines: lines });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/api/export-orders/${order.id}`, form);
      setEditing(false);
      onUpdated?.();
    } catch (err) {
      console.error('Save packing error:', err);
    }
    setSaving(false);
  }

  const hasBagSpec = bagSpec.type || bagSpec.sizeKg || bagSpec.printing;
  const hasLines = packingLines.length > 0;
  const isEmpty = !hasBagSpec && !hasLines && !hasItemPacking && !receivingMode && !packingNotes;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Package size={20} className="text-blue-600" /> Packing Specification
        </h3>
        {!editing && (
          <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">
            <Edit3 size={14} /> {isEmpty ? 'Add Packing Details' : 'Edit'}
          </button>
        )}
      </div>

      {/* View Mode */}
      {!editing && (
        <>
          {isEmpty ? (
            <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center">
              <Package size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">No packing details specified yet</p>
              <button onClick={startEdit} className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Packing Details</button>
            </div>
          ) : (
            <>
              {/* Bag Specification Card */}
              {hasBagSpec && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Bag Specification</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {bagSpec.type && <div><p className="text-xs text-gray-500">Bag Type</p><p className="text-sm font-medium">{bagSpec.type}</p></div>}
                    {bagSpec.quality && <div><p className="text-xs text-gray-500">Quality</p><p className="text-sm font-medium">{bagSpec.quality}</p></div>}
                    {bagSpec.sizeKg && <div><p className="text-xs text-gray-500">Size</p><p className="text-sm font-medium">{bagSpec.sizeKg} KG</p></div>}
                    {bagSpec.weightGm && <div><p className="text-xs text-gray-500">Bag Weight</p><p className="text-sm font-medium">{bagSpec.weightGm} gm</p></div>}
                    {bagSpec.printing && <div><p className="text-xs text-gray-500">Printing</p><p className="text-sm font-medium">{bagSpec.printing}</p></div>}
                    {bagSpec.color && <div><p className="text-xs text-gray-500">Color</p><p className="text-sm font-medium">{bagSpec.color}</p></div>}
                    {bagSpec.brand && <div><p className="text-xs text-gray-500">Brand / Mark</p><p className="text-sm font-medium">{bagSpec.brand}</p></div>}
                    {receivingMode && <div><p className="text-xs text-gray-500">Receiving Mode</p><p className="text-sm font-medium capitalize">{receivingMode}</p></div>}
                    {totalBags > 0 && <div><p className="text-xs text-gray-500">Total Bags</p><p className="text-sm font-medium">{totalBags.toLocaleString()}</p></div>}
                  </div>
                </div>
              )}

              {/* Per-item Packing (multi-product orders) */}
              {hasItemPacking && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <h4 className="text-sm font-semibold text-gray-700">Per-item Packing ({items.length})</h4>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                        <th className="px-4 py-2 text-left">#</th>
                        <th className="px-4 py-2 text-left">Product</th>
                        <th className="px-4 py-2 text-left">Bag Type</th>
                        <th className="px-4 py-2 text-left">Bag Size</th>
                        <th className="px-4 py-2 text-left">Brand / Marking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => {
                        const b = itemBag(it);
                        return (
                          <tr key={it.id || i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-sm text-gray-500">{b.lineNo || i + 1}</td>
                            <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{b.product || '—'}</td>
                            <td className="px-4 py-2.5 text-sm">{b.type || '—'}</td>
                            <td className="px-4 py-2.5 text-sm whitespace-nowrap">
                              {b.sizeKg ? `${b.sizeKg} KG` : '—'}
                              {b.masterKg ? <span className="text-amber-700"> · master {b.masterKg} KG</span> : ''}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-gray-700">{b.brand || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Packing Lines Table */}
              {hasLines && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <h4 className="text-sm font-semibold text-gray-700">Packing Lines ({packingLines.length})</h4>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                        <th className="px-4 py-2 text-left">#</th>
                        <th className="px-4 py-2 text-left">Bag Type</th>
                        <th className="px-4 py-2 text-left">Quality</th>
                        <th className="px-4 py-2 text-right">Fill (KG)</th>
                        <th className="px-4 py-2 text-right">Bags</th>
                        <th className="px-4 py-2 text-right">Total (KG)</th>
                        <th className="px-4 py-2 text-left">Printing</th>
                        <th className="px-4 py-2 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packingLines.map((line, i) => (
                        <tr key={line.id || i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-sm text-gray-500">{line.lineNo || line.line_no || i + 1}</td>
                          <td className="px-4 py-2.5 text-sm font-medium">{line.bagType || line.bag_type || '—'}</td>
                          <td className="px-4 py-2.5 text-sm">{line.bagQuality || line.bag_quality || '—'}</td>
                          <td className="px-4 py-2.5 text-sm text-right tabular-nums">{line.fillWeightKg || line.fill_weight_kg || '—'}</td>
                          <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">{(line.bagCount || line.bag_count || 0).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-sm text-right tabular-nums">{((parseFloat(line.fillWeightKg || line.fill_weight_kg || 0)) * (parseInt(line.bagCount || line.bag_count || 0))).toLocaleString()} KG</td>
                          <td className="px-4 py-2.5 text-sm">{line.bagPrinting || line.bag_printing || '—'}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-500">{line.notes || '—'}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold text-sm">
                        <td colSpan={4} className="px-4 py-2 text-right">Total</td>
                        <td className="px-4 py-2 text-right tabular-nums">{packingLines.reduce((s, l) => s + (parseInt(l.bagCount || l.bag_count || 0)), 0).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{packingLines.reduce((s, l) => s + (parseFloat(l.fillWeightKg || l.fill_weight_kg || 0) * parseInt(l.bagCount || l.bag_count || 0)), 0).toLocaleString()} KG</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Packing Notes */}
              {packingNotes && (
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Packing Notes</p>
                  <p className="text-sm text-amber-800">{packingNotes}</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Edit Mode */}
      {editing && form && (
        <div className="space-y-4">
          {/* Bag Spec Fields */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">Bag Specification</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Bag Type</label>
                <select value={form.bag_type} onChange={e => setForm({ ...form, bag_type: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">Select...</option>
                  <option value="PP Bag">PP Bag</option>
                  <option value="BOPP Bag">BOPP Bag</option>
                  <option value="Jute Bag">Jute Bag</option>
                  <option value="Non-Woven">Non-Woven</option>
                  <option value="Paper Bag">Paper Bag</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Quality</label>
                <select value={form.bag_quality} onChange={e => setForm({ ...form, bag_quality: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">Select...</option>
                  <option value="New">New</option>
                  <option value="A-Grade">A-Grade</option>
                  <option value="B-Grade">B-Grade</option>
                  <option value="Recycled">Recycled</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Size (KG)</label>
                <input type="number" value={form.bag_size_kg} onChange={e => setForm({ ...form, bag_size_kg: e.target.value })}
                  placeholder="25" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Bag Weight (gm)</label>
                <input type="number" value={form.bag_weight_gm} onChange={e => setForm({ ...form, bag_weight_gm: e.target.value })}
                  placeholder="120" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Printing</label>
                <input type="text" value={form.bag_printing} onChange={e => setForm({ ...form, bag_printing: e.target.value })}
                  placeholder="Buyer logo + text" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Color</label>
                <input type="text" value={form.bag_color} onChange={e => setForm({ ...form, bag_color: e.target.value })}
                  placeholder="White" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Brand / Mark</label>
                <input type="text" value={form.bag_brand} onChange={e => setForm({ ...form, bag_brand: e.target.value })}
                  placeholder="GOLDEN RICE" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Receiving Mode</label>
                <select value={form.receiving_mode} onChange={e => setForm({ ...form, receiving_mode: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                  <option value="">Select...</option>
                  <option value="bags">Bags</option>
                  <option value="loose">Loose</option>
                  <option value="mixed">Mixed</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Packing Notes</label>
              <textarea value={form.packing_notes} onChange={e => setForm({ ...form, packing_notes: e.target.value })}
                rows={2} placeholder="Special packing instructions..."
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>

          {/* Per-item Bag Type — operator picks the bag type for each P.I. line */}
          {form.items && form.items.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700">Per-item Bag Type</h4>
              <p className="text-xs text-gray-500">Choose the bag type for each line. Size & master bag are shown for context.</p>
              <div className="space-y-2">
                {form.items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5 text-sm text-gray-800 truncate">{it.product_name || `Item ${i + 1}`}</div>
                    <div className="col-span-3 text-xs text-gray-500">
                      {it.bag_size_kg ? `${it.bag_size_kg} KG` : '—'}{it.master_bag_size_kg ? ` · master ${it.master_bag_size_kg} KG` : ''}
                    </div>
                    <div className="col-span-4">
                      <select value={it.bag_type || ''} onChange={e => updateItem(i, 'bag_type', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                        <option value="">Select bag type…</option>
                        {BAG_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Packing Lines Editor */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">Packing Lines</h4>
              <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                <Plus size={13} /> Add Line
              </button>
            </div>
            {form.packing_lines.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-3">No packing lines. Click "Add Line" for mixed packing.</p>
            )}
            {form.packing_lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-6 gap-2 items-end bg-gray-50 rounded-lg p-3">
                <div>
                  <label className="text-[10px] text-gray-500">Bag Type</label>
                  <input type="text" value={line.bag_type} onChange={e => updateLine(idx, 'bag_type', e.target.value)}
                    placeholder="PP" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Quality</label>
                  <input type="text" value={line.bag_quality} onChange={e => updateLine(idx, 'bag_quality', e.target.value)}
                    placeholder="New" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Fill KG</label>
                  <input type="number" value={line.fill_weight_kg} onChange={e => updateLine(idx, 'fill_weight_kg', e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Bag Count</label>
                  <input type="number" value={line.bag_count} onChange={e => updateLine(idx, 'bag_count', e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Printing</label>
                  <input type="text" value={line.bag_printing} onChange={e => updateLine(idx, 'bag_printing', e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                </div>
                <button type="button" onClick={() => removeLine(idx)} className="p-1 text-red-400 hover:text-red-600 self-end mb-0.5">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving...' : 'Save Packing'}
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
