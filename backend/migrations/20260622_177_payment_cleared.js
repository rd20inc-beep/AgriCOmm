/**
 * Post-dated cheques: a cheque payment with a future `due_date` is recorded but
 * does NOT settle the linked sale/receivable/payable until it clears. `cleared`
 * = false means "pending clearance"; clearing it applies the balance. Existing
 * payments default to cleared=true (already applied).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('payments', (t) => {
    t.boolean('cleared').notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('payments', (t) => { t.dropColumn('cleared'); });
};
