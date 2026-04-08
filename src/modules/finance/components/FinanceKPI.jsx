import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

const statusColors = {
  good:    { border: 'border-emerald-200', bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'ring-emerald-100', badge: 'bg-emerald-100 text-emerald-700' },
  warning: { border: 'border-amber-200',   bg: 'bg-amber-50',   icon: 'text-amber-600',   ring: 'ring-amber-100',   badge: 'bg-amber-100 text-amber-700' },
  danger:  { border: 'border-red-200',     bg: 'bg-red-50',     icon: 'text-red-600',     ring: 'ring-red-100',     badge: 'bg-red-100 text-red-700' },
  neutral: { border: 'border-gray-200',    bg: 'bg-gray-50',    icon: 'text-gray-600',    ring: 'ring-gray-100',    badge: 'bg-gray-100 text-gray-700' },
  info:    { border: 'border-blue-200',    bg: 'bg-blue-50',    icon: 'text-blue-600',    ring: 'ring-blue-100',    badge: 'bg-blue-100 text-blue-700' },
};

/**
 * Enhanced KPI card for Finance Dashboard.
 * Props:
 *   icon       — Lucide icon component
 *   title      — KPI label
 *   value      — Main metric (string)
 *   subtitle   — Small description
 *   change     — e.g. "+12%" or "-3.4K"
 *   changeDir  — 'up' | 'down' (colors the change badge)
 *   status     — 'good' | 'warning' | 'danger' | 'neutral' | 'info'
 *   onClick    — makes card clickable
 *   currency   — optional label shown after value
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
      <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
        <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
        <div className="h-7 w-28 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border ${s.border} p-4 transition-all ${
        isClickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{title}</p>
        {Icon && (
          <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${s.bg} ring-1 ${s.ring} flex-shrink-0`}>
            <Icon size={16} className={s.icon} />
          </div>
        )}
      </div>

      <p className="text-2xl font-bold text-gray-900 tabular-nums truncate">{value}</p>

      <div className="flex items-center justify-between mt-1.5 min-h-[20px]">
        {subtitle && (
          <p className="text-xs text-gray-400 truncate">{subtitle}</p>
        )}
        {change && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
            changeDir === 'up' ? 'bg-emerald-50 text-emerald-700' : changeDir === 'down' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
          }`}>
            {changeDir === 'up' && <ArrowUpRight size={12} />}
            {changeDir === 'down' && <ArrowDownRight size={12} />}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
