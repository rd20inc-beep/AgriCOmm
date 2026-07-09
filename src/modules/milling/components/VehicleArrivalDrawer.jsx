import { Truck } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';

/**
 * Add Vehicle Arrival — right slide-over.
 * Presentational: the parent owns `form`/`setForm` and the submit handler.
 * `hidePricing` drops the per-truck price field (service milling: client-owned rice).
 */
export default function VehicleArrivalDrawer({
  open, onClose, form, setForm, onSubmit,
  showQuality, setShowQuality, hidePricing = false,
  title = 'Add Vehicle Arrival', submitLabel = 'Add Vehicle',
}) {
  return (
    <SlideDrawer open={open} onClose={onClose} title={title} icon={Truck} size="xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle / Truck Number *</label>
            <input
              type="text"
              required
              value={form.vehicleNo}
              onChange={(e) => setForm(prev => ({ ...prev, vehicleNo: e.target.value }))}
              placeholder="e.g. ABC-1234 or LEA-5678"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Arrival Date</label>
            <input
              type="date"
              value={form.arrivalDate}
              onChange={(e) => setForm(prev => ({ ...prev, arrivalDate: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
            <input
              type="text"
              value={form.driverName}
              onChange={(e) => setForm(prev => ({ ...prev, driverName: e.target.value }))}
              placeholder="e.g. Muhammad Ali"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
            <input
              type="text"
              value={form.driverPhone}
              onChange={(e) => setForm(prev => ({ ...prev, driverPhone: e.target.value }))}
              placeholder="e.g. 0300-1234567"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weight (KG)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={form.weightKg}
              onChange={(e) => setForm(prev => ({ ...prev, weightKg: e.target.value }))}
              placeholder="e.g. 30000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {form.weightKg && (
              <p className="text-xs text-gray-400 mt-0.5">{Math.round(parseFloat(form.weightKg) || 0).toLocaleString()} kg</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bags</label>
            <input
              type="number"
              step="1"
              min="0"
              value={form.totalBags}
              onChange={(e) => setForm(prev => ({ ...prev, totalBags: e.target.value }))}
              placeholder="e.g. 600"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {form.weightKg && form.totalBags && parseInt(form.totalBags, 10) > 0 && (
              <p className="text-xs text-emerald-600 mt-0.5 font-medium">Avg: {(parseFloat(form.weightKg) / parseInt(form.totalBags, 10)).toFixed(2)} kg/bag</p>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="e.g. Weigh bridge slip #123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Per-truck quality (optional) */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowQuality(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600"
          >
            <span>{showQuality ? '▾' : '▸'}</span>
            Quality (this truck)
            <span className="text-xs text-gray-400 font-normal">
              {hidePricing ? '— optional, recorded for this lot' : '— optional, overrides batch arrival price for this lot'}
            </span>
          </button>
          {showQuality && (() => {
            const setQ = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));
            const pctInput = (key, label) => (
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-0.5">{label}</label>
                <input
                  type="number" step="0.01" min="0" max="100"
                  value={form[key]}
                  onChange={setQ(key)}
                  placeholder="0"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            );
            const gradeTotal =
              (parseFloat(form.b1) || 0) + (parseFloat(form.b2) || 0) +
              (parseFloat(form.b3) || 0) + (parseFloat(form.csr) || 0) +
              (parseFloat(form.shortGrain) || 0) + (parseFloat(form.cobba) || 0) +
              (parseFloat(form.nb) || 0) + (parseFloat(form.ov) || 0);
            const brokenPct = parseFloat(form.broken) || 0;
            const sumMatch = brokenPct > 0 && gradeTotal > 0
              ? Math.abs(gradeTotal - brokenPct) < 0.1
              : null;
            return (
              <div className="space-y-3 mt-3">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Aggregate</p>
                  <div className="grid grid-cols-5 gap-2">
                    {pctInput('moisture',      'Moisture %')}
                    {pctInput('broken',        'Broken %')}
                    {pctInput('foreignMatter', 'Foreign matter %')}
                    {pctInput('chalky',        'Chalky %')}
                    {pctInput('purity',        'Purity %')}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Broken-grade breakdown</p>
                    {gradeTotal > 0 && (
                      <span className={`text-[10px] font-medium ${
                        sumMatch === true ? 'text-emerald-700' :
                        sumMatch === false ? 'text-amber-700' : 'text-gray-500'
                      }`}>
                        Σ = {gradeTotal.toFixed(2)}%
                        {sumMatch === false && brokenPct > 0 && (
                          <span className="ml-1">(broken: {brokenPct.toFixed(2)}%)</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {pctInput('b1',         'B1 %')}
                    {pctInput('b2',         'B2 %')}
                    {pctInput('b3',         'B3 %')}
                    {pctInput('csr',        'CSR %')}
                    {pctInput('shortGrain', 'Short Grain %')}
                    {pctInput('cobba',      'Choba %')}
                    {pctInput('nb',         'N.B %')}
                    {pctInput('ov',         'O.V %')}
                  </div>
                </div>
                {!hidePricing && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Price / kg (PKR)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={form.pricePerKg}
                      onChange={setQ('pricePerKg')}
                      placeholder="e.g. 95"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                )}
              </div>
            );
          })()}
        </div>

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
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Truck size={16} />
            {submitLabel}
          </button>
        </div>
      </form>
    </SlideDrawer>
  );
}
