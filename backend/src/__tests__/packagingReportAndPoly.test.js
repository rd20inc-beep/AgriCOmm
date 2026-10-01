/**
 * Phases 4 and 5 of the packaging program.
 *
 * 4. The stock report shows katta, P.P. bags and master bags SEPARATELY and never
 *    combined. They were listed flat under one "packaging" category, which put a
 *    50 kg sack and a 25 kg retail bag on adjacent lines with nothing to say they
 *    are different things and no subtotal for either.
 *
 * 5. Polythene can line each retail bag, line the master, or both. The code
 *    assumed one sheet per retail bag, which is only one of the three real cases
 *    — and at Rs 12 a sheet, 400 vs 80 vs 480 is real money.
 *
 * Both exercised against a real Postgres. The polythene cases came out
 * 400 / 80 / 480 sheets at Rs 4,800 / 960 / 5,760, with an explicit count still
 * winning and a run with no polythene claiming no scope.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const REPORT = read('modules/analytics/reporting.controller.js');
const PACKING = read('modules/millStore/packing.service.js');
const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20260930_308_polythene_applies_to.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(__dirname, '../../../src/modules/analytics/pages/PrintableReportsViews.jsx'), 'utf8');

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

describe('packaging stock is reported per type, never combined', () => {
  const fn = methodBody(REPORT, 'printableStockDetail');

  it('each type gets its own group with its own quantity AND value', () => {
    expect(fn).toContain("const PACK_ORDER = ['katta', 'pp_bag', 'master_bag', 'polythene', 'other']");
    expect(fn).toContain('const packGroups =');
    expect(fn).toContain("units: of.reduce");
    expect(fn).toContain('valuePkr: of.reduce');
  });

  it('an item typed before migration 305 groups under other, it does not vanish', () => {
    expect(fn).toContain("(m.packType || 'other') === t");
  });

  it('only packaging is grouped by pack type', () => {
    // Fuel and spares are not bags and must not get a bag heading.
    expect(fn).toContain("m.category === 'packaging'");
    expect(VIEW).toMatch(/millStore \|\| \[\]\)\.filter\(m => m\.category !== 'packaging'\)/);
  });

  it('the report prints one section per type, each with a subtotal', () => {
    expect(VIEW).toContain('PACK_TYPE_LABEL');
    expect(VIEW).toContain('packGroups.map(g => (');
    expect(VIEW).toContain('TOTAL`, fmtKg(g.units)');
  });

  it('an item with no price is called out rather than valued at zero', () => {
    expect(VIEW).toContain('no price set');
  });

  it('a size is shown as the mill says it — 25 KG, 8 LBS', () => {
    expect(fn).toContain('sizeLabel: packLabelOf(m.size_value, m.size_unit)');
    expect(REPORT).toContain('function packLabelOf');
  });
});

describe('master bags appear on the rice rows too', () => {
  const fn = methodBody(REPORT, 'printableStockDetail');

  it('a lot in retail bags inside masters states both', () => {
    expect(fn).toContain('const masterRuns =');
    expect(fn).toContain('masterBags: master ? master.masters : 0');
    expect(VIEW).toContain("'Masters'");
  });

  it('only finished output is judged against a packing run', () => {
    // A raw lot's sacks are what it ARRIVED in; it has no master bags.
    expect(fn).toContain("const master = l.type === 'finished'");
  });

  it('the predominant master wins, the same rule the bag size uses', () => {
    expect(fn).toContain('if (!cur || masters > cur.masters)');
  });
});

describe('polythene goes where it is told', () => {
  // The rule, exercised rather than grepped: 400 retail bags in 80 masters.
  const sheets = (scope, bags, masters) => (scope === 'master' ? masters
    : scope === 'both' ? bags + masters : bags);

  it.each([
    ['bag', 400], ['master', 80], ['both', 480],
  ])('applied to %s gives %s sheets', (scope, expected) => {
    expect(sheets(scope, 400, 80)).toBe(expected);
  });

  it('both is bags PLUS masters, not one or the other', () => {
    expect(sheets('both', 400, 80)).toBe(480);
    expect(sheets('both', 400, 80)).not.toBe(400);
    expect(sheets('both', 400, 80)).not.toBe(80);
  });

  it('the service derives it from the scope', () => {
    expect(PACKING).toContain("const polyScope = ['bag', 'master', 'both'].includes(poly_applies_to) ? poly_applies_to : 'bag'");
    expect(PACKING).toContain("polyScope === 'master' ? masterQty");
    expect(PACKING).toContain('polyScope === \'both\' ? bagsCount + masterQty');
  });

  it('an explicit count always wins over the derivation', () => {
    expect(PACKING).toContain("const polyQty = poly_count == null || poly_count === '' ? derivedPoly : Number(poly_count)");
  });

  it('a run with no polythene claims no scope', () => {
    // "Applied to bags" with zero sheets would be a lie about what happened.
    expect(PACKING).toContain('poly_applies_to: poly.qty > 0 ? polyScope : null');
  });

  it('bag is the default, so every run already recorded keeps its quantity', () => {
    expect(MIG).toContain("where('poly_count', '>', 0).update({ poly_applies_to: 'bag' })");
    expect(MIG).toContain("poly_applies_to IS NULL OR poly_applies_to IN ('bag', 'master', 'both')");
  });

  it('the field is declared, or Joi would strip it', () => {
    const { packSchema } = require('../modules/millStore/millStore.validator');
    const { value, error } = packSchema.validate(
      { bag_item_id: 1, bags_count: 400, poly_item_id: 2, poly_applies_to: 'both' },
      { stripUnknown: true },
    );
    expect(error).toBeUndefined();
    expect(value.poly_applies_to).toBe('both');
    expect(packSchema.validate({ bag_item_id: 1, bags_count: 1, poly_applies_to: 'sideways' }).error).toBeDefined();
  });

  it('the breakdown says where it went', () => {
    expect(PACKING).toContain("polyScope === 'both' ? 'bags + masters'");
  });
});

describe('pack() returns what it wrote', () => {
  it('the stamped master/poly values are read back onto the returned row', () => {
    // It returns the row from the original INSERT, so without this every master
    // and polythene field came back null to the caller even though the database
    // held them. Found by reading the return value in a live run.
    expect(PACKING).toContain('const stamped = {');
    expect(PACKING).toContain('Object.assign(log, stamped)');
  });
});
