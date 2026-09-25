const fs = require('fs');
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
async function mergeToPdf(sources) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const merged = await PDFDocument.create();
  const skipped = [];

  for (const src of sources) {
    try {
      const bytes = src.bytes || fs.readFileSync(src.path);
      // %PDF- magic: trust the file, not the stored mime type
      if (Buffer.from(bytes.slice(0, 5)).toString() !== '%PDF-') {
        skipped.push(`${src.name} (not a PDF — ${src.mime || 'unknown type'})`);
        continue;
      }
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((pg) => merged.addPage(pg));
    } catch (err) {
      console.error('Document merge failed for', src.name, err.message);
      skipped.push(`${src.name} (could not be read)`);
    }
  }

  if (skipped.length) {
    const page = merged.addPage([595, 842]);
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('Not included in this file', { x: 50, y: 790, size: 14, font, color: rgb(0.6, 0.1, 0.1) });
    skipped.forEach((label, i) => {
      page.drawText(`- ${label}`.slice(0, 95), { x: 50, y: 760 - i * 18, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    });
    page.drawText('Download these individually, or as a ZIP.', { x: 50, y: 760 - skipped.length * 18 - 20, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  }

  if (merged.getPageCount() === 0) {
    const page = merged.addPage([595, 842]);
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('None of the selected documents could be merged into a PDF.', { x: 50, y: 790, size: 12, font });
  }
  // Uint8Array from pdf-lib; res.send needs a Buffer.
  return Buffer.from(await merged.save());
}

async function bundle(req, res) {
  const { uploadedIds = [], generated = [], format = 'zip' } = req.body || {};
  if (!uploadedIds.length && !generated.length) {
    return res.status(400).json({ success: false, message: 'Select at least one document.' });
  }
  if (generated.length && !pdfService.isAvailable()) {
    return res.status(503).json({ success: false, message: 'PDF rendering is unavailable on this server, so generated documents cannot be bundled. Uploaded files can still be downloaded individually.' });
  }

  const rows = uploadedIds.length
    ? await db('document_store').whereIn('id', uploadedIds.map((n) => parseInt(n, 10)).filter(Boolean))
    : [];

  if (format === 'pdf') {
    const sources = [];
    for (const row of rows) {
      if (row.file_path && fs.existsSync(row.file_path)) {
        sources.push({ name: row.file_name || row.title, path: row.file_path, mime: row.mime_type });
      } else {
        sources.push({ name: row.title || `document #${row.id}`, bytes: Buffer.alloc(0), mime: 'missing' });
      }
    }
    for (const g of generated) {
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
      const out = await mergeToPdf(sources);
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

  for (const row of rows) {
    if (row.file_path && fs.existsSync(row.file_path)) {
      archive.file(row.file_path, { name: uniqueName(safeName(row.file_name || row.title, `document-${row.id}`)) });
    } else {
      missing.push(row.title || row.file_name || `document #${row.id}`);
    }
  }

  for (const g of generated) {
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

module.exports = { bundle };
