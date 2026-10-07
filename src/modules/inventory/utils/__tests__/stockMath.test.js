import { describe, test, expect } from 'vitest';
import { splitOnHand, unitsOnHand, onHandKg, formatUnits, transferKg } from '../stockMath';

describe('Internal transfer quantity', () => {
  test('reads qtyKg (internal_transfers.qty_kg after transformKeys)', () => {
    expect(transferKg({ qtyKg: '2500.000' })).toBe(2500);
    expect(transferKg({ qty_kg: 1200 })).toBe(1200);
  });
  test('falls back to legacy qtyMt × 1000 only when no KG field exists', () => {
    expect(transferKg({ qtyMt: 2.5 })).toBe(2500);
    expect(transferKg({ qtyKg: 0, qtyMt: 9 })).toBe(0);
  });
  test('missing transfer counts as 0', () => {
    expect(transferKg(null)).toBe(0);
    expect(transferKg({})).toBe(0);
  });
});

describe('Stock Summary row math', () => {
  test('free + committed + reserved for milling = on hand', () => {
    // 10,000 kg on hand: 2,000 committed to an export order, 3,000 held by a
    // started milling batch. available_qty = qty − reserved − milling = 5,000.
    const row = { total_kg: '10000', available_kg: '5000', reserved_kg: '2000', milling_reserved_kg: '3000' };
    const s = splitOnHand(row);
    expect(s.free + s.committed + s.milling).toBe(s.onHand);
    expect(s.unexplained).toBe(0);
  });

  test('the old two-column view did not add up when milling held stock — the bug', () => {
    const row = { total_kg: 10000, available_kg: 5000, reserved_kg: 2000, milling_reserved_kg: 3000 };
    const s = splitOnHand(row);
    expect(s.free + s.committed).not.toBe(s.onHand);
    expect(s.milling).toBe(3000);
  });

  test('drift between net weight and qty is surfaced, not hidden', () => {
    const s = splitOnHand({ total_kg: 1000, available_kg: 990, reserved_kg: 0, milling_reserved_kg: 0 });
    expect(s.unexplained).toBe(10);
  });

  test('missing milling column reads as zero', () => {
    const s = splitOnHand({ total_kg: 500, available_kg: 500, reserved_kg: 0 });
    expect(s.milling).toBe(0);
    expect(s.unexplained).toBe(0);
  });
});

describe('units on hand (katta vs bags)', () => {
  test('intake sacks are scaled by the weight left, not reported as intake', () => {
    expect(unitsOnHand({ total_bags: 530, received_net_weight_kg: 26495, net_weight_kg: 22995 })).toEqual({ katta: 460, bags: 0 });
  });

  test('a fully consumed lot has no sacks left', () => {
    expect(unitsOnHand({ total_bags: 1000, received_net_weight_kg: 49857, net_weight_kg: 0, qty: 0 })).toEqual({ katta: 0, bags: 0 });
  });

  test('sub-50 kg packs are Bags, not katta', () => {
    expect(unitsOnHand({ total_bags: 0, net_weight_kg: 500, bag_weight_kg: 25 })).toEqual({ katta: 0, bags: 20 });
  });

  test('unknown pack size (0) counts as katta', () => {
    expect(unitsOnHand({ net_weight_kg: 500, bag_weight_kg: 0 })).toEqual({ katta: 10, bags: 0 });
  });

  test('on hand falls back to qty when net weight is missing', () => {
    expect(onHandKg({ net_weight_kg: 0, qty: '750' })).toBe(750);
  });

  test('formatUnits', () => {
    expect(formatUnits({ katta: 1200, bags: 0 })).toBe('1,200 katta');
    expect(formatUnits({ katta: 0, bags: 0 })).toBe('');
    expect(formatUnits({ katta: 3, bags: 4 })).toBe('3 katta · 4 bags');
  });
});
