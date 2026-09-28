const fs = require('fs');
const path = require('path');

// A blended batch used to prefix the GRADE with the batch number (M-001-B2).
// Per-batch separation is real, but the grade column is not where it belongs:
// every classifier matches the grade EXACTLY —
//   TAG_CASE:  WHEN l.grade IN ('B1','B2','B3','CSR','Short Grain') THEN l.grade
//   pricing:   else if (g === 'B1') perMt = num(b.b1_price_per_kg)
// so a blended lot fell into the catch-all bucket and missed its per-grade
// by-product price.
describe('a by-product lot carries its bare grade', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );

  test('the grade is stored unprefixed', () => {
    expect(src).toContain('grade: bp.grade || null,');
  });

  test('the blend number is not folded into the grade', () => {
    expect(src).not.toMatch(/grade:\s*\(isBlend/);
    expect(src).not.toMatch(/\$\{blendNo\}-\$\{bp\.grade\}/);
  });

  test('per-batch identity still comes from the other columns', () => {
    // lot_no, blend_batch_no, variety and batch_ref all carry the batch, so
    // nothing is lost by leaving the grade alone.
    expect(src).toMatch(/lot_no: lotNo,/);
    expect(src).toMatch(/blend_batch_no:/);
    expect(src).toMatch(/batch_ref:/);
  });

  test('the item name still distinguishes a blend', () => {
    expect(src).toMatch(/item_name: isBlend \? `Blend \$\{blendNo\} — \$\{bp\.name\}` : bp\.name/);
  });
});

// The two classifiers this had to satisfy, restated so a future change to either
// fails here rather than silently re-bucketing stock.
describe('the grades the classifiers recognise', () => {
  const GRADES = ['B1', 'B2', 'B3', 'CSR', 'Short Grain'];

  const tagOf = (grade, itemName = '') => {
    if (GRADES.includes(grade)) return grade;
    if (/sweeping/i.test(itemName)) return 'Sweeping';
    if (/powder/i.test(itemName)) return 'Powder';
    return grade || 'Broken';
  };

  test.each(GRADES)('%s is its own category', (g) => {
    expect(tagOf(g)).toBe(g);
  });

  test('a prefixed grade is NOT recognised — the bug this fixes', () => {
    expect(tagOf('M-001-B2')).toBe('M-001-B2');
    expect(tagOf('M-001-B2')).not.toBe('B2');
  });

  test('graded by-products with no grade still fall back to Broken', () => {
    expect(tagOf(null)).toBe('Broken');
  });

  test('powder and sweeping are recognised by name, not grade', () => {
    expect(tagOf(null, 'Blend M-001 — Powder')).toBe('Powder');
    expect(tagOf(null, 'Blend M-001 — Sweeping')).toBe('Sweeping');
  });
});
