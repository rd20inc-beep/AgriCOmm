const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');
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

// Read a page's text with pdftotext, so the assertions are about what is
// actually PRINTED on the contents sheet rather than what we believe we drew.
function pageText(bytes, page) {
  const file = path.join(os.tmpdir(), `contents-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    fs.writeFileSync(file, bytes);
    return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), file, '-'], { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
  }
}

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

    const text = pageText(out, 1);
    expect(text).toContain('Contents');
    expect(text).toContain('EX-001 documents');

    // Pull "<name> ....... <page or range>" off the sheet and check the page
    // really holds that document, identified by its distinctive width.
    const expected = { 'Commercial Invoice': 300, 'Packing List': 100, 'Certificate of Origin': 200 };
    let checked = 0;
    for (const [name, width] of Object.entries(expected)) {
      const line = text.split('\n').find((l) => l.includes(name));
      if (!line) throw new Error(`no contents line for ${name} in:\n${text}`);
      const m = line.match(/(\d+)(?:-(\d+))?\s*$/);
      if (!m) throw new Error(`no page number on "${line}"`);
      const from = parseInt(m[1], 10);
      const to = m[2] ? parseInt(m[2], 10) : from;
      for (let p = from; p <= to; p += 1) expect(w[p - 1]).toBe(width);
      checked += 1;
    }
    expect(checked).toBe(3);
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
    expect(pageText(out, 2)).toContain('Contents (continued)');

    // The 30th document is the last page, and the sheet must say page 32.
    const line = `${pageText(out, 1)}\n${pageText(out, 2)}`.split('\n').find((l) => /Document 30\b/.test(l));
    expect(line).toBeTruthy();
    expect(line.match(/(\d+)\s*$/)[1]).toBe('32');
    expect(w[31]).toBe(149);
  });

  test('an unmergeable file is listed on the contents too, so the numbering is complete', async () => {
    const out = await mergeToPdf([
      { name: 'Commercial Invoice', bytes: await stub(300), mime: 'application/pdf' },
      { name: 'scan.jpg', bytes: Buffer.from('not a pdf'), mime: 'image/jpeg' },
    ], { contentsPage: true });
    const w = await widths(out);
    expect(w).toEqual([595, 300, 595]);   // contents, the invoice, the notice page
    const text = pageText(out, 1);
    expect(text).toContain('Not included in this file');
    // The notice is page 3 and the contents has to say so.
    expect(text.split('\n').find((l) => l.includes('Not included'))).toMatch(/3\s*$/);
  });
});
