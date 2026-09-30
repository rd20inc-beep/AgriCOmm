/**
 * Packaging items know WHAT THEY ARE and WHAT UNIT they are spoken in.
 *
 * Katta, P.P. bags and master bags have to stay apart in stock, on the reports
 * and in the costing — and nothing recorded which was which. It was inferred
 * from size, which is how a 25 kg P.P. bag came to be filed as "Katta 25kg":
 * reconcileBatchKatta mints a katta item for whatever size it frees, and a 25 kg
 * sack looked like a 25 kg katta. KATTA-25 holds 1,826 units on production
 * because of it.
 *
 * Every case below is a REAL item from the live master. The classifier was
 * written against all 34 of them, and two rules exist only because they got it
 * wrong first: a brand-named retail bag carries no "PP" or "BAG" in its name,
 * and "8LBS" has no word boundary before the L.
 */
const { classifyPackaging, resolveSize, sizeToKg, formatPackSize, PACK_TYPE_CODES } = require('../shared/packagingTypes');

const item = (code, name, capacity_kg = null) => ({ code, name, category: 'packaging', capacity_kg });

describe('the intake sack is a katta, by any of its trade names', () => {
  it.each([
    ['KATTA-50', 'Katta 50kg'],
    ['BAG-50KG-PP/JUTE', 'Bardana 50kg'],
    ['BAG25KGPENTRADE', 'BARDANA PENTRADE'],
    ['BAG-100KG-JUTE', 'Jute Bori 100kg'],
    ['BAG-50KG-PP WOVEN', 'Katta 50kg'],
  ])('%s / %s', (code, name) => {
    expect(classifyPackaging(item(code, name, 50))).toBe('katta');
  });

  it('an EXPORT bag in woven PP is an output bag, not intake', () => {
    // The only woven-PP item that is not a sack the paddy arrived in.
    expect(classifyPackaging(item('BAG-25KG-WOVEN PP', 'Export Bag 25kg'))).toBe('pp_bag');
  });
});

describe('output bags', () => {
  it.each([
    ['PP25KG WHITE HORSE', 'WHITE HORSE PP BAG 25KG', 25],
    ['BAG-5KG-BOPP', 'BOPP Bag 5kg (Printed)', 5],
    ['5KG NBW PJP', '5KG NON WOVEN BAGS', 5],
    ['PP25KG INNER', 'INNER BAG 25KG', null],
  ])('%s is a pp_bag', (code, name, cap) => {
    expect(classifyPackaging(item(code, name, cap))).toBe('pp_bag');
  });

  it('a brand-named retail bag with no "PP" or "BAG" in its name still is one', () => {
    // The commonest kind in the live master, and the first thing the classifier
    // got wrong — a keyword rule filed all of these as 'other'.
    expect(classifyPackaging(item('25KG AENOS', 'AENOS 25KG', 25))).toBe('pp_bag');
    expect(classifyPackaging(item('10KG FIZZA', 'FIZZA 10KG', 10))).toBe('pp_bag');
    expect(classifyPackaging(item('8LBS NOORI', 'NOORI 8LBS', 3.63))).toBe('pp_bag');
    expect(classifyPackaging(item('2KGPNJPRD', '2KG PUNJAB PRIDE', 2))).toBe('pp_bag');
  });
});

describe('masters, liners and things that are not bags', () => {
  it('a master is a master before it is a size', () => {
    // Ordered before the katta rules, or "Master Bag 50kg" would read as a sack.
    expect(classifyPackaging(item('MASTER-50', 'Master Bag 50kg', 50))).toBe('master_bag');
    expect(classifyPackaging(item('MASTER-20', 'Master Bag 20kg', 20))).toBe('master_bag');
    expect(classifyPackaging(item('MASTER-40', 'Master Bag 40kg', 40))).toBe('master_bag');
  });

  it('a sheet and a liner are polythene', () => {
    expect(classifyPackaging(item('POLY-SHEET', 'Polythene Sheet'))).toBe('polythene');
    expect(classifyPackaging(item('BAG-50KG-PLASTIC', 'Liner Bag 50kg'))).toBe('polythene');
  });

  it('thread and labels are not bags, whatever their code says', () => {
    expect(classifyPackaging(item('THREAD-WHITE', 'Stitching thread (white, 250g roll)'))).toBe('other');
    expect(classifyPackaging(item('LABEL-BRAND', 'Branded rice label (printed)'))).toBe('other');
    // BAG-50KG-PP is named "Thread Roll" in the live master — its code and name
    // disagree and only a person can say which is right, so it is listed
    // explicitly rather than forced through a cleverer rule.
    expect(classifyPackaging(item('BAG-50KG-PP', 'Thread Roll'))).toBe('other');
  });

  it('a non-packaging item is never typed as a bag', () => {
    expect(classifyPackaging({ code: 'DIESEL', name: 'Diesel', category: 'fuel' })).toBe('other');
  });

  it('every answer is one the column will accept', () => {
    const codes = ['KATTA-50', 'MASTER-20', 'POLY-SHEET', 'THREAD-WHITE', '25KG AENOS', 'ZZ-UNKNOWN'];
    for (const c of codes) expect(PACK_TYPE_CODES).toContain(classifyPackaging(item(c, c, 25)));
  });
});

