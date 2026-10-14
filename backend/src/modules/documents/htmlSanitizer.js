/**
 * Allowlist sanitizer for stored export-document HTML.
 *
 * The export documents are rendered in the BROWSER (DocumentCenter.jsx), and
 * what the operator sees — including inline contentEditable edits — is stored on
 * the generated_documents version and later rendered to PDF on the server. That
 * HTML is user-controlled, so before it is stored (and again before it reaches
 * headless Chromium) it is reduced to the markup the document renderers
 * actually produce: layout tags, inline styles and data: images.
 *
 * Removed:
 *   - <script>, <iframe>, <object>, <embed>, <link>, <meta>, <base>, forms, … —
 *     dropped together with their content
 *   - every on* event handler and any attribute not on the allowlist
 *   - URLs that are not data:image/…, blob:, a fragment or a same-origin
 *     relative path (javascript:, file:, http(s)://other-host, //host, …).
 *     An absolute URL to one of the app's own static assets (the letterhead
 *     logo) is rewritten to its relative path rather than dropped.
 *   - CSS that can fetch: @import, url(...) that is not data:, expression(),
 *     behavior / -moz-binding
 *
 * Unknown tags are unwrapped (their text kept) rather than dropped, so an edit
 * the browser wrapped in an odd element still prints. Comments and doctype are
 * removed. Stray "<" in text is escaped.
 *
 * Deliberately dependency-free: the input is our own renderer's output (plus
 * browser edits), serialised by the browser's innerHTML, so a strict tokenizer
 * is enough — and the PDF renderer independently blocks every network request
 * and runs with JavaScript off, so this is one of two layers, not the only one.
 */

// Tags kept as-is (attributes filtered).
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'small', 'big',
  'sub', 'sup', 'mark', 'font', 'center', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'img', 'style', 'section', 'header', 'footer', 'article', 'aside', 'main', 'nav', 'figure', 'figcaption',
  'label', 'a', 'abbr', 'address', 'wbr',
]);

// Tags dropped together with EVERYTHING inside them.
const DROP_WITH_CONTENT = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed',
  'noframes', 'template', 'textarea', 'title', 'xmp', 'plaintext', 'select', 'option', 'button',
  'svg', 'math', 'video', 'audio', 'canvas', 'portal', 'head',
]);

// Void elements (no closing tag).
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'wbr']);

// Raw-text elements: their content is not markup and ends only at </tag>.
const RAW_TEXT = new Set(['script', 'style', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp', 'textarea', 'title', 'plaintext']);

const GLOBAL_ATTRS = new Set([
  'class', 'id', 'style', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height',
  'bgcolor', 'color', 'face', 'size', 'border', 'aria-hidden', 'role',
]);
const TAG_ATTRS = {
  td: new Set(['colspan', 'rowspan', 'nowrap', 'headers', 'scope']),
  th: new Set(['colspan', 'rowspan', 'nowrap', 'headers', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  table: new Set(['cellpadding', 'cellspacing', 'summary']),
  img: new Set(['src', 'alt']),
  ol: new Set(['start', 'type', 'reversed']),
  ul: new Set(['type']),
  li: new Set(['value']),
  a: new Set(['href', 'name']),
  style: new Set(['media']),
};
// Attributes holding a URL.
const URL_ATTRS = new Set(['src', 'href']);

// The app's own static assets that a document may reference by ABSOLUTE URL
// (the renderer builds `${location.origin}/logo.jpg`). Rewritten to the relative
// path; the server inlines them from disk at render time.
const KNOWN_ASSET_PATHS = new Set(['/logo.jpg', '/logo.png', '/coo-kcci-template.jpg']);

// ── helpers ────────────────────────────────────────────────────────────────
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')' };

// Decode character references — used ONLY to classify a value (a URL scheme or
// CSS), never to produce output.
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&([a-z]+);?/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, n.toLowerCase()) ? NAMED_ENTITIES[n.toLowerCase()] : m));
}
function safeFromCode(n) {
  try { return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; } catch (_) { return ''; }
}

// Decode CSS backslash escapes (\75 rl → url) for classification.
function decodeCssEscapes(s) {
  return String(s)
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
}

/**
 * Classify a URL attribute value. Returns the value to keep, or null to drop.
 * Allowed: data:image/* (not svg), blob:, #fragment, same-origin relative path.
 */
