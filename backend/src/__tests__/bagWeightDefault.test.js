const fs = require('fs');
const path = require('path');

// inventory_lots.bag_weight_kg carried a column DEFAULT of 50, applied by the
// DATABASE to any insert that omitted it — whatever bag_size_kg the same row
// carried. A loader writing lots directly (how the opening stock was loaded) set
// the sack size and left the weight, so `1121 CSR 25KG` was stored size 25 /
// weight 50 and reported 8 katta where it held 16.
//
// The schema fingerprint does NOT track column defaults, so CI cannot catch this
// coming back. These tests are the guard instead.
const MIGRATIONS = path.join(__dirname, '../../migrations');

describe('bag_weight_kg has no silent default', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.js'));
  const sources = files.map((f) => ({ f, src: fs.readFileSync(path.join(MIGRATIONS, f), 'utf8') }));

  test('a migration drops the default', () => {
    const dropper = sources.find((s) => /ALTER COLUMN bag_weight_kg DROP DEFAULT/i.test(s.src));
    expect(dropper).toBeDefined();
  });

  test('nothing later sets it again', () => {
    const drop = sources.find((s) => /ALTER COLUMN bag_weight_kg DROP DEFAULT/i.test(s.src));
    const after = sources.filter((s) => s.f > drop.f);
    const resetters = after.filter((s) => /bag_weight_kg[\s\S]{0,80}(SET DEFAULT|defaultTo)/i.test(s.src));
    // down() in the dropping migration is allowed to restore it; a LATER
    // migration re-adding it is not.
    expect(resetters.map((s) => s.f)).toEqual([]);
  });

  test('the drop is reversible', () => {
    const drop = sources.find((s) => /ALTER COLUMN bag_weight_kg DROP DEFAULT/i.test(s.src));
    expect(drop.src).toMatch(/exports\.down/);
    expect(drop.src).toMatch(/SET DEFAULT 50/);
  });
});

// The rule that makes the dropped default an improvement rather than a loss:
// where it matters, the size is consulted before the 50.
describe('the per-bag weight resolves from the size before 50', () => {
  const resolve = (weight, size) => parseFloat(weight) || parseFloat(size) || 50;

  test('a 25kg lot with no recorded weight is 25, not 50', () => {
    expect(resolve(null, 25)).toBe(25);
    expect(resolve(undefined, 25)).toBe(25);
  });

  test('an explicit weight still wins — part-filled sacks stay honest', () => {
    expect(resolve(43, 50)).toBe(43);
  });

  test('neither recorded still falls back to 50, as before', () => {
    expect(resolve(null, null)).toBe(50);
  });

  test('lot creation uses exactly this order', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../modules/inventory/lotInventory.controller.js'), 'utf8',
    );
    expect(src).toContain('parseFloat(bag_weight_kg) || parseFloat(bag_size_kg) || 50');
  });
});
