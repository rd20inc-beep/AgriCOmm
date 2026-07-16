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
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
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
