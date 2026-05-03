/**
 * Round-15 schema refinement.
 *
 * Hot tables that are read in recency order (dashboards, "last N
 * payments", admin activity feeds, status history) lack an index on
 * created_at. Every such query is sorting the whole table.
 *
 * Audit on 2026-05-04 found 12 of 14 hot tables in this state. Add
 * btree indexes on created_at — DESC because every reader of these
 * tables wants newest-first.
 *
 * Idempotent CREATE INDEX IF NOT EXISTS throughout. No data risk.
 */

const TABLES = [
  'export_order_costs',
  'export_order_documents',
  'export_order_status_history',
  'inventory_lots',
  'local_sales',
  'milling_costs',
  'milling_quality_samples',
  'milling_vehicle_arrivals',
  'payables',
  'payments',
  'receivables',
  'shipment_containers',
];

exports.up = async function (knex) {
  let added = 0;
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'created_at'))) continue;
    const idxName = `idx_${table}_created_at`.slice(0, 63);
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" (created_at DESC)`
    );
    added += 1;
  }
  if (added > 0) console.log(`[087] Ensured ${added} created_at index(es)`);
};

exports.down = async function (knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS "idx_${table}_created_at"`);
  }
};
