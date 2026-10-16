// Pure logic behind <GlobalSearch /> (P5-03): keyboard shortcuts, arrow-key
// movement, the Enter target, and the allow-list of link targets. Kept apart
// from the component so it is testable without a DOM.

export const MIN_CHARS = 2;

// Every place a result may open — each one a route in src/App.jsx (the test
// checks them against the route table). A server href outside this list is
// dropped rather than followed into the catch-all redirect.
export const RESULT_ROUTES = [
  /^\/export\/\d+$/,
  /^\/milling\/\d+$/,
  /^\/service-milling\/\d+$/,
  /^\/lot-inventory\/\d+$/,
  /^\/local-sales\/\d+$/,
  /^\/finance\/accounting\/statements\?type=(customer|supplier)&id=\d+(&scope=local)?$/,
  /^\/reports\/supplier-ledger\/\d+$/,
  /^\/admin\?tab=haulers&hauler=\d+$/,
  /^\/finance\/money-in\?open=(receivable|payment):\d+$/,
  /^\/finance\/money-out\?open=(payable|payment):\d+$/,
  /^\/finance\/money-out\/expenses\?open=expense:\d+$/,
  /^\/finance\/accounts\?open=bank:\d+$/,
  /^\/documents$/,
];

export function isKnownTarget(href) {
  return typeof href === 'string' && RESULT_ROUTES.some((re) => re.test(href));
}

/** The server's groups → one flat list in display order (unknown targets dropped). */
export function flattenResults(groups) {
  const out = [];
  for (const g of groups || []) {
    for (const item of g.items || []) {
      if (!isKnownTarget(item.href)) continue;
      out.push({ ...item, groupKey: g.key, groupLabel: g.label, index: out.length });
    }
  }
  return out;
}

/** Groups with only the items that survived flattening, each carrying its flat index. */
export function displayGroups(flat) {
  const groups = [];
  for (const it of flat) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== it.groupKey) { g = { key: it.groupKey, label: it.groupLabel, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return groups;
}

function isEditable(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

/**
 * Does this keydown (on the document) mean "focus the search box"? Ctrl/Cmd+K
 * always; "/" only when the user is not already typing somewhere.
 */
export function isSearchShortcut(e) {
  if (!e) return false;
  const key = String(e.key || '');
  if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === 'k') return true;
  return key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target);
}

/** Next highlighted index for a key, wrapping; -1 = nothing highlighted. */
export function moveActive(active, key, count) {
  if (!count) return -1;
  switch (key) {
    case 'ArrowDown': return active < 0 || active >= count - 1 ? 0 : active + 1;
    case 'ArrowUp': return active <= 0 ? count - 1 : active - 1;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return active;
  }
}

/** What Enter opens: the highlighted result, else the best (first) one. */
export function enterTarget(flat, active) {
  if (!flat || !flat.length) return null;
  return flat[active] || flat[0];
}

/** "PKR 1,200" — one currency per figure, never summed across currencies. */
export function formatMoney(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}
