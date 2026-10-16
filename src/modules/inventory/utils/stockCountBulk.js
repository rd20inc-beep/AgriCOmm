// Bulk stock-take entry (INV-34): which typed counts one "Save all" sends,
// and which of them deserve the big-difference check first. Pure.

const n = (v) => Number(v) || 0;

// A count this far off the record is more likely a typo than a loss.
export const BIG_VARIANCE_SHARE = 0.5;

// Lines to save: every draft the user typed that is a number and differs
// from what is already saved for that line. Untouched lines are left alone.
export function bulkCountLines(items, drafts) {
  const lines = [];
  for (const it of items || []) {
    const draft = drafts?.[it.id];
    if (draft === undefined || draft === '' || draft === null) continue;
    const counted = Number(draft);
    if (!Number.isFinite(counted)) continue;
    const saved = it.counted_qty == null || it.counted_qty === '' ? null : Number(it.counted_qty);
    if (saved != null && saved === counted && it.status !== 'Pending') continue;
    lines.push({ item_id: it.id, counted_qty: counted });
  }
  return lines;
}

// The lines among `lines` whose difference from the record is over half of it.
export function bigVarianceLines(items, lines, share = BIG_VARIANCE_SHARE) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  return lines
    .map((l) => {
      const it = byId.get(l.item_id);
      const sys = n(it?.system_qty);
      return { ...l, item: it, system: sys, variance: l.counted_qty - sys };
    })
    .filter((x) => Math.abs(x.variance) > x.system * share);
}
