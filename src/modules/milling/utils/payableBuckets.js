/**
 * Which mill payables are real debts, and how supplier-less ones are grouped.
 *
 * The payables list mixes two kinds of row:
 *
 *   STORED    a bill somebody actually owes — numeric id, lives in `payables`.
 *   DERIVED   a cost allocation, id like MC-2 / EC-7 / ME-3, computed from
 *             milling_costs and friends. A batch's packaging cost is the bags it
 *             consumed; the money owed for those bags is on the store purchase
 *             under that vendor. Paying the allocation too would pay twice.
 *
 * Only stored rows are payable. A stored row with no supplier on it is still a
 * debt — mill expenses (fuel, lunch, maintenance, a one-off transport run) are
 * routinely entered without naming a vendor — so those collect under one bucket
 * rather than being dropped.
 */

export const UNASSIGNED = '__unassigned__';

// Derived rows carry a lettered prefix; stored rows are plain integers.
export const isStoredPayable = (p) => /^\d+$/.test(String(p?.id ?? ''));

// Does this payable belong in the "no supplier" bucket?
export const isUnassignedPayable = (p) => isStoredPayable(p) && !p?.supplierName && !p?.supplierId;

// The payables a given directory row should settle. `UNASSIGNED` collects every
// stored bill with no supplier; anything else matches on supplier id.
export function payablesForRow(payables, rowId) {
  const list = Array.isArray(payables) ? payables : [];
  if (rowId === UNASSIGNED) return list.filter(isUnassignedPayable);
  return list.filter((p) => isStoredPayable(p) && String(p.supplierId) === String(rowId));
}
