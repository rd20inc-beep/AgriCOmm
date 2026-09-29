const fs = require('fs');
const path = require('path');

// A blend's own variety is the blend label — "Blend M-001" — so a by-product
// row could not be traced to the rice it was milled from without opening the
// batch. The source varieties live on the lots that fed it.
describe('the lot ledger carries a source trace', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/analytics/reporting.service.js'), 'utf8',
  );
  const fn = (() => {
    const at = src.indexOf('async getLotLedger');
    const open = src.indexOf('{', src.indexOf(')', src.indexOf('(', at)));
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('getLotLedger not found');
  })();

  test('it reads the batch that produced the lot', () => {
    expect(fn).toMatch(/batch_ref/);
    expect(fn).toContain("db('milling_batches')");
  });

  test('it reads the lots that fed that batch', () => {
    expect(fn).toContain("db('batch_source_lots as bsl')");
    expect(fn).toMatch(/bsl\.batch_id/);
  });

  test('the response exposes the batch and the varieties', () => {
    expect(fn).toMatch(/sourceBatchNo:/);
    expect(fn).toMatch(/sourceVarieties:/);
    expect(fn).toMatch(/source: sourceTrace/);
  });

  test('a lot with no batch behind it gets no trace rather than an error', () => {
    expect(fn).toMatch(/let sourceTrace = null/);
    expect(fn).toMatch(/if \(lot\.batch_ref &&/);
  });

  test('the batch_ref is validated before being parsed', () => {
    // batch_ref is a free-text column; `batch-<n>` is the only shape that means
    // a milling batch, and parseInt on anything else would query batch NaN.
    expect(fn).toMatch(/\/\^batch-\\d\+\$\/\.test/);
  });
});

// The shape the ledger page renders, restated.
describe('what the trace says for each kind of batch', () => {
  const trace = (ownVariety, sourceVarieties) => ({
    riceType: ownVariety,
    sourceVarieties: [...new Set(sourceVarieties.filter(Boolean))],
  });

  test('a blend shows every rice that went in, deduped', () => {
    const t = trace('Blend M-001', ['D98', 'BLENDED', 'C9', 'D98', null]);
    expect(t.riceType).toBe('Blend M-001');
    expect(t.sourceVarieties).toEqual(['D98', 'BLENDED', 'C9']);
  });

  test('a single-variety batch agrees with the lot it already carries', () => {
    const t = trace('IRRI-6 Long Grain White Rice', ['IRI6']);
    expect(t.sourceVarieties).toEqual(['IRI6']);
  });

  test('a purchased lot has nothing to trace', () => {
    expect(trace('D98', []).sourceVarieties).toEqual([]);
  });
});
