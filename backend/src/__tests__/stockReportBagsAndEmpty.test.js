/**
 * The stock reports report what is ON HAND, in the units the store counts in.
 *
 * Three things were wrong and are pinned here:
 *  1. A lot whose rice has all been milled or sold keeps status 'Available',
 *     so it was still listed — at 0 kg, 0 value, and carrying its full intake
 *     sack count (SHAP-1121BASM-260926-01 showed 1,000 katta against 0 kg).
 *  2. A katta is the 50 kg sack. A 960 x 25 kg pack was being reported as 960
 *     katta, which overstates the sacks and mixes two different units.
 *  3. A blend's by-products were named "Blend M-001 — Sweeping", which says
 *     nothing about which rice is in the bag.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Body of a top-level method in an object literal, from `async name(` to the
// matching closing brace — so an assertion cannot match a neighbouring handler.
function methodBody(src, name) {
  const at = src.indexOf(`async ${name}(`);
  if (at === -1) throw new Error(`method ${name} not found`);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const reporting = read('modules/analytics/reporting.controller.js');

describe('a lot holding nothing is not stock', () => {
  for (const handler of ['printableStock', 'printableStockDetail']) {
    it(`${handler} filters out zero on-hand lots`, () => {
      const fn = methodBody(reporting, handler);
      if (!/net_weight_kg[\s\S]{0,80}> 0/.test(fn.replace(/\n/g, ' '))) {
        throw new Error(`${handler} does not filter on remaining weight`);
      }
    });

    it(`${handler} can still show them on request`, () => {
      const fn = methodBody(reporting, handler);
      if (!fn.includes('include_empty')) throw new Error(`${handler} has no include_empty escape hatch`);
    });
  }
});

describe('katta are 50 kg sacks; smaller packs are bags', () => {
  it('printableStockDetail splits the two and never adds them together', () => {
    const fn = methodBody(reporting, 'printableStockDetail');
    expect(fn).toContain('KATTA_MIN_KG = 50');
    expect(fn).toContain('bags: isKatta ? units : 0');
    expect(fn).toContain('bagUnits: isKatta ? 0 : units');
    expect(fn).toContain('bagSizeKg');
  });

  it('printableStock splits the two in SQL and reports the pack size', () => {
    const fn = methodBody(reporting, 'printableStock');
    expect(fn).toContain('KATTA_ON_HAND');
    expect(fn).toContain('BAGS_ON_HAND');
    expect(fn).toContain('total_bag_units');
    expect(fn).toContain('bag_size_kg');
  });

  it('printableStock counts sacks ON HAND, not the intake count', () => {
    const fn = methodBody(reporting, 'printableStock');
    // SUM(l.total_bags) is the intake and is never decremented.
    expect(fn).not.toContain('SUM(l.total_bags)');
    // The on-hand expressions now live in ONE place (inventory/stockSql.js),
    // shared with the Stock Summary so the two cannot disagree.
    expect(fn).toContain('KATTA_ON_HAND');
    expect(fn).toContain('} = stockSql;');
    expect(require('../modules/inventory/stockSql').KATTA_ON_HAND)
      .toContain(require('../modules/inventory/stockSql').UNITS_ON_HAND);
  });

  // The rule itself, exercised rather than grepped.
  const isKatta = (packKg) => packKg === 0 || packKg >= 50;
  it.each([
    [50, true], [60, true], [0, true],
    [25, false], [10, false], [3.5, false],
  ])('a %s kg pack counts as katta: %s', (kg, expected) => {
    expect(isKatta(kg)).toBe(expected);
  });
});

describe("a blend's by-products are named after the rice they are mostly made of", () => {
  const svc = read('modules/inventory/inventory.service.js');

  it('the dominant source variety is resolved by input weight', () => {
    expect(svc).toContain('dominantVariety');
    expect(svc).toContain("batch_source_lots as bsl");
    expect(svc).toContain('orderByRaw(\'kg DESC\')');
  });

  it('it is used for the by-product name and variety', () => {
    expect(svc).toContain('item_name: isBlend ? `${blendLabel} — ${bp.name}` : bp.name');
    expect(svc).toContain('variety: isBlend ? blendLabel :');
  });

  it('a free-text lot name is never used as a variety', () => {
    const at = svc.indexOf('const NAME =');
    const line = svc.slice(at, svc.indexOf('\n', at));
    expect(line).not.toContain('item_name');
  });

  it('a blend with no source variety at all still falls back to the blend', () => {
    expect(svc).toContain('const blendLabel = dominantVariety || (isBlend ? `Blend ${blendNo}` : null);');
  });
});

describe('a master bag holds whole bags', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src/modules/millStore/components/PackingPanel.jsx'), 'utf8');

  it('is offered for any bag, not only those under 15 kg', () => {
    expect(panel).toContain('const needsMP = capacity > 0;');
    expect(panel).not.toContain('capacity <= 15');
  });

  it('counts masters from bags per master, not from packed weight', () => {
    expect(panel).toContain('Math.floor(masterCap / capacity)');
    expect(panel).toContain('Math.ceil(bagsN / bagsPerMaster)');
  });

  // 5 x 3.5 kg into a 20 kg master — the case that could not be recorded.
  const masters = (bagKg, masterKg, bags) => {
    const per = Math.floor(masterKg / bagKg);
    return per > 0 ? Math.ceil(bags / per) : 0;
  };
  it.each([
    [3.5, 20, 100, 20],   // 5 per master
    [3.5, 20, 7, 2],      // the remainder still needs a master
    [25, 50, 10, 5],      // 2 per master
    [5, 20, 20, 5],       // 4 per master, exact
  ])('%s kg bags into a %s kg master: %s bags needs %s masters', (bagKg, masterKg, bags, expected) => {
    expect(masters(bagKg, masterKg, bags)).toBe(expected);
  });

  it('a master smaller than the bag is not offered', () => {
    expect(panel).toContain('num(b.capacity_kg) >= capacity');
  });
});
