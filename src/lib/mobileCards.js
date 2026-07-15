// Whole-app mobile table responsiveness (no per-page edits).
//
// On phones (<=767px) every data table in the main content becomes a stacked
// "Label: value" card: we add the `mobile-cards` class to each table's wrapper and
// copy each column's header text into that column's cells as `data-label` (the CSS
// in index.css does the visual reflow). This runs on navigation + whenever the DOM
// changes (tables load async), and is idempotent. Desktop is a no-op.
//
// Opt out by putting the class `no-mobile-cards` on a table or any ancestor — used
// for printable documents/invoices that must keep their real table layout.

function isPhone() {
  try {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  } catch { return false; }
}

export function cardifyTables() {
  try {
    if (!isPhone() || typeof document === 'undefined') return;
    const tables = document.querySelectorAll('.page-content table');
    tables.forEach((table) => {
      // Skip printable docs / anything that opted out, and nested tables handled by parent.
      if (table.closest('.no-mobile-cards')) return;

      // Column header labels (own thead only, not a nested table's).
      const heads = Array.from(table.querySelectorAll(':scope > thead th, :scope > thead > tr > th'))
        .map((th) => th.textContent.trim());
      if (!heads.length) return;

      // Mark the wrapper so the card CSS applies.
      const parent = table.parentElement;
      if (parent && !table.closest('.mobile-cards')) parent.classList.add('mobile-cards');

      // Label each body/foot cell by its column index (respecting colspans).
      const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr');
      rows.forEach((tr) => {
        let col = 0;
        Array.from(tr.children).forEach((cell) => {
          if (cell.tagName !== 'TD') { col += 1; return; }
          const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
          if (span === 1 && heads[col] && !cell.hasAttribute('data-label')) {
            cell.setAttribute('data-label', heads[col]);
          }
          col += span;
        });
      });
    });
  } catch { /* best-effort — never break the page */ }
}

// Debounced scheduler so a burst of DOM mutations collapses into one pass.
let scheduled = false;
export function scheduleCardify() {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  const run = () => { scheduled = false; cardifyTables(); };
  if (window.requestAnimationFrame) window.requestAnimationFrame(run);
  else setTimeout(run, 16);
}
