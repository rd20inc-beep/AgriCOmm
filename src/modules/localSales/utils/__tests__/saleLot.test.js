import { describe, it, expect } from 'vitest';
import { lotFreeKg, lotSaleBlock, saleCogs } from '../saleLot';

// P3-12: soft reservation, server-flag cost check, one locked COGS.
describe('lotFreeKg', () => {
  it('is available less what pending sales hold', () => {
    expect(lotFreeKg({ availableQty: '10000', pendingSaleKg: '6000' })).toBe(4000);
    expect(lotFreeKg({ availableQty: 10000 })).toBe(10000);
    expect(lotFreeKg({ available_qty: 500, pending_sale_kg: 800 })).toBe(0);
    expect(lotFreeKg(null)).toBe(0);
  });
});

describe('lotSaleBlock (INV-52)', () => {
  it('uses the has_cost flag, not redacted cost figures', () => {
    // A cost-blind role: costs are null but the server says the lot has one.
    expect(lotSaleBlock({ lotNo: 'L1', hasCost: true, landedCostPerKg: null, costPerUnit: null })).toBeNull();
    expect(lotSaleBlock({ lotNo: 'L2', hasCost: false })).toMatch(/L2 has no recorded cost/);
  });
  it('without the flag the server decides — nothing refused here', () => {
    expect(lotSaleBlock({ lotNo: 'L3', landedCostPerKg: null })).toBeNull();
  });
});

describe('saleCogs (INV-54)', () => {
  it('a confirmed sale reports its locked COGS, not the estimate', () => {
    expect(saleCogs({ status: 'Completed', lotId: 1, cogsTotalPkr: '120000', landedCostTotal: '100000' }))
      .toEqual({ cost: 120000, locked: true });
  });
  it('a confirmed lot sale from before the lock falls back to landed_cost_total', () => {
    expect(saleCogs({ status: 'Completed', lotId: 1, cogsTotalPkr: null, landedCostTotal: 90000 }).cost).toBe(90000);
  });
  it('a confirmed line with no lot posted no COGS', () => {
    expect(saleCogs({ status: 'Completed', lotId: null, cogsTotalPkr: null, landedCostTotal: 500 }).cost).toBe(0);
  });
  it('a pending sale shows an estimate', () => {
    expect(saleCogs({ status: 'Pending', lotId: 1, landedCostTotal: 100000 })).toEqual({ cost: 100000, locked: false });
    expect(saleCogs({ status: 'Pending', lot_id: 1, cost_per_kg: 100, quantity_kg: 50 }).cost).toBe(5000);
  });
});
