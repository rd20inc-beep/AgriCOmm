const fs = require('fs');
const path = require('path');

// Re-recording a yield used to DELETE every output lot and insert fresh ones.
// That threw away three things the lot owns:
//   its lot_no  — "WHITE HORSE D98 2.5 TON LOT" reverted to M-001-FIN-01
//   its id      — anything pointing at the lot broke (119 → 129 → 169)
//   its ledger  — lot_transactions were deleted with it
const SRC = fs.readFileSync(
  path.join(__dirname, '../modules/inventory/inventory.service.js'), 'utf8',
);
const fnBody = (name) => {
  const at = SRC.indexOf(`async ${name}`);
  if (at < 0) throw new Error(`${name} not found`);
  const open = SRC.indexOf('{', SRC.indexOf(')', SRC.indexOf('(', at)));
  let d = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === '{') d += 1;
    else if (SRC[i] === '}') { d -= 1; if (d === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error(`${name} not closed`);
};

describe('upsertOutputLot keeps what belongs to the lot', () => {
  const fn = fnBody('upsertOutputLot');

  test('an existing lot is updated, not replaced', () => {
    expect(fn).toMatch(/trx\('inventory_lots'\)\.where\('id', existing\.id\)\s*\n?\s*\.update/);
  });

  test('a hand-given lot number survives the update', () => {
    // The generated lot_no is dropped from the patch; the stored one stands.
    expect(fn).toMatch(/lot_no: _generated, \.\.\.rest/);
    expect(fn).not.toMatch(/\.update\(\{ \.\.\.row/);
  });

  test('it still inserts when the batch has no such output yet', () => {
    expect(fn).toMatch(/if \(!existing\)/);
    expect(fn).toMatch(/\.insert\(row\)/);
  });
});

describe('recordMillingOutput matches the output it already produced', () => {
  const fn = fnBody('recordMillingOutput');

  test('the finished lot is matched on the batch', () => {
    expect(fn).toMatch(/upsertOutputLot\(trx, \{\s*batch_ref: `batch-\$\{batchId\}`, type: 'finished',/);
  });

  test('a graded by-product is matched on its grade', () => {
    expect(fn).toMatch(/type: 'byproduct', grade: bp\.grade/);
  });

  test('an ungraded by-product is matched on its product', () => {
    expect(fn).toMatch(/type: 'byproduct', product_id: bpProductId/);
  });

  test('neither output is inserted blindly any more', () => {
    expect(fn).not.toMatch(/const \[lot\] = await trx\('inventory_lots'\)\s*\n?\s*\.insert/);
  });
});

describe('the resync no longer deletes the lots', () => {
  const fn = fnBody('resyncBatchOutputsFromBatch');

  test('output lots are not deleted wholesale', () => {
    expect(fn).not.toMatch(/trx\('inventory_lots'\)\.whereIn\('id', outIds\)\.del\(\)/);
  });

  test("only this batch's own movement rows are cleared", () => {
    // Otherwise a re-recorded yield stacks a second production receipt.
    expect(fn).toMatch(/reference_module: 'milling_batch', reference_id: batchId \}\)\.del\(\)/);
  });

  test('the reserved / sold / re-milled guard is still in force', () => {
    expect(fn).toMatch(/e\.status = 409/);
    expect(fn).toMatch(/inventory_reservations/);
  });

  test('an output that is no longer produced is retired, but only if empty', () => {
    expect(fn).toMatch(/COALESCE\(qty, 0\) = 0/);
    expect(fn).toMatch(/resyncStartedAt/);
  });

  test('it reports what it updated rather than what it recreated', () => {
    expect(fn).toMatch(/updatedInPlace:/);
    expect(fn).not.toMatch(/recreatedFrom:/);
  });
});
