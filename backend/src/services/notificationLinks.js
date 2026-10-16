/**
 * Turns a notification into a page the reader can open.
 *
 * A writer may store an explicit `link`; otherwise the record is found from
 * `linked_ref` (an order number, batch number, lot number, sale number or
 * purchase-request number — what the ~15 writers put there). Either way the
 * link is handed out only when the reader may open that page (routeAccess):
 * a Finance Manager notified about an export receipt gets no order link.
 */
const db = require('../config/database');
const { safeLink } = require('./routeAccess');

// [table, column, link(row)] — looked up in this order; first match wins.
const LOOKUPS = [
  ['export_orders', 'order_no', (r) => `/export/${r.id}`],
  ['milling_batches', 'batch_no', (r) => `/milling/${r.id}`],
  ['inventory_lots', 'lot_no', (r) => `/lot-inventory/${r.id}`],
  ['local_sales', 'sale_no', (r) => `/local-sales/${r.id}`],
  ['purchase_requirements', 'pr_no', () => '/purchase-requirements'],
];

async function linksForRefs(refs, conn = db) {
  const out = new Map();
  let pending = [...new Set(refs.filter(Boolean))];
  for (const [table, col, toLink] of LOOKUPS) {
    if (!pending.length) break;
    const rows = await conn(table).whereIn(col, pending).select('id', col);
    for (const r of rows) if (!out.has(r[col])) out.set(r[col], toLink(r));
    pending = pending.filter((p) => !out.has(p));
  }
  return out;
}

/** rows: notifications rows; access: accessContext of the reader. */
async function resolveLinks(rows, access, conn = db) {
  if (!rows.length) return rows;
  const refs = rows.filter((n) => !n.link && n.linked_ref).map((n) => n.linked_ref);
  const derived = refs.length ? await linksForRefs(refs, conn) : new Map();
  return rows.map((n) => ({
    ...n,
    link: safeLink(access, n.link || derived.get(n.linked_ref) || null),
  }));
}

module.exports = { resolveLinks, linksForRefs, LOOKUPS };
