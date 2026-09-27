const { PDFDocument } = require('pdf-lib');
const { mergeToPdf, sequenceEntries } = require('../modules/documents/bundle.controller');

// Each stub PDF is given a distinctive page width, so the page order of the
// merged file can be read back without extracting any text.
async function stub(width, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([width, 842]);
  return Buffer.from(await doc.save());
}

const widths = async (bytes) => (await PDFDocument.load(bytes))
  .getPages().map((pg) => Math.round(pg.getWidth()));

describe('the combined PDF follows the requested order', () => {
  test('pages come out in the order the sources were given', async () => {
    const out = await mergeToPdf([
      { name: 'invoice', bytes: await stub(300), mime: 'application/pdf' },
      { name: 'packing list', bytes: await stub(100), mime: 'application/pdf' },
      { name: 'certificate', bytes: await stub(200), mime: 'application/pdf' },
    ]);
    expect(await widths(out)).toEqual([300, 100, 200]);
  });

  test('a multi-page document keeps its own pages together and in order', async () => {
    const out = await mergeToPdf([
      { name: 'first', bytes: await stub(100), mime: 'application/pdf' },
      { name: 'three-page scan', bytes: await stub(250, 3), mime: 'application/pdf' },
      { name: 'last', bytes: await stub(400), mime: 'application/pdf' },
    ]);
    expect(await widths(out)).toEqual([100, 250, 250, 250, 400]);
  });

  test('an interleaved sequence survives the whole path, helper into merge', async () => {
    // What the old code could not do: a generated document before an uploaded
    // one. It emitted every upload first, so this came out [200, 300, 100].
    const uploads = { 7: await stub(200), 9: await stub(300) };
    const gens = [{ docType: 'invoice', rendered: await stub(100) }];
    const entries = sequenceEntries([7, 9], gens, [
      { k: 'u', id: 7 }, { k: 'g', i: 0 }, { k: 'u', id: 9 },
    ]);
    const sources = entries.map((e) => (e.kind === 'uploaded'
      ? { name: `upload ${e.id}`, bytes: uploads[e.id], mime: 'application/pdf' }
      : { name: e.doc.docType, bytes: e.doc.rendered, mime: 'application/pdf' }));
    const out = await mergeToPdf(sources);
    expect(await widths(out)).toEqual([200, 100, 300]);
  });

  test('an unmergeable file does not shift the others, and is named at the end', async () => {
    const out = await mergeToPdf([
      { name: 'invoice', bytes: await stub(300), mime: 'application/pdf' },
      { name: 'scan.jpg', bytes: Buffer.from('\xff\xd8\xff not a pdf', 'latin1'), mime: 'image/jpeg' },
      { name: 'certificate', bytes: await stub(200), mime: 'application/pdf' },
    ]);
    const w = await widths(out);
    // The two real documents keep their order and positions; the trailing page
    // is the "Not included in this file" notice.
    expect(w.slice(0, 2)).toEqual([300, 200]);
    expect(w).toHaveLength(3);
  });
});
