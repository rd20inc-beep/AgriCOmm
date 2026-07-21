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

    // Fit-to-one-page. The frontend print HTML tries to fit oversized content
    // with CSS `zoom`, but page.pdf() does NOT honour `zoom` in pagination — the
    // result is shrunk text + blank space / overflow (the "not A4-appropriate"
    // bug). So neutralise that and use puppeteer's NATIVE `scale`, which IS
    // honoured. A short doc keeps its footer pinned to the page bottom (flex fill,
    // which page.pdf does honour); a doc a bit over one page is scaled to fit
    // exactly one; a genuinely multi-page doc (> ~1.45 pages) flows normally.
    const A4_PRINTABLE_PX = Math.round((297 - 24) * 96 / 25.4); // A4 height − 12mm margins
    let scale = 1;
    try {
      const contentPx = await page.evaluate((pagePx) => {
        const fit = document.getElementById('agri-fit');
        if (fit) { fit.style.zoom = '1'; fit.style.width = ''; }
        const doc = document.querySelector('.agri-doc > div');
        if (doc) doc.style.minHeight = '';
        const el = fit || document.body;
        const natural = el.scrollHeight;
        // Short export doc → pin footer to the page bottom via the flex fill.
        if (doc && natural <= pagePx) doc.style.minHeight = pagePx + 'px';
        return natural;
      }, A4_PRINTABLE_PX);
      if (contentPx > A4_PRINTABLE_PX && contentPx <= A4_PRINTABLE_PX * 1.45) {
        scale = Math.max(0.55, (A4_PRINTABLE_PX - 8) / contentPx); // 8px safety so it can't tip onto a 2nd page
      }
    } catch (_) { /* fall back to unscaled */ }

    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, scale });
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
