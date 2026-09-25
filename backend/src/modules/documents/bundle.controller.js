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

async function bundle(req, res) {
  const { uploadedIds = [], generated = [] } = req.body || {};
  if (!uploadedIds.length && !generated.length) {
    return res.status(400).json({ success: false, message: 'Select at least one document.' });
  }
  if (generated.length && !pdfService.isAvailable()) {
    return res.status(503).json({ success: false, message: 'PDF rendering is unavailable on this server, so generated documents cannot be bundled. Uploaded files can still be downloaded individually.' });
  }

  const rows = uploadedIds.length
    ? await db('document_store').whereIn('id', uploadedIds.map((n) => parseInt(n, 10)).filter(Boolean))
    : [];

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
