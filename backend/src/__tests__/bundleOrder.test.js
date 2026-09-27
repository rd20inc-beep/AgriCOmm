const { sequenceEntries } = require('../modules/documents/bundle.controller');

// A document set is assembled from two sources: files uploaded to the order and
// documents the system renders itself. The combined PDF used to emit every
// uploaded file first and every generated one after, so a bank submission came
// out shuffled. The client now sends the sequence it wants.
describe('sequenceEntries', () => {
  const gens = [{ docType: 'commercial-invoice' }, { docType: 'packing-list' }];

  test('honours an explicit order that interleaves uploaded and generated', () => {
    const out = sequenceEntries([7, 9], gens, [
      { k: 'g', i: 0 }, { k: 'u', id: 9 }, { k: 'g', i: 1 }, { k: 'u', id: 7 },
    ]);
    expect(out.map((e) => (e.kind === 'uploaded' ? `u${e.id}` : `g${e.index}`)))
      .toEqual(['g0', 'u9', 'g1', 'u7']);
  });

  test('keeps the requested order of uploaded files', () => {
    // The server reads rows with a whereIn, which comes back in no order at all,
    // so the oldest-first sequence the client builds has to be re-applied here.
    const out = sequenceEntries([31, 12, 25], [], [
      { k: 'u', id: 31 }, { k: 'u', id: 12 }, { k: 'u', id: 25 },
    ]);
    expect(out.map((e) => e.id)).toEqual([31, 12, 25]);
  });

  describe('falls back to uploaded-then-generated rather than lose a document', () => {
    const expectFallback = (order) => {
      const out = sequenceEntries([7, 9], gens, order);
      expect(out).toHaveLength(4);
      expect(out.map((e) => (e.kind === 'uploaded' ? `u${e.id}` : `g${e.index}`)))
        .toEqual(['u7', 'u9', 'g0', 'g1']);
    };

    test('no order at all (an older cached client)', () => expectFallback(undefined));
    test('order that misses a document', () => expectFallback([{ k: 'u', id: 7 }]));
    test('order naming an unknown upload', () => expectFallback([
      { k: 'u', id: 7 }, { k: 'u', id: 999 }, { k: 'g', i: 0 }, { k: 'g', i: 1 },
    ]));
    test('generated index out of range', () => expectFallback([
      { k: 'u', id: 7 }, { k: 'u', id: 9 }, { k: 'g', i: 0 }, { k: 'g', i: 5 },
    ]));
    test('a document listed twice', () => expectFallback([
      { k: 'u', id: 7 }, { k: 'u', id: 7 }, { k: 'g', i: 0 }, { k: 'g', i: 1 },
    ]));
    test('an unrecognised token kind', () => expectFallback([
      { k: 'x' }, { k: 'u', id: 9 }, { k: 'g', i: 0 }, { k: 'g', i: 1 },
    ]));
    test('a non-object token', () => expectFallback([
      'u7', { k: 'u', id: 9 }, { k: 'g', i: 0 }, { k: 'g', i: 1 },
    ]));
  });

  test('every selected document reaches the merge exactly once', () => {
    const many = [1, 2, 3, 4];
    const order = [
      { k: 'g', i: 1 }, { k: 'u', id: 3 }, { k: 'u', id: 1 },
      { k: 'g', i: 0 }, { k: 'u', id: 4 }, { k: 'u', id: 2 },
    ];
    const out = sequenceEntries(many, gens, order);
    expect(out).toHaveLength(6);
    expect(out.filter((e) => e.kind === 'uploaded').map((e) => e.id).sort()).toEqual([1, 2, 3, 4]);
    expect(out.filter((e) => e.kind === 'generated').map((e) => e.index).sort()).toEqual([0, 1]);
  });

  test('duplicate ids in uploadedIds are collapsed, not merged twice', () => {
    const out = sequenceEntries([5, 5], [], [{ k: 'u', id: 5 }]);
    expect(out).toEqual([{ kind: 'uploaded', id: 5 }]);
  });

  test('carries the generated document through for rendering', () => {
    const out = sequenceEntries([], gens, [{ k: 'g', i: 1 }, { k: 'g', i: 0 }]);
    expect(out[0].doc.docType).toBe('packing-list');
    expect(out[1].doc.docType).toBe('commercial-invoice');
  });
});
