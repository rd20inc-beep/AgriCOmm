// Batch 6 · item 9 — a local sale must be confirmed by a Mill Manager or Owner
// before stock/revenue move. A sale recorded by a Mill Manager/Owner auto-confirms
// (status 'Completed' immediately); anyone else's sale sits 'Pending' until
// confirmed. confirmed_by/at record who released it; bank_account_id persists the
// intended receipt account so confirm can post the payment.
exports.up = async (knex) => {
  await knex.schema.alterTable('local_sales', (t) => {
    t.integer('confirmed_by').unsigned().nullable();
    t.timestamp('confirmed_at', { useTz: true }).nullable();
    t.integer('bank_account_id').unsigned().nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('local_sales', (t) => {
    t.dropColumn('confirmed_by');
    t.dropColumn('confirmed_at');
    t.dropColumn('bank_account_id');
  });
};
