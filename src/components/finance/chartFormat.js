import { fmtNum } from '../../shared/utils/format';

/**
 * Y-axis tick: the one place a figure may be abbreviated (an axis has no room
 * for "Rs 12,345,678"). Tooltips and tables always show the exact value.
 */
export function formatTick(v) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return fmtNum(v);
}

/** Tooltip value: the exact figure behind the chart's currency prefix ('$', 'Rs '). */
export function formatTooltip(v, currency = '$') {
  const s = fmtNum(v);
  if (s === '—') return s;
  return s.startsWith('-') ? `-${currency}${s.slice(1)}` : `${currency}${s}`;
}
