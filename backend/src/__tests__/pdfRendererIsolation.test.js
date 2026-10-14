/**
 * P1-08 / EXP-12 — the PDF renderer must not reach anything.
 *
 * Export documents used to be rendered from HTML posted by the browser, in
 * headless Chromium with network open and JavaScript on: any viewer could make
 * the server fetch http://127.0.0.1:3001/... (or file:///...) into a PDF. The
 * renderer now aborts every request except data:/blob:/about:blank and runs with
 * JavaScript off.
 *
 * The predicate is tested on its own; the end-to-end test drives a real Chrome
 * when one is installed (PUPPETEER_EXECUTABLE_PATH or /usr/bin/google-chrome)
 * and is skipped otherwise.
 */
const http = require('http');
const pdfService = require('../modules/documents/pdf.service');

describe('isAllowedRequestUrl', () => {
  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:null/1234',
    'about:blank',
  ])('allows inline content: %s', (u) => {
    expect(pdfService.isAllowedRequestUrl(u)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:3001/api/users',
    'https://agricommodities.online/logo.jpg',
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'ws://127.0.0.1:3001/',
    'ftp://example.com/x',
    'chrome://settings',
    '',
    undefined,
  ])('blocks %s', (u) => {
    expect(pdfService.isAllowedRequestUrl(u)).toBe(false);
  });
});

describe('launchArgs', () => {
  const realGetuid = process.getuid;
  const realEnv = process.env.PDF_CHROME_NO_SANDBOX;
  afterEach(() => {
    process.getuid = realGetuid;
    if (realEnv === undefined) delete process.env.PDF_CHROME_NO_SANDBOX;
    else process.env.PDF_CHROME_NO_SANDBOX = realEnv;
  });

  it('keeps the Chromium sandbox for a non-root process', () => {
    process.getuid = () => 1000;
    delete process.env.PDF_CHROME_NO_SANDBOX;
    expect(pdfService.launchArgs()).not.toContain('--no-sandbox');
  });

  it('drops the sandbox only as root (container), where Chromium cannot start it', () => {
    process.getuid = () => 0;
    expect(pdfService.launchArgs()).toContain('--no-sandbox');
  });

  it('can be forced off explicitly', () => {
    process.getuid = () => 1000;
    process.env.PDF_CHROME_NO_SANDBOX = '1';
    expect(pdfService.launchArgs()).toContain('--no-sandbox');
  });
});

const chromeAvailable = pdfService.isAvailable();
(chromeAvailable ? describe : describe.skip)('real Chromium: nothing is fetched', () => {
  let server;
  let hits;
  let port;

  beforeAll(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('SECRET-INTERNAL-RESPONSE');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); });

  it('renders a PDF but never contacts http://127.0.0.1 or file://', async () => {
    const base = `http://127.0.0.1:${port}`;
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${base}/link.css">
      <style>@import url("${base}/import.css"); body { background: url("${base}/bg.png"); }</style>
      </head><body>
      <img src="${base}/img.png"><img src="file:///etc/hostname">
      <iframe src="${base}/frame"></iframe><iframe src="file:///etc/passwd"></iframe>
      <object data="${base}/object"></object>
      <script src="${base}/script.js"></script>
      <script>fetch("${base}/fetch"); new Image().src = "${base}/js-img";</script>
      <div class="agri-doc"><div><p>Hello</p></div></div>
      </body></html>`;
    const pdf = await pdfService.htmlToPdf(html);
    const buf = Buffer.from(pdf);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    expect(hits).toEqual([]);
    expect(buf.toString('latin1')).not.toContain('SECRET-INTERNAL-RESPONSE');
  }, 60000);

  it('a stored document page (sanitized body + server shell, logo inlined) renders with no requests', async () => {
    const { buildDocumentPage } = require('../modules/documents/documentHtml');
    const base = `http://127.0.0.1:${port}`;
    const page = buildDocumentPage(
      `<div class="agri-doc"><div><img src="${base}/logo.jpg"><img src="https://app.example/logo.jpg"><p>Body</p>`
      + `<div style="background:url(${base}/x)">x</div><div class="agri-ftr">f</div></div></div>`,
      { docType: 'commercial-invoice', title: 'CI', orientation: 'landscape' },
    );
    const before = hits.length;
    const pdf = Buffer.from(await pdfService.htmlToPdf(page));
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    expect(hits.length).toBe(before);
  }, 60000);
});
