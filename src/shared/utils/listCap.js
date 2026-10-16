// Capped lists: the server returns one page (newest first) and how many rows
// match. Say so instead of letting a page pass for the whole set.

/** "Showing 200 of 1,234" when the list was capped, else null. */
export function cappedHint(shown, total) {
  const s = Number(shown) || 0;
  const t = Number(total);
  if (!Number.isFinite(t) || t <= s) return null;
  return `Showing ${s.toLocaleString('en-US')} of ${t.toLocaleString('en-US')}`;
}

/**
 * W19 — the warning for a CSV written from a capped list: the export holds the
 * `loaded` rows the server sent, not all `total` that match. null when the
 * list was complete.
 */
export function csvCapWarning(loaded, total) {
  const l = Number(loaded) || 0;
  const t = Number(total);
  if (!Number.isFinite(t) || t <= l) return null;
  return `CSV holds ${l.toLocaleString('en-US')} of ${t.toLocaleString('en-US')} matching rows (list limit reached). Narrow the date range or filters to export the rest.`;
}
