/**
 * Value the mill's inventory lots — the D-14 stock value (owner decision
 * 2026-10-15), the same basis as the backend's stockValue.js:
 *
 *   value = landed cost per KG × KG on hand (netWeightKg, falling back to qty)
 *
 * No fallback prices. A lot with no landed cost is worth 0 here and is counted
 * in `unpricedLots` so the dashboard can say so — it used to be valued at a
 * hard-coded Rs 190/kg finished, 150 raw, 38 broken, 28 bran, 8.4 other, which
 * made a zero-cost blend look like Rs 6.8m of finished rice.
 *
 * Inventory is stored in KG throughout — see shared/utils/unitConversion.js:
 * "All inventory stored in KG internally". A lot's `unit` field still reads
 * "MT", but that is a DISPLAY LABEL, not the unit of `qty`: a lot reading
 * qty 50.0000 · unit MT · netWeightKg 50.00 is fifty KILOS. (The dashboard once
 * multiplied by 1000 and showed Rs 88.8bn for Rs 113.5m of stock.)
 *
 * On hand, not available: reserved and milling-committed rice is still ours.
 * Mill stock only — export-entity lots belong to the export side.
 */

const pf = (v) => parseFloat(v) || 0;

/** KG on hand: net weight, falling back to qty (both KG). */
export function onHandKg(lot) {
  return pf(lot.netWeightKg) > 0 ? pf(lot.netWeightKg) : pf(lot.qty);
}

/**
 * @param {Array} lots inventory lots as the API returns them (camelCase)
 * @returns {{raw:number, fin:number, bp:number, total:number, unpricedLots:number}} PKR
 */
export function valueInventory(lots) {
  let raw = 0;
  let fin = 0;
  let bp = 0;
  let unpricedLots = 0;

  for (const lot of Array.isArray(lots) ? lots : []) {
    if (lot.entity && lot.entity !== 'mill') continue;
    if (lot.ownership && lot.ownership !== 'company') continue;
    const kg = onHandKg(lot);
    if (!(kg > 0)) continue;
    const costKg = pf(lot.landedCostPerKg);
    if (!(costKg > 0)) unpricedLots += 1;
    const value = kg * costKg;
    if (lot.type === 'raw') raw += value;
    else if (lot.type === 'finished') fin += value;
    else if (lot.type === 'byproduct') bp += value;
  }

  return { raw, fin, bp, total: raw + fin + bp, unpricedLots };
}
