/**
 * Value the mill's inventory lots.
 *
 * Inventory is stored in KG throughout — see shared/utils/unitConversion.js:
 * "All inventory stored in KG internally". A lot's `unit` field still reads
 * "MT", but that is a DISPLAY LABEL, not the unit of `qty` / `availableQty`:
 * a lot reading qty 50.0000 · unit MT · netWeightKg 50.00 is fifty KILOS.
 *
 * The dashboard used to multiply the quantity by 1000 to "convert MT to KG",
 * which valued finished rice and by-products 1000x over. On the go-live opening
 * stock that showed Rs 88,824,322,750 against a true Rs 113,540,226.
 *
 * Cost fields are per KG (`landedCostPerKg` / `ratePerKg`), so value = kg x cost.
 */

const pf = (v) => parseFloat(v) || 0;

/** Per-KG stand-ins for a lot that carries no cost at all. */
export const FALLBACK_COST_PER_KG = { raw: 150, finished: 190, broken: 38, bran: 28, other: 8.4 };

/** By-product fallback depends on what the by-product is. */
export function byproductFallbackCostPerKg(itemName) {
  const name = String(itemName || '').toLowerCase();
  if (name.includes('broken')) return FALLBACK_COST_PER_KG.broken;
  if (name.includes('bran')) return FALLBACK_COST_PER_KG.bran;
  return FALLBACK_COST_PER_KG.other;
}

/**
 * @param {Array} lots inventory lots as the API returns them (camelCase)
 * @returns {{raw:number, fin:number, bp:number, total:number}} PKR
 */
export function valueInventory(lots) {
  let raw = 0;
  let fin = 0;
  let bp = 0;

  for (const lot of Array.isArray(lots) ? lots : []) {
    const qtyKg = pf(lot.availableQty || lot.qty);
    const costKg = pf(lot.landedCostPerKg) || pf(lot.ratePerKg);

    if (lot.type === 'raw') {
      // Raw is valued on the weight RECEIVED (netWeightKg), falling back to what
      // remains. Left as it was deliberately: received-vs-remaining is a costing
      // policy question, not part of this unit fix.
      raw += (costKg || FALLBACK_COST_PER_KG.raw) * (pf(lot.netWeightKg) || qtyKg);
    } else if (lot.type === 'finished') {
      fin += (costKg || FALLBACK_COST_PER_KG.finished) * qtyKg;
    } else if (lot.type === 'byproduct') {
      bp += (costKg || byproductFallbackCostPerKg(lot.itemName)) * qtyKg;
    }
  }

  return { raw, fin, bp, total: raw + fin + bp };
}
