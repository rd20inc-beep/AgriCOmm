const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const archiver = require('archiver');
const db = require('../../config/database');
const pdfService = require('./pdf.service');

/**
 * Download several documents at once, as one ZIP.
 *
 * Two kinds go in:
 *   - uploaded  — files already on disk (document_store), added as they are
 *   - generated — the system's own documents, which are rendered in the BROWSER,
 *                 so the client sends each one's HTML and the server turns it
 *                 into a PDF (same puppeteer path as the single-document
 *                 download, so a bundled copy matches a singly-downloaded one)
 *
 * Streamed, not buffered: a shipment's full document set is tens of MB and
 * holding it in memory to count its length first would be wasteful.
 */

const safeName = (s, fallback) => String(s || fallback || 'document')
  .replace(/[/\\?%*:|"<>]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);

// Merge every source into ONE pdf. Anything that is not a PDF (a scanned JPG,
// a spreadsheet) cannot be merged, so it is named on a trailing page rather than
// vanishing — the same honesty as MISSING.txt in the zip.
// Official certificates are routinely issued as ENCRYPTED PDFs. pdf-lib cannot
// decrypt; loading one with ignoreEncryption silently copies pages that render
// blank, which is how a 25-page merge came out with 22 empty pages. qpdf strips
// the encryption first — it needs no password when only an owner password is
// set, which is the usual case for issued certificates.
function decryptIfNeeded(bytes, label) {
  const looksEncrypted = bytes.slice(-3072).toString('latin1').includes('/Encrypt')
    || bytes.slice(0, 2048).toString('latin1').includes('/Encrypt');
  if (!looksEncrypted) return { bytes, note: null };

  const tmpIn = path.join(os.tmpdir(), `dec-in-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const tmpOut = `${tmpIn}.out.pdf`;
  try {
    fs.writeFileSync(tmpIn, bytes);
    // --decrypt removes encryption; a non-zero exit means a user password is
    // required, which we cannot supply.
    execFileSync('qpdf', ['--decrypt', tmpIn, tmpOut], { stdio: 'pipe', timeout: 30000 });
    return { bytes: fs.readFileSync(tmpOut), note: null };
  } catch (err) {
    return { bytes: null, note: `${label} (password-protected — could not be combined)` };
  } finally {
    for (const f of [tmpIn, tmpOut]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* ignore */ } }
  }
}

// pdf-lib's standard fonts encode WinAnsi only, and drawText THROWS on a glyph
// it cannot encode — so a document named in Urdu would not merely print oddly,
// it would fail the whole combined download with a 500. Everything drawn onto a
// page we create is reduced to plain ASCII first.
const asciiSafe = (value, fallback = 'Document') => {
  const out = String(value == null ? '' : value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
  return out || fallback;
};

// How many entries fit on one contents sheet, below its heading.
const CONTENTS_ROWS_PER_PAGE = 26;

/**
 * Where each document lands once the contents sheets are in front of it.
 *
 * The contents has to state page numbers, and inserting it at the front moves
 * every document along by however many sheets the contents itself takes — which
 * depends on how many documents there are. Kept separate from the drawing so the
 * arithmetic can be tested on its own.
 */
function contentsRows(outline, sheets) {
  return outline.map((item, i) => {
    const from = item.start + sheets;
    const to = from + Math.max(1, item.pages) - 1;
    return {
      index: i + 1,
      name: asciiSafe(item.name, `Document ${i + 1}`),
      from,
      to,
      label: to > from ? `${from}-${to}` : `${from}`,
    };
  });
}

const contentsSheetCount = (entries) => Math.max(1, Math.ceil(entries / CONTENTS_ROWS_PER_PAGE));

// Draw the contents onto sheets inserted at the front of the merged document.
async function prependContents(merged, outline, title) {
  const { StandardFonts, rgb } = require('pdf-lib');
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const bold = await merged.embedFont(StandardFonts.HelveticaBold);
  const sheets = contentsSheetCount(outline.length);
  const rows = contentsRows(outline, sheets);

  for (let i = 0; i < sheets; i += 1) merged.insertPage(i, [595, 842]);

  const LEFT = 55;
  const RIGHT = 540;
  const NAME_X = LEFT + 26;
  const SIZE = 10;
  const grey = rgb(0.45, 0.45, 0.45);
  const ink = rgb(0.1, 0.1, 0.1);

  // Trim a name to the space between its number and its page number.
  const fit = (text, maxWidth) => {
    let t = text;
    if (font.widthOfTextAtSize(t, SIZE) <= maxWidth) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, SIZE) > maxWidth) t = t.slice(0, -1);
    return `${t}...`;
  };

  for (let sheet = 0; sheet < sheets; sheet += 1) {
    const page = merged.getPage(sheet);
    page.drawText(sheet === 0 ? 'Contents' : 'Contents (continued)', {
      x: LEFT, y: 782, size: 17, font: bold, color: ink,
    });
    if (sheet === 0 && title) {
      page.drawText(asciiSafe(title, 'Documents'), { x: LEFT, y: 762, size: 10, font, color: grey });
    }
    let y = 726;
    for (const row of rows.slice(sheet * CONTENTS_ROWS_PER_PAGE, (sheet + 1) * CONTENTS_ROWS_PER_PAGE)) {
      const numW = font.widthOfTextAtSize(row.label, SIZE);
      const name = fit(row.name, RIGHT - numW - NAME_X - 14);
      page.drawText(`${row.index}.`, { x: LEFT, y, size: SIZE, font, color: grey });
      page.drawText(name, { x: NAME_X, y, size: SIZE, font, color: ink });
      // Dot leader, so the eye can follow a short title across to its page.
      const gapFrom = NAME_X + font.widthOfTextAtSize(name, SIZE) + 4;
      const gapTo = RIGHT - numW - 4;
      const dotW = font.widthOfTextAtSize('.', SIZE);
      if (gapTo > gapFrom && dotW > 0) {
        page.drawText('.'.repeat(Math.floor((gapTo - gapFrom) / dotW)), { x: gapFrom, y, size: SIZE, font, color: grey });
      }
      page.drawText(row.label, { x: RIGHT - numW, y, size: SIZE, font, color: ink });
      y -= 20;
    }
  }
  return sheets;
}

async function mergeToPdf(sources, opts = {}) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const merged = await PDFDocument.create();
  const skipped = [];
  const outline = [];   // what went in, and where — for the optional contents sheet

  for (const src of sources) {
    try {
      const raw = src.bytes || fs.readFileSync(src.path);
      // %PDF- magic: trust the file, not the stored mime type
      if (Buffer.from(raw.slice(0, 5)).toString() !== '%PDF-') {
        skipped.push(`${src.name} (not a PDF — ${src.mime || 'unknown type'})`);
        continue;
      }
      const { bytes, note } = decryptIfNeeded(Buffer.from(raw), src.name);
      if (!bytes) { skipped.push(note); continue; }

      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      if (!pages.length) { skipped.push(`${src.name} (no pages)`); continue; }
      const startsAt = merged.getPageCount() + 1;
      pages.forEach((pg) => merged.addPage(pg));
      outline.push({ name: src.name, start: startsAt, pages: pages.length });
    } catch (err) {
      console.error('Document merge failed for', src.name, err.message);
      skipped.push(`${src.name} (could not be read)`);
    }
  }

  if (skipped.length) {
    const noticeStart = merged.getPageCount() + 1;
    const page = merged.addPage([595, 842]);
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('Not included in this file', { x: 50, y: 790, size: 14, font, color: rgb(0.6, 0.1, 0.1) });
    skipped.forEach((label, i) => {
      // asciiSafe: a name pdf-lib cannot encode used to throw here and fail the
      // whole download rather than the one document it could not include.
      page.drawText(asciiSafe(`- ${label}`, '- a document').slice(0, 95), { x: 50, y: 760 - i * 18, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    });
    page.drawText('Download these individually, or as a ZIP.', { x: 50, y: 760 - skipped.length * 18 - 20, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    outline.push({ name: 'Not included in this file', start: noticeStart, pages: 1 });
  }

  if (merged.getPageCount() === 0) {
    const page = merged.addPage([595, 842]);
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('None of the selected documents could be merged into a PDF.', { x: 50, y: 790, size: 12, font });
  }
  // Opt-in, and last, so the sheets land in front of a finished document set and
  // the page numbers it prints are the ones the reader will see.
  if (opts.contentsPage && outline.length) {
    await prependContents(merged, outline, opts.title);
  }

  // Uint8Array from pdf-lib; res.send needs a Buffer.
  return Buffer.from(await merged.save());
}

// Put the documents in the order the client asked for.
//
// The combined PDF used to come out in two blocks — every uploaded file, then
// every generated one — and within the uploaded block in whatever order
// Postgres returned the `whereIn`. So a set read in the sequence the user had
// ticked the checkboxes, not the sequence the Documents tab lists, and the
// deliberate oldest-first ordering of a certificate scanned as several files
// was thrown away. The client now sends an explicit `order` of tokens
// ({ k: 'u', id } for an uploaded file, { k: 'g', i } for a generated one) and
// the merge walks it.
//
// The order has to account for every document exactly once to be used at all;
// anything else (an older cached client that sends no order, a token that does
// not line up) falls back to the previous behaviour rather than dropping a
// document from someone's bank submission.
function sequenceEntries(uploadedIds, generated, order) {
  const ids = [];
  for (const raw of Array.isArray(uploadedIds) ? uploadedIds : []) {
    const id = parseInt(raw, 10);
    if (Number.isFinite(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  const gens = Array.isArray(generated) ? generated : [];
  const fallback = () => [
    ...ids.map((id) => ({ kind: 'uploaded', id })),
    ...gens.map((doc, index) => ({ kind: 'generated', doc, index })),
  ];

  if (!Array.isArray(order) || order.length !== ids.length + gens.length) return fallback();

  const seen = new Set();
  const out = [];
  for (const tok of order) {
    if (!tok || typeof tok !== 'object') return fallback();
    if (tok.k === 'u') {
      const id = parseInt(tok.id, 10);
      if (!ids.includes(id) || seen.has(`u${id}`)) return fallback();
      seen.add(`u${id}`);
      out.push({ kind: 'uploaded', id });
    } else if (tok.k === 'g') {
      const index = parseInt(tok.i, 10);
      if (!(index >= 0 && index < gens.length) || seen.has(`g${index}`)) return fallback();
      seen.add(`g${index}`);
      out.push({ kind: 'generated', doc: gens[index], index });
    } else {
      return fallback();
    }
  }
  return out;
}

async function bundle(req, res) {
  const { uploadedIds = [], generated = [], order, contentsPage = false, format = 'zip' } = req.body || {};
  if (!uploadedIds.length && !generated.length) {
    return res.status(400).json({ success: false, message: 'Select at least one document.' });
  }
  if (generated.length && !pdfService.isAvailable()) {
    return res.status(503).json({ success: false, message: 'PDF rendering is unavailable on this server, so generated documents cannot be bundled. Uploaded files can still be downloaded individually.' });
  }

  const rows = uploadedIds.length
    ? await db('document_store').whereIn('id', uploadedIds.map((n) => parseInt(n, 10)).filter(Boolean))
    : [];
  // A `whereIn` comes back in no particular order, so the requested sequence is
  // re-applied by id rather than read off the result set.
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const entries = sequenceEntries(uploadedIds, generated, order);

  if (format === 'pdf') {
    const sources = [];
    for (const entry of entries) {
      if (entry.kind === 'uploaded') {
        const row = rowById.get(entry.id);
        if (!row) continue;   // deleted since the page loaded; reported below
        if (row.file_path && fs.existsSync(row.file_path)) {
          sources.push({ name: row.file_name || row.title, path: row.file_path, mime: row.mime_type });
        } else {
          sources.push({ name: row.title || `document #${row.id}`, bytes: Buffer.alloc(0), mime: 'missing' });
        }
        continue;
      }
      const g = entry.doc;
      if (!g || !g.html) continue;
      try {
        const pdf = await pdfService.htmlToPdf(g.html);
        sources.push({ name: g.filename || g.docType, bytes: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf), mime: 'application/pdf' });
      } catch (err) {
        console.error('Document bundle PDF failed for', g.docType, err.message);
        sources.push({ name: g.filename || g.docType, bytes: Buffer.alloc(0), mime: 'render failed' });
      }
    }
    // Everything asked for is gone (rows deleted since the page loaded), so
    // there is nothing to merge. Returning a one-page "nothing here" PDF looked
    // to the user like a blank download; a refusal the UI can show is honest.
    const mergeable = sources.filter((x) => x.path || (x.bytes && x.bytes.length));
    if (!mergeable.length) {
      return res.status(409).json({
        success: false,
        message: 'Those documents are no longer available — they may have been deleted or replaced. Refresh the page and try again.',
      });
    }
    try {
      const out = await mergeToPdf(sources, {
        contentsPage: !!contentsPage,
        title: req.body.zipName || null,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName(req.body.zipName, 'documents')}.pdf"`);
      return res.send(out);
    } catch (err) {
      console.error('Document merge error:', err);
      return res.status(500).json({ success: false, message: 'Could not build the combined PDF.' });
    }
  }

  const stillThere = rows.filter((r) => r.file_path && fs.existsSync(r.file_path));
  if (!stillThere.length && !generated.length) {
    return res.status(409).json({
      success: false,
      message: 'Those documents are no longer available — they may have been deleted or replaced. Refresh the page and try again.',
    });
  }

  const zipName = safeName(req.body.zipName, 'documents') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  // Headers are already sent by the time anything can fail, so a late error can
  // only be logged and the stream cut — the client sees a truncated download
  // rather than a misleading 200 with a valid-looking empty zip.
  // Headers are already sent, so a late failure cannot become a clean HTTP
  // error. Log it and cut the stream — the client sees a truncated download
  // rather than a valid-looking zip that is quietly missing documents.
  archive.on('error', (err) => { console.error('Document bundle error:', err); res.destroy(err); });
  archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.error('Document bundle warning:', err); });
  archive.pipe(res);

  const used = new Set();
  const uniqueName = (name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };

  const missing = [];

  // Same sequence as the combined PDF, so the archive lists the documents in
  // the order the Documents tab shows them.
  for (const entry of entries) {
    if (entry.kind === 'uploaded') {
      const row = rowById.get(entry.id);
      if (!row) continue;
      if (row.file_path && fs.existsSync(row.file_path)) {
        archive.file(row.file_path, { name: uniqueName(safeName(row.file_name || row.title, `document-${row.id}`)) });
      } else {
        missing.push(row.title || row.file_name || `document #${row.id}`);
      }
      continue;
    }
    const g = entry.doc;
    if (!g || !g.html) continue;
    try {
      const pdf = await pdfService.htmlToPdf(g.html);
      // Buffer.from: puppeteer returns a Uint8Array, and archiver accepts only a
      // Buffer or a Stream — appending the raw Uint8Array throws
      // INPUTSTEAMBUFFERREQUIRED and kills the response mid-stream.
      archive.append(Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf), {
        name: uniqueName(`${safeName(g.filename || g.docType, 'document')}.pdf`),
      });
    } catch (err) {
      console.error('Document bundle PDF failed for', g.docType, err.message);
      missing.push(g.filename || g.docType);
    }
  }

  // Say what could not be included, inside the zip itself — a silently short
  // bundle is worse than a short one that explains itself.
  if (missing.length) {
    archive.append(
      `These documents could not be included:\n\n${missing.map((m) => `  - ${m}`).join('\n')}\n`,
      { name: 'MISSING.txt' }
    );
  }

  await archive.finalize();
}

module.exports = { bundle, sequenceEntries, mergeToPdf, contentsRows, contentsSheetCount, asciiSafe };
