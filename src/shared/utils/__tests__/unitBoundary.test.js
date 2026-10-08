import { describe, it, expect } from 'vitest';
import { mtToKg, kgToMt, perMtToPerKg, perKgToPerMt, KG_PER_MT } from '../unitConversion';
import { transformBatch } from '../../../api/transforms';
import { transferKg } from '../../../modules/inventory/utils/stockMath';
import { stockTransferView } from '../../../modules/finance/utils/stockTransfers';

/**
 * D2: KG inside, MT only at the export-document boundary. The four boundary
 * helpers are EXACT (the same ×1000 / ÷1000 the inline code did), so routing
 * a call site through them never changes a figure.
 */
const SAMPLES = [0, 1, 0.1, 0.3, 1 / 3, 12.345, 24.35, 20.0005, 0.001, 123456.789, '24.350', '0.1', '1e3', -5.5];

describe('MT ↔ KG boundary helpers', () => {
  it('1 MT is 1000 kg, rates scale the other way', () => {
    expect(KG_PER_MT).toBe(1000);
    expect(mtToKg(12.5)).toBe(12500);
    expect(kgToMt(487)).toBe(0.487);
    expect(perMtToPerKg(1290)).toBe(1.29);
    expect(perKgToPerMt(1.29)).toBe(1290);
  });

  it('null / undefined / "" / junk count as 0', () => {
    for (const v of [null, undefined, '', 'x']) {
      expect([mtToKg(v), kgToMt(v), perMtToPerKg(v), perKgToPerMt(v)]).toEqual([0, 0, 0, 0]);
    }
  });

  it('are bit-for-bit the inline (parseFloat(x) || 0) ×/÷ 1000', () => {
    for (const v of SAMPLES) {
      const p = parseFloat(v) || 0;
      expect(Object.is(mtToKg(v), p * 1000)).toBe(true);
      expect(Object.is(kgToMt(v), p / 1000)).toBe(true);
      expect(Object.is(perMtToPerKg(v), p / 1000)).toBe(true);
      expect(Object.is(perKgToPerMt(v), p * 1000)).toBe(true);
    }
  });
});

describe('converted call sites keep their numbers', () => {
  it('transformBatch MT / per-MT fields', () => {
    const b = transformBatch({
      id: 1, batch_no: 'M-001', raw_qty_kg: '12082.5', planned_finished_kg: 8000, actual_finished_kg: '7801.3',
      broken_kg: '0.3', bran_kg: null, finished_price_per_kg: '172.5', bran_price_per_kg: 0.1, husk_price_per_kg: null,
    });
    expect(b.rawQtyMT).toBe(12082.5 / 1000);
    expect(b.plannedFinishedMT).toBe(8);
    expect(b.actualFinishedMT).toBe(7801.3 / 1000);
    expect(b.brokenMT).toBe(0.3 / 1000);
    expect(b.branMT).toBe(0);
    expect(b.finishedPricePerMT).toBe(172.5 * 1000);
    expect(b.branPricePerMT).toBe(0.1 * 1000);
    expect(b.huskPricePerMT).toBe(0);
  });

  it("a transfer's KG: qty_kg wins, else qty_mt × 1000", () => {
    expect(transferKg({ qtyKg: '24350' })).toBe(24350);
    expect(transferKg({ qtyMt: '0.3' })).toBe(0.3 * 1000);
    expect(transferKg({ qty_mt: 20.0005 })).toBe(20.0005 * 1000);
    expect(transferKg(null)).toBe(0);
  });

  it('a stock transfer row shows KG and Rs/kg from the API row (qty_kg, per-MT price)', () => {
    const v = stockTransferView({
      id: 7, transferNo: 'IT-007', dispatchDate: '2026-10-01', batchNo: 'M-003', exportOrderNo: 'EX-012',
      productName: 'Super Kernel', qtyKg: '24350', transferPricePkr: '172500', totalValuePkr: '4200375', usdEquivalent: '15001.34',
      pkrRate: '280', status: 'In Transit',
    });
    expect(v).toEqual(expect.objectContaining({
      transferNo: 'IT-007', orderNo: 'EX-012', product: 'Super Kernel', kg: 24350, pricePerKg: 172.5,
      totalPkr: 4200375, usd: 15001.34,
    }));
  });
});
