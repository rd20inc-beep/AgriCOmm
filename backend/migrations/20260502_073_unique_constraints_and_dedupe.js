/**
 * Round-7 schema refinement: natural-key UNIQUE constraints + soft de-dupe.
 *
 * Audit found columns that look like natural keys but had no UNIQUE
 * constraint enforcing it — opening the door to silent duplicates from
 * imports, manual SQL, or race conditions in the API. None had data
 * duplicates today (after a small soft-archive of 2 supplier rows below).
 *
 * Most use a *partial* UNIQUE INDEX (`WHERE col IS NOT NULL AND col != ''`)
 * so legitimately-blank values stay allowed — for example, contract_number
 * is optional, but two orders should not have the same non-blank one.
 *
 * Soft de-dupe (suppliers only):
 *   Two supplier rows are exact name+email duplicates that look like
 *   data-entry mistakes (Punjab Rice Mills × 2, Thai Rice Exporters × 2).
 *   The duplicate IDs are not referenced by any FK in the dev DB. Archive
 *   the higher-id row by setting is_active=false and tagging the name with
 *   "(dup of #N)" so the user can spot and merge later.
 *
 *   NOT touched: customers email duplicates — those are similar but not
 *   exact (e.g., "ABDULLA" vs "ABDULLAH"). Likely the same buyer typed
 *   twice; needs a human to decide which name is canonical.
 *
 * Idempotent: every CREATE INDEX uses IF NOT EXISTS; archive update is
 * NULL-safe.
 */

// (table, column) — partial UNIQUE so blank values stay allowed.
const UNIQUE_TARGETS = [
  // Identity codes (already populated for everyone — full UNIQUE)
  ['products', 'code', false],
  // Optional natural keys — partial UNIQUE so blank stays allowed
  ['local_sales', 'lot_no', true],
  ['supplier_invoices', 'invoice_no', true],
  ['export_orders', 'contract_number', true],
  ['mill_workers', 'phone', true],
  ['mills', 'phone', true],
  ['suppliers', 'phone', true],
  ['customers', 'phone', true],
];

exports.up = async function (knex) {
  // 1. Soft-archive supplier duplicates that look like clear data-entry
  //    mistakes — keep both rows so any FK reference still resolves.
  const dupes = await knex.raw(`
    SELECT MIN(id) AS keep_id, MAX(id) AS dup_id, name, email
    FROM suppliers
    WHERE email IS NOT NULL AND email != ''
    GROUP BY name, email
    HAVING COUNT(*) > 1
  `);
  for (const row of dupes.rows) {
    if (row.dup_id === row.keep_id) continue;
    await knex('suppliers').where({ id: row.dup_id }).update({
      is_active: false,
      // Tag the name so users can find these in the UI
      name: knex.raw(`name || ' (dup of #' || ? || ')'`, [row.keep_id]),
    });
  }

  // 2. Add UNIQUE constraints
  for (const [tbl, col, partial] of UNIQUE_TARGETS) {
    if (!(await knex.schema.hasTable(tbl))) continue;
    if (!(await knex.schema.hasColumn(tbl, col))) continue;
    const idxName = `uq_${tbl}_${col}`;
    if (partial) {
      await knex.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}" ON "${tbl}" ("${col}")
         WHERE "${col}" IS NOT NULL AND "${col}" != ''`
      );
    } else {
      await knex.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}" ON "${tbl}" ("${col}")`
      );
    }
  }
};

exports.down = async function (knex) {
  for (const [tbl, col] of UNIQUE_TARGETS) {
    await knex.raw(`DROP INDEX IF EXISTS "uq_${tbl}_${col}"`);
  }
  // Don't auto-restore the archived suppliers — the user may have already
  // merged customer references onto the kept row.
};
