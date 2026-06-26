/**
 * Owner-authorized approvals. Policy: only the Owner role (role_id 9) may approve
 * directly; anyone else (Finance, Super Admin, …) must name which owner authorized
 * the approval. This table logs every gated approval action for audit — who
 * performed it and on which owner's authority.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('approval_authorizations');
  if (exists) return;
  await knex.schema.createTable('approval_authorizations', (t) => {
    t.increments('id').primary();
    t.string('kind', 40).notNullable();          // fund_transfer | milling_batch | stock_adjustment | master_data | export_advance | export_balance
    t.string('ref', 80).nullable();              // the approved record's id/no
    t.string('action', 24).notNullable().defaultTo('approve');
    t.integer('performed_by').nullable();        // user who clicked approve
    t.integer('authorized_by_owner_id').nullable(); // the owner on whose authority
    t.boolean('self_approved').notNullable().defaultTo(false); // true when performer IS the owner
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['kind', 'ref']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('approval_authorizations');
};
