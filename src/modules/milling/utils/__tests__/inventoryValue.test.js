import { describe, it, expect } from 'vitest';
import { valueInventory } from '../inventoryValue';

// Shapes copied from production (/api/inventory), where `unit` says MT but the
// quantity is KG — the exact trap that produced the 1000x overstatement.
const finishedLot = {
  type: 'finished', lotNo: 'RENA C9 LOT1', unit: 'MT', entity: 'mill',
  qty: '50.0000', availableQty: '50.0000', netWeightKg: '50.00',
  costPerUnit: '172.7000', landedCostPerKg: '172.7000', ratePerKg: '172.7000',
};

describe('valueInventory (D-14: landed cost/kg × kg on hand, no fallback)', () => {
  it('values a finished lot at kg x cost-per-kg, not kg x 1000 x cost', () => {
    const { fin, total } = valueInventory([finishedLot]);
    expect(fin).toBeCloseTo(50 * 172.7, 2);   // 8,635 — fifty kilos
    expect(fin).not.toBeCloseTo(50 * 172.7 * 1000, 2);
    expect(total).toBeCloseTo(8635, 2);
  });

  it('values by-products per kg too', () => {
    const bran = { type: 'byproduct', itemName: 'Rice Bran', qty: '1000', landedCostPerKg: '28' };
    expect(valueInventory([bran]).bp).toBeCloseTo(28000, 2);
  });

  it('values on hand (net weight, else qty), not available', () => {
    const reserved = { type: 'raw', qty: '1000', availableQty: '200', netWeightKg: '1000', landedCostPerKg: '238' };
    expect(valueInventory([reserved]).raw).toBeCloseTo(1000 * 238, 2);
    const noNet = { type: 'raw', qty: '900', availableQty: '900', landedCostPerKg: '238' };
    expect(valueInventory([noNet]).raw).toBeCloseTo(900 * 238, 2);  // NOT 900 * 1000 * 238
  });

  it('keeps the go-live opening stock in millions, not billions', () => {
    const lots = [
      { type: 'finished', qty: '323116', landedCostPerKg: '249.04' },
      { type: 'byproduct', itemName: 'Broken Rice', qty: '71430', landedCostPerKg: '116.64' },
    ];
    const { fin, bp, total } = valueInventory(lots);
    expect(fin).toBeCloseTo(323116 * 249.04, 2);
    expect(bp).toBeCloseTo(71430 * 116.64, 2);
    expect(total).toBeLessThan(100_000_000);
    expect(total).toBeGreaterThan(80_000_000);
  });

  it('never invents a price: a lot with no landed cost is 0 and counted as unpriced', () => {
    const out = valueInventory([{ type: 'finished', qty: '10', ratePerKg: '300', costPerUnit: '300' }]);
    expect(out.fin).toBe(0);
    expect(out.unpricedLots).toBe(1);
  });

  it('values mill company stock only', () => {
    const exp = { ...finishedLot, entity: 'export' };
    const client = { ...finishedLot, ownership: 'client' };
    expect(valueInventory([exp, client]).total).toBe(0);
  });

  it('tolerates junk input', () => {
    expect(valueInventory(null).total).toBe(0);
    expect(valueInventory([{ type: 'finished' }]).total).toBe(0);
  });
});
