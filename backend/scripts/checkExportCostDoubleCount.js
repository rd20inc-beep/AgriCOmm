/**
 * READ-ONLY (P2-05): export-order cost rows that the new rules no longer allow.
 *
 *   A. manual 'rice' / 'raw_rice' costs on orders that shipped with a locked
 *      COGS — the same rice is expensed twice (Dr 6000 via the cost AND
 *      Dr 5020 via shipment COGS). Candidates for owner review; confirmed
 *      duplicates are corrected by scripts/correctExportRiceDoubleCount.js.
 *   B. manual 'rice' / 'raw_rice' costs on orders not shipped yet — they will
 *      double count once the order ships; review before shipping.
 *   C. stored 'milling' rows (copied from the batch at completion, often in the
 *      order's currency). No longer read by the order page (derived from the
 *      batch now); listed for information.
 *   D. any row not in PKR.
 *
 * Writes nothing. Prints counts, cost ids and order ids only.
 *
 *   node scripts/checkExportCostDoubleCount.js
 */
const db = require('../src/config/database');

const SHIPPED = ['Shipped', 'Arrived', 'Closed'];

async function main() {
  const rows = await db('export_order_costs as c')
    .join('export_orders as o', 'o.id', 'c.order_id')
    .where(function () {
      this.whereRaw("LOWER(c.category) IN ('rice', 'raw_rice', 'milling')")
        .orWhereRaw("UPPER(COALESCE(c.currency, 'PKR')) <> 'PKR'");
    })
    .select('c.id', 'c.order_id', 'c.category', 'c.currency', 'c.paid_amount',
      'o.status', 'o.inventory_cogs_total_pkr')
    .orderBy('c.id');

  const cat = (r) => String(r.category || '').toLowerCase();
  const isRice = (r) => cat(r) === 'rice' || cat(r) === 'raw_rice';
  const shippedWithCogs = (r) => SHIPPED.includes(r.status) && parseFloat(r.inventory_cogs_total_pkr) > 0;

  const groups = {
    'A. rice cost on a shipped order with locked COGS (likely double count)': rows.filter((r) => isRice(r) && shippedWithCogs(r)),
    'B. rice cost on an order not shipped / no COGS yet': rows.filter((r) => isRice(r) && !shippedWithCogs(r) && r.status !== 'Cancelled'),
    'C. stored milling rows (legacy copy; order page now derives milling)': rows.filter((r) => cat(r) === 'milling'),
    'D. rows not in PKR': rows.filter((r) => String(r.currency || 'PKR').toUpperCase() !== 'PKR'),
  };
  let flagged = 0;
  for (const [label, list] of Object.entries(groups)) {
    console.log(`${label}: ${list.length}`);
    for (const r of list) {
      const paid = parseFloat(r.paid_amount) > 0 ? ' (partly/fully PAID — manual review)' : '';
      console.log(`    cost #${r.id}  order #${r.order_id}  ${r.category}  ${r.status}${paid}`);
    }
    if (label.startsWith('A.') || label.startsWith('B.')) flagged += list.length;
  }
  return flagged ? 2 : 0;
}

main()
  .then((code) => db.destroy().then(() => process.exit(code)))
  .catch((err) => {
    console.error('Check failed:', err.message);
    db.destroy().finally(() => process.exit(1));
  });
