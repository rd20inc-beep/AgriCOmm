import { describe, it, expect } from 'vitest';
import { valueInventory, byproductFallbackCostPerKg, FALLBACK_COST_PER_KG } from '../inventoryValue';

// Shapes copied from production (/api/inventory), where `unit` says MT but the
// quantity is KG — the exact trap that produced the 1000x overstatement.
const finishedLot = {
  type: 'finished', lotNo: 'RENA C9 LOT1', unit: 'MT',
  qty: '50.0000', availableQty: '50.0000', netWeightKg: '50.00',
  costPerUnit: '172.7000', landedCostPerKg: '172.7000', ratePerKg: '172.7000',
};

describe('valueInventory', () => {
  it('values a finished lot at kg x cost-per-kg, not kg x 1000 x cost', () => {
    const { fin, total } = valueInventory([finishedLot]);
    expect(fin).toBeCloseTo(50 * 172.7, 2);   // 8,635 — fifty kilos
    expect(fin).not.toBeCloseTo(50 * 172.7 * 1000, 2);
    expect(total).toBeCloseTo(8635, 2);
  });

  it('values by-products per kg too', () => {
    const bran = { type: 'byproduct', itemName: 'Rice Bran', availableQty: '1000', landedCostPerKg: '28' };
    expect(valueInventory([bran]).bp).toBeCloseTo(28000, 2);
  });

  it('values raw on received weight, falling back to remaining quantity', () => {
    const withNet = { type: 'raw', availableQty: '900', netWeightKg: '1000', landedCostPerKg: '238' };
    expect(valueInventory([withNet]).raw).toBeCloseTo(1000 * 238, 2);
    const noNet = { type: 'raw', availableQty: '900', landedCostPerKg: '238' };
    expect(valueInventory([noNet]).raw).toBeCloseTo(900 * 238, 2);  // NOT 900 * 1000 * 238
  });

  it('keeps the go-live opening stock in millions, not billions', () => {
    // Production quantities: 323,116 kg finished and 71,430 kg by-product. The
    // old formula turned Rs 88.7m of stock into Rs 88.7bn.
    const lots = [
      { type: 'finished', availableQty: '323116', landedCostPerKg: '249.04' },
      { type: 'byproduct', itemName: 'Broken Rice', availableQty: '71430', landedCostPerKg: '116.64' },
    ];
    const { fin, bp, total } = valueInventory(lots);
    expect(fin).toBeCloseTo(323116 * 249.04, 2);
    expect(bp).toBeCloseTo(71430 * 116.64, 2);
    expect(total).toBeLessThan(100_000_000);   // millions
    expect(total).toBeGreaterThan(80_000_000);
  });

  it('falls back per kg when a lot carries no cost', () => {
    expect(valueInventory([{ type: 'finished', availableQty: '10' }]).fin)
      .toBeCloseTo(10 * FALLBACK_COST_PER_KG.finished, 2);
  });

  it('picks the by-product fallback from the item name', () => {
    expect(byproductFallbackCostPerKg('Broken Rice B2')).toBe(38);
    expect(byproductFallbackCostPerKg('Rice Bran')).toBe(28);
    expect(byproductFallbackCostPerKg('Husk')).toBe(8.4);
  });

  it('tolerates junk input', () => {
    expect(valueInventory(null).total).toBe(0);
    expect(valueInventory([{ type: 'finished' }]).total).toBe(0);
  });
});
