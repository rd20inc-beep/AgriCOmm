/**
 * Export receipts are never deleted (P2-15, D-7 / D-23).
 *
 * - payments.status 'Superseded': a pending export receipt that Finance
 *   confirmed. Confirming posts a NEW payment row (bank, GL, receivable); the
 *   pending placeholder used to be hard-deleted. It now stays, marked
 *   Superseded and pointing at the posted row (superseded_by_payment_id). Like
 *   'Rejected' it never moved money and every money reader excludes it.
 * - payments.refund_of_payment_id: a money-out refund of an export receipt
 *   (order cancelled) points at the receipt it gives back. Cancelling used to
 *   debit the bank and delete the receipt and its bank row.
 *
 * Additive. The CHECK keeps every status that was allowed before.
 */
const STATUSES_BEFORE = ['Confirmed', 'Pending Finance Confirmation', 'Rejected', 'Reversed', 'Bounced'];

const statusCheck = (list) => 'ALTER TABLE payments ADD CONSTRAINT chk_payments_status_valid CHECK ('
  + `status IS NULL OR status IN (${list.map((s) => `'${s}'`).join(', ')}))`;

exports.up = async (knex) => {
  await knex.schema.alterTable('payments', (t) => {
    t.integer('superseded_by_payment_id').nullable().references('id').inTable('payments').onDelete('SET NULL');
    t.integer('refund_of_payment_id').nullable().references('id').inTable('payments').onDelete('RESTRICT');
    t.index(['superseded_by_payment_id'], 'idx_payments_superseded_by_payment_id');
    t.index(['refund_of_payment_id'], 'idx_payments_refund_of_payment_id');
  });
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(statusCheck([...STATUSES_BEFORE, 'Superseded']));
};

exports.down = async (knex) => {
  // A Superseded row cannot go back under the old CHECK; it was a pending
  // placeholder for a receipt that was confirmed, so it reverts to Rejected.
  await knex('payments').where({ status: 'Superseded' }).update({ status: 'Rejected' });
  await knex.raw('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_status_valid');
  await knex.raw(statusCheck(STATUSES_BEFORE));
  await knex.schema.alterTable('payments', (t) => {
    t.dropIndex(['refund_of_payment_id'], 'idx_payments_refund_of_payment_id');
    t.dropIndex(['superseded_by_payment_id'], 'idx_payments_superseded_by_payment_id');
    t.dropColumn('refund_of_payment_id');
    t.dropColumn('superseded_by_payment_id');
  });
};
