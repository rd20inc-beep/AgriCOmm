// Employee portal hardening (P1-07: PAY-07, PAY-08, PAY-30, PLT-30).
//
// 1. Per-worker failed-PIN counter + time-based lockout
//    (portal_failed_attempts / portal_locked_until).
// 2. portal_pin_version — stamped into every portal token; bumped whenever an
//    admin resets/disables the PIN or the worker changes it, so tokens issued
//    before that stop working on the next request.
// 3. A unique partial index on the CNIC of ACTIVE workers, so a CNIC logs in
//    to exactly one person (unless 081's all-workers index already exists). Existing duplicates are NOT merged automatically:
//    if any exist the index is skipped with a log line (the deploy must not
//    fail) and portal login refuses the ambiguous CNIC until an admin fixes
//    the records. The worker create/edit routes also refuse a CNIC already
//    held by another active worker, so no new duplicates appear; once the old
//    ones are cleaned up the index can be created with the statement below.

const INDEX = 'uq_mill_workers_active_cnic';

exports.up = async function up(knex) {
  const cols = {
    portal_failed_attempts: (t) => t.integer('portal_failed_attempts').notNullable().defaultTo(0),
    portal_locked_until: (t) => t.timestamp('portal_locked_until', { useTz: true }).nullable(),
    portal_pin_version: (t) => t.integer('portal_pin_version').notNullable().defaultTo(0),
  };
  for (const [name, add] of Object.entries(cols)) {
    if (!(await knex.schema.hasColumn('mill_workers', name))) {
      await knex.schema.alterTable('mill_workers', (t) => add(t));
    }
  }

  // Migration 081 already tried a stricter index (unique CNIC across ALL
  // workers) but skipped it when duplicates existed. Where it exists, the
  // active-only index adds nothing.
  const existing = await knex.raw(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uniq_mill_workers_cnic'`);
  if (existing.rows.length) return;

  const dups = await knex.raw(`
    SELECT cnic, COUNT(*)::int AS n FROM mill_workers
    WHERE is_active = true AND cnic IS NOT NULL AND TRIM(cnic) <> ''
    GROUP BY cnic HAVING COUNT(*) > 1
  `);
  if (dups.rows.length) {
    // Count only — CNICs are personal data and stay out of the deploy log.
    console.warn(`[migration 335] ${dups.rows.length} CNIC(s) are shared by more than one active worker — `
      + `skipping unique index ${INDEX}. Portal login rejects those CNICs until an admin corrects the records.`);
    return;
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON mill_workers (cnic)
    WHERE is_active = true AND cnic IS NOT NULL AND TRIM(cnic) <> ''`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
  for (const name of ['portal_failed_attempts', 'portal_locked_until', 'portal_pin_version']) {
    if (await knex.schema.hasColumn('mill_workers', name)) {
      await knex.schema.alterTable('mill_workers', (t) => t.dropColumn(name));
    }
  }
};
