// Open a party statement in a clean new window with the app's stylesheets and
// fire the print dialog (Print, or "Save as PDF" = download). Unlike the
// proforma, a ledger can run many rows, so it flows across A4 LANDSCAPE pages
// rather than being scaled to a single page. Interactive controls (marked
// .statement-actions) are stripped from the printout.
export function printStatement(node, title = 'Statement') {
  if (!node) return;
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((l) => l.outerHTML)
    .join('');
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { window.print(); return; } // popup blocked → fall back
  const printScript =
    'window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},250);});';
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>${links}`
    + '<style>'
    + '@page{size:A4 landscape;margin:10mm}'
    + 'html,body{margin:0;padding:0;background:#fff}'
    + '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '.statement-actions{display:none!important}'
    + '#st-root{width:100%}'
    + '#st-root .rounded-xl{border:0!important;box-shadow:none!important}'
    + '#st-root table{width:100%;border-collapse:collapse}'
    + 'tr{break-inside:avoid}'
    + '</style></head><body>'
    + `<div id="st-root">${node.outerHTML}</div>`
    + `<script>${printScript}</script>`
    + '</body></html>'
  );
  w.document.close();
}
