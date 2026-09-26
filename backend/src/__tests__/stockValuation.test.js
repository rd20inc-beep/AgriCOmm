const { toPerKg, buildRateIndex, valueLot, summarise } = require('../modules/inventory/stockValuation');

// Real shapes: lot costs are per KG; the one rate row on production is per_mt.
const B2_LOT = { type: 'byproduct', product_id: 7, grade: 'B2', available_qty: '22995', cost_per_unit: '118.83' };

describe('toPerKg — the unit trap that caused the 88-billion bug', () => {
  test('per_mt is divided by 1000', () => {
    expect(toPerKg(35000, 'per_mt')).toBe(35);
    expect(toPerKg('130000', 'per_mt')).toBe(130);
  });
  test('per_kg is left alone', () => {
    expect(toPerKg(130, 'per_kg')).toBe(130);
  });
  test('unit defaults to per_mt, matching the column default', () => {
    expect(toPerKg(35000, null)).toBe(35);
    expect(toPerKg(35000, undefined)).toBe(35);
  });
  test('an unknown unit returns null rather than a guess', () => {
    expect(toPerKg(35000, 'per_bag')).toBeNull();
    expect(toPerKg(35000, 'katta')).toBeNull();
  });
  test('junk returns null', () => {
    expect(toPerKg('abc', 'per_mt')).toBeNull();
    expect(toPerKg(null, 'per_mt')).toBeNull();
  });
});

describe('buildRateIndex', () => {
  test('the newest effective_date wins', () => {
    const idx = buildRateIndex([
      { product_id: 7, product_type: 'B2', rate_value: 120000, unit: 'per_mt', effective_date: '2026-09-01' },
      { product_id: 7, product_type: 'B2', rate_value: 130000, unit: 'per_mt', effective_date: '2026-09-25' },
    ]);
    expect(valueLot(B2_LOT, idx).sellingPerKg).toBe(130);
  });
  test('a rate in an unknown unit is skipped, not mis-applied', () => {
    const idx = buildRateIndex([{ product_id: 7, product_type: 'B2', rate_value: 130, unit: 'per_bag', effective_date: '2026-09-25' }]);
    expect(valueLot(B2_LOT, idx).hasRate).toBe(false);
  });
});

describe('valueLot', () => {
  test('profit is (selling - cost) x kg held', () => {
    const idx = buildRateIndex([{ product_id: 7, product_type: 'B2', rate_value: 130000, unit: 'per_mt', effective_date: '2026-09-25' }]);
    const v = valueLot(B2_LOT, idx);
    expect(v.costValue).toBeCloseTo(22995 * 118.83, 2);
    expect(v.marketValue).toBeCloseTo(22995 * 130, 2);
    expect(v.profit).toBeCloseTo(22995 * (130 - 118.83), 2);
  });

  test('a grade-specific rate beats the product-wide one', () => {
    const idx = buildRateIndex([
      { product_id: 7, product_type: null, rate_value: 100000, unit: 'per_mt', effective_date: '2026-09-25' },
      { product_id: 7, product_type: 'B2', rate_value: 130000, unit: 'per_mt', effective_date: '2026-09-25' },
    ]);
    expect(valueLot(B2_LOT, idx).sellingPerKg).toBe(130);
  });

  test('falls back to the product-wide rate when the grade has none', () => {
    const idx = buildRateIndex([{ product_id: 7, product_type: null, rate_value: 100000, unit: 'per_mt', effective_date: '2026-09-25' }]);
    expect(valueLot({ ...B2_LOT, grade: 'B3' }, idx).sellingPerKg).toBe(100);
  });

  test('an unpriced lot reports no market value — it is NEVER valued at cost', () => {
    const v = valueLot(B2_LOT, buildRateIndex([]));
    expect(v.hasRate).toBe(false);
    expect(v.marketValue).toBeNull();
    expect(v.profit).toBeNull();
    expect(v.costValue).toBeCloseTo(22995 * 118.83, 2);   // cost still known
  });

  test('a loss shows as a negative profit, not zero', () => {
    // D98 B2 cost 118.83 and sold at 115.00 — the real LS-0001 case.
    const idx = buildRateIndex([{ product_id: 7, product_type: 'B2', rate_value: 115000, unit: 'per_mt', effective_date: '2026-09-26' }]);
    const v = valueLot({ ...B2_LOT, available_qty: '3500' }, idx);
    expect(v.profit).toBeCloseTo(3500 * (115 - 118.83), 2);
    expect(v.profit).toBeLessThan(0);
    expect(Math.round(v.profit)).toBe(-13405);   // the exact loss booked on LS-0001
  });
});

describe('summarise', () => {
  const idx = buildRateIndex([{ product_id: 7, product_type: 'B2', rate_value: 130000, unit: 'per_mt', effective_date: '2026-09-25' }]);
  const lots = [B2_LOT, { type: 'finished', product_id: 9, grade: null, available_qty: '1000', cost_per_unit: '300' }];

  test('priced and unpriced stock are kept apart', () => {
    const s = summarise(lots, idx);
    expect(s.total.unpricedLots).toBe(1);
    expect(s.total.unpricedCostValue).toBeCloseTo(1000 * 300, 2);
    expect(s.byType.finished.marketValue).toBe(0);
    expect(s.byType.byproduct.profit).toBeCloseTo(22995 * (130 - 118.83), 2);
  });

  test('cost total covers ALL stock, priced or not', () => {
    const s = summarise(lots, idx);
    expect(s.total.costValue).toBeCloseTo(22995 * 118.83 + 1000 * 300, 2);
    expect(s.total.pricedCostValue).toBeCloseTo(22995 * 118.83, 2);
  });

  test('empty input is safe', () => {
    expect(summarise([], idx).total.costValue).toBe(0);
    expect(summarise(null, idx).total.profit).toBe(0);
  });
});
