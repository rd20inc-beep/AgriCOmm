// How a packaging item reads in the packing-run bag pickers.
//
// The store holds look-alike items: "5KG NON WOVEN BAGS" (never stocked) and
// "5KG NWB SINDBAD" (1,870 in store). Packing run #7 on M-007 picked the first,
// so 980 bags were costed out of 1250 while the bags actually used stayed in
// store (Rs 49,784 gap). The stock on hand is now part of the option text, so
// the empty item is visible before it is chosen, not only after.
const fmtQty = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });

export function bagOptionLabel(item, { capacity = true } = {}) {
  if (!item) return '';
  const cap = Number(item.capacity_kg);
  const parts = [item.name];
  if (capacity) parts.push(cap ? `(${cap}kg)` : '(no capacity set)');
  const onHand = Number(item.quantity_available);
  parts.push(onHand > 0 ? `· ${fmtQty(onHand)} in stock` : '· none in stock');
  return parts.join(' ');
}
