// P2-32 / ADM-14 — a customer edit by someone without master_data.approve is a
// PROPOSAL, not a live change. It is held on the customer row until reviewed:
// Approve applies it, Reject discards it (the customer stays as it was and
// stays active — a rejected edit no longer deactivates the buyer).
//
//   pending_edit     jsonb   the proposed field values ({ name, phone, … })
//   pending_edit_by  users   who proposed it
//   pending_edit_at  when

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('customers', 'pending_edit'))) {
    await knex.schema.alterTable('customers', (t) => {
      t.jsonb('pending_edit').nullable();
      t.integer('pending_edit_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('pending_edit_at', { useTz: true }).nullable();
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_customers_pending_edit_by ON customers (pending_edit_by)');
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('customers', 'pending_edit')) {
    await knex.raw('DROP INDEX IF EXISTS idx_customers_pending_edit_by');
    await knex.schema.alterTable('customers', (t) => {
      t.dropColumn('pending_edit');
      t.dropColumn('pending_edit_by');
      t.dropColumn('pending_edit_at');
    });
  }
};
