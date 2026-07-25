/**
 * Server-side PDF rendering for export documents.
 *
 * The documents are produced as print-ready HTML by the frontend (the same
 * markup the browser prints). To attach an invoice to a WhatsApp/email message
 * we need a real file, so this renders that HTML to an A4 PDF with headless
 * Chromium — matching what the user would get from Print → Save as PDF.
 *
 * puppeteer-core is used (no bundled Chromium); the browser binary comes from
 * PUPPETEER_EXECUTABLE_PATH or a small list of common locations (the backend
 * image installs Alpine's `chromium`). Everything is lazily required so the API
 * still boots if the dependency/binary is absent — the caller gets a clear 500.
 */

const fs = require('fs');

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function resolveChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Render a complete HTML document (with its own @page CSS) to a PDF Buffer.
 * @param {string} html  full <html> string as built by the frontend print path
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html) {
  const executablePath = resolveChrome();
  if (!executablePath) {
    const e = new Error('PDF rendering is unavailable — no Chromium/Chrome found on the server.');
    e.status = 503;
    throw e;
  }
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch (_) {
    const e = new Error('PDF rendering is unavailable — puppeteer-core is not installed.');
    e.status = 503;
    throw e;
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html || '<html><body></body></html>', { waitUntil: 'networkidle0', timeout: 25000 });
    // Let the on-load fit script settle before capturing.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

    // Page fitting — NO down-scaling. The document must print at its real size
    // (≥12px text); shrinking to force one page is forbidden. Render at scale 1:
    // a short document has its footer pinned to the page bottom (fill the
    // printable height); a document taller than one page flows onto additional
    // A4 pages (table headers repeat) instead of being scaled down.
    //
    // Printable height derived from the document's OWN @page rule (orientation +
    // margin) so it is correct for the landscape export docs and any other
    // caller. Must match buildDocHtml.
    const pageBlock = (String(html || '').match(/@page[^{]*\{[^}]*\}/i) || [''])[0];
    const landscape = /landscape/i.test(pageBlock);
    const marginMm = (() => { const m = pageBlock.match(/margin:\s*([\d.]+)mm/i); return m ? parseFloat(m[1]) : 8; })();
    const pageHmm = landscape ? 210 : 297;
    const A4_H_PX = Math.round((pageHmm - 2 * marginMm) * 96 / 25.4); // printable height
    try {
      const h = await page.evaluate(() => {
        const fit = document.getElementById('agri-fit'); if (fit) { fit.style.zoom = '1'; fit.style.width = '100%'; }
        const doc = document.querySelector('.agri-doc > div'); if (doc) doc.style.minHeight = '';
        return (fit || document.body).scrollHeight;
      });
      if (h <= A4_H_PX) {
        // Short doc — fill the page so the footer sits at the bottom.
        await page.evaluate((pagePx) => {
          const doc = document.querySelector('.agri-doc > div'); if (doc) doc.style.minHeight = pagePx + 'px';
        }, A4_H_PX);
      }
      // Taller than one page → flow onto additional pages (no scaling).
    } catch (_) { /* fall back to native pagination */ }

    // Explicit A4 landscape + CSS page size + backgrounds, native scale 1 (never
    // shrink). preferCSSPageSize honours the document's @page (A4 landscape 8mm);
    // format/landscape/margin are declared too as an explicit, safe fallback.
    const pdf = await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      preferCSSPageSize: true,
      scale: 1,
      margin: { top: `${marginMm}mm`, right: `${marginMm}mm`, bottom: `${marginMm}mm`, left: `${marginMm}mm` },
    });
    return pdf;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Whether PDF rendering can work in this environment (used for graceful UI).
function isAvailable() {
  if (!resolveChrome()) return false;
  try { require.resolve('puppeteer-core'); return true; } catch (_) { return false; }
}

module.exports = { htmlToPdf, resolveChrome, isAvailable };
