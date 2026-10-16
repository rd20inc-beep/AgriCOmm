import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const TONES = {
  slate:  'bg-white border-gray-100',
  blue:   'bg-blue-50/40 border-blue-100',
  green:  'bg-emerald-50/40 border-emerald-100',
  red:    'bg-red-50/40 border-red-100',
  amber:  'bg-amber-50/40 border-amber-100',
  purple: 'bg-purple-50/40 border-purple-100',
};
const ICON_TONES = {
  slate:  'text-gray-400',
  blue:   'text-blue-500',
  green:  'text-emerald-500',
  red:    'text-red-500',
  amber:  'text-amber-500',
  purple: 'text-purple-500',
};

/**
 * A KPI tile. With `to`, the whole tile is a link to the filtered list behind
 * the number (P5-09: no dead-end figures) and says so with a chevron.
 */
export default function Stat({ label, value, sub, tone = 'slate', icon: Icon, to, testId }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={ICON_TONES[tone]} aria-hidden="true" />}
      </div>
      <p className="text-xl font-semibold text-gray-900 mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1 truncate">{sub}</p>}
      {to && (
        <span className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 no-print">
          View <ChevronRight size={12} aria-hidden="true" />
        </span>
      )}
    </>
  );
  const cls = `rounded-xl border p-4 ${TONES[tone] || TONES.slate}`;
  if (to) {
    return (
      <Link to={to} data-testid={testId} aria-label={`${label}: ${value} — view details`}
        className={`${cls} block hover:border-blue-300 hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>
        {body}
      </Link>
    );
  }
  return <div className={cls} data-testid={testId}>{body}</div>;
}
