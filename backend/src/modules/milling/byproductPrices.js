/**
 * By-product sale prices on a milling batch — units and sanity.
 *
 * Every `*_price_per_kg` column on milling_batches is Rs per KG. Rice and its
 * by-products sell for roughly Rs 5–400 per kg (husk at the bottom, premium
 * finished rice at the top). The same figure per METRIC TON is 1000× larger
 * (Rs 38/kg broken = Rs 38,000/MT), so a per-MT number typed or defaulted into
 * a per-kg field is off by three orders of magnitude.
 *
 * That is exactly what happened: GET /last-prices fell back to per-MT defaults
 * (broken 38000, bran 28000, husk 8400, sortex 35000) when no earlier batch had
 * confirmed prices, the costing drawer saved them as per-kg, and every later
 * batch copied them forward from "last prices".
 */

// Ceiling for a plausible per-kg price. Rs 2,000/kg is 5× the dearest rice the
// mill handles (~Rs 400/kg) and still 19× below the cheapest per-MT figure that
// could be confused for it (husk ~Rs 8,400/MT → 8.4/kg would never trip, but
// Rs 8,400 entered as per-kg does). Anything above it is almost certainly a
// per-MT value in a per-kg field.
const MAX_PRICE_PER_KG = 2000;

// Per-KG starting values offered by the costing drawer when no previous batch
// has usable prices. Same figures the per-batch fallback chain has always used.
const DEFAULT_PRICES_PER_KG = Object.freeze({
  finished: 72.8, broken: 38, bran: 28, husk: 8.4, sortex: 35,
});

// Body field → human label, for every by-product price the batch stores.
const BYPRODUCT_PRICE_FIELDS = Object.freeze({
  broken_price_per_kg: 'Broken',
  b1_price_per_kg: 'B1',
  b2_price_per_kg: 'B2',
  b3_price_per_kg: 'B3',
  csr_price_per_kg: 'CSR',
  short_grain_price_per_kg: 'Short Grain',
  bran_price_per_kg: 'Rice Bran',
  husk_price_per_kg: 'Rice Husk',
  sortex_rejects_price_per_kg: 'Sortex Rejects',
  powder_price_per_kg: 'Powder',
  sweeping_price_per_kg: 'Sweeping',
  choba_price_per_kg: 'Choba',
});

// A stored price usable as a per-kg starting value: positive and plausible.
// A value above the ceiling is treated as missing so a bad row can never be
// copied forward into the next batch again.
function usablePerKg(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_PER_KG ? n : null;
}

/**
 * The "last prices" payload: the most recent confirmed batch's prices, each
 * falling back to the per-KG default when missing or implausible. Grade prices
 * (B1…Short Grain) fall back to the aggregate broken price.
 */
function buildLastPrices(last) {
  const src = last || {};
  const broken = usablePerKg(src.broken_price_per_kg) ?? DEFAULT_PRICES_PER_KG.broken;
  return {
    finished: usablePerKg(src.finished_price_per_kg) ?? DEFAULT_PRICES_PER_KG.finished,
    broken,
    bran: usablePerKg(src.bran_price_per_kg) ?? DEFAULT_PRICES_PER_KG.bran,
    husk: usablePerKg(src.husk_price_per_kg) ?? DEFAULT_PRICES_PER_KG.husk,
    sortex: usablePerKg(src.sortex_rejects_price_per_kg) ?? DEFAULT_PRICES_PER_KG.sortex,
    b1: usablePerKg(src.b1_price_per_kg) ?? broken,
    b2: usablePerKg(src.b2_price_per_kg) ?? broken,
    b3: usablePerKg(src.b3_price_per_kg) ?? broken,
    csr: usablePerKg(src.csr_price_per_kg) ?? broken,
    short_grain: usablePerKg(src.short_grain_price_per_kg) ?? broken,
    fromBatch: last ? last.batch_no : null,
    date: last ? last.completed_at : null,
  };
}

/**
 * By-product price fields in a request body whose value is above the per-kg
 * ceiling. Returns [{ field, label, value }]; empty when every price is sane.
 */
function findImplausiblePrices(body) {
  const out = [];
  for (const [field, label] of Object.entries(BYPRODUCT_PRICE_FIELDS)) {
    const n = parseFloat(body ? body[field] : undefined);
    if (Number.isFinite(n) && n > MAX_PRICE_PER_KG) out.push({ field, label, value: n });
  }
  return out;
}

function implausiblePriceMessage(bad) {
  const list = bad.map((b) => `${b.label} Rs ${b.value.toLocaleString('en-US')}`).join(', ');
  const hint = bad.map((b) => `${b.label} Rs ${(b.value / 1000).toLocaleString('en-US')}`).join(', ');
  return `By-product prices are per KG. ${list} looks like a per-MT price `
    + `(the ceiling is Rs ${MAX_PRICE_PER_KG.toLocaleString('en-US')}/kg). `
    + `If it is per MT, enter ${hint} per kg instead.`;
}

/**
 * Sale value (PKR) of a batch's by-products at its own recorded per-kg prices —
 * the same credit the residual cost engine (computeResidualAllocation) takes.
 * Broken is stored both as an aggregate (broken_kg) and as a per-grade split
 * (b1…short_grain, summing to broken_kg); the split is valued when present,
 * otherwise the aggregate, never both. Grade prices fall back to the aggregate
 * broken price.
 */
function byproductSaleValue(batch) {
  const p = (v) => parseFloat(v) || 0;
  const b = batch || {};
  const brokenPrice = p(b.broken_price_per_kg);
  const grade = (qty, price) => p(qty) * (p(price) || brokenPrice);
  const gradeQty = p(b.b1_kg) + p(b.b2_kg) + p(b.b3_kg) + p(b.csr_kg) + p(b.short_grain_kg);
  const broken = gradeQty > 0
    ? grade(b.b1_kg, b.b1_price_per_kg) + grade(b.b2_kg, b.b2_price_per_kg) + grade(b.b3_kg, b.b3_price_per_kg)
      + grade(b.csr_kg, b.csr_price_per_kg) + grade(b.short_grain_kg, b.short_grain_price_per_kg)
    : p(b.broken_kg) * brokenPrice;
  return broken
    + p(b.bran_kg) * p(b.bran_price_per_kg)
    + p(b.husk_kg) * p(b.husk_price_per_kg)
    + p(b.sortex_rejects_kg) * p(b.sortex_rejects_price_per_kg)
    + p(b.powder_kg) * p(b.powder_price_per_kg)
    + p(b.sweeping_kg) * p(b.sweeping_price_per_kg)
    + p(b.choba_kg) * p(b.choba_price_per_kg);
}

module.exports = {
  byproductSaleValue,
  MAX_PRICE_PER_KG,
  DEFAULT_PRICES_PER_KG,
  BYPRODUCT_PRICE_FIELDS,
  buildLastPrices,
  findImplausiblePrices,
  implausiblePriceMessage,
};
