/**
 * Payment confirmation state (enhancement Batch 3, item 14).
 *
 * Export receipts (advance/balance) must not post to bank/GL until Finance
 * verifies them and enters the actual FX rate. Add a status lifecycle to
 * payments: 'Pending Finance Confirmation' → 'Confirmed' (posts) or 'Rejected'.
 * Existing rows default to 'Confirmed' (they were always posted). Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('payments'))) return;
  if (!(await knex.schema.hasColumn('payments', 'status'))) {
    await knex.schema.alterTable('payments', (t) => t.string('status', 30).notNullable().defaultTo('Confirmed'));
  }
  if (!(await knex.schema.hasColumn('payments', 'confirmed_by'))) {
    await knex.schema.alterTable('payments', (t) => t.integer('confirmed_by').nullable().references('id').inTable('users').onDelete('SET NULL'));
  }
  if (!(await knex.schema.hasColumn('payments', 'confirmed_at'))) {
    await knex.schema.alterTable('payments', (t) => t.timestamp('confirmed_at').nullable());
  }
  if (!(await knex.schema.hasColumn('payments', 'reject_reason'))) {
    await knex.schema.alterTable('payments', (t) => t.text('reject_reason').nullable());
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('payments'))) return;
  for (const col of ['reject_reason', 'confirmed_at', 'confirmed_by', 'status']) {
    if (await knex.schema.hasColumn('payments', col)) {
      await knex.schema.alterTable('payments', (t) => t.dropColumn(col));
    }
  }
};
