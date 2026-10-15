/**
 * P3-15 / INV-31: a lot's katta / bag count comes from the lot's OWN bag
 * weight (bag_weight_kg, then bag_size_kg), never a literal 50. 50 kg is only
 * the fallback for a lot with no bag spec.
 */
const { lotBagKg, kgToBagCount, lotBagCount, DEFAULT_BAG_KG } = require('../shared/units');

describe('lot bag weight', () => {
  test.each([
    [{ bag_weight_kg: 25 }, 25],
    [{ bag_weight_kg: '40.000' }, 40],
    [{ bag_weight_kg: 50 }, 50],
    [{ bag_weight_kg: null, bag_size_kg: 25 }, 25],
    [{ bag_weight_kg: 0, bag_size_kg: '40' }, 40],
    [{ bagWeightKg: 25 }, 25], // camelCase API rows
    [{ bagSizeKg: 10 }, 10],
    [{}, 50],
    [null, 50],
  ])('%j → %s kg', (lot, kg) => {
    expect(lotBagKg(lot)).toBe(kg);
  });

  test('the fallback is the 50 kg katta', () => {
    expect(DEFAULT_BAG_KG).toBe(50);
  });
});

describe('katta count for 25 / 40 / 50 kg lots', () => {
  test.each([
    [25, 21825, 873],
    [40, 2000, 50],
    [50, 2000, 40],
    [25, 1000, 40],
  ])('%s kg bags: %s kg is %s bags', (bagKg, kg, bags) => {
    expect(lotBagCount({ bag_weight_kg: bagKg }, kg)).toBe(bags);
    expect(kgToBagCount(kg, bagKg)).toBeCloseTo(bags, 6);
  });

  test('a 25 kg lot is not read as 50 kg katta (the M-005 case)', () => {
    // 873 × 25 kg packed; the old flat-50 divisor reported 437.
    expect(lotBagCount({ bag_weight_kg: 25 }, 21825)).toBe(873);
    expect(lotBagCount({}, 21825)).toBe(437);
  });

  test('a missing bag size yields 0, not a division by zero', () => {
    expect(kgToBagCount(100, 0)).toBe(0);
    expect(kgToBagCount(100, null)).toBe(0);
  });
});
