import { Filter, X } from 'lucide-react';
import AdjustmentTypeChip from './AdjustmentTypeChip';

/**
 * Filter bar for adjustments — status pills + type multi-select chips +
 * date-range inputs. Controlled component: all state lives in the parent.
 *
 *   value:      { status, types, fromDate, toDate }
 *   onChange:   (next) => void
 *   types:      array of type metadata (STOCK_ADJ_TYPES or STORE_ADJ_TYPES)
 *   statuses:   array of allowed status values for the page (varies per backend)
 */
export default function AdjustmentFilters({
  value = { status: 'all', types: [], fromDate: '', toDate: '' },
  onChange,
  types = [],
  statuses = ['all', 'pending', 'approved', 'rejected'],
  formatStatusLabel = (s) => (s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
}) {
  const set = (patch) => onChange({ ...value, ...patch });
  const toggleType = (t) => {
    const cur = value.types || [];
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    set({ types: next });
  };
  const hasFilters = (value.types && value.types.length > 0) || value.fromDate || value.toDate || (value.status && value.status !== 'all' && value.status !== '');
  const clearAll = () => onChange({ status: 'all', types: [], fromDate: '', toDate: '' });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Status pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400 mr-1" />
        {statuses.map((s) => {
          const active = value.status === s || (s === 'all' && (value.status === '' || value.status === 'all'));
          return (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => set({ status: s })}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {formatStatusLabel(s)}
            </button>
          );
        })}
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* Type chips (click to toggle) */}
      {types.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Types</span>
          {types.map((t) => {
            const selected = (value.types || []).includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleType(t.value)}
                className={`transition-opacity ${selected ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}
                title={t.desc}
              >
                <AdjustmentTypeChip type={t} />
              </button>
            );
          })}
        </div>
      )}

      {/* Date range */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">Date</span>
        <input
          type="date"
          value={value.fromDate || ''}
          onChange={(e) => set({ fromDate: e.target.value })}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1 outline-none"
          placeholder="From"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          value={value.toDate || ''}
          onChange={(e) => set({ toDate: e.target.value })}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1 outline-none"
        />
      </div>
    </div>
  );
}
