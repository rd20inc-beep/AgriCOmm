// Accounting periods (owner decision D-1): pure helpers for Accounting ›
// Periods. The fiscal year is the Pakistani tax year, 1 July – 30 June.

export const dayOf = (v) => (v ? String(v).slice(0, 10) : '');

/** '2026-27' for the fiscal year starting in July 2026. */
export const fyLabel = (startYear) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

/** Periods grouped by fiscal year label ('2026-27'), each list oldest first. */
export function groupByFiscalYear(periods = []) {
  const out = {};
  for (const p of periods) {
    const fy = p.fyLabel || 'Unassigned';
    (out[fy] ||= []).push(p);
  }
  for (const list of Object.values(out)) list.sort((a, b) => dayOf(a.periodStart).localeCompare(dayOf(b.periodStart)));
  return out;
}
