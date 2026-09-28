/**
 * The local-customer directory: what each customer was billed, has paid, and
 * still owes.
 *
 * It is fed from TWO places, and that is the whole difficulty:
 *
 *   local sales   — an invoice with a due amount
 *   receivables   — money owed with no sale behind it, an opening balance being
 *                   the obvious case
 *
 * The receivables endpoint returns both kinds in one list: rows from the
 * receivables table (kind 'receivable') and rows derived from local_sales
 * (kind 'local_sale'). The sales are already counted here, so folding the whole
 * list in counts every sale twice — YOUSUF BROKER came out at 1,547,441 instead
 * of 1,143,401. Only non-sale receivables belong.
 */

// Receivables that are not already represented by a local sale.
export const nonSaleReceivables = (receivables) =>
  (Array.isArray(receivables) ? receivables : []).filter((r) => r && r.kind !== 'local_sale');

export function buildCustomerRows(customers, sales, receivables) {
  const byId = {};
  const byName = {};
  for (const c of (customers || [])) {
    const row = {
      id: c.id, name: c.name, contact: c.contact || c.phone || '', country: c.country || '',
      billed: 0, paid: 0, outstanding: 0, _inv: new Set(),
    };
    byId[c.id] = row;
    if (c.name) byName[c.name.trim().toLowerCase()] = row;
  }

  for (const s of (sales || [])) {
    const total = parseFloat(s.totalAmount) || 0;
    const due = parseFloat(s.dueAmount) || 0;
    let row = null;
    if (s.customerId != null) row = byId[s.customerId];
    if (!row && s.buyerName) row = byName[s.buyerName.trim().toLowerCase()];
    if (!row) continue; // unregistered walk-in — not in the directory
    row.billed += total;
    row.paid += (total - due);
    row.outstanding += due;
    row._inv.add(s.saleGroupNo || s.saleNo || s.id);
  }

  // A customer can owe money without a sale behind it. This directory read
  // local_sales alone, so customers carrying an opening balance showed a row of
  // zeros while the money sat correctly in the GL and on the Receivables page.
  for (const r of nonSaleReceivables(receivables)) {
    const row = byId[r.customerId];
    if (!row) continue; // export customer, or not a registered local one
    const expected = parseFloat(r.expectedAmount) || 0;
    const outstanding = parseFloat(r.outstanding) || 0;
    row.billed += expected;
    row.paid += Math.max(0, expected - outstanding);
    row.outstanding += outstanding;
    row._inv.add(r.recvNo || `recv-${r.id}`);
  }

  return Object.values(byId)
    .map((r) => ({ ...r, count: r._inv.size }))
    .sort((a, b) => b.outstanding - a.outstanding || b.billed - a.billed);
}
