const {
  PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream,
} = require('pdf-lib');
const {
  mergeToPdf, contentsRows, contentsSheetCount, asciiSafe,
} = require('../modules/documents/bundle.controller');

async function stub(width, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([width, 842]);
  return Buffer.from(await doc.save());
}
const widths = async (bytes) => (await PDFDocument.load(bytes))
  .getPages().map((pg) => Math.round(pg.getWidth()));

// Read back what was actually DRAWN on a page, rather than trusting that the
// drawing code did what it meant to. pdf-lib writes each string as a hex literal
// preceded by its text matrix, so position comes with it for free:
//
//   1 0 0 1 81 726 Tm  <436F6D6D65726369616C20496E766F696365> Tj
//
// An external extractor (pdftotext) would have been simpler, but the CI runner
// has no such binary and the resulting ENOENT could not be serialised by
// jest-worker, which failed the whole suite with "Converting circular structure
// to JSON" instead of naming the missing tool. This needs nothing but pdf-lib.
async function drawnItems(bytes, pageIndex) {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, i) => doc.context.lookup(contents.get(i)))
    : [contents];
  let raw = '';
  for (const st of streams) {
    const bytesOut = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents();
    raw += Buffer.from(bytesOut).toString('latin1');
  }
  const re = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g;
  return [...raw.matchAll(re)].map((m) => ({
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
    text: Buffer.from(m[3], 'hex').toString('latin1'),
  }));
}

// The sheet as rows: everything sharing a baseline, left to right, with the dot
// leader dropped. A contents line becomes ['1.', 'Commercial Invoice', '2'].
async function contentsSheet(bytes, pageIndex = 0) {
  const items = await drawnItems(bytes, pageIndex);
  const byLine = new Map();
  for (const it of items) {
    if (/^\.+$/.test(it.text)) continue;            // dot leader
    const key = Math.round(it.y);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(it);
  }
  return [...byLine.entries()]
    .sort((a, b) => b[0] - a[0])                     // top of the page down
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((i) => i.text));
}

// The page (or range) a named document is listed against.
const listedAt = (rows, name) => {
  const row = rows.find((r) => r.some((cell) => cell.includes(name)));
  return row ? row[row.length - 1] : null;
};

describe('contentsRows — the page numbers account for the contents itself', () => {
  const outline = [
    { name: 'Commercial Invoice', start: 1, pages: 1 },
    { name: 'Packing List', start: 2, pages: 3 },
    { name: 'Certificate of Origin', start: 5, pages: 1 },
  ];

  test('one contents sheet shifts everything by one', () => {
    expect(contentsRows(outline, 1).map((r) => r.label)).toEqual(['2', '3-5', '6']);
  });

  test('two contents sheets shift everything by two', () => {
    expect(contentsRows(outline, 2).map((r) => r.label)).toEqual(['3', '4-6', '7']);
  });

  test('a single-page document prints one number, not a range', () => {
    expect(contentsRows([{ name: 'x', start: 1, pages: 1 }], 1)[0].label).toBe('2');
  });

  test('sheet count follows the number of entries', () => {
    expect(contentsSheetCount(1)).toBe(1);
    expect(contentsSheetCount(26)).toBe(1);
    expect(contentsSheetCount(27)).toBe(2);
    expect(contentsSheetCount(0)).toBe(1);   // never zero — it is only called with entries
  });

  test('numbers stay right when a document reports no pages', () => {
    expect(contentsRows([{ name: 'x', start: 4, pages: 0 }], 1)[0].label).toBe('5');
  });
});

describe('asciiSafe — a name pdf-lib cannot encode must not fail the download', () => {
  test('typographic punctuation is folded, not dropped', () => {
    expect(asciiSafe('Indemnity — Related Party')).toBe('Indemnity - Related Party');
    expect(asciiSafe('“Quality”')).toBe('"Quality"');
  });
  test('unencodable text falls back rather than yielding an empty label', () => {
    expect(asciiSafe('الفاتورة', 'Document 3')).toBe('Document 3');
  });
});

describe('the contents page, end to end', () => {
  test('off by default — no sheet is added', async () => {
    const out = await mergeToPdf([{ name: 'a', bytes: await stub(300), mime: 'application/pdf' }]);
    expect(await widths(out)).toEqual([300]);
  });

  test('every document starts on the page the contents says it does', async () => {
    const sources = [
      { name: 'Commercial Invoice', bytes: await stub(300), mime: 'application/pdf' },
      { name: 'Packing List', bytes: await stub(100, 3), mime: 'application/pdf' },
      { name: 'Certificate of Origin', bytes: await stub(200), mime: 'application/pdf' },
    ];
    const out = await mergeToPdf(sources, { contentsPage: true, title: 'EX-001 documents' });

    const w = await widths(out);
    // One contents sheet (A4), then the five document pages in order.
    expect(w).toEqual([595, 300, 100, 100, 100, 200]);

    const rows = await contentsSheet(out);
    expect(rows[0]).toEqual(['Contents']);
    expect(rows[1]).toEqual(['EX-001 documents']);
    // Numbered, in order, each against the page it starts on.
    expect(rows[2]).toEqual(['1.', 'Commercial Invoice', '2']);
    expect(rows[3]).toEqual(['2.', 'Packing List', '3-5']);
    expect(rows[4]).toEqual(['3.', 'Certificate of Origin', '6']);

    // And the page it names really does hold that document, identified by width.
    const expected = { 'Commercial Invoice': 300, 'Packing List': 100, 'Certificate of Origin': 200 };
    for (const [name, width] of Object.entries(expected)) {
      const label = listedAt(rows, name);
      if (!label) throw new Error(`${name} is not listed on the contents sheet`);
      const [from, to = from] = label.split('-').map(Number);
      for (let page = from; page <= to; page += 1) expect(w[page - 1]).toBe(width);
    }
  });

  test('past 26 documents the contents runs to a second sheet, numbers still true', async () => {
    const sources = [];
    for (let i = 0; i < 30; i += 1) {
      sources.push({ name: `Document ${i + 1}`, bytes: await stub(120 + i), mime: 'application/pdf' });
    }
    const out = await mergeToPdf(sources, { contentsPage: true, title: 'big set' });
    const w = await widths(out);
    expect(w.slice(0, 2)).toEqual([595, 595]);          // two contents sheets
    expect(w).toHaveLength(32);

    const sheet1 = await contentsSheet(out, 0);
    const sheet2 = await contentsSheet(out, 1);
    expect(sheet2[0]).toEqual(['Contents (continued)']);

    // The first document is page 3 (two contents sheets ahead of it) and the
    // thirtieth is the last page, 32.
    expect(listedAt(sheet1, 'Document 1')).toBe('3');
    expect(listedAt(sheet2, 'Document 30')).toBe('32');
    expect(w[2]).toBe(120);
    expect(w[31]).toBe(149);
  });

  test('an unmergeable file is listed on the contents too, so the numbering is complete', async () => {
    const out = await mergeToPdf([
      { name: 'Commercial Invoice', bytes: await stub(300), mime: 'application/pdf' },
      { name: 'scan.jpg', bytes: Buffer.from('not a pdf'), mime: 'image/jpeg' },
    ], { contentsPage: true });
    const w = await widths(out);
    expect(w).toEqual([595, 300, 595]);   // contents, the invoice, the notice page
    const rows = await contentsSheet(out);
    // The notice is page 3 and the contents has to say so.
    expect(listedAt(rows, 'Not included in this file')).toBe('3');
  });
});
