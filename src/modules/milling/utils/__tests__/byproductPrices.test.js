import { describe, it, expect } from 'vitest';
import { byproductRevenuePKR, batchByproductRevenuePKR, isImplausiblePerKg, MAX_PRICE_PER_KG } from '../byproductPrices';
import { transformBatch } from '../../../../api/transforms';

// Prod M-001 as the transform delivers it (MT quantities, per-MT prices = per-kg × 1000).
const M001 = {
  actualFinishedMT: 2.5, brokenMT: 0.75, b2MT: 0.55, csrMT: 0.2, powderMT: 0.06, sweepingMT: 0.5,
  brokenPricePerMT: 38000 * 1000, b1PricePerMT: 38000 * 1000, b2PricePerMT: 100 * 1000,
  csrPricePerMT: 100 * 1000, powderPricePerMT: 50 * 1000, sweepingPricePerMT: 202 * 1000,
  branPricePerMT: 28000 * 1000, huskPricePerMT: 8400 * 1000,
};

describe('byproductRevenuePKR', () => {
  it('values the broken grade split, never brokenMT × the aggregate price', () => {
    // B2 55,000 + CSR 20,000 + powder 3,000 + sweeping 101,000 — was 28,500,000.
    expect(byproductRevenuePKR(M001, 38000)).toBeCloseTo(179000, 6);
  });

  it('uses the aggregate broken price when there is no grade split', () => {
    expect(byproductRevenuePKR({ brokenMT: 1, brokenPricePerMT: 40000 })).toBeCloseTo(40000, 6);
  });

  it('falls back to the commodity broken rate when the batch has none', () => {
    expect(byproductRevenuePKR({ brokenMT: 1 }, 38000)).toBeCloseTo(38000, 6);
    expect(byproductRevenuePKR({ b1MT: 1 }, 38000)).toBeCloseTo(38000, 6);
  });
});

describe('isImplausiblePerKg', () => {
  it('flags per-MT figures and allows real per-kg prices', () => {
    expect(isImplausiblePerKg('38000')).toBe(true);
    expect(isImplausiblePerKg(MAX_PRICE_PER_KG)).toBe(false);
    expect(isImplausiblePerKg('38')).toBe(false);
    expect(isImplausiblePerKg('')).toBe(false);
  });
});

describe('batchByproductRevenuePKR', () => {
  it('uses what the yield booked on the output lots, even after the batch prices were edited', () => {
    const edited = { ...M001, b2PricePerMT: 999 * 1000, sweepingPricePerMT: 999 * 1000 };
    const b = { ...edited, outputValue: { byproductValue: 179000, finishedValue: 665903, source: 'yield_lots' } };
    expect(batchByproductRevenuePKR(b, 38000)).toBe(179000);
  });

  it('a stored 0 (only a finished lot) stays 0 — no fallback', () => {
    expect(batchByproductRevenuePKR({ brokenMT: 1, outputValue: { byproductValue: 0, source: 'yield_lots' } }, 38000)).toBe(0);
  });

  it('falls back to the batch prices when there is no stored output (or it was redacted)', () => {
    expect(batchByproductRevenuePKR({ ...M001, outputValue: null }, 38000)).toBeCloseTo(179000, 6);
    expect(batchByproductRevenuePKR(M001, 38000)).toBeCloseTo(179000, 6);
  });

  it('transformBatch carries output_value through as outputValue', () => {
    const t = transformBatch({ id: 1, batch_no: 'M-001', output_value: { byproductValue: 179000, source: 'yield_lots' } });
    expect(t.outputValue).toEqual({ byproductValue: 179000, source: 'yield_lots' });
    expect(transformBatch({ id: 2, batch_no: 'M-002' }).outputValue).toBeNull();
  });
});
