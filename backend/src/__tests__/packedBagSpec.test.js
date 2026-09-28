const fs = require('fs');
const path = require('path');

// A batch's output lots used to be stamped with the predominant RAW katta size —
// what the paddy ARRIVED in, not what the rice left in. Batch M-001 arrived in
// 50kg katta and was packed into 100 × 25kg bags; its output lot was written as
// 50 × 50kg, a figure nobody had packed, which then followed the rice onto the
// order and onto the documents.
describe('output lots take their bag spec from the packing run', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );
  const fn = (() => {
    const at = src.indexOf('async reconcileBatchKatta');
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', at)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('reconcileBatchKatta not found');
  })();

  test('it reads what was actually packed', () => {
    expect(fn).toContain("trx('mill_packing_logs')");
    expect(fn).toMatch(/capacity_kg_per_bag/);
  });

  test('finished rice is stamped with the packed size, not the raw katta size', () => {
    expect(fn).toMatch(/usePacked\s*=\s*packedSpec && l\.type === 'finished'/);
    expect(fn).toMatch(/const size = usePacked \? packedSpec\.sizeKg : predSize/);
  });

  test('bags purchased from store do not also consume freed katta', () => {
    // The packing service already deducts those bags from mill stock. Counting
    // them against the katta freed from the raw would consume the sacks twice.
    expect(fn).toMatch(/if \(!usePacked\) packed \+= bags/);
  });

  test('without a packing run the previous behaviour stands', () => {
    // predSize is still the fallback for every lot, so batches that never
    // recorded a packing run are unaffected.
    expect(fn).toContain('predSize');
    expect(fn).toMatch(/packedSpec\s*=\s*null/);
  });

  test('the predominant packed size wins when a batch packed several', () => {
    expect(fn).toMatch(/if \(!packedSpec \|\| bags > packedSpec\.bags\)/);
  });

  test('zero or negative packing rows are ignored', () => {
    expect(fn).toMatch(/if \(sizeKg <= 0 \|\| bags <= 0\) continue/);
  });
});

describe('the order detail exposes what was packed', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/exportOrders/exportOrders.controller.js'), 'utf8',
  );

  test('it aggregates packing logs for the order’s batches', () => {
    expect(src).toContain("mill_packing_logs as pl");
    expect(src).toContain("mb.linked_export_order_id");
  });

  test('it is returned as actualPacking, per bag size', () => {
    expect(src).toMatch(/actualPacking:/);
    expect(src).toMatch(/bagSizeKg:/);
    expect(src).toMatch(/bags:/);
  });
});

// bag_weight_kg is the kg-per-bag every kg <-> katta conversion divides by:
//   quantity_bags = movementQtyKg / (lot.bag_weight_kg || 50)
// Re-stamping bag_size_kg without it left a 100 x 25kg lot reporting as 50
// katta, and two lots on production drifted that way.
describe('bag_weight_kg moves with bag_size_kg', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );
  const fn = (() => {
    const at = src.indexOf('async reconcileBatchKatta');
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', at)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('reconcileBatchKatta not found');
  })();

  const stamps = [...fn.matchAll(/update\(\{[^}]*bag_size_kg[^}]*\}\)/g)].map((m) => m[0]);

  test('every place that stamps a size exists and is found', () => {
    expect(stamps.length).toBeGreaterThanOrEqual(3);
  });

  test('none of them set the size without the weight', () => {
    const missing = stamps.filter((s) => !s.includes('bag_weight_kg'));
    expect(missing).toEqual([]);
  });

  test('the two are always given the same value', () => {
    for (const s of stamps) {
      const size = /bag_size_kg:\s*([A-Za-z0-9_.]+)/.exec(s);
      const weight = /bag_weight_kg:\s*([A-Za-z0-9_.]+)/.exec(s);
      expect(weight).toBeTruthy();
      expect(weight[1]).toBe(size[1]);
    }
  });
});

// A batch fed by FINISHED or by-product lots (a re-mill of owned stock) frees no
// katta — there are no raw sacks to return. The function bailed out at
// `if (freed <= 0) return null` BEFORE the stamping, so M-002, which packed
// 960 × 25kg, carried no bag spec at all on its output lot.
describe('a batch with no katta still records how its output was packed', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
  );
  const fn = (() => {
    const at = src.indexOf('async reconcileBatchKatta');
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', at)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('reconcileBatchKatta not found');
  })();

  test('the packing run is read BEFORE the no-katta exit', () => {
    const packIdx = fn.indexOf("trx('mill_packing_logs')");
    const exitIdx = fn.indexOf('if (freed <= 0)');
    expect(packIdx).toBeGreaterThan(-1);
    expect(exitIdx).toBeGreaterThan(-1);
    expect(packIdx).toBeLessThan(exitIdx);
  });

  test('the no-katta path still stamps the finished lots from it', () => {
    const at = fn.indexOf('if (freed <= 0)');
    const branch = fn.slice(at, at + 1400);
    expect(branch).toContain('if (packedSpec)');
    expect(branch).toMatch(/total_bags: bags/);
    expect(branch).toMatch(/bag_size_kg: packedSpec\.sizeKg/);
    expect(branch).toMatch(/bag_weight_kg: packedSpec\.sizeKg/);
  });

  test('it still returns null when there is no katta AND no packing run', () => {
    const at = fn.indexOf('if (freed <= 0)');
    expect(fn.slice(at, at + 1600)).toMatch(/return null; \/\/ no katta intake and nothing packed/);
  });

  test('the size and the per-bag weight are stamped together here too', () => {
    const at = fn.indexOf('if (freed <= 0)');
    const branch = fn.slice(at, at + 1400);
    const size = /bag_size_kg: ([A-Za-z0-9_.]+)/.exec(branch);
    const weight = /bag_weight_kg: ([A-Za-z0-9_.]+)/.exec(branch);
    expect(weight[1]).toBe(size[1]);
  });
});
