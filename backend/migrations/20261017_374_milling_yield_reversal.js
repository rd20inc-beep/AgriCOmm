/**
 * P3-03 / MIL-20 — controlled yield reversal. A reversed yield is stamped on
 * the batch: when, by whom, why, and which Owner authorised it (the Owner's
 * approval is also logged to approval_authorizations by ownerApproval). The
 * reversal itself is written as new stock movements and signed-delta journals;
 * nothing about the original yield is deleted.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('milling_batches', (t) => {
    t.timestamp('yield_reversed_at', { useTz: true }).nullable();
    t.integer('yield_reversed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('yield_reversal_reason', 500).nullable();
    t.integer('yield_reversal_authorized_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS milling_batches_yield_reversed_by_idx ON milling_batches (yield_reversed_by)');
  await knex.raw('CREATE INDEX IF NOT EXISTS milling_batches_yield_reversal_authorized_by_idx ON milling_batches (yield_reversal_authorized_by)');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS milling_batches_yield_reversal_authorized_by_idx');
  await knex.raw('DROP INDEX IF EXISTS milling_batches_yield_reversed_by_idx');
  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('yield_reversal_authorized_by');
    t.dropColumn('yield_reversal_reason');
    t.dropColumn('yield_reversed_by');
    t.dropColumn('yield_reversed_at');
  });
};