function sanitizeUrl(raw) {
  const decoded = decodeEntities(raw)
    // Browsers ignore embedded whitespace / control characters in a scheme.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000- \u007f-\u009f]+/g, '')
    .trim();
  if (!decoded) return null;
  const lower = decoded.toLowerCase();
  if (lower.startsWith('#')) return raw;
  if (/^data:image\/(png|jpe?g|gif|webp|bmp);/.test(lower)) return raw;
  if (lower.startsWith('blob:')) return raw;
  // Absolute URL (has a scheme) or protocol-relative (//host).
  const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(lower);
  if (hasScheme || lower.startsWith('//') || lower.startsWith('\\\\') || lower.startsWith('/\\')) {
    if (/^https?:\/\//.test(lower)) {
      try {
        const u = new URL(decoded);
        if (KNOWN_ASSET_PATHS.has(u.pathname) && !u.search && !u.username && !u.password) return u.pathname;
      } catch (_) { /* fall through */ }
    }
    return null;
  }
  // Relative path — same origin by definition.
  return raw;
}

/**
 * Remove anything in a CSS string that could fetch or execute. Returns the
 * cleaned CSS, or null when it cannot be cleaned safely (caller drops it).
 */
function sanitizeCss(css) {
  let out = String(css)
    // @import in any form
    .replace(/@import[^;]*;?/gi, '')
    // url(...) that is not a data: image
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, inner) => (/^\s*data:image\/(png|jpe?g|gif|webp|bmp);/i.test(inner) ? m : 'none'))
    .replace(/image-set\([^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/(-moz-binding|behavior)\s*:[^;"}]*/gi, '');
  // Escape-obfuscated leftovers ("\75 rl(", "@\69mport") — refuse rather than guess.
  const probe = decodeCssEscapes(decodeEntities(out)).toLowerCase().replace(/\s+/g, '');
  const urlUses = probe.match(/url\(/g) || [];
  const dataUses = probe.match(/url\(['"]?data:image\/(png|jpe?g|gif|webp|bmp);/g) || [];
  if (urlUses.length !== dataUses.length) return null;
  if (/@import|expression\(|-moz-binding|behavior:|javascript:|image-set\(/.test(probe)) return null;
  // A style element's content must not be able to close the element.
  out = out.replace(/<\/?(style|script)/gi, '');
  return out;
}

function escapeText(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Parse the attribute section of a start tag into [name, value|null] pairs.
function parseAttrs(src) {
  const attrs = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null;
    attrs.push([m[1].toLowerCase(), value]);
  }
  return attrs;
}

function cleanAttrs(tag, rawAttrs) {
  const allowed = TAG_ATTRS[tag];
  const out = [];
  for (const [name, value] of parseAttrs(rawAttrs)) {
    if (name.startsWith('on')) continue;
    if (!(GLOBAL_ATTRS.has(name) || (allowed && allowed.has(name)))) continue;
    let v = value == null ? '' : value;
    if (URL_ATTRS.has(name)) {
      v = sanitizeUrl(v);
      if (v == null) continue;
    } else if (name === 'style') {
      v = sanitizeCss(v);
      if (v == null) continue;
    }
    out.push(value == null && !URL_ATTRS.has(name) && name !== 'style' ? ` ${name}` : ` ${name}="${escapeAttr(v)}"`);
  }
  return out.join('');
}

/**
 * Sanitize an HTML fragment (the document body as the browser serialised it).
 * @param {string} html
 * @returns {string}
 */
function sanitizeDocumentHtml(html) {
  const src = String(html == null ? '' : html);
  let out = '';
  let i = 0;
  const n = src.length;
  // Matches a start or end tag at the current position.
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out += escapeText(src.slice(i)); break; }
    out += escapeText(src.slice(i, lt));
    i = lt;

    // Comments / CDATA / doctype / processing instructions — removed.
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
      const end = src.indexOf('>', i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(src);
    if (!m) { out += '&lt;'; i += 1; continue; }
    i = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (!closing && (RAW_TEXT.has(tag) || DROP_WITH_CONTENT.has(tag))) {
      // Find the matching close tag (raw-text: first occurrence; otherwise
      // depth-counted so nested same-name tags are consumed too).
      const closeRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
      closeRe.lastIndex = i;
      let depth = 1;
      let contentEnd = n;
      let after = n;
      let c;
      while ((c = closeRe.exec(src))) {
        if (c[1] === '/') depth -= 1;
        else if (!RAW_TEXT.has(tag)) depth += 1;
        if (depth === 0) { contentEnd = c.index; after = closeRe.lastIndex; break; }
      }
      if (tag === 'style') {
        const css = sanitizeCss(src.slice(i, contentEnd));
        if (css != null) out += `<style${cleanAttrs('style', m[3])}>${css}</style>`;
      }
      i = after;
      continue;
    }

    if (closing) {
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue; // unknown / disallowed tag: unwrap
    if (tag === 'img') {
      const attrs = cleanAttrs(tag, m[3]);
      if (!/\ssrc="/.test(attrs)) continue; // an image with no safe source is dropped
      out += `<img${attrs}>`;
      continue;
    }
    out += `<${tag}${cleanAttrs(tag, m[3])}>`;
  }
  return out;
}

module.exports = { sanitizeDocumentHtml, sanitizeUrl, sanitizeCss, KNOWN_ASSET_PATHS };
