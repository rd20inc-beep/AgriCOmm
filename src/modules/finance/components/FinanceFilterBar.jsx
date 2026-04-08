import { Filter, X } from 'lucide-react';

/**
 * Standardized filter bar for finance pages.
 * Props:
 *   filters  — [{ key, label, options: [{ value, label }], value, onChange }]
 *   onReset  — reset all filters callback
 *   children — additional custom controls
 */
export default function FinanceFilterBar({ filters = [], onReset, children }) {
  const hasActiveFilter = filters.some(f => f.value && f.value !== 'All' && f.value !== '');

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter size={15} className="text-gray-400 flex-shrink-0" />
      {filters.map(f => (
        <select
          key={f.key}
          value={f.value}
          onChange={e => f.onChange(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {f.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
      {children}
      {hasActiveFilter && onReset && (
        <button onClick={onReset}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}
