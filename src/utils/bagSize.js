// Katta (empty rice sack) nominal SIZE handling — mirrors the backend
// helper in backend/src/services/unitConversion.js (keep the two in sync).
//
// A katta is a physical sack of a fixed nominal size. The rice weight inside is
// slightly under nominal (shrinkage / actual arrival), so weight ÷ bags rounds
// DOWN (e.g. 10804/219 = 49.3 → 49). `snapBagSizeKg` snaps a derived/entered
// size to the nearest STANDARD sack size when it's within tolerance, so
// near-standard noise settles on the real size (50) instead of an off-size 49.

export const STANDARD_BAG_SIZES = [10, 25, 40, 50];
export const BAG_SIZE_SNAP_TOLERANCE = 0.08; // 8%
export const DEFAULT_BAG_SIZE_KG = 50;

// Snap to the nearest standard sack size when within tolerance
// (|kg − S| ≤ max(2, 8%·S)); else the plain rounded value; 0 for non-positive.
export function snapBagSizeKg(kg) {
  const v = parseFloat(kg) || 0;
  if (v <= 0) return 0;
  let best = null;
  let bestDiff = Infinity;
  for (const s of STANDARD_BAG_SIZES) {
    const diff = Math.abs(v - s);
    if (diff <= Math.max(2, BAG_SIZE_SNAP_TOLERANCE * s) && diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best != null ? best : Math.round(v);
}

export function isStandardBagSize(kg) {
  return STANDARD_BAG_SIZES.includes(Math.round(parseFloat(kg) || 0));
}
