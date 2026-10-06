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
    // BAG-50KG-PP was seeded as "Thread Roll" — a size-less "Thread Roll" row in
    // bag_types fell through migration 057's `|| 50` / `|| 'PP'` defaults and
    // claimed the code. The name still decides while a database has not yet run
    // migration 309, which is why no explicit override was ever needed for it.
    expect(classifyPackaging(item('BAG-50KG-PP', 'Thread Roll'))).toBe('other');
  });

  it('and once 309 gives that code back to the bag, it types as a bag', () => {
    // The override that used to force this to 'other' had to go with the rename:
    // left in place it would have classified the corrected item as 'other'.
    expect(classifyPackaging(item('BAG-50KG-PP', 'PP Bag 50kg (Empty)', 50))).toBe('pp_bag');
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
    const fn = SVC.slice(SVC.indexOf('const itemForSize ='), SVC.indexOf('const outLots', SVC.indexOf('const itemForSize =')));
    expect(fn).toContain("where('pack_type', 'katta')");
    expect(fn).toContain("andWhere('capacity_kg', size)");
  });

  it('anything it does create is typed katta explicitly', () => {
    const fn = SVC.slice(SVC.indexOf('const itemForSize ='), SVC.indexOf('const outLots', SVC.indexOf('const itemForSize =')));
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

describe('the 50 kg P.P. bag gets its code back', () => {
  const fs = require('fs');
  const path = require('path');
  const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20261001_309_fix_thread_roll_bag_item.js'), 'utf8');
  const SEED = fs.readFileSync(path.join(__dirname, '../../migrations/20260422_057_seed_mill_store_items_ratios.js'), 'utf8');

  it('the seed really did derive the code from bag_types with those defaults', () => {
    // This is the mechanism, not a guess: a size-less, material-less "Thread
    // Roll" row became BAG-50KG-PP and claimed the code before the real
    // "PP Bag 50kg (Empty)" row, which `if (!exists)` then skipped.
    expect(SEED).toContain("const sizeKg = Number(bt.size_kg) || 50;");
    expect(SEED).toContain("const material = (bt.material || 'PP').toUpperCase();");
    expect(SEED).toContain('const code = `BAG-${sizeKg}KG-${material}`;');
    expect(SEED).toContain('if (!exists)');
  });

  it('it renames the item and types it as a bag', () => {
    expect(MIG).toContain("name: 'PP Bag 50kg (Empty)'");
    expect(MIG).toContain("pack_type: 'pp_bag'");
    expect(MIG).toContain('capacity_kg: 50');
  });

  it('it only acts while the name is still wrong', () => {
    // So a re-run, or a database where someone already fixed it by hand, is left
    // alone rather than overwritten.
    expect(MIG).toContain("String(item.name).trim().toLowerCase() === 'thread roll'");
  });

  it('it repoints the item at the bag type it should have had', () => {
    expect(MIG).toContain("['pp bag 50kg (empty)']");
  });

  it('a thread roll stops being offered as a BAG TYPE', () => {
    // It had no size, so it appeared in every bag picker as a sizeless bag.
    expect(MIG).toContain("whereRaw('LOWER(name) = ?', ['thread roll'])");
    expect(MIG).toContain('whereNull(\'size_kg\')');
    expect(MIG).toContain('update({ is_active: false })');
  });

  it('the bad bag type is deactivated, not deleted', () => {
    // mill_items points at it until the repoint above, and deleting a row
    // something has referenced loses the trail of why that link existed.
    expect(MIG).not.toMatch(/bag_types[\s\S]{0,120}\.del\(\)/);
  });

  it('nothing is lost: thread has its own items already', () => {
    expect(SEED).toContain("code: 'THREAD-WHITE'");
    expect(SEED).toContain("code: 'THREAD-GREEN'");
  });
});

describe('a bag that states its size gets it stored', () => {
  const { deriveSizeFromLabel, hasCapacity, sizeToKg } = require('../shared/packagingTypes');
  const fs = require('fs');
  const path = require('path');
  const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20261001_310_backfill_packaging_sizes.js'), 'utf8');
  const SVC = fs.readFileSync(path.join(__dirname, '../modules/millStore/millStore.service.js'), 'utf8');

  // Migration 057 seeded eleven bags whose size is written in their own name and
  // stored NONE of it, because capacity_kg was never set. That field is what
  // pack() requires before it will pack and what the stock report divides by to
  // count bags, so every one was unusable and invisible to the katta/bag split.
  it.each([
    ['BAG-100KG-PP', 'PP Bag 100kg (Empty)', 100, 'kg'],
    ['BAG-50KG-PP WOVEN', 'Katta 50kg', 50, 'kg'],
    ['BAG-100KG-PP/JUTE', 'Bardana 100kg', 100, 'kg'],
    ['PP25KG INNER', 'INNER BAG 25KG', 25, 'kg'],
    ['BAG-25KG-WOVEN PP', 'Export Bag 25kg', 25, 'kg'],
    ['8LBS NOORI', 'NOORI 8LBS', 8, 'lb'],
  ])('%s reads as %s %s', (code, name, value, unit) => {
    expect(deriveSizeFromLabel({ code, name })).toEqual({ value, unit });
  });

  it('pounds win over kilograms when a label says both', () => {
    // A bag named in LB is a pound bag whatever else is in the text.
    expect(deriveSizeFromLabel({ code: 'X', name: '8 LBS (3.63 KG) BAG' })).toEqual({ value: 8, unit: 'lb' });
  });

  it('a label that states no size gets none invented', () => {
    for (const [code, name] of [
      ['POLY-SHEET', 'Polythene Sheet'],
      ['LABEL-BRAND', 'Branded rice label (printed)'],
      // "250g roll" must not read as a size — the rule requires KG or LB, never
      // a bare number.
      ['THREAD-GREEN', 'Stitching thread (green, 250g roll)'],
    ]) {
      const got = deriveSizeFromLabel({ code, name });
      if (got !== null) throw new Error(`${code} ("${name}") should state no size, got ${JSON.stringify(got)}`);
    }
  });

  it('a capacity only goes where it means kg of rice held', () => {
    expect(hasCapacity('katta')).toBe(true);
    expect(hasCapacity('pp_bag')).toBe(true);
    expect(hasCapacity('master_bag')).toBe(true);
    // A liner's size describes the bag it lines; a sheet, a label and a roll of
    // thread hold no rice at all.
    expect(hasCapacity('polythene')).toBe(false);
    expect(hasCapacity('other')).toBe(false);
  });

  it('a pound size is stored in kg, exactly', () => {
    expect(sizeToKg(8, 'lb')).toBe(3.629);
  });

  it('the backfill only fills blanks — nothing measured is overwritten', () => {
    // A 50 kg sack weighed at 49.3 is the real figure and must survive.
    expect(MIG).toContain('if (it.size_value == null)');
    expect(MIG).toContain('if (it.capacity_kg == null && hasCapacity(packType))');
  });

  it('it fills a missing type too rather than leaving another gap', () => {
    expect(MIG).toContain('if (!it.pack_type) patch.pack_type = packType;');
  });

  it('an item with no size still gets its type saved', () => {
    // The early return used to skip the whole row, type included.
    const block = MIG.slice(MIG.indexOf('if (!size) {'), MIG.indexOf('continue;', MIG.indexOf('if (!size) {')));
    expect(block).toContain('Object.keys(patch).length > 0');
  });

  it('and the next item created cannot arrive in the same state', () => {
    // Migration 310 repaired the rows; this is what stops the gap recurring.
    expect(SVC).toContain('function packagingDefaults(item)');
    expect(SVC).toContain('...packagingDefaults(data), ...data');
    // The caller always wins, so a deliberate value is never replaced by a guess
    // read off a name.
    expect(SVC).toContain('{ ...derived, ...data }');
  });

  it('a rename that reveals a size fills it in', () => {
    // updateItem derives from the MERGED row, not just the patch.
    expect(SVC).toContain('packagingDefaults({ ...existing, ...data })');
  });

  it('only packaging gets any of this', () => {
    expect(SVC).toContain("item.category !== 'packaging'");
  });
});

describe('a capacity of zero is a blank, not a measurement', () => {
  const { isMissingSize } = require('../shared/packagingTypes');
  const fs = require('fs');
  const path = require('path');
  const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20261001_311_repair_zero_capacity.js'), 'utf8');
  const SVC = fs.readFileSync(path.join(__dirname, '../modules/millStore/millStore.service.js'), 'utf8');
  const PACK = fs.readFileSync(path.join(__dirname, '../modules/millStore/packing.service.js'), 'utf8');
  // Comments stripped for the "must not mention" assertion — the migration's
  // header names the item that prompted it, which is the comment doing its job.
  const MIG_CODE = MIG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Migration 310 filled every NULL size and correctly left anything holding a
  // figure alone — but BAG-25KG-PP WOVEN held capacity 0, which is not a figure.
  // No bag holds nothing.
  it.each([
    [null, true], [undefined, true], [0, true], ['0', true], ['0.000', true],
    [-5, true], ['', true], ['abc', true],
    [25, false], ['25.000', false], [3.63, false], [0.5, false],
  ])('%s is missing: %s', (value, expected) => {
    expect(isMissingSize(value)).toBe(expected);
  });

  it('it matters because pack() already treats them alike', () => {
    // "Set a bag capacity (kg per bag) for X before packing" — a zero blocks
    // packing exactly as a null does, which is why one had to be repaired too.
    expect(PACK).toContain('if (capacity <= 0)');
  });

  it('the repair covers the class, not the one row', () => {
    expect(MIG_CODE).toContain("where({ category: 'packaging' })");
    expect(MIG_CODE).not.toContain('BAG-25KG-PP WOVEN');
  });

  it('a real figure is never replaced — a 49.3 kg sack stays 49.3', () => {
    expect(MIG).toContain('if (!isMissingSize(it.capacity_kg)) continue;');
  });

  it('it prefers the size already on the row, then the label', () => {
    expect(MIG).toContain('!isMissingSize(it.size_value)');
    expect(MIG).toContain('deriveSizeFromLabel(it)');
  });

  it('an item that states no size anywhere is left alone', () => {
    // Nothing is invented for it; it stays visible as needing attention.
    expect(MIG).toContain('if (!kg) continue;');
  });

  it('only a kind of item that HAS a capacity is touched', () => {
    expect(MIG).toContain('if (!hasCapacity(packType)) continue;');
  });

  it('a tare or a price of zero is deliberately NOT invented', () => {
    // Those are figures somebody may have meant. The stock report already prints
    // "no price set" where a price is zero, so it is visible rather than guessed.
    expect(MIG).not.toContain('tare_weight_kg:');
    expect(MIG).not.toContain('avg_cost_per_unit:');
  });

  it('and a zero cannot be saved as a size again', () => {
    // createItem/updateItem fill it the same way, so the next item entered with a
    // zero capacity gets the real one from its label.
    expect(SVC).toContain('isMissingSize(item.capacity_kg) && hasCapacity(packType)');
    expect(SVC).toContain('isMissingSize(item.size_value)');
  });
});

describe('retiring the seeded duplicates nobody uses', () => {
  const fs = require('fs');
  const path = require('path');
  const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20261002_312_retire_unused_seeded_bags.js'), 'utf8');
  const CODE = MIG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Migration 057 seeded a bag item per bag_types row, which left duplicates of
  // the same sack at the same size — three "Katta 50kg", three 100 kg katta.
  // Confirmed with the user: prices are maintained by hand and are not fixed, so
  // pricing the duplicates is not the answer; retiring them is.
  it('retires, never deletes', () => {
    // Pickers and the katta reconciler already filter on is_active, and the stock
    // report only lists what holds stock, so a retired item just stops being
    // offered. Deleting rows that movements or ratios may reference would be the
    // irreversible version of the same tidy-up.
    expect(CODE).toContain('is_active: false');
    expect(CODE).not.toMatch(/mill_items[\s\S]{0,80}\.del\(\)/);
  });

  it('the criteria are computed, not a hardcoded list of codes', () => {
    // So it cannot retire something that is in use on another database.
    expect(CODE).not.toContain('BAG-100KG-JUTE');
    expect(CODE).not.toContain('BAG-50KG-PP WOVEN');
    expect(CODE).toContain("andWhere('mi.code', 'like', 'BAG-%')");
  });

  it('anything with stock, history, a price or a ratio is spared', () => {
    for (const guard of [
      "whereNull('mi.avg_cost_per_unit').orWhere('mi.avg_cost_per_unit', 0)",
      "from('mill_stock')",
      "from('mill_stock_movements')",
      "from('mill_consumption_ratios')",
      "from('mill_purchase_items')",
      "from('mill_packing_logs')",
      "from('milling_batch_packaging')",
    ]) {
      expect(CODE).toContain(guard);
    }
    // Every usage test is a NOT EXISTS, so one hit is enough to keep an item.
    expect((CODE.match(/whereNotExists/g) || []).length).toBe(6);
  });

  it('a packing run counts whichever slot the item filled', () => {
    // A bag used as a master or as polythene is still a bag in use.
    expect(CODE).toContain('mill_packing_logs.bag_item_id = mi.id');
    expect(CODE).toContain('mill_packing_logs.master_bag_item_id = mi.id');
    expect(CODE).toContain('mill_packing_logs.poly_item_id = mi.id');
  });

  it('only bags and liners — thread and labels are left alone', () => {
    // Consumables the mill may well still buy, and never part of what was being
    // tidied. THREAD-WHITE also carries a ratio.
    expect(CODE).toContain("whereIn('mi.pack_type', ['katta', 'pp_bag', 'master_bag', 'polythene'])");
  });

  it('a user-created item is not caught by the seeded-code pattern', () => {
    // The seeded family is hyphenated (BAG-25KG-PP). BAG25KGPENTRADE is not, and
    // must survive even though it has no price and no usage.
    const like = (code) => /^BAG-/.test(code);
    expect(like('BAG-50KG-PP WOVEN')).toBe(true);
    expect(like('BAG25KGPENTRADE')).toBe(false);
    expect(like('KATTA-50')).toBe(false);
    expect(like('10KG FIZZA')).toBe(false);
  });

  it('it says what it did, because it changes what the pickers offer', () => {
    expect(CODE).toContain('console.log(`[312] Retired');
  });

  it('down() reactivates exactly what it retired', () => {
    expect(MIG).toContain("where('notes', 'like', '%Retired: seeded duplicate%')");
    expect(MIG).toContain('is_active: true');
  });
});
