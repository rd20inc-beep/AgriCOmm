/**
 * Packing after the yield has to tell the lot what it was packed into.
 *
 * The bag spec is stamped onto a finished lot by reconcileBatchKatta, which runs
 * at YIELD. But you mill first and bag afterwards, so the normal order of work is
 * yield-then-pack — and then there was no packing run to read at the time, the
 * lot was left with no spec at all, and every report fell back to dividing the
 * weight by 50.
 *
 * Batch M-005 packed 873 x 25 kg and its 21,825 kg lot read as "437 katta".
 * M-006 packed 7,435 x 3.63 kg (8 lb retail) and read as 540. Both were packed
 * after their yield; M-001 and M-002 were packed before theirs and were correct,
 * which is what made this look like a display bug rather than a missing write.
 *
 * Replayed against a real Postgres: after yield 437 katta, after packing
 * 873 x 25 kg, and a second packing run does not double it.
 */
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PACKING = read('modules/millStore/packing.service.js');
const INVENTORY = read('modules/inventory/inventory.service.js');

// Extract a named method's body so an assertion cannot match a neighbour.
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

describe('a packing run reaches the lot', () => {
  const pack = methodBody(PACKING, 'pack');

  it('pack() reconciles the batch, which is what stamps the spec', () => {
    expect(pack).toContain('inventoryService.reconcileBatchKatta(trx, batchId, userId)');
  });

  it('it runs inside the packing transaction', () => {
    // Outside it, a failed packing run would still have restamped the lot.
    const txAt = pack.indexOf('db.transaction');
    expect(pack.indexOf('reconcileBatchKatta')).toBeGreaterThan(txAt);
  });

  it('it only runs once the batch has actually yielded', () => {
    // Before the yield there is no output lot to stamp.
    expect(pack).toMatch(/if \(\(Number\(batch\.actual_finished_kg\) \|\| 0\) > 0\) \{\s*\n\s*try \{ (const katta = )?await inventoryService\.reconcileBatchKatta/);
  });

  it('a failure there does not lose the packing run', () => {
    // Same non-blocking treatment as the GL and cost steps above it. Anchored on
    // the CALL, not the first mention — the comment above it names it too.
    const call = 'await inventoryService.reconcileBatchKatta(trx, batchId, userId)';
    const idx = pack.indexOf(call);
    expect(idx).toBeGreaterThan(-1);
    const line = pack.slice(pack.lastIndexOf('\n', idx) + 1, pack.indexOf('\n', idx));
    expect(line.trim().startsWith('try {')).toBe(true);
    expect(pack.slice(idx, idx + 400)).toContain('catch');
  });
});

describe('re-running the reconcile is safe, which is why it can be called again', () => {
  const rec = methodBody(INVENTORY, 'reconcileBatchKatta');

  it('it reverses its own prior movements before recomputing', () => {
    // Without this, each packing run would add another set of katta movements.
    expect(rec).toContain("where({ reference_type: 'batch_katta', reference_id: batchId })");
    expect(rec).toContain('.del()');
  });

  it('bags are derived from the lot weight, not by summing packing runs', () => {
    // An over-pack or a correction run must not inflate what the lot holds:
    // 21,825 kg at 25 kg is 873 bags however many runs recorded it.
    expect(rec).toMatch(/const bags = Math\.ceil\(kg \/ (packedSpec\.sizeKg|size)\)/);
  });

  it('the predominant packed size wins, not the most recent run', () => {
    expect(rec).toContain('if (!packedSpec || bags > packedSpec.bags) packedSpec = { sizeKg, bags }');
  });

  it('bag_weight_kg is always set with the size', () => {
    // It is the divisor for every kg <-> bag conversion; leaving it behind is
    // what made a 100 x 25 kg lot report as 50 katta.
    const updates = rec.match(/bag_size_kg: [^,]+, bag_weight_kg: [^,]+/g) || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      const [, size, weight] = u.match(/bag_size_kg: ([^,]+), bag_weight_kg: ([^,]+)/);
      expect(weight.trim()).toBe(size.trim());
    }
  });

  it('bags drawn from mill store do not also consume freed katta', () => {
    // Re-running after a packing run releases the katta the yield had assumed
    // would be used — the reason to re-run the whole reconcile, not just stamp.
    expect(rec).toContain('const usePacked = packedSpec && l.type === \'finished\'');
    expect(rec).toContain('if (!usePacked) packed += bags;');
  });
});

describe('the report rule this feeds', () => {
  // A lot with no spec falls back to 50 — which is how 21,825 kg became 437.
  const katta = (kg, per) => Math.round(kg / (per || 50));
  it.each([
    [21825, null, 437],    // M-005 before the fix
    [21825, 25, 873],      // M-005 after
    [26990, null, 540],    // M-006 before
    [26990, 3.63, 7435],   // M-006 after — 8 lb retail bags
  ])('%s kg at %s kg per bag is %s units', (kg, per, expected) => {
    expect(katta(kg, per)).toBe(expected);
  });

  it('under 50 kg they are reported as bags, not katta', () => {
    const isKatta = (per) => per === 0 || per >= 50;
    expect(isKatta(25)).toBe(false);
    expect(isKatta(3.63)).toBe(false);
    // And a lot with NO spec still counts as katta, which is why the missing
    // stamp showed up as a katta figure rather than as a blank.
    expect(isKatta(0)).toBe(true);
  });
});

/**
 * ── The part that stops this happening a fourth time ──
 *
 * Three separate bugs have now produced a wrong bag count on a stock report —
 * an intake count that was never decremented, a 25 kg pack reported as katta,
 * and a spec that was never stamped because the packing came after the yield.
 * Every one of them was found by a person reading the number, and every one was
 * fixed by hand against production.
 *
 * Tests only cover the paths someone thought of, so the safeguard is not another
 * test: it is that a lot whose bag count disagrees with its packing runs is
 * DETECTED wherever it appears, SHOWN on the report that carries the number, and
 * REPAIRABLE without anyone writing SQL. These pin that arrangement in place.
 */
describe('a wrong bag count cannot stay quiet', () => {
  const SVC = read('modules/inventory/inventory.service.js');
  const ROUTES = read('modules/inventory/lotInventory.routes.js');
  const REPORT = read('modules/analytics/reporting.controller.js');

  it('the detector looks for the SYMPTOM, not a known cause', () => {
    // Any path that produces or repacks bagged output and fails to stamp shows
    // up, including paths written later. That is the whole point.
    expect(SVC).toContain('bagSpecMismatchLots');
    expect(SVC).toContain('bagSpecMismatch: bagSpecMismatch.rows.length');
  });

  it('it catches BOTH shapes: never stamped, and stamped at the wrong size', () => {
    const q = SVC.slice(SVC.indexOf('WITH packed AS'), SVC.indexOf('bagSpecMismatchLots'));
    expect(q).toContain('IS NULL');
    expect(q).toContain('> 0.001');
    expect(q).toContain("'never stamped'");
    expect(q).toContain("'stamped at a size it was not packed in'");
  });

  it('it ignores a retired or empty lot, which cannot be wrong about anything', () => {
    const q = SVC.slice(SVC.indexOf('WITH packed AS'), SVC.indexOf('bagSpecMismatchLots'));
    expect(q).toContain("l.status <> 'Retired'");
    expect(q).toContain('> 0');
  });

  it('the repair goes through the one owner of the field, not its own UPDATE', () => {
    // Writing the spec here would be a second implementation to drift from.
    const repair = methodBody(SVC, 'repairBagSpecs');
    expect(repair).toContain('reconcileBatchKatta');
    expect(repair).not.toContain("update({ bag_weight_kg");
    expect(repair).not.toContain('bag_size_kg:');
  });

  it('one batch failing does not abandon the rest', () => {
    const repair = methodBody(SVC, 'repairBagSpecs');
    expect(repair).toContain('continue;');
    expect(repair).toContain('ok: false');
  });

  it('it is a route anyone with inventory edit can press, and it is audited', () => {
    expect(ROUTES).toContain("router.post('/repair-bag-specs', authorize('inventory', 'edit')");
    expect(ROUTES).toContain("auditAction('repair_bag_specs'");
  });

  it('the stock report states the disagreement where the number is read', () => {
    // Not on a separate page nobody opens — the last three were each noticed on
    // this report, so this is where it has to say so.
    const fn = methodBody(REPORT, 'printableStockDetail');
    expect(fn).toContain('packedByBatch');
    expect(fn).toContain('specDisagrees');
    expect(fn).toContain('packedSizeKg');
    expect(fn).toContain('packedUnits');
  });

  it('the report and the stamping agree on which size wins', () => {
    // Both take the predominant run by bag count. Two different rules here would
    // make the report flag lots that are correctly stamped.
    const fn = methodBody(REPORT, 'printableStockDetail');
    expect(fn).toContain('if (!cur || bags > cur.bags)');
    expect(methodBody(SVC, 'reconcileBatchKatta')).toContain('if (!packedSpec || bags > packedSpec.bags)');
  });

  it('only finished output is judged against a packing run', () => {
    // A raw lot's sacks are what it ARRIVED in; there is no packing run for it
    // to disagree with, and flagging it would be noise.
    const fn = methodBody(REPORT, 'printableStockDetail');
    expect(fn).toContain("l.type === 'finished'");
  });
});
