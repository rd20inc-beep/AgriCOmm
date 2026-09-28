const fs = require('fs');
const path = require('path');
const { freedKattaFrom } = require('../modules/localSales/freedKatta');

const rp = (over = {}) => ({
  freed_katta_to_store: true, original_bag_size_kg: 50, original_bag_count: 20, ...over,
});

describe('freedKattaFrom', () => {
  test('a repacked sale returns what it emptied', () => {
    expect(freedKattaFrom(rp())).toEqual({ sizeKg: 50, count: 20 });
  });

  test('nothing comes back when the buyer keeps the empties', () => {
    expect(freedKattaFrom(rp({ freed_katta_to_store: false }))).toBeNull();
  });

  test('a sale that was never repacked frees nothing', () => {
    // No repacking row at all: the rice shipped in its original sacks and they
    // left with it.
    expect(freedKattaFrom(null)).toBeNull();
    expect(freedKattaFrom(undefined)).toBeNull();
  });

  test('an unrecorded size or count credits nothing rather than guessing', () => {
    expect(freedKattaFrom(rp({ original_bag_size_kg: null }))).toBeNull();
    expect(freedKattaFrom(rp({ original_bag_count: null }))).toBeNull();
    expect(freedKattaFrom(rp({ original_bag_size_kg: 0 }))).toBeNull();
    expect(freedKattaFrom(rp({ original_bag_count: 0 }))).toBeNull();
    expect(freedKattaFrom(rp({ original_bag_count: '' }))).toBeNull();
  });

  test('numbers arriving as strings still work', () => {
    // Postgres numerics come back as strings.
    expect(freedKattaFrom(rp({ original_bag_size_kg: '25.00', original_bag_count: '16' })))
      .toEqual({ sizeKg: 25, count: 16 });
  });

  test('a missing flag defaults to returning them', () => {
    // Rows written before the column existed must not silently stop crediting.
    const { freed_katta_to_store: _drop, ...noFlag } = rp();
    expect(freedKattaFrom(noFlag)).toEqual({ sizeKg: 50, count: 20 });
  });

  test('a negative count is refused', () => {
    expect(freedKattaFrom(rp({ original_bag_count: -5 }))).toBeNull();
  });
});

describe('the credit is wired to confirmation, not to entry', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/localSales/localSales.controller.js'), 'utf8',
  );

  test('katta are returned from postSaleSideEffects', () => {
    // A pending sale that is rejected must not leave sacks behind, so the credit
    // sits with the other stock/money side effects.
    expect(src).toMatch(/async function postSaleSideEffects[\s\S]{0,200}returnRepackedKatta\(/);
  });

  test('the store credit is idempotent per repacking row', () => {
    expect(src).toContain("referenceType: 'sale_repack_katta'");
  });
});

describe('creditFreedKatta writes a movement the table accepts', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );
  const fn = (() => {
    const at = src.indexOf('async creditFreedKatta');
    // Open at the BODY brace, not the destructured parameter list — the first
    // `{` after `async creditFreedKatta` belongs to `{ sizeKg, count, ... }`.
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', at)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('creditFreedKatta not found');
  })();

  test("movement_type is 'return', the only inbound value the CHECK allows", () => {
    expect(fn).toContain("movement_type: 'return'");
    expect(fn).not.toContain("movement_type: 'in'");
  });

  test('the MOVEMENT insert uses reason/performed_by, the columns that exist', () => {
    // Scoped to the mill_stock_movements insert: mill_items legitimately has a
    // `notes` and a `created_by`, and asserting across the whole function
    // flagged those as violations.
    const at = fn.indexOf("mill_stock_movements').insert(");
    const movement = fn.slice(at, fn.indexOf('});', at));
    expect(movement).toMatch(/reason:/);
    expect(movement).toMatch(/performed_by:/);
    expect(movement).not.toMatch(/notes:/);
    expect(movement).not.toMatch(/created_by:/);
  });

  test('it never touches cost — freed katta are valued at zero until sold', () => {
    expect(fn).not.toMatch(/cost_per_unit|total_cost|avg_cost/);
  });
});
