// By-product prices on a milling batch are Rs per KG. A per-MT figure in a
// per-kg field is 1000× too large — the bug that put Rs 38,000 "per kg" on
// every completed batch's broken/B1/B3/short-grain price. Mirrors
// backend/src/modules/milling/byproductPrices.js.

// Rs 2,000/kg is 5× the dearest rice the mill handles (~Rs 400/kg); anything
// above it is almost certainly a per-MT price. The server refuses it (400).
export const MAX_PRICE_PER_KG = 2000;

export const isImplausiblePerKg = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > MAX_PRICE_PER_KG;
};

/**
 * Sale value (PKR) of a transformed batch's by-products at its own prices —
 * the residual engine's by-product credit. The broken GRADE split is valued
 * when the batch recorded one (it sums to brokenMT), otherwise the aggregate;
 * never both. Grade prices fall back to the aggregate broken price, and a
 * batch with no broken price at all to `fallbackBrokenPerMT`.
 * Quantities are the *MT keys, prices the *PricePerMT keys (MT × per-MT = PKR).
 */
export function byproductRevenuePKR(b, fallbackBrokenPerMT = 0) {
  const n = (v) => parseFloat(v) || 0;
  const brokenRate = n(b.brokenPricePerMT) || n(fallbackBrokenPerMT);
  const grade = (qty, rate) => n(qty) * (n(rate) || brokenRate);
  const gradeQty = n(b.b1MT) + n(b.b2MT) + n(b.b3MT) + n(b.csrMT) + n(b.shortGrainMT);
  const broken = gradeQty > 0
    ? grade(b.b1MT, b.b1PricePerMT) + grade(b.b2MT, b.b2PricePerMT) + grade(b.b3MT, b.b3PricePerMT)
      + grade(b.csrMT, b.csrPricePerMT) + grade(b.shortGrainMT, b.shortGrainPricePerMT)
    : n(b.brokenMT) * brokenRate;
  return broken
    + n(b.branMT) * n(b.branPricePerMT)
    + n(b.huskMT) * n(b.huskPricePerMT)
    + n(b.sortexRejectsMT) * n(b.sortexRejectsPricePerMT)
    + n(b.powderMT) * n(b.powderPricePerMT)
    + n(b.sweepingMT) * n(b.sweepingPricePerMT)
    + n(b.chobaMT) * n(b.chobaPricePerMT);
}
