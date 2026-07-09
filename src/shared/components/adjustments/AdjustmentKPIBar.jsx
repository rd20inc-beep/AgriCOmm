import { Clock, TrendingDown, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * KPI strip shown at the top of an adjustments page. Pure presentation —
 * the page computes the four numbers and passes them in.
 *
 *   pendingCount    — adjustments awaiting approval right now
 *   periodCount     — adjustments created in the chosen period
 *   periodImpact    — total cost impact of the period (Rs)
 *   approvalRate    — fraction approved over the period (0..1)
 *
 * Pass null for any value the page can't compute (e.g., Store
 * adjustments don't track cost impact yet) and that card is hidden.
 */
export default function AdjustmentKPIBar({
  pendingCount,
  periodCount,
  periodImpact,
  approvalRate,
  periodLabel = 'last 30 days',
  currency = 'Rs',
}) {
  const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
  const cards = [
    {
      label: 'Pending Approval',
      value: fmt(pendingCount),
      sub: pendingCount > 0 ? 'Action required' : 'All clear',
      icon: pendingCount > 0 ? AlertCircle : CheckCircle2,
      tone: pendingCount > 0 ? 'amber' : 'green',
      visible: pendingCount != null,
    },
    {
      label: `Adjustments · ${periodLabel}`,
      value: fmt(periodCount),
      sub: 'Total in period',
      icon: Clock,
      tone: 'slate',
      visible: periodCount != null,
    },
    {
      label: `Cost Impact · ${periodLabel}`,
      value: periodImpact == null ? null : `${currency} ${fmt(periodImpact)}`,
      sub: 'Approved write-offs',
      icon: TrendingDown,
      tone: 'red',
      visible: periodImpact != null,
    },
    {
      label: `Approval Rate · ${periodLabel}`,
      value: approvalRate == null ? null : `${Math.round(approvalRate * 100)}%`,
      sub: 'Approved / decided',
      icon: CheckCircle2,
      tone: approvalRate != null && approvalRate >= 0.8 ? 'green' : 'amber',
      visible: approvalRate != null,
    },
  ].filter((c) => c.visible);

  const tones = {
    amber: { border: 'border-l-amber-500', bg: 'bg-amber-50/50', icon: 'text-amber-500' },
    green: { border: 'border-l-green-500', bg: 'bg-emerald-50/50', icon: 'text-emerald-500' },
    red:   { border: 'border-l-red-500',   bg: 'bg-red-50/50',   icon: 'text-red-500' },
    slate: { border: 'border-l-slate-400', bg: 'bg-slate-50/50', icon: 'text-slate-500' },
  };

  return (
    <div className={`grid gap-3 ${cards.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : `grid-cols-${Math.min(cards.length, 4)}`}`}>
      {cards.map((c) => {
        const t = tones[c.tone];
        const Icon = c.icon;
        return (
          <div key={c.label} className={`border-l-4 rounded-r-lg p-3 ${t.border} ${t.bg}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide truncate">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{c.value || '—'}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 truncate">{c.sub}</p>
              </div>
              <Icon size={18} className={`${t.icon} flex-shrink-0`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
