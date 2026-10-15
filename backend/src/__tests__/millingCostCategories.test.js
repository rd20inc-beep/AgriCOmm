// P3-07 / MIL-11 — the canonical milling cost-sheet categories.
const {
  canonicalCostCategory, MILLING_COST_CATEGORIES, RAW_RICE, PACKAGING, unknownCategoryError,
} = require('../modules/milling/costCategories');

describe('canonicalCostCategory', () => {
  test('the drawer key for raw rice maps to raw_rice in any spelling', () => {
    for (const k of ['rawRice', 'raw_rice', 'Raw Rice', 'RAW-RICE', ' raw rice purchase ']) {
      expect(canonicalCostCategory(k)).toBe(RAW_RICE);
    }
  });

  test('packing is the bag cost (one row with the mill-store packaging)', () => {
    expect(canonicalCostCategory('packing')).toBe(PACKAGING);
    expect(canonicalCostCategory('Bagging')).toBe(PACKAGING);
    expect(canonicalCostCategory('packaging')).toBe(PACKAGING);
  });

  test('every canonical key maps to itself', () => {
    for (const c of MILLING_COST_CATEGORIES) expect(canonicalCostCategory(c)).toBe(c);
  });

  test('the mill-store consumption categories are accepted', () => {
    for (const c of ['chemicals', 'diesel', 'maintenance', 'packaging']) expect(canonicalCostCategory(c)).toBe(c);
    expect(canonicalCostCategory('Labour')).toBe('labor');
  });

  test('unknown, empty and null are refused', () => {
    expect(canonicalCostCategory('coffee')).toBeNull();
    expect(canonicalCostCategory('')).toBeNull();
    expect(canonicalCostCategory(null)).toBeNull();
    const e = unknownCategoryError('coffee');
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/Unknown cost category 'coffee'/);
  });
});
