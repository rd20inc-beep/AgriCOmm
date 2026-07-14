/**
 * Stage 0 — behaviour lock. Golden characterization of the residual-costing
 * engine `inventoryService.computeResidualAllocation` (the finished-goods cost =
 * Net Purchase − by-product sale value, split across outputs). Pure function:
 * we mock the DB module so requiring the service never opens a connection.
 *
 * These assertions capture CURRENT output. If a later offline-migration stage
 * changes a number here, that is a red flag to review — not to "fix the test".
 */
jest.mock('../config/database', () => jest.fn());

const inventoryService = require('../modules/inventory/inventory.service');
const compute = (batch, raw, proc, pack = 0) =>
  inventoryService.computeResidualAllocation(batch, raw, proc, pack);

describe('computeResidualAllocation (residual costing engine)', () => {
  test('simple finished + broken by-product, no overrides', () => {
    const r = compute({ actual_finished_kg: 700, broken_kg: 200, broken_price_per_kg: 50 }, 100000, 20000, 0);
    expect(r.netPurchase).toBe(120000);        // 100000 raw + 0 milling + 20000 other + 0 packing
    expect(r.byproductValue).toBe(10000);      // 200kg × 50
    expect(r.finishedTotal).toBe(110000);      // 120000 − 10000
    expect(r.finishedCostPerKg).toBeCloseTo(157.142857, 5); // 110000 / 700
    expect(r.rawFrac).toBeCloseTo(0.833333, 5);
    expect(r.millFrac).toBeCloseTo(0.166667, 5);
    expect(r.clamped).toBe(false);
    expect(r.hasPerGradeBroken).toBe(false);
  });

  test('manual milling + manual other override + packing', () => {
    const r = compute(
      { actual_finished_kg: 1000, manual_milling_cost_pkr: 5000, manual_other_expenses_pkr: 8000 },
      200000, 30000 /* processing IGNORED when manual other > 0 */, 2000);
    expect(r.millingCost).toBe(5000);
    expect(r.otherExpenses).toBe(8000);        // manual > 0 overrides the 30000 processing
    expect(r.packing).toBe(2000);
    expect(r.netPurchase).toBe(215000);        // 200000 + 5000 + 8000 + 2000
    expect(r.finishedCostPerKg).toBeCloseTo(215, 6);
  });

  test('manual other = 0 must NOT hide real processing costs', () => {
    const r = compute({ actual_finished_kg: 500, manual_other_expenses_pkr: 0 }, 50000, 10000, 0);
    expect(r.otherExpenses).toBe(10000);       // 0 is "unset", falls back to processing
    expect(r.netPurchase).toBe(60000);
    expect(r.finishedCostPerKg).toBeCloseTo(120, 6);
  });

  test('per-grade broken → qty-weighted tier rate', () => {
    const r = compute(
      { actual_finished_kg: 600, b1_kg: 100, b2_kg: 50, b1_price_per_kg: 60, b2_price_per_kg: 40, broken_price_per_kg: 30 },
      120000, 0, 0);
    expect(r.hasPerGradeBroken).toBe(true);
    expect(r.byproductValue).toBe(8000);       // 100×60 + 50×40
    expect(r.brokenTierCostPerKg).toBeCloseTo(53.333333, 5); // 8000 / 150
  });

  test('by-product value exceeding net purchase clamps finished to 0', () => {
    const r = compute({ actual_finished_kg: 10, broken_kg: 1000, broken_price_per_kg: 100 }, 5000, 0, 0);
    expect(r.byproductValue).toBe(100000);
    expect(r.clamped).toBe(true);
    expect(r.finishedTotal).toBe(0);
    expect(r.finishedCostPerKg).toBe(0);
  });
});
