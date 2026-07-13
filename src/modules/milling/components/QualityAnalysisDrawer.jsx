import { FlaskConical } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';

/**
 * Sample / Arrival quality analysis — right slide-over.
 * Presentational: the parent owns `form`/`setForm` and the submit handler.
 * `hidePricing` drops the rice-price section (service milling: the client owns
 * the rice, so there is no purchase price to agree).
 */
export default function QualityAnalysisDrawer({
  open, onClose, type = 'arrival', form, setForm, onSubmit,
  qualityParams = [], batch, hidePricing = false,
}) {
  const isSample = type === 'sample';
  return (
    <SlideDrawer open={open} onClose={onClose} title={isSample ? 'Sample Analysis' : 'Arrival Analysis'} icon={FlaskConical} size="xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {qualityParams.map((param) => (
            <div key={param.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{param.label}</label>
              <input
                type="number"
                step="0.01"
                value={form[param.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [param.key]: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={`Enter ${param.label.toLowerCase()}`}
              />
            </div>
          ))}
        </div>

        {/* Rice Price — not applicable to service milling (client owns the rice, we don't buy it) */}
        {!hidePricing && (
        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">
            {isSample ? 'Offered Price' : 'Agreed Price'} (PKR)
          </h4>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price per KG</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">Rs</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.pricePerKg}
                onChange={(e) => {
                  const pkg = e.target.value;
                  const pmt = pkg ? (parseFloat(pkg) * 1000).toFixed(2) : '';
                  setForm(prev => ({ ...prev, pricePerKg: pkg, pricePerMT: pmt }));
                }}
                className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 85"
              />
            </div>
          </div>
          {form.pricePerKg && batch.rawQtyKg > 0 && (
            <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Estimated total cost for {(batch.rawQtyKg).toLocaleString()} kg raw: <span className="font-semibold text-gray-800">Rs {(parseFloat(form.pricePerKg) * batch.rawQtyKg).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>
        )}

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
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${isSample ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            Save {isSample ? 'Sample' : 'Arrival'} Analysis
          </button>
        </div>
      </form>
    </SlideDrawer>
  );
}
