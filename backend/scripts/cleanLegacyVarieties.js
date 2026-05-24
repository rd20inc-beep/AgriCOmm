/**
 * One-off cleanup — null out variety values on inventory_lots when the
 * stored string is just an auto-generated SKU code, not a meaningful
 * rice variety. Mirrors the heuristic the UI uses to hide them.
 *
 * Affects lots whose variety matches any of:
 *   • starts with PRD- followed by 6+ digits (PRD-20251230-180141-…)
 *   • starts with PROD- (catalog-internal product codes)
 *   • contains 8+ consecutive digits (datetime-shaped IDs)
 *   • is longer than 18 characters (generic ID-shaped)
 *
 * Idempotent: a NULL-out can't be re-applied.
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/cleanLegacyVarieties.js --dry
 *   docker exec riceflow-backend node scripts/cleanLegacyVarieties.js
 */
require('dotenv').config();
const db = require('../src/config/database');

const DRY = process.argv.includes('--dry');

// Postgres regex — case-insensitive (~*). Matches anything the UI
// heuristic would also flag.
const SQL_WHERE = `
  variety IS NOT NULL
  AND (
    variety ~* '^PRD[-_]\\d{6,}'
    OR variety ~* '^PROD[-_]'
    OR variety ~ '\\d{8,}'
    OR LENGTH(variety) > 18
  )
`;

async function main() {
  const candidates = await db('inventory_lots')
    .whereRaw(SQL_WHERE)
    .select('id', 'lot_no', 'item_name', 'variety');

  console.log(`Found ${candidates.length} lots with auto-SKU variety values.`);
  if (candidates.length === 0) {
    await db.destroy();
    return;
  }

  for (const r of candidates.slice(0, 40)) {
    console.log(`  ${r.lot_no.padEnd(36)}  item=${(r.item_name || '').slice(0, 28).padEnd(28)}  variety=${r.variety}`);
  }
  if (candidates.length > 40) console.log(`  ... and ${candidates.length - 40} more`);

  if (DRY) {
    console.log('\nDry run — no changes written. Re-run without --dry to apply.');
    await db.destroy();
    return;
  }

  const updated = await db('inventory_lots')
    .whereRaw(SQL_WHERE)
    .update({ variety: null, updated_at: db.fn.now() });

  console.log(`\nNULLed variety on ${updated} lots.`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
