/**
 * internal_transfers.status whitelist.
 *
 * Round 31/32 deferred this because the table was empty and the
 * state machine wasn't obvious. A read of the controller and FE shows:
 *
 *   - default on insert: 'Pending'
 *   - FE row badge styles: 'In Transit', 'Completed'
 *   - implied next states: 'Cancelled' (typical), 'Received' (mill→export
 *     handover terminology)
 *
 * Lock to: Pending / Dispatched / In Transit / Received / Completed / Cancelled.
 *
 * Idempotent — skips if any rows hold a value outside the whitelist.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('internal_transfers'))) return;
  if (!(await knex.schema.hasColumn('internal_transfers', 'status'))) return;
  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = 'chk_internal_transfers_status_valid'`);
  if (exists.rowCount > 0) return;

  const allowed = ['Pending', 'Dispatched', 'In Transit', 'Received', 'Completed', 'Cancelled'];
  const offenders = await knex('internal_transfers').whereNotNull('status').whereNotIn('status', allowed).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round31+] internal_transfers.status has ${offenders.n} unknown values; skipping CHECK.`);
    return;
  }
  const list = allowed.map(v => `'${v}'`).join(',');
  await knex.raw(
    `ALTER TABLE internal_transfers ADD CONSTRAINT chk_internal_transfers_status_valid
     CHECK (status IS NULL OR status IN (${list}))`
  );
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE internal_transfers DROP CONSTRAINT IF EXISTS chk_internal_transfers_status_valid`);
};
