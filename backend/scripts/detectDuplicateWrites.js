/**
 * READ-ONLY scan for probable duplicate money writes (P2-12).
 *
 * Before per-submit Idempotency-Keys, a double-click or a replay after a dropped
 * response could create the same payment / sale / expense / store purchase /
 * transport cost twice. This sizes the past exposure: rows that share the same
 * party, amount and business date and were created within WINDOW_MINUTES of
 * each other.
 *
 * It NEVER writes and never merges — a "probable duplicate" may be two real
 * identical transactions; a person decides, and any correction goes through the
 * normal void / reversal path (signed-delta journals), never a delete.
 *
 *   node scripts/detectDuplicateWrites.js            (default window 5 minutes)
 *   DUP_WINDOW_MINUTES=10 node scripts/detectDuplicateWrites.js
 *
 * Output: per table, the number of suspect pairs and the row IDs only — no
 * names, no amounts.
 * Runbook: docs/runbooks/duplicate-money-writes.md
 */

// Each check: the table, the columns that make two rows "the same write", and
// a filter that drops rows already voided/reversed.
const CHECKS = [
  { table: 'payments', same: ['type', 'amount', 'currency', 'payment_date', 'linked_receivable_id', 'linked_payable_id', 'local_sale_id', 'source_table', 'source_id'], live: "coalesce(a.status, '') not in ('reversed', 'rejected', 'Reversed', 'Rejected')" },
  { table: 'local_sales', same: ['customer_id', 'buyer_name', 'lot_id', 'mill_item_id', 'quantity_kg', 'total_amount', 'sale_date'], live: "coalesce(a.status, '') not in ('Cancelled')" },
  { table: 'business_expenses', same: ['category', 'amount', 'currency', 'expense_date', 'supplier_id', 'vendor_name'], live: 'true' },
  { table: 'mill_purchases', same: ['supplier_id', 'vendor_name', 'total_amount', 'purchase_date'], live: 'true' },
  { table: 'transport_costs', same: ['hauler_id', 'lot_id', 'batch_id', 'amount', 'expense_date', 'vehicle_no'], live: "coalesce(a.status, '') not in ('void', 'Void', 'cancelled', 'Cancelled')" },
];

async function scanTable(db, check, windowMinutes) {
  if (!(await db.schema.hasTable(check.table))) return null;
  const cols = [];
  for (const c of check.same) if (await db.schema.hasColumn(check.table, c)) cols.push(c);
  const match = cols.map((c) => `a."${c}" is not distinct from b."${c}"`).join(' and ');
  const { rows } = await db.raw(
    `select a.id as first_id, b.id as second_id
       from "${check.table}" a
       join "${check.table}" b
         on b.id > a.id and ${match}
        and b.created_at between a.created_at and a.created_at + (? || ' minutes')::interval
      where ${check.live} and ${check.live.replace(/\ba\./g, 'b.')}
      order by a.id`,
    [String(windowMinutes)],
  );
  return rows;
}

async function main(env = process.env, log = console.log) {
  const windowMinutes = Math.max(1, parseInt(env.DUP_WINDOW_MINUTES, 10) || 5);
  const db = require('../src/config/database');
  try {
    let total = 0;
    log(`Probable duplicate writes (same party/amount/date, created within ${windowMinutes} min) — READ-ONLY`);
    for (const check of CHECKS) {
      const pairs = await scanTable(db, check, windowMinutes);
      if (pairs === null) { log(`  ${check.table}: table missing — skipped`); continue; }
      total += pairs.length;
      log(`  ${check.table}: ${pairs.length} suspect pair(s)`);
      for (const p of pairs.slice(0, 200)) log(`    #${p.first_id} ~ #${p.second_id}`);
      if (pairs.length > 200) log(`    … ${pairs.length - 200} more`);
    }
    log(`Total suspect pairs: ${total}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectDuplicateWrites failed:', err.message);
    process.exit(1);
  });
}

module.exports = { scanTable, main, CHECKS };
