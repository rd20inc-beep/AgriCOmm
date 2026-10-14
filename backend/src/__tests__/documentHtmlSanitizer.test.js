/**
 * P1-08 — stored document HTML is reduced to what the document renderers
 * produce before it is saved and again before it is rendered to PDF.
 */
const { sanitizeDocumentHtml: clean, sanitizeUrl } = require('../modules/documents/htmlSanitizer');
const { buildDocumentPage, resolveOrientation, maskBankInHtml } = require('../modules/documents/documentHtml');

describe('sanitizeDocumentHtml — removes anything that can execute or fetch', () => {
  it('drops <script> with its content', () => {
    const out = clean('<p>a</p><script>fetch("http://127.0.0.1:3001/api")</script><p>b</p>');
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it.each(['iframe', 'object', 'embed', 'noscript', 'template', 'svg'])('drops <%s> and its content', (tag) => {
    const out = clean(`<div>x<${tag} src="http://127.0.0.1:3001/">inside</${tag}>y</div>`);
    expect(out).toBe('<div>xy</div>');
  });

  it('drops <link>, <meta>, <base> and form controls', () => {
    const out = clean('<link rel="stylesheet" href="http://evil/x.css"><meta http-equiv="refresh" content="0;url=http://x"><base href="http://x/"><div>ok</div>');
    expect(out).toBe('<div>ok</div>');
  });

  it('strips every on* event handler', () => {
    const out = clean('<div onclick="x()" ONLOAD="y()" class="a"><img src="/logo.jpg" onerror="alert(1)"></div>');
    expect(out).not.toMatch(/on(click|load|error)/i);
    expect(out).toContain('class="a"');
    expect(out).toContain('<img src="/logo.jpg">');
  });

  it('removes javascript: URLs, including entity / whitespace obfuscation', () => {
    for (const u of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', ' java\tscript:alert(1)', 'JAVASCRIPT:x']) {
      expect(clean(`<a href="${u}">x</a>`)).toBe('<a>x</a>');
    }
  });

  it('drops images from file:, http(s) to other paths and protocol-relative URLs', () => {
    expect(clean('<img src="file:///etc/passwd">')).toBe('');
    expect(clean('<img src="http://127.0.0.1:3001/api/users">')).toBe('');
    expect(clean('<img src="//evil.example/x.png">')).toBe('');
    expect(clean('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('');
  });

  it('keeps data: images, blob: and relative paths; rewrites the absolute logo URL to relative', () => {
    expect(clean('<img src="data:image/png;base64,iVBO">')).toBe('<img src="data:image/png;base64,iVBO">');
    expect(sanitizeUrl('blob:https://app/123')).toBe('blob:https://app/123');
    expect(clean('<img src="/coo-kcci-template.jpg" class="coo-tpl">')).toContain('src="/coo-kcci-template.jpg"');
    expect(clean('<img src="https://agricommodities.online/logo.jpg" alt="">')).toBe('<img src="/logo.jpg" alt="">');
  });

  it('removes fetching CSS: @import and non-data url() in <style> and style=""', () => {
    const out = clean('<style>@import url("http://x/a.css"); .a{color:red} .b{background:url(http://127.0.0.1:3001/x)}</style>'
      + '<div style="background-image:url(\'file:///etc/passwd\'); color: blue">t</div>');
    expect(out).not.toMatch(/@import|127\.0\.0\.1|file:/);
    expect(out).toContain('.a{color:red}');
    expect(out).toContain('color: blue');
  });

  it('refuses escape-obfuscated CSS rather than guessing', () => {
    expect(clean('<div style="background:\\75 rl(http://x/)">t</div>')).toBe('<div>t</div>');
  });

  it('keeps the markup the renderers produce', () => {
    const doc = '<style>.agri-doc td{padding:2px}</style><div class="agri-doc agri-styled" style="zoom:1.1"><div>'
      + '<table><colgroup><col style="width:30%"></colgroup><thead><tr><th colspan="2">H</th></tr></thead>'
      + '<tbody><tr><td class="agri-num" rowspan="1">1,234.00</td><td><b>x</b> <span style="font-size:14px">y</span><br></td></tr></tbody></table>'
      + '<div class="agri-ftr"><p><strong>Co</strong></p></div></div></div>';
    expect(clean(doc)).toBe(doc);
  });

  it('escapes stray "<" and removes comments', () => {
    expect(clean('<p>1 < 2<!-- secret --></p>')).toBe('<p>1 &lt; 2</p>');
  });

  it('a style element cannot be closed early to smuggle markup', () => {
    const out = clean('<style>.a{}</style ><script>x</script>');
    expect(out).not.toContain('<script');
  });
});

describe('buildDocumentPage', () => {
  it('wraps the body in the A4 shell with NO script and the logo inlined', () => {
    const page = buildDocumentPage('<div class="agri-doc"><div><img src="https://agricommodities.online/logo.jpg"><script>x</script></div></div>',
      { docType: 'commercial-invoice', title: 'CI <x>' });
    expect(page).toContain('@page { size: A4 portrait; margin: 12mm; }');
    expect(page).not.toMatch(/<script/i);
    expect(page).toMatch(/<img src="data:image\/jpeg;base64,/);
    expect(page).toContain('<title>CI &lt;x&gt;</title>');
  });

  it('landscape and the Certificate of Origin overlay keep their page rules', () => {
    expect(buildDocumentPage('<p>x</p>', { orientation: 'landscape' })).toContain('@page { size: A4 landscape; margin: 8mm; }');
    expect(buildDocumentPage('<p>x</p>', { docType: 'certificate-of-origin' })).toContain('@page { size: A4 portrait; margin: 0mm; }');
  });
});

describe('resolveOrientation (server port)', () => {
  it('defaults to portrait and honours an active landscape template, incl. aliases', () => {
    expect(resolveOrientation('packing-list', [])).toBe('portrait');
    expect(resolveOrientation('packing-list', [{ doc_type: 'packing_list', orientation: 'landscape', is_active: true }])).toBe('landscape');
    expect(resolveOrientation('certificate-of-origin', [{ doc_type: 'coo', orientation: 'landscape' }])).toBe('landscape');
    expect(resolveOrientation('packing-list', [{ doc_type: 'packing_list', orientation: 'landscape', is_active: false }])).toBe('portrait');
  });
});

describe('maskBankInHtml', () => {
  it('masks full account/IBAN values in a stored rendering, spaced or not', () => {
    const html = '<td>PK36 SCBL 0000 0011 2345 6702</td><td>01234567890</td>';
    const out = maskBankInHtml(html, { account: '01234567890', iban: 'PK36SCBL0000001123456702' });
    expect(out).not.toContain('01234567890');
    expect(out).not.toContain('SCBL 0000');
    expect(out).toContain('•••• 7890');
    expect(out).toContain('•••• 6702');
  });
});