describe('a bag bought in pounds is spoken in pounds', () => {
  it('NOORI 8LBS reads back as 8 LBS, not 3.63 kg', () => {
    // Stored in kg because that is what the engine measures; shown as bought.
    expect(resolveSize(item('8LBS NOORI', 'NOORI 8LBS', 3.63))).toEqual({ value: 8, unit: 'lb' });
    expect(formatPackSize(8, 'lb')).toBe('8 LBS');
  });

  it('a kilogram bag stays in kilograms', () => {
    expect(resolveSize(item('25KG AENOS', 'AENOS 25KG', 25))).toEqual({ value: 25, unit: 'kg' });
    expect(formatPackSize(25, 'kg')).toBe('25 KG');
  });

  it('the kg equivalent uses the exact pound, so the weights still add up', () => {
    // 1 lb = 0.45359237 kg exactly — the same figure the export documents use.
    expect(sizeToKg(8, 'lb')).toBe(3.629);
    expect(sizeToKg(25, 'kg')).toBe(25);
  });

  it('an item with no size has none invented for it', () => {
    expect(resolveSize(item('THREAD-WHITE', 'Stitching thread'))).toEqual({ value: null, unit: 'kg' });
    expect(formatPackSize(null, 'kg')).toBe('');
  });
});

describe('freeing a sack can no longer mint a fake katta', () => {
  const fs = require('fs');
  const path = require('path');
  const SVC = fs.readFileSync(path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8');

  it('it prefers a real katta item of that size over the size-keyed code', () => {
    const fn = SVC.slice(SVC.indexOf('const itemForSize ='), SVC.indexOf('// Reverse the batch'));
    expect(fn).toContain("where('pack_type', 'katta')");
    expect(fn).toContain("andWhere('capacity_kg', size)");
  });

  it('anything it does create is typed katta explicitly', () => {
    const fn = SVC.slice(SVC.indexOf('const itemForSize ='), SVC.indexOf('// Reverse the batch'));
    expect(fn).toContain("pack_type: 'katta'");
  });
});

describe('the 1,826 mis-filed bags move to the right item', () => {
  const fs = require('fs');
  const path = require('path');
  const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20260930_306_reclass_katta25_to_pp_bag.js'), 'utf8');
  // Comments stripped for the "must not mention" assertions — the file explains
  // WHY the branded bags are not the target, so their names are in the prose.
  const CODE = MIG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('they go to the GENERIC 25 kg P.P. bag, not a branded one', () => {
    // 25KG AENOS and PP25KG WHITE HORSE are printed bags at Rs 43.92 — four
    // times the price. Folding unbranded stock into one would misstate both the
    // count and the value of the stock.
    expect(MIG).toContain("const TARGET = 'BAG-25KG-PP'");
    expect(CODE).not.toContain('AENOS');
    expect(CODE).not.toContain('WHITE HORSE');
  });

  it('the move is a stock LEDGER entry on both sides, not a silent update', () => {
    const outs = MIG.match(/mill_stock_movements'\)\.insert/g) || [];
    expect(outs.length).toBe(2);
    expect(MIG).toContain('quantity: -qty');
    expect(MIG).toContain('quantity: qty');
  });

  it('it is idempotent, keyed on its own reference', () => {
    expect(MIG).toContain("const REF = 'reclass_katta25_to_pp25'");
    expect(MIG).toContain("where({ reference_type: REF }).first('id')");
    expect(MIG).toContain('if (already) return;');
  });

  it('it creates the target rather than skipping when it is missing', () => {
    // BAG-25KG-PP is user-created on production and is not seeded elsewhere. A
    // migration that silently does nothing because a row is missing is how a
    // correction gets lost.
    expect(MIG).toContain('if (!target) {');
    expect(MIG).toContain("code: TARGET, name: 'PP Bag 25kg (Empty)'");
  });

  it('the target gets the capacity and price it was missing', () => {
    // It was seeded with neither — unusable for packing, which needs a capacity,
    // and invisible to the katta/bag split, which divides by it.
    expect(MIG).toContain('capacity_kg: parseFloat(target.capacity_kg) > 0 ? target.capacity_kg : 25');
    expect(MIG).toContain("pack_type: 'pp_bag'");
  });

  it('KATTA-25 survives at zero — a 25 kg katta is a real thing', () => {
    expect(MIG).not.toMatch(/where\(\{ code: SOURCE \}\)[\s\S]{0,60}\.del\(\)/);
    expect(MIG).not.toContain('is_active: false');
  });

  it('down() puts the stock back', () => {
    expect(MIG).toContain('exports.down');
    expect(MIG).toContain('GREATEST(quantity_available - ?, 0)');
    expect(MIG).toContain("where({ reference_type: REF }).del()");
  });
});
