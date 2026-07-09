import { Boxes } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';

/**
 * Record Yield Output — right slide-over.
 * Presentational: the parent owns `form`/`setForm` and the submit handler.
 * The yield form itself carries no costing/pricing UI (costs are derived on the
 * backend), so it is shared verbatim by regular and service-milling batches.
 */
export default function YieldOutputDrawer({ open, onClose, form, setForm, onSubmit, batch, finishedLabel }) {
  return (
    <SlideDrawer open={open} onClose={onClose} title="Record Yield Output" icon={Boxes} size="xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
          <span className="font-semibold">Raw Input:</span> {Math.round(batch.rawQtyKg).toLocaleString()} kg &nbsp;|&nbsp;
          <span className="font-semibold">Planned Finished:</span> {Math.round(batch.plannedFinishedKg).toLocaleString()} kg
        </div>

        {/* Finished rice */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Finished Rice (KG) *</label>
          <input type="number" step="0.01" min="0" required value={form.actualFinishedMT}
            onChange={(e) => setForm(prev => ({ ...prev, actualFinishedMT: e.target.value }))}
            placeholder="e.g. 49.2"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
        </div>

        {/* Grades — B1/B2/B3/CSR/Short Grain are first-class outputs (no
            generic "Broken Rice" tag). Total is computed and shown live. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">Grades (KG)</label>
            {(() => {
              const total = ['b1MT','b2MT','b3MT','csrMT','shortGrainMT']
                .reduce((s, k) => s + (parseFloat(form[k]) || 0), 0);
              return total > 0 ? (
                <span className="text-xs font-medium text-amber-700">Total: {Math.round(total).toLocaleString()} kg</span>
              ) : null;
            })()}
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">B1 (KG)</label>
              <input type="number" step="0.01" min="0" value={form.b1MT}
                onChange={(e) => setForm(prev => ({ ...prev, b1MT: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">B2 (KG)</label>
              <input type="number" step="0.01" min="0" value={form.b2MT}
                onChange={(e) => setForm(prev => ({ ...prev, b2MT: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">B3 (KG)</label>
              <input type="number" step="0.01" min="0" value={form.b3MT}
                onChange={(e) => setForm(prev => ({ ...prev, b3MT: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">CSR (KG)</label>
              <input type="number" step="0.01" min="0" value={form.csrMT}
                onChange={(e) => setForm(prev => ({ ...prev, csrMT: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Short Grain (KG)</label>
              <input type="number" step="0.01" min="0" value={form.shortGrainMT}
                onChange={(e) => setForm(prev => ({ ...prev, shortGrainMT: e.target.value }))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            </div>
          </div>
        </div>

        {/* By-products */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sortex Rejects (KG)</label>
            <input type="number" step="0.01" min="0" value={form.sortexMT}
              onChange={(e) => setForm(prev => ({ ...prev, sortexMT: e.target.value }))}
              placeholder="e.g. 2.1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Color-sorter rejected kernels (yellow/damaged)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Powder (KG)</label>
            <input type="number" step="0.01" min="0" value={form.powderMT}
              onChange={(e) => setForm(prev => ({ ...prev, powderMT: e.target.value }))}
              placeholder="e.g. 0.5"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Rice powder — sellable, goes to inventory</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">S.W (KG)</label>
            <input type="number" step="0.01" min="0" value={form.sweepingMT}
              onChange={(e) => setForm(prev => ({ ...prev, sweepingMT: e.target.value }))}
              placeholder="e.g. 0.3"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Sweeping — sellable, goes to inventory</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Choba (KG)</label>
            <input type="number" step="0.01" min="0" value={form.chobaMT}
              onChange={(e) => setForm(prev => ({ ...prev, chobaMT: e.target.value }))}
              placeholder="e.g. 0.4"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Choba — sellable, goes to inventory</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">O.V (KG)</label>
            <input type="number" step="0.01" min="0" value={form.ovMT}
              onChange={(e) => setForm(prev => ({ ...prev, ovMT: e.target.value }))}
              placeholder="e.g. 0.2"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Record-only — not priced or stocked</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stone (KG)</label>
            <input type="number" step="0.01" min="0" value={form.stoneMT}
              onChange={(e) => setForm(prev => ({ ...prev, stoneMT: e.target.value }))}
              placeholder="e.g. 0.1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Record-only — not priced or stocked</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wastage (KG)</label>
            <input type="number" step="0.01" min="0" value={form.wastageMT}
              onChange={(e) => setForm(prev => ({ ...prev, wastageMT: e.target.value }))}
              placeholder="e.g. 1.3"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Dust / fines / unaccounted — no value</p>
          </div>
        </div>
        {(parseFloat(form.branMT) > 0 || parseFloat(form.huskMT) > 0) && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs text-gray-600">
            Legacy bran/husk carried from this batch: bran {parseFloat(form.branMT) || 0} kg, husk {parseFloat(form.huskMT) || 0} kg. New batches no longer record these.
          </div>
        )}

        {/* Live calculation preview */}
        {(() => {
          const f = parseFloat(form.actualFinishedMT) || 0;
          const b1 = parseFloat(form.b1MT) || 0;
          const b2 = parseFloat(form.b2MT) || 0;
          const b3 = parseFloat(form.b3MT) || 0;
          const csr = parseFloat(form.csrMT) || 0;
          const sg = parseFloat(form.shortGrainMT) || 0;
          const br = parseFloat(form.branMT) || 0;   // legacy
          const h = parseFloat(form.huskMT) || 0;    // legacy
          const sx = parseFloat(form.sortexMT) || 0;
          const pw = parseFloat(form.powderMT) || 0;
          const sw = parseFloat(form.sweepingMT) || 0;
          const ch = parseFloat(form.chobaMT) || 0;
          const ovv = parseFloat(form.ovMT) || 0;
          const st = parseFloat(form.stoneMT) || 0;
          const w = parseFloat(form.wastageMT) || 0;
          const gradeTotal = b1 + b2 + b3 + csr + sg;
          // Broken total derives from the per-grade inputs (gradeTotal)
          // — falls back to legacy form.brokenMT only for batches
          // saved before this change.
          const b = gradeTotal > 0 ? gradeTotal : (parseFloat(form.brokenMT) || 0);
          const total = f + b + br + h + sx + pw + sw + ch + ovv + st + w;
          const rawQty = (parseFloat(batch.rawQtyMT) || 0) * 1000; // KG (form is KG)
          const yieldPct = rawQty > 0 ? ((f / rawQty) * 100).toFixed(1) : '0.0';
          const accounted = rawQty > 0 ? ((total / rawQty) * 100).toFixed(1) : '0.0';

          const rows = [
            { label: finishedLabel, value: f, bold: true, color: 'text-blue-700' },
          ];
          if (b > 0) rows.push({ label: 'Grades (total)', value: b, color: 'text-amber-700' });
          if (b1) rows.push({ label: '  B1', value: b1, indent: true });
          if (b2) rows.push({ label: '  B2', value: b2, indent: true });
          if (b3) rows.push({ label: '  B3', value: b3, indent: true });
          if (csr) rows.push({ label: '  CSR', value: csr, indent: true });
          if (sg) rows.push({ label: '  Short Grain', value: sg, indent: true });
          rows.push({ label: 'Sortex Rejects', value: sx, color: 'text-amber-700' });
          if (pw > 0) rows.push({ label: 'Powder', value: pw, color: 'text-gray-600' });
          if (sw > 0) rows.push({ label: 'S.W', value: sw, color: 'text-gray-600' });
          if (ch > 0) rows.push({ label: 'Choba', value: ch, color: 'text-gray-600' });
          if (ovv > 0) rows.push({ label: 'O.V (record-only)', value: ovv, color: 'text-gray-500' });
          if (st > 0) rows.push({ label: 'Stone (record-only)', value: st, color: 'text-gray-500' });
          rows.push({ label: 'Wastage', value: w, color: 'text-red-600' });
          // Show bran/husk in the preview only when they were carried from
          // an existing batch — keeps the math correct for legacy batches.
          if (br > 0) rows.push({ label: 'Rice Bran (legacy)', value: br, color: 'text-gray-500' });
          if (h > 0)  rows.push({ label: 'Rice Husk (legacy)', value: h, color: 'text-gray-500' });

          return (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm space-y-1.5">
              {rows.map((r, i) => r.value > 0 && (
                <div key={i} className={`flex justify-between ${r.indent ? 'pl-4 text-xs text-gray-500' : ''}`}>
                  <span className={r.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}>{r.label}</span>
                  <span className={`font-medium ${r.color || 'text-gray-900'}`}>{Math.round(r.value).toLocaleString()} kg</span>
                </div>
              ))}
              {gradeTotal > 0 && b > 0 && Math.abs(gradeTotal - b) > 0.01 && (
                <div className="flex justify-between pl-4 text-xs text-red-500">
                  <span>Grade total vs Broken total mismatch</span>
                  <span>{Math.round(gradeTotal).toLocaleString()} vs {Math.round(b).toLocaleString()} kg</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between">
                <span className="font-semibold text-gray-700">Total Output</span>
                <span className="font-bold text-gray-900">{Math.round(total).toLocaleString()} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Accounted for</span>
                <span className={`font-semibold ${parseFloat(accounted) > 100 ? 'text-red-600' : parseFloat(accounted) >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {accounted}% of {Math.round(rawQty).toLocaleString()} kg
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="font-semibold text-gray-700">Yield %</span>
                <span className={`text-lg font-bold ${parseFloat(yieldPct) >= 75 ? 'text-emerald-600' : parseFloat(yieldPct) >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                  {yieldPct}%
                </span>
              </div>
            </div>
          );
        })()}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Save Yield Output
          </button>
        </div>
      </form>
    </SlideDrawer>
  );
}
