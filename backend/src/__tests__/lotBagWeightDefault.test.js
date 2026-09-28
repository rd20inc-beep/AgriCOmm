const fs = require('fs');
const path = require('path');

// bag_weight_kg is the kg-per-bag every katta <-> kg conversion divides by. It
// used to default to a flat 50 regardless of the sack size on the same request,
// so a lot entered as 25kg bags was stored as size 25 / weight 50 — and a
// katta-denominated quantity came out at TWICE its real weight. Two production
// lots drifted this way, including one loaded as opening stock.
describe('a new lot takes its per-bag weight from its sack size', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/lotInventory.controller.js'), 'utf8',
  );
  const createFn = (() => {
    const at = src.indexOf('async createLot');
    const start = at >= 0 ? at : src.indexOf('quantity_input, quantity_unit');
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', start)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(start, i + 1); }
    }
    return src;
  })();

  test('the weight falls back to the size before it falls back to 50', () => {
    expect(src).toContain('parseFloat(bag_weight_kg) || parseFloat(bag_size_kg) || 50');
  });

  test('the parameter no longer defaults to 50 on its own', () => {
    // `bag_weight_kg = 50` as a default made the fallback unreachable: the value
    // was never undefined, so the sack size could never be consulted.
    expect(src).not.toContain("quantity_unit = 'katta', bag_weight_kg = 50,");
  });

  test('the resolved weight is what gets stored', () => {
    expect(src).toContain('bag_weight_kg: bagWt,');
  });

  test('50 survives as the fallback when neither figure is given', () => {
    const m = /const bagWt = parseFloat\(bag_weight_kg\) \|\| parseFloat\(bag_size_kg\) \|\| (\d+);/.exec(src);
    expect(m).toBeTruthy();
    expect(m[1]).toBe('50');
  });
});

// The rule the whole chain depends on, stated once so it is testable.
describe('the resolution order', () => {
  const resolve = (bagWeightKg, bagSizeKg) => parseFloat(bagWeightKg) || parseFloat(bagSizeKg) || 50;

  test('an explicit weight always wins', () => {
    expect(resolve(43, 50)).toBe(43);
  });

  test('no weight falls back to the sack size', () => {
    expect(resolve(undefined, 25)).toBe(25);
    expect(resolve('', 25)).toBe(25);
    expect(resolve(null, 25)).toBe(25);
  });

  test('neither given falls back to 50', () => {
    expect(resolve(undefined, undefined)).toBe(50);
    expect(resolve(0, 0)).toBe(50);
  });

  test('a 25kg katta lot no longer doubles its weight', () => {
    // 16 katta at the resolved weight; previously 16 x 50 = 800kg, not 400.
    expect(16 * resolve(undefined, 25)).toBe(400);
  });
});
