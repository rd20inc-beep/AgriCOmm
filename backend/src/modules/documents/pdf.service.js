/* global document -- page.evaluate callbacks run inside the headless browser */
/**
 * Server-side PDF rendering for export documents.
 *
 * Export documents are rendered from the STORED, sanitized version body
 * (generated_documents.rendered_html) wrapped in the A4 print shell by
 * documentHtml.buildDocumentPage — never from HTML posted with the request. To
 * attach a document to a WhatsApp/email message we need a real file, so this
 * renders that page to an A4 PDF with headless Chromium — matching what the
 * user would get from Print → Save as PDF. The renderer has no network and no
 * JavaScript (see isAllowedRequestUrl / launchArgs).
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

// ── renderer hardening ─────────────────────────────────────────────────────
// The HTML handed to Chromium is a stored, sanitized document (or, for the
// generic Communications send, browser-built receipt HTML). Either way the
// renderer must not be able to reach anything: every request except inline
// data:/blob: content and about:blank is aborted (http/https/file/ws/…), so a
// document referencing http://127.0.0.1:3001/... or file:///etc/... renders
// nothing from it. JavaScript is disabled for the page; the page-fit below runs
// through DevTools evaluation, which is unaffected.
function isAllowedRequestUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  return u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank';
}

// Chromium's sandbox cannot start as root (it refuses without --no-sandbox),
// and the production backend container runs as root under Docker's default
// seccomp profile, which also blocks the user namespaces the sandbox needs. So
// --no-sandbox is used ONLY when running as root, or when explicitly forced
// with PDF_CHROME_NO_SANDBOX=1. In that case the renderer still has no network
// (request interception above), no JavaScript, and only sanitized input.
function launchArgs() {
  const args = [
    '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--disable-default-apps', '--mute-audio', '--disable-component-update',
  ];
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot || process.env.PDF_CHROME_NO_SANDBOX === '1') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return args;
}

const RENDER_TIMEOUT_MS = 30000;

/**
 * Render a complete HTML document (with its own @page CSS) to a PDF Buffer.
 * @param {string} html  full <html> page (see documentHtml.buildDocumentPage)
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
    args: launchArgs(),
    protocolTimeout: RENDER_TIMEOUT_MS,
    timeout: 15000,
  });
  let timer;
  try {
    const work = renderWith(browser, html);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error('Rendering the document PDF timed out.');
        e.status = 504;
        reject(e);
      }, RENDER_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => {});
  }
}

async function renderWith(browser, html) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isInterceptResolutionHandled && req.isInterceptResolutionHandled()) return;
    if (isAllowedRequestUrl(req.url())) req.continue().catch(() => {});
    else req.abort('blockedbyclient').catch(() => {});
  });
  await page.emulateMediaType('print');
  // 'load', not 'networkidle0': there is no network to wait for.
  await page.setContent(html || '<html><body></body></html>', { waitUntil: 'load', timeout: 15000 });

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
}

// Whether PDF rendering can work in this environment (used for graceful UI).
function isAvailable() {
  if (!resolveChrome()) return false;
  try { require.resolve('puppeteer-core'); return true; } catch (_) { return false; }
}

module.exports = { htmlToPdf, resolveChrome, isAvailable, isAllowedRequestUrl, launchArgs };
