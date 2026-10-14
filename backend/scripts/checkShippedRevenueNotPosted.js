/**
 * READ-ONLY health report (P2-03): export orders that are Shipped / Arrived /
 * Closed with revenue_posted = false — shipments whose revenue / COGS journals
 * never posted. Writes nothing. Prints counts and order ids only.
 *
 *   node scripts/checkShippedRevenueNotPosted.js
 *
 * Exit code 0 when none are found, 2 when some are (so a cron / CI can alert).
 * What to do with the list: docs/runbooks/export-shipment-posting-health.md.
 */
const db = require('../src/config/database');
const { findShippedWithoutRevenue } = require('../src/modules/exportOrders/shipmentPostingHealth');

async function main() {
  const { total, orders } = await findShippedWithoutRevenue(db);
  console.log(`Shipped / Arrived / Closed export orders with revenue NOT posted: ${total}`);
  if (!total) return 0;
  const count = (f) => orders.filter(f).length;
  console.log(`  missing a booked FX rate (posting would be refused, D-10): ${count((o) => !o.hasBookedRate)}`);
  console.log(`  with no locked COGS:                                      ${count((o) => !o.hasLockedCogs)}`);
  console.log(`  with a Posted revenue journal despite the flag (check!):  ${count((o) => o.postedRevenueJournals > 0)}`);
  console.log('\n  id      order_no        status    booked_rate  locked_cogs  revenue_journals');
  for (const o of orders) {
    console.log(`  ${String(o.id).padEnd(7)} ${String(o.order_no || '').padEnd(15)} ${String(o.status).padEnd(9)} ${String(o.hasBookedRate).padEnd(12)} ${String(o.hasLockedCogs).padEnd(12)} ${o.postedRevenueJournals}`);
  }
  return 2;
}

main()
  .then((code) => db.destroy().then(() => process.exit(code)))
  .catch((err) => {
    console.error('Health check failed:', err.message);
    db.destroy().finally(() => process.exit(1));
  });
