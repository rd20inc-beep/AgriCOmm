/**
 * Round-33 schema refinement.
 *
 * Audit found:
 *
 *   1. Three commonly-joined columns still lack a btree index, all
 *      hit on every Money In / Money Out / Reports load:
 *        - journal_entries.ref_no  — looked up to render a journal
 *          for an order_no / batch_no / lot_no
 *        - lot_transactions.reference_id — lot-history queries scan
 *          this column for joins back to the parent batch / order
 *        - payables.linked_ref     — finance UI looks up payables
 *          by 'LOT-...', 'EO-...' refs
 *
 *   2. mills.status had no whitelist. Existing data is just 'Active'
 *      but the application has no clear state machine; this round
 *      adds the obvious set so a typo can't sneak in.
 *
 * Other empty-data status columns (approval_queue, bank_reconciliation,
 * bank_transactions, data_imports, exception_inbox, mill_attendance,
 * predictive_alerts, reprocessing_batches, stock_counts/items) left
 * unconstrained — locking them blindly without reading the workflow
 * code is more likely to break a future writer than catch a real bug.
 *
 * Idempotent — every index uses CREATE INDEX IF NOT EXISTS, every
 * CHECK guards on offender-count first.
 */

exports.up = async function (knex) {
  // ── Indexes ─────────────────────────────────────────────
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_journal_entries_ref_no ON journal_entries (ref_no)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_lot_transactions_reference_id ON lot_transactions (reference_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_payables_linked_ref ON payables (linked_ref)`);

  // ── mills.status whitelist ──────────────────────────────
  if (await knex.schema.hasTable('mills') && await knex.schema.hasColumn('mills', 'status')) {
    const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname='chk_mills_status_valid'`);
    if (exists.rowCount === 0) {
      const allowed = ['Active', 'Inactive', 'Maintenance', 'Decommissioned'];
      const offenders = await knex('mills').whereNotNull('status').whereNotIn('status', allowed).count('* as n').first();
      if (parseInt(offenders.n, 10) === 0) {
        const list = allowed.map(v => `'${v}'`).join(',');
        await knex.raw(
          `ALTER TABLE mills ADD CONSTRAINT chk_mills_status_valid
           CHECK (status IS NULL OR status IN (${list}))`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[round33] mills.status has ${offenders.n} unknown values; skipping whitelist.`);
      }
    }
  }
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_journal_entries_ref_no`);
  await knex.raw(`DROP INDEX IF EXISTS idx_lot_transactions_reference_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_payables_linked_ref`);
  await knex.raw(`ALTER TABLE mills DROP CONSTRAINT IF EXISTS chk_mills_status_valid`);
};
