import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import Drawer from '../../../components/Drawer';
import RiceTypePicker from '../../../components/RiceTypePicker';
import { useProducts } from '../../../api/queries';
import { lotInventoryApi } from '../api/services';

// Extended quality percentages stored in inventory_lots.quality_json. Keys match
// the backend sanitizeLotQuality whitelist exactly.
const AGGREGATE = [
  ['moisture', 'Moisture %'],
  ['broken', 'Broken %'],
  ['foreign_matter', 'Foreign matter %'],
  ['chalky', 'Chalky %'],
  ['purity', 'Purity %'],
];
const GRADES = [
  ['b1', 'B1 %'], ['b2', 'B2 %'], ['b3', 'B3 %'], ['csr', 'CSR %'],
  ['short_grain', 'Short Grain %'], ['cobba', 'Cobba %'], ['nb', 'N.B %'], ['ov', 'O.V %'],
];

/**
 * Correct a lot's recorded quality after creation. Quality is an analysis
 * record (not a cost input), so this never touches landed cost or stock.
 */
export default function QualityEditModal({ isOpen, lot, onClose, onSuccess, addToast, canEditRiceType = false }) {
  const qj = lot?.qualityJson || {};
  // Rice type is editable only for a raw lot that hasn't started milling (the
  // backend enforces the same guard). Fetch products only when the picker shows.
  const { data: products = [] } = useProducts({}, { enabled: !!canEditRiceType });
  const init = (k) => {
    const v = qj[k] ?? (k === 'moisture' ? lot?.moisturePct : k === 'broken' ? lot?.brokenPct : undefined);
    return v == null ? '' : String(v);
  };
  const grainInit = qj.grain_size ?? qj.grainSize;
  const [form, setForm] = useState({
    product_id: lot?.productId ? String(lot.productId) : '',
    variety: lot?.variety || '',
    grade: lot?.grade || '',
    sortex_status: lot?.sortexStatus || '',
    whiteness: lot?.whiteness || '',
    grain_size: grainInit == null ? '' : String(grainInit),
    bag_quality: lot?.bagQuality || '',
    quality_notes: lot?.qualityNotes || '',
    quality: [...AGGREGATE, ...GRADES].reduce((a, [k]) => ({ ...a, [k]: init(k) }), {}),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setQ = (k, v) => setForm((p) => ({ ...p, quality: { ...p.quality, [k]: v } }));

  async function save() {
    setSaving(true);
    try {
      const quality = {};
      for (const [k] of [...AGGREGATE, ...GRADES]) {
        const v = form.quality[k];
        if (v !== '' && v != null && !Number.isNaN(parseFloat(v))) quality[k] = parseFloat(v);
      }
      // Grain length (mm) is stored in quality_json.grain_size (whitelisted).
      if (form.grain_size !== '' && form.grain_size != null && !Number.isNaN(parseFloat(form.grain_size))) {
        quality.grain_size = parseFloat(form.grain_size);
      }
      await lotInventoryApi.updateLotQuality(lot.id, {
        // Only send the rice type when it's editable AND actually chosen — the
        // backend skips it when unchanged.
        ...(canEditRiceType && form.product_id ? { product_id: parseInt(form.product_id, 10) } : {}),
        variety: form.variety || null,
        grade: form.grade || null,
        sortex_status: form.sortex_status || null,
        whiteness: form.whiteness === '' || form.whiteness == null ? null : parseFloat(form.whiteness),
        bag_quality: form.bag_quality || null,
        quality_notes: form.quality_notes || null,
        quality_json: Object.keys(quality).length ? quality : null,
      });
      addToast?.('Quality updated', 'success');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      // surface validation errors (e.g. a percentage outside 0–100)
      addToast?.(err?.response?.data?.message || err.message || 'Failed to update quality', 'error');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1';
  const numCell = ([k, label]) => (
    <div key={k}>
      <label className={lbl}>{label}</label>
      <input type="number" min="0" max="100" step="0.01" value={form.quality[k]} onChange={(e) => setQ(k, e.target.value)} className={inp} placeholder="—" />
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit quality — ${lot?.lotNo || 'lot'}`}
      subtitle="Correct the recorded analysis — never touches cost or stock"
      width="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700 inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save quality
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {canEditRiceType && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
            <RiceTypePicker
              label={<span className="text-xs font-medium text-gray-600">Rice type (product)</span>}
              value={form.product_id}
              onChange={(id) => set('product_id', id || '')}
              products={products}
              addToast={addToast}
              placeholder="Search rice type or add a new one…"
            />
            <p className="text-[11px] text-gray-500 mt-1">Change the rice type before this lot starts milling. Locked once milling begins.</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Variety</label><input value={form.variety} onChange={(e) => set('variety', e.target.value)} className={inp} placeholder="e.g. D-98" /></div>
          <div><label className={lbl}>Grade</label><input value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inp} /></div>
          <div><label className={lbl}>Sortex status</label><select value={form.sortex_status || ''} onChange={(e) => set('sortex_status', e.target.value)} className={inp}><option value="">—</option><option>Done</option><option>Pending</option><option>N/A</option></select></div>
          <div><label className={lbl}>Whiteness</label><input type="number" min="0" step="0.1" value={form.whiteness} onChange={(e) => set('whiteness', e.target.value)} className={inp} placeholder="index" /></div>
          <div><label className={lbl}>Grain length (mm)</label><input type="number" min="0" step="0.01" value={form.grain_size} onChange={(e) => set('grain_size', e.target.value)} className={inp} placeholder="mm" /></div>
          <div><label className={lbl}>Bag quality</label><input value={form.bag_quality} onChange={(e) => set('bag_quality', e.target.value)} className={inp} /></div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Aggregate</p>
          <div className="grid grid-cols-5 gap-2">{AGGREGATE.map(numCell)}</div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Broken-grade breakdown</p>
          <div className="grid grid-cols-4 gap-2">{GRADES.map(numCell)}</div>
        </div>

        <div>
          <label className={lbl}>Notes</label>
          <input value={form.quality_notes} onChange={(e) => set('quality_notes', e.target.value)} className={inp} placeholder="Optional" />
        </div>
      </div>
    </Drawer>
  );
}
