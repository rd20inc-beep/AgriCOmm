// Batch 6 · item 8 — salary advances now need Owner approval before Finance pays.
// approval_status is a SEPARATE lifecycle from `status` (which is the recovery
// lifecycle outstanding→recovered). A new advance starts 'pending'; existing rows
// were created + paid immediately, so backfill them to 'paid'.
exports.up = async (knex) => {
  await knex.schema.alterTable('mill_worker_advances', (t) => {
    t.string('approval_status', 20).notNullable().defaultTo('paid'); // pending | approved | rejected | paid
    t.integer('approved_by').unsigned().nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.text('reject_reason').nullable();
  });
  // Existing advances predate the approval flow — they already paid cash.
  await knex('mill_worker_advances').update({ approval_status: 'paid' });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('mill_worker_advances', (t) => {
    t.dropColumn('approval_status');
    t.dropColumn('approved_by');
    t.dropColumn('approved_at');
    t.dropColumn('reject_reason');
  });
};
