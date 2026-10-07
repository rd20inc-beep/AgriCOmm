import { useMemo, useState } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { fmtKg as fmtKgBase } from '../../../shared/utils/format';

const num = (v) => Number(v) || 0;
const fmtKg = (v) => fmtKgBase(num(v), { decimals: 1 });

// Correct a recorded packing run. The server applies only the DIFFERENCE to
// store stock and to the packaging cost (signed-delta journal); katta still
// moves only through the yield reconcile.
// Remounted per open (key) so the form starts from the run every time — no
// effect copying props into state.
export default function EditPackingRunDrawer(props) {
  const { open, run } = props;
  return <RunEditor key={`${run ? run.id : 'none'}-${open ? 1 : 0}`} {...props} />;
}

function RunEditor({ open, run, bagItems = [], onClose, onSave, saving = false }) {
  const [bagItemId, setBagItemId] = useState(run?.bag_item_id ? String(run.bag_item_id) : '');
  const [bags, setBags] = useState(String(num(run?.bags_count) || ''));
  const [masterId, setMasterId] = useState(run?.master_bag_item_id ? String(run.master_bag_item_id) : '');
  const [masterQty, setMasterQty] = useState(num(run?.master_bags_count) ? String(num(run.master_bags_count)) : '');
  const [polyId, setPolyId] = useState(run?.poly_item_id ? String(run.poly_item_id) : '');
  const [polyQty, setPolyQty] = useState(num(run?.poly_count) ? String(num(run.poly_count)) : '');
  const [polyScope, setPolyScope] = useState(run?.poly_applies_to || 'bag');
  const [notes, setNotes] = useState(run?.notes || '');

  const bag = useMemo(() => bagItems.find((b) => String(b.id) === String(bagItemId)), [bagItems, bagItemId]);
  const sameBag = run && String(run.bag_item_id) === String(bagItemId);
  const capacity = sameBag ? num(run?.capacity_kg_per_bag) : num(bag?.capacity_kg);
  const bagsN = num(bags);
  const delta = bagsN - num(run?.bags_count);
  const valid = !!bagItemId && bagsN > 0 && capacity > 0
    && (!masterId || num(masterQty) > 0) && (!polyId || num(polyQty) > 0);

  function submit() {
    onSave?.({
      bag_item_id: Number(bagItemId),
      bags_count: bagsN,
      master_bag_item_id: masterId ? Number(masterId) : null,
      master_bags_count: masterId ? num(masterQty) : null,
      poly_item_id: polyId ? Number(polyId) : null,
      poly_count: polyId ? num(polyQty) : null,
      poly_applies_to: polyId ? polyScope : null,
      notes: notes.trim() || null,
    });
  }

  const select = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white';
  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

  return (
    <SlideDrawer open={open} onClose={onClose} title="Correct packing run"
      subtitle={run ? `Run #${run.id} · ${num(run.bags_count)} × ${run.bag_item_name || 'bag'}` : undefined}
      icon={Pencil} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={submit} disabled={!valid || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />} Save correction
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Bag</span>
          <select value={bagItemId} onChange={(e) => setBagItemId(e.target.value)} className={select}>
            <option value="">Select a bag…</option>
            {bagItems.map((b) => (
              <option key={b.id} value={b.id}>{b.name} {b.capacity_kg ? `(${Number(b.capacity_kg)}kg)` : '(no capacity set)'}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Number of bags</span>
          <input type="number" min="0" step="1" value={bags} onChange={(e) => setBags(e.target.value)} className={input} autoFocus />
          {bagsN > 0 && capacity > 0 && (
            <span className="block mt-1 text-xs text-gray-500">
              Packs {fmtKg(bagsN * capacity)} net
              {sameBag && delta !== 0 ? ` · ${delta > 0 ? `${delta} more` : `${-delta} fewer`} bag(s) than recorded` : ''}
            </span>
          )}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Master bag</span>
            <select value={masterId} onChange={(e) => setMasterId(e.target.value)} className={select}>
              <option value="">None</option>
              {bagItems.filter((b) => String(b.id) !== String(bagItemId)).map((b) => (
                <option key={b.id} value={b.id}>{b.name} {b.capacity_kg ? `(${Number(b.capacity_kg)}kg)` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Masters</span>
            <input type="number" min="0" step="1" value={masterQty} onChange={(e) => setMasterQty(e.target.value)}
              disabled={!masterId} className={`${input} disabled:bg-gray-50`} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Polythene</span>
            <select value={polyId} onChange={(e) => setPolyId(e.target.value)} className={select}>
              <option value="">None</option>
              {bagItems.filter((b) => String(b.id) !== String(bagItemId)).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Sheets</span>
            <input type="number" min="0" step="1" value={polyQty} onChange={(e) => setPolyQty(e.target.value)}
              disabled={!polyId} className={`${input} disabled:bg-gray-50`} />
          </label>
        </div>
        {polyId && (
          <div className="flex flex-wrap gap-1.5">
            {[['bag', 'Each bag'], ['master', 'Each master'], ['both', 'Both']].map(([code, label]) => (
              <button key={code} type="button" onClick={() => setPolyScope(code)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border ${polyScope === code
                  ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Notes</span>
          <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        </label>

        <p className="text-[11px] text-gray-500 leading-snug">
          Only the difference moves: extra bags, masters and sheets are drawn from store (refused if the
          store is short), fewer are returned, and the packaging cost is adjusted by the difference.
          Katta still moves only through the katta reconcile at yield.
        </p>
      </div>
    </SlideDrawer>
  );
}
