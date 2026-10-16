// Pure helpers behind components/ReportChrome.jsx (kept apart so the component
// file only exports components).
import { fmtDate, fmtDateTime } from '../../../shared/utils/format';

export const fmtCount = (v) => Number(v || 0).toLocaleString('en-US');
const n = fmtCount;

/** Pure: the "Showing a–b of N" words, or null when nothing is hidden. */
export function pagerText(p) {
  if (!p || !p.total) return null;
  const start = (Math.max(1, p.page || 1) - 1) * (p.limit || 0) + 1;
  const end = start + (p.returned ?? 0) - 1;
  if (!p.truncated && start === 1) return null;
  return `Showing ${n(start)}–${n(Math.max(start, end))} of ${n(p.total)}`;
}

/** Pure: "1 Oct 2026 – 31 Oct 2026 · kg · PKR · as of …". */
export function metaText(meta) {
  if (!meta) return null;
  const period = meta.allTime ? 'All time' : `${meta.from ? fmtDate(meta.from) : '…'} – ${meta.to ? fmtDate(meta.to) : '…'}`;
  return [period, meta.unit, meta.currency, meta.basis, meta.asOf ? `as of ${fmtDateTime(meta.asOf)}` : null].filter(Boolean).join(' · ');
}

