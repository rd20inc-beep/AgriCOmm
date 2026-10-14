/**
 * Server-side assembly of the print page for a STORED export-document version.
 *
 * PDF download, email and WhatsApp never render HTML posted by the browser.
 * They render the version's stored rendering (generated_documents.rendered_html
 * — the document body exactly as the operator saw it, inline edits included,
 * sanitized when it was saved) wrapped in the same A4 page shell the browser's
 * Print uses (DocumentCenter.jsx buildDocHtml). The shell here carries NO
 * script: the page-fit the browser does in window.onload is done by
 * pdf.service.js itself, so the renderer can run with JavaScript disabled.
 */

const fs = require('fs');
const path = require('path');
const { sanitizeDocumentHtml } = require('./htmlSanitizer');
const { maskTail } = require('../../utils/bankMasking');

// ── static assets inlined as data: URIs (the renderer has no network) ──────
const ASSET_FILES = {
  '/logo.jpg': { file: path.join(__dirname, 'assets', 'logo.jpg'), mime: 'image/jpeg' },
};
const assetCache = new Map();
function assetDataUri(p) {
  if (assetCache.has(p)) return assetCache.get(p);
  const spec = ASSET_FILES[p];
  let uri = null;
  if (spec) {
    try { uri = `data:${spec.mime};base64,${fs.readFileSync(spec.file).toString('base64')}`; } catch (_) { uri = null; }
  }
  assetCache.set(p, uri);
  return uri;
}
function inlineKnownAssets(html) {
  return String(html).replace(/(<img\b[^>]*?\ssrc=")([^"]*)(")/gi, (m, a, src, b) => {
    const uri = assetDataUri(src);
    return uri ? `${a}${uri}${b}` : m;
  });
}

// ── orientation (port of DocumentCenter.jsx resolveOrientation) ────────────
const ORIENT_ALIAS = {
  certificateoforigin: 'coo', coo: 'certificateoforigin',
  billoflading: 'bldraft', bldraft: 'billoflading',
};
const canonType = (s) => String(s || '').toLowerCase().replace(/[-_\s]+/g, '');
function resolveOrientation(docType, templates) {
  if (!docType || !Array.isArray(templates)) return 'portrait';
  const want = canonType(docType);
  const alias = ORIENT_ALIAS[want];
  const row = templates.find((t) => {
    if (t.is_active === false || t.isActive === false) return false;
    const k = canonType(t.doc_type || t.docType);
    return k === want || (alias && k === alias);
  });
  return row && row.orientation === 'landscape' ? 'landscape' : 'portrait';
}
async function loadOrientation(db, docType) {
  try {
    const templates = await db('document_templates').select('doc_type', 'is_active', 'orientation');
    return resolveOrientation(docType, templates);
  } catch (_) {
    return 'portrait';
  }
}

// ── viewer masking of a stored rendering ───────────────────────────────────
// A stored rendering was produced by whoever saved it. If that person could see
// full bank details and the requester cannot, the full account / IBAN values
// are replaced with the same masked form the API gives that requester.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function maskBankInHtml(html, bank) {
  if (!bank) return html;
  let out = String(html);
  const values = [bank.account, bank.iban, bank.correspondent && bank.correspondent.account];
  for (const v of values) {
    if (v == null || v === '') continue;
    const raw = String(v).trim();
    const compact = raw.replace(/\s+/g, '');
    if (compact.length <= 4) continue;
    const masked = maskTail(raw);
    // Match the value with any (or no) whitespace between its characters, so
    // "PK36 SCBL 0000 …" and "PK36SCBL0000…" are both caught.
    const pattern = compact.split('').map(escapeRe).join('(?:\\s|&nbsp;)*');
    out = out.replace(new RegExp(pattern, 'g'), masked);
  }
  return out;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap a (sanitized) document body in the A4 print shell. Mirrors
 * DocumentCenter.jsx buildDocHtml — keep the two in step.
 */
function buildDocumentPage(bodyHtml, { docType, title, orientation = 'portrait' } = {}) {
  const body = inlineKnownAssets(sanitizeDocumentHtml(bodyHtml));
  const t = escapeHtml(title || 'Document');
  if (docType === 'certificate-of-origin') {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${t}</title>
<style>
  @page { size: A4 portrait; margin: 0mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 210mm; background: #fff; color: #000; }
  .coo-overlay { width: 210mm !important; height: 297mm !important; margin: 0 auto !important; }
  @media print { .coo-tpl { display: none !important; } }
  @media print { html, body { width: 210mm; } }
</style></head>
<body>${body}</body></html>`;
  }
  const isLandscape = orientation === 'landscape';
  const marginMm = isLandscape ? 8 : 12;
  const printW = isLandscape ? '281mm' : '186mm';
  const printH = isLandscape ? '194mm' : '273mm';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${t}</title>
<style>
  @page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: ${marginMm}mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: ${printW}; font-size: 12px; line-height: 1.4; background: #fff; color: #000; }
  #agri-fit { width: 100%; }
  body .agri-doc { width: 100%; max-width: 100%; margin: 0; box-sizing: border-box; }
  body .agri-doc > div {
    width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box;
    min-height: ${printH}; display: flex; flex-direction: column;
  }
  body .agri-doc > div > .agri-ftr { margin-top: auto !important; }
  .agri-doc table { width: 100%; max-width: 100%; border-collapse: collapse; }
  .agri-doc td, .agri-doc th { padding: 3px 5px; line-height: 1.35; vertical-align: top; overflow-wrap: break-word; word-break: normal; }
  .agri-doc .agri-num { white-space: nowrap; }
  .agri-doc thead { display: table-header-group; }
  .agri-doc tfoot { display: table-footer-group; }
  .agri-doc tr, .agri-doc td, .agri-doc th { break-inside: avoid; page-break-inside: avoid; }
  .agri-doc img { max-width: 100%; height: auto; }
  .no-print { display: none !important; }
  @media print {
    html, body { margin: 0; padding: 0; width: ${printW}; font-size: 12px; overflow: visible !important; }
    body .agri-doc, body .agri-doc > div { width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box; }
    .no-print { display: none !important; }
  }
</style></head>
<body><div id="agri-fit">${body}</div></body></html>`;
}

module.exports = {
  buildDocumentPage,
  resolveOrientation,
  loadOrientation,
  maskBankInHtml,
  inlineKnownAssets,
};
