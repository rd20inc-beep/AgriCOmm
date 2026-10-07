import { useState } from 'react';
import { Package, Pencil, X, Loader2, Lock } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { fmtNum } from '../../../shared/utils/format';
import { packSpecSourceLabel } from '../utils/packingAccess';

const num = (v) => Number(v) || 0;
const kgText = (v) => (num(v) > 0 ? `${fmtNum(num(v))} kg` : '—');

// "Packs into" — the bag this batch's finished rice packs into, and where that
// comes from: the batch's own override, or the linked export order's line for
// the batch product. Permitted users can set or clear the override.
export default function PackSpecCard({ spec, access, onSave, onClear, saving = false }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState('');
  const [type, setType] = useState('');
  const [master, setMaster] = useState('');

  const isOverride = spec?.source === 'override';
  const hasSpec = !!spec && spec.source && spec.source !== 'none';
  const bulk = spec?.packingType === 'container';
  const canEdit = !!access?.allowed;

  function startEdit() {
    setSize(spec?.bagSizeKg ? String(num(spec.bagSizeKg)) : '');
    setType(spec?.bagType && !bulk ? spec.bagType : '');
    setMaster(spec?.masterBagSizeKg ? String(num(spec.masterBagSizeKg)) : '');
    setOpen(true);
  }

  async function save() {
    const ok = await onSave?.({
      pack_bag_size_kg: num(size) > 0 ? num(size) : null,
      pack_bag_type: type.trim() || null,
      pack_master_bag_size_kg: num(master) > 0 ? num(master) : null,
    });
    if (ok !== false) setOpen(false);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4" data-testid="pack-spec-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Package size={16} className="text-blue-600" /> Packs into
          <span
            data-testid="pack-spec-source"
            className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${isOverride
              ? 'bg-amber-100 text-amber-800' : hasSpec ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}
          >
            {packSpecSourceLabel(spec)}
          </span>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={startEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100">
              <Pencil size={13} /> {isOverride ? 'Edit override' : 'Override'}
            </button>
            {isOverride && (
              <button type="button" onClick={() => onClear?.()} disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                <X size={13} /> Clear override
              </button>
            )}
          </div>
        ) : access?.reason ? (
          <span data-testid="pack-spec-lock" className="inline-flex items-center gap-1 text-[11px] text-gray-500">
            <Lock size={12} /> {access.reason}
          </span>
        ) : null}
      </div>

      {hasSpec ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <Field label="Bag size" value={bulk ? 'Bulk — no bags' : kgText(spec.bagSizeKg)} />
          <Field label="Bag type" value={spec.bagType || '—'} />
          <Field label="Master bag" value={kgText(spec.masterBagSizeKg)} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-500">
          No bag set for this batch — the output is stamped with what a packing run records,
          or the raw katta size. Set an override to fix the bag.
        </p>
      )}
      <p className="mt-2 text-[11px] text-gray-500">
        A packing run, when recorded, is what the output lots carry — this spec is what they are packed to.
      </p>

      <SlideDrawer open={open} onClose={() => setOpen(false)} title="Batch packing spec"
        subtitle="Overrides the export order's bag for this batch" icon={Package} size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={save} disabled={saving || !(num(size) > 0)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />} Save override
            </button>
          </div>
        )}>
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Bag size (kg)</span>
            <input type="number" min="0" step="0.01" value={size} onChange={(e) => setSize(e.target.value)} autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 25" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Bag type</span>
            <input type="text" maxLength={100} value={type} onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. P.P. bag, Jute" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Master bag (kg, optional)</span>
            <input type="number" min="0" step="0.01" value={master} onChange={(e) => setMaster(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 20" />
          </label>
          {spec && spec.source !== 'override' && spec.source !== 'none' && (
            <p className="text-xs text-gray-500">Without an override this batch packs to {packSpecSourceLabel(spec)}.</p>
          )}
        </div>
      </SlideDrawer>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{label}</div>
      <div className="font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}
