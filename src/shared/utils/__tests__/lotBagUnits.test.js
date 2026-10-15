import { describe, it, expect } from 'vitest';
import { lotBagKg, sumLotsFromKg, fromKg } from '../unitConversion';

// P3-15 / INV-31: katta and bag figures use each lot's own bag weight.
describe('lotBagKg', () => {
  it.each([
    [{ bagWeightKg: 25 }, 25],
    [{ bagWeightKg: '40' }, 40],
    [{ bag_weight_kg: 50 }, 50],
    [{ bagWeightKg: 0, bagSizeKg: 25 }, 25],
    [{}, 50],
    [null, 50],
  ])('%j → %s', (lot, kg) => {
    expect(lotBagKg(lot)).toBe(kg);
  });
});

describe('katta count for 25 / 40 / 50 kg lots', () => {
  it.each([[25, 1000, 40], [40, 1000, 25], [50, 1000, 20]])('%s kg bags: %s kg = %s katta', (bw, kg, katta) => {
    expect(fromKg(kg, 'katta', lotBagKg({ bagWeightKg: bw }))).toBe(katta);
  });

  it('a grouped row sums each lot with its own weight, not a flat 50', () => {
    const lots = [
      { netWeightKg: 1000, bagWeightKg: 25 }, // 40 bags
      { netWeightKg: 1000, bagWeightKg: 40 }, // 25 bags
      { netWeightKg: 1000, bagWeightKg: 50 }, // 20 bags
    ];
    expect(sumLotsFromKg(lots, (l) => l.netWeightKg, 'katta')).toBe(85);
    // kg is unit-independent of the bag weight
    expect(sumLotsFromKg(lots, (l) => l.netWeightKg, 'kg')).toBe(3000);
    // the old behaviour (3000 kg / 50) would have said 60
    expect(fromKg(3000, 'katta', 50)).toBe(60);
  });
});
