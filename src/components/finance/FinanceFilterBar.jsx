import { Filter, X } from 'lucide-react';

/**
 * Standardized filter bar for finance pages.
 * Props:
 *   filters  — [{ key, label, options: [{ value, label }], value, onChange }]
 *   onReset  — reset all filters callback
 *   children — additional custom controls
 *
 * On a phone the selects share the row two-up instead of wrapping ragged.
 */
export default function FinanceFilterBar({ filters = [], onReset, children }) {
  const hasActiveFilter = filters.some(f => f.value && f.value !== 'All' && f.value !== '');

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter size={15} className="text-gray-400 flex-shrink-0 hidden sm:block" aria-hidden="true" />
      {filters.map(f => (
        <select
          key={f.key}
          value={f.value}
          onChange={e => f.onChange(e.target.value)}
          aria-label={f.label || f.key}
          className="flex-1 sm:flex-none min-w-0 text-sm border border-gray-200 rounded-lg px-3 min-h-10 sm:min-h-9 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {f.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
      {children}
      {hasActiveFilter && onReset && (
        <button type="button" onClick={onReset}
          className="inline-flex items-center justify-center gap-1 text-sm text-gray-600 hover:text-gray-800 px-3 min-h-10 sm:min-h-9 rounded-lg hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <X size={14} aria-hidden="true" /> Clear filters
        </button>
      )}
    </div>
  );
}
