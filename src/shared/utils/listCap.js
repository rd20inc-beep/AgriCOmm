// Capped lists: the server returns one page (newest first) and how many rows
// match. Say so instead of letting a page pass for the whole set.

/** "Showing 200 of 1,234" when the list was capped, else null. */
export function cappedHint(shown, total) {
  const s = Number(shown) || 0;
  const t = Number(total);
  if (!Number.isFinite(t) || t <= s) return null;
  return `Showing ${s.toLocaleString('en-US')} of ${t.toLocaleString('en-US')}`;
}
