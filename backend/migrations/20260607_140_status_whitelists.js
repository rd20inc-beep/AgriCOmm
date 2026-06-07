/**
 * Schema refinement round 39 — status-whitelist CHECK constraints for the 11
 * secondary status columns the earlier rounds left unconstrained.
 *
 * Each whitelist was built from a per-table deep dive: reading the creating
 * migration's documented states AND every INSERT/UPDATE code path (no grep
 * guessing — an earlier grep attempt was proven wrong). Each set is the union
 * of "values the code writes" and "values the migration author documented as
 * valid", so features that are designed-but-not-yet-implemented (e.g. approval
 * 'Cancelled'/'Expired', bank_transactions 'pending'/'reversed') won't trip the
 * constraint when they land. Verified: prod + local data conform to every set.
 *
 * Companion code change (same PR): the POST /milling/attendance route set
 * mill_attendance.status straight from req.body with no validation. It now
 * rejects out-of-whitelist values with a 400 before insert, so this CHECK is
 * defense-in-depth rather than a way to turn bad input into a 500.
 *
 * Every CHECK allows NULL (so it can't fail a legitimately-null row) and is
 * guarded by table/column existence + a pg_constraint check. Idempotent.
 */

const CHECKS = [
  ['bank_transactions', 'status', ['posted', 'pending', 'reversed']],
  ['bank_reconciliation', 'status', ['Draft', 'In Progress', 'Completed']],
  ['approval_queue', 'status', ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired']],
  ['exception_inbox', 'status', ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Snoozed', 'Escalated']],
  ['predictive_alerts', 'status', ['Active', 'Acknowledged', 'Dismissed', 'Expired']],
  ['stock_counts', 'status', ['Planned', 'In Progress', 'Completed', 'Cancelled']],
  ['stock_count_items', 'status', ['Pending', 'Counted', 'Approved', 'Adjusted']],
  ['stock_adjustments', 'approval_status', ['draft', 'pending_approval', 'approved', 'rejected']],
  ['reprocessing_batches', 'status', ['Pending', 'Completed']],
  ['data_imports', 'status', ['Pending', 'Processing', 'Completed', 'Failed']],
  ['mill_attendance', 'status', ['present', 'absent', 'half_day', 'leave']],
];

const cname = (table, col) => `${table}_${col}_check`;

exports.up = async function (knex) {
  for (const [table, col, values] of CHECKS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, col))) continue;

    const name = cname(table, col);
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
    if (exists.rows.length) continue;

    // values are trusted enum literals from source analysis; quote defensively
    const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ${name} CHECK (?? IS NULL OR ?? IN (${list}))`,
      [table, col, col]
    );
  }
};

exports.down = async function (knex) {
  for (const [table, col] of CHECKS) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ${cname(table, col)}`, [table]);
  }
};
