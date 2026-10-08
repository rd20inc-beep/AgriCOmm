/**
 * D2: KG inside, MT only at the export-document boundary. shared/units.js is
 * the one backend helper for that crossing; the call sites that used inline
 * ×1000 / ÷1000 now go through it and must produce the SAME numbers.
 */

const units = require('../shared/units');
const { mtToKg, kgToMt, perMtToPerKg, perKgToPerMt, roundKg, roundMt, roundRate, KG_PER_MT } = units;
const { linePackaging, priceText } = require('../modules/exportOrders/orderLines');

// Values that stress binary floating point and the parse path (DB numerics
// arrive as strings).
const SAMPLES = [0, 1, 0.1, 0.2, 0.3, 1 / 3, 2 / 3, 12.345, 24.35, 20.0005, 99.999, 0.001, 1e-7,
  123456.789, -5.5, '24.350', '0.1', '1290', ' 7.25 ', '1e3'];

describe('shared/units helper', () => {
  test('1 MT is 1000 kg', () => {
    expect(KG_PER_MT).toBe(1000);
    expect(mtToKg(12.5)).toBe(12500);
    expect(kgToMt(12500)).toBe(12.5);
    expect(perMtToPerKg(1290)).toBe(1.29);
    expect(perKgToPerMt(1.29)).toBe(1290);
  });

  test('accepts numeric strings; null / undefined / "" / junk count as 0', () => {
    expect(mtToKg('24.350')).toBe(24350);
    expect(kgToMt('487.5')).toBe(0.4875);
    for (const v of [null, undefined, '', 'abc', NaN]) {
      expect(mtToKg(v)).toBe(0);
      expect(kgToMt(v)).toBe(0);
      expect(perMtToPerKg(v)).toBe(0);
      expect(perKgToPerMt(v)).toBe(0);
    }
  });

  test('conversions are EXACT: bit-for-bit the inline (parseFloat(x) || 0) ×/÷ 1000', () => {
    for (const v of SAMPLES) {
      const p = parseFloat(v) || 0;
      expect(Object.is(mtToKg(v), p * 1000)).toBe(true);
      expect(Object.is(kgToMt(v), p / 1000)).toBe(true);
      expect(Object.is(perMtToPerKg(v), p / 1000)).toBe(true);
      expect(Object.is(perKgToPerMt(v), p * 1000)).toBe(true);
    }
  });

  test('round trips are exact for whole-kg quantities', () => {
    for (const kg of [0, 1, 487, 24350, 1000001]) expect(mtToKg(kgToMt(kg))).toBe(kg);
  });

  test('rounding rules: kg and MT to 3 dp, per-kg rates to 4 dp', () => {
    expect(roundKg(24349.99951)).toBe(24350);
    expect(roundKg('1.23456')).toBe(1.235);
    expect(roundMt(kgToMt(20000.5))).toBe(20.001);
    expect(roundRate(perMtToPerKg(1234.56789))).toBe(1.2346);
    expect(roundRate(null)).toBe(0);
  });
});

describe('converted call sites give the same numbers', () => {
  test('export line packaging: kg, bags and master bags from qty_mt', () => {
    const order = { qty_mt: '24.35', bag_size_kg: 50, master_bag_size_kg: 0 };
    const [line] = linePackaging(order, []);
    expect(line.kg).toBe(24350);
    expect(line.kg).toBe((parseFloat(order.qty_mt) || 0) * 1000);
    expect(line.bags).toBe(487);

    const multi = linePackaging({}, [
      { qty_mt: 10.005, bag_size_kg: 5, master_bag_size_kg: 20 },
      { qty_mt: '0.3', bag_size_kg: 2 },
    ]);
    expect(multi.map((l) => l.kg)).toEqual([10.005 * 1000, 0.3 * 1000]);
    expect(multi.map((l) => l.bags)).toEqual([Math.round((10.005 * 1000) / 5), Math.round((0.3 * 1000) / 2)]);
    expect(multi[0].masterBags).toBe(Math.ceil((10.005 * 1000) / 20));
  });

  test('the export price line still shows USD/MT with its per-kg equivalent', () => {
    expect(priceText({ price_per_mt: 1290 }, [])).toBe('@ 1,290/MT (1.29/kg)');
    expect(priceText({ price_per_mt: 1234.5 }, [])).toBe(`@ ${(1234.5).toLocaleString()}/MT (${(1234.5 / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}/kg)`);
  });

  test('reporting MT totals sum the same as the inline ÷1000', () => {
    const rows = [{ raw_qty_kg: '12082.5' }, { raw_qty_kg: 0.3 }, { raw_qty_kg: null }, { raw_qty_kg: '1e3' }];
    const num = (v) => parseFloat(v) || 0;
    const inline = rows.reduce((s, b) => s + num(b.raw_qty_kg) / 1000, 0);
    const helper = rows.reduce((s, b) => s + kgToMt(b.raw_qty_kg), 0);
    expect(Object.is(helper, inline)).toBe(true);
  });
});
