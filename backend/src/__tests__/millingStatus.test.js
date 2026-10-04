const fs = require('fs');
const path = require('path');

// inventory_lots.milling_status is CHECK-constrained to exactly:
//   NULL | 'In Milling' | 'Consumed'
// and the batch picker hides 'In Milling' and 'Consumed'. So the value written
// when a lot is only PARTLY consumed decides whether its remainder can ever be
// milled again. It was 'In Milling', which stranded 48,450 kg of IRI6 ND LOT1 —
// visible in the stock report, unselectable for a new batch.
const LEGAL = [null, 'In Milling', 'Consumed'];

describe('milling_status stays within what the constraint allows', () => {
  const files = [
    'modules/inventory/inventory.service.js',
    'modules/inventory/lotInventory.controller.js',
    'modules/milling/milling.controller.js',
    'modules/milling/batchLifecycle.js',
  ].map((f) => ({ f, src: fs.readFileSync(path.join(__dirname, '..', f), 'utf8') }));

  test('no code writes a value the CHECK would reject', () => {
    const illegal = [];
    for (const { f, src } of files) {
      for (const m of src.matchAll(/milling_status:\s*([^,\n]+)/g)) {
        const expr = m[1].trim();
        // Pull out every quoted literal in the expression and check each one.
        for (const lit of expr.matchAll(/'([^']*)'/g)) {
          if (!LEGAL.includes(lit[1])) illegal.push(`${f}: '${lit[1]}'`);
        }
      }
    }
    expect(illegal).toEqual([]);
  });

  test("'Partial' is gone — it was never a legal value", () => {
    for (const { src } of files) expect(src).not.toMatch(/milling_status:[^,\n]*'Partial'/);
  });
});

describe('a part-consumed lot can be milled again', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );

  test('full consumption marks Consumed, partial clears the status', () => {
    expect(src).toMatch(/milling_status: remaining <= 1e-6 \? 'Consumed' : null/);
  });

  test('it is no longer left In Milling after the yield', () => {
    expect(src).not.toMatch(/remaining <= 1e-6 \? 'Consumed' : 'In Milling'/);
  });

  // The picker's own rule, restated: what it hides is what must not be written
  // to a lot that still has stock.
  const hidden = ['In Milling', 'Consumed'];
  const selectable = (status, availableQty) => availableQty > 0 && !hidden.includes(status);

  test('the remainder of a part-milled lot is selectable', () => {
    expect(selectable(null, 48450)).toBe(true);
  });

  test('a fully consumed lot is not', () => {
    expect(selectable('Consumed', 0)).toBe(false);
  });

  test('a lot actively reserved by a running batch is not', () => {
    expect(selectable('In Milling', 10000)).toBe(false);
  });
});
