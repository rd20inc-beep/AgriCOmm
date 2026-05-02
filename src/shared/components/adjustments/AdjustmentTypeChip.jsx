import { themeFor } from './types';

/**
 * Compact icon + label chip for an adjustment type. Used in tables and
 * filter bars. Accepts a `type` object (one of STOCK_ADJ_TYPES or
 * STORE_ADJ_TYPES) — pass null to render a neutral fallback.
 */
export default function AdjustmentTypeChip({ type, size = 'sm' }) {
  if (!type) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
        —
      </span>
    );
  }
  const t = themeFor(type.color);
  const Icon = type.icon;
  const padding = size === 'lg' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  const text = size === 'lg' ? 'text-xs' : 'text-[11px]';
  return (
    <span
      title={type.desc}
      className={`inline-flex items-center gap-1.5 ${padding} rounded-full ${text} font-medium ${t.chipBg} ${t.chipText} border ${t.chipBorder}`}
    >
      <Icon className={`w-3.5 h-3.5 ${t.icon}`} />
      {type.label}
    </span>
  );
}
