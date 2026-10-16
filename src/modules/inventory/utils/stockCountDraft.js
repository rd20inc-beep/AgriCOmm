/**
 * Stock Take keeps the counts typed but not yet saved (P5-07): a closed drawer,
 * a reload or a dropped connection on the warehouse floor must not lose a
 * half-entered count. Local only — the count is recorded on the server only
 * when the user presses Save on a line.
 */

export const stockCountDraftName = (countId) => `stock-count-${countId}`;

/**
 * The typed counts that differ from what is saved on the server. Lines not
 * (yet) loaded are kept, so a draft survives the count still loading.
 */
export function unsavedCounts(drafts, items) {
  const byId = new Map((items || []).map((it) => [String(it.id), it]));
  const out = {};
  for (const [id, value] of Object.entries(drafts || {})) {
    const it = byId.get(String(id));
    if (!it) { if (!items?.length) out[id] = value; continue; }
    const saved = it.counted_qty == null ? '' : String(it.counted_qty);
    if (String(value) !== saved && !(value !== '' && saved !== '' && Number(value) === Number(saved))) out[id] = value;
  }
  return out;
}
