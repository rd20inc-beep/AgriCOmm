/**
 * The MT ↔ KG document boundary — the one place the backend converts.
 *
 * The stock / milling engine is KG (mig 228): quantities in KG, rates per KG.
 * Export orders, quotations, contracts and printed export documents keep
 * metric tons (qty_mt, price_per_mt, USD/MT) as a declared document boundary.
 * Every crossing of that boundary goes through these four functions instead
 * of an inline ×1000 / ÷1000, so the direction is named at the call site.
 *
 * Rounding rule: the conversions are EXACT (a plain ×1000 or ÷1000 on the
 * parsed number — the same floating-point operation the inline code did), so
 * routing a call site through them never changes a result. Rounding is a
 * presentation / persistence decision taken by the caller: KG to 3 dp
 * (roundKg), per-KG rates to 4 dp (roundRate), MT to 3 dp (roundMt), the same
 * precision services/unitConversion.js uses for stored values.
 *
 * Input: anything parseFloat understands (DB numerics arrive as strings);
 * null / undefined / '' / non-numeric count as 0, matching the
 * `(parseFloat(x) || 0)` the call sites used.
 *
 * Kept in step with the frontend twin in src/shared/utils/unitConversion.js.
 */

const KG_PER_MT = 1000;

const toNum = (v) => parseFloat(v) || 0;

/** Metric tons → kilograms. */
function mtToKg(mt) {
  return toNum(mt) * KG_PER_MT;
}

/** Kilograms → metric tons. */
function kgToMt(kg) {
  return toNum(kg) / KG_PER_MT;
}

/** A rate per metric ton → the same rate per kilogram. */
function perMtToPerKg(ratePerMt) {
  return toNum(ratePerMt) / KG_PER_MT;
}

/** A rate per kilogram → the same rate per metric ton. */
function perKgToPerMt(ratePerKg) {
  return toNum(ratePerKg) * KG_PER_MT;
}

const roundTo = (v, dp) => {
  const f = 10 ** dp;
  return Math.round(toNum(v) * f) / f;
};
const roundKg = (kg) => roundTo(kg, 3);
const roundMt = (mt) => roundTo(mt, 3);
const roundRate = (rate) => roundTo(rate, 4);

// ─── Bags (katta) ───
// A lot's quantity is KG; its bag count is DERIVED from the lot's own bag
// weight, never from a hard-coded 50: a 25 kg-packed lot of 21,825 kg is 873
// bags, not 437 katta. 50 kg (the standard jute katta) is only the fallback for
// a lot that carries no bag spec at all. Same precedence as stockSql.packKg:
// bag_weight_kg, then bag_size_kg, then the default. Reads snake_case DB rows
// and camelCase API rows alike.
const DEFAULT_BAG_KG = 50;

function lotBagKg(lot) {
  if (!lot) return DEFAULT_BAG_KG;
  const w = toNum(lot.bag_weight_kg ?? lot.bagWeightKg);
  if (w > 0) return w;
  const s = toNum(lot.bag_size_kg ?? lot.bagSizeKg);
  if (s > 0) return s;
  return DEFAULT_BAG_KG;
}

/** KG → bags of `bagKg` each, exact (the caller rounds). 0 for a missing size. */
function kgToBagCount(kg, bagKg = DEFAULT_BAG_KG) {
  const b = toNum(bagKg);
  return b > 0 ? toNum(kg) / b : 0;
}

/** Whole bags a lot's `kg` fills, using the lot's own bag weight. */
function lotBagCount(lot, kg) {
  return Math.round(kgToBagCount(kg, lotBagKg(lot)));
}

module.exports = {
  KG_PER_MT,
  mtToKg, kgToMt, perMtToPerKg, perKgToPerMt,
  roundKg, roundMt, roundRate,
  DEFAULT_BAG_KG, lotBagKg, kgToBagCount, lotBagCount,
};
