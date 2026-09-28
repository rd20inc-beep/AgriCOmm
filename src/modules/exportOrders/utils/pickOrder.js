/**
 * The selected documents, in the order they will be merged.
 *
 * The order of this list IS the page order of the combined PDF, which is why the
 * selection is a list and not a Set — a Set cannot express "this one is page 1".
 * Kept out of the component so the arithmetic can be tested directly.
 */

// Put a list of keys back into the order a reference list gives, with anything
// not in that reference list kept, at the end.
export function inReferenceOrder(keys, reference) {
  const present = new Set(keys);
  return [
    ...reference.filter((k) => present.has(k)),
    ...keys.filter((k) => !reference.includes(k)),
  ];
}

/**
 * Add or remove a document.
 *
 * Until the operator has moved something by hand, a newly ticked document slots
 * into the position the reference order implies, so someone who just ticks boxes
 * and downloads gets a sensible set without arranging it. Once they HAVE moved
 * something, a new tick goes on the end instead of re-sorting their arrangement
 * out from under them.
 */
export function togglePick(picked, key, { reference = [], handSorted = false } = {}) {
  if (picked.includes(key)) return picked.filter((k) => k !== key);
  const next = [...picked, key];
  return handSorted ? next : inReferenceOrder(next, reference);
}

// Move one document earlier (-1) or later (+1). Out-of-range moves and unknown
// keys return the list untouched, so the caller needs no guard of its own.
export function movePick(picked, key, delta) {
  const at = picked.indexOf(key);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= picked.length) return picked;
  const next = [...picked];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

// The request body's sequence: one token per file, uploaded ({k:'u',id}) or
// generated ({k:'g',i}), in the order the operator arranged.
export const positionOf = (picked, key) => picked.indexOf(key) + 1;
