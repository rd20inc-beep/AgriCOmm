/**
 * Two-phase fund transfers: the receiving side must ACCEPT a transfer before the
 * funds land in their account. Adds acceptance metadata to fund_transfers; the
 * `status` column (already present) now carries 'pending' until accepted, then
 * 'completed'.
 */
exports.up = async function (knex) {
  const hasAcceptedAt = await knex.schema.hasColumn('fund_transfers', 'accepted_at');
  if (!hasAcceptedAt) {
    await knex.schema.alterTable('fund_transfers', (t) => {
      t.timestamp('accepted_at', { useTz: true });
      t.integer('accepted_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('fund_transfers', 'accepted_at')) {
    await knex.schema.alterTable('fund_transfers', (t) => {
      t.dropColumn('accepted_at');
      t.dropColumn('accepted_by');
    });
  }
};
