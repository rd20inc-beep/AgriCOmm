import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

// The status tints only the icon chip — the card stays a plain white tile so
// a row of tiles reads calmly and the figure carries the emphasis.
const statusColors = {
  good:    { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  warning: { bg: 'bg-amber-50',   icon: 'text-amber-600' },
  danger:  { bg: 'bg-red-50',     icon: 'text-red-600' },
  neutral: { bg: 'bg-gray-50',    icon: 'text-gray-500' },
  info:    { bg: 'bg-blue-50',    icon: 'text-blue-600' },
};

/**
 * The Finance KPI tile: small label · big figure · small sub-line.
 * Props:
 *   icon       — Lucide icon component
 *   title      — KPI label
 *   value      — Main metric (string or node)
 *   subtitle   — Small description
 *   change     — e.g. "+12%" or "-3.4K"
 *   changeDir  — 'up' | 'down' (colors the change badge)
 *   status     — 'good' | 'warning' | 'danger' | 'neutral' | 'info'
 *   onClick    — makes the tile a button
 *   loading    — shows skeleton
 */
export default function FinanceKPI({
  icon: Icon, title, value, subtitle, change, changeDir,
  status = 'neutral', onClick, loading,
}) {
  const s = statusColors[status] || statusColors.neutral;
  const isClickable = !!onClick;

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse" aria-busy="true">
        <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
        <div className="h-7 w-28 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
    );
  }

  const Cmp = isClickable ? 'button' : 'div';
  return (
    <Cmp
      type={isClickable ? 'button' : undefined}
      onClick={onClick}
      data-status={status}
      className={`w-full min-w-0 text-left bg-white rounded-xl border border-gray-200 p-4 transition-colors ${
        isClickable ? 'cursor-pointer hover:border-gray-300 hover:bg-gray-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="min-w-0 text-xs font-medium text-gray-500 uppercase tracking-wide line-clamp-2 break-words" title={typeof title === 'string' ? title : undefined}>{title}</p>
        {Icon && (
          <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.bg} flex-shrink-0`} aria-hidden="true">
            <Icon size={16} className={s.icon} />
          </span>
        )}
      </div>

      <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums leading-tight break-words" title={typeof value === 'string' ? value : undefined}>{value}</div>

      {(subtitle || change) && (
        <div className="flex items-center justify-between gap-2 mt-1.5">
          {subtitle && (
            <p className="text-xs text-gray-500 truncate" title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</p>
          )}
          {change && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
              changeDir === 'up' ? 'bg-emerald-50 text-emerald-700' : changeDir === 'down' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
            }`}>
              {changeDir === 'up' && <ArrowUpRight size={12} aria-hidden="true" />}
              {changeDir === 'down' && <ArrowDownRight size={12} aria-hidden="true" />}
              {change}
            </span>
          )}
        </div>
      )}
    </Cmp>
  );
}
