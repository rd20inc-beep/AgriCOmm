/**
 * Round-18 schema refinement.
 *
 * Audit on 2026-05-04 found pg_stat_user_tables stats massively out
 * of date — bag_types showed 0 live rows when there are 18, customers
 * 0 vs 50, chart_of_accounts 0 vs 52. With those estimates the query
 * planner picks bad plans (nested-loop joins where it should hash
 * join). Manual ANALYZE refreshed the estimates immediately, but the
 * underlying autoanalyze settings made it certain to drift again.
 *
 * Postgres' default autoanalyze_threshold is 50 + 10% of rows. For an
 * 18-row master-data table that's 51 changes before the planner
 * notices anything — effectively never on a stable reference table.
 *
 * This migration:
 *  1. Lowers autovacuum_analyze_threshold to 10 on the small
 *     master-data tables so any meaningful change re-stats them.
 *  2. Runs ANALYZE on the schema at apply time so the planner has
 *     correct numbers immediately after deploy.
 *
 * Idempotent: ALTER TABLE ... SET overwrites; ANALYZE is always safe.
 */

const SMALL_MASTER_TABLES = [
  'customers',
  'suppliers',
  'products',
  'bag_types',
  'mills',
  'warehouses',
  'bank_accounts',
  'document_templates',
  'permissions',
  'roles',
  'mill_workers',
  'mill_items',
  'mill_consumption_ratios',
];

exports.up = async function (knex) {
  for (const table of SMALL_MASTER_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`
      ALTER TABLE "${table}" SET (
        autovacuum_analyze_threshold = 10,
        autovacuum_analyze_scale_factor = 0.05
      )
    `);
  }
  // One-shot stats refresh for the whole schema. Safe to run inside a
  // transaction in modern Postgres; takes <1s on small DBs.
  await knex.raw('ANALYZE');
  console.log(`[089] Tightened autoanalyze on ${SMALL_MASTER_TABLES.length} master tables and ran ANALYZE.`);
};

exports.down = async function (knex) {
  for (const table of SMALL_MASTER_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`
      ALTER TABLE "${table}" RESET (
        autovacuum_analyze_threshold,
        autovacuum_analyze_scale_factor
      )
    `);
  }
};
