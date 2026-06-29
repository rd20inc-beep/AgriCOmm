/**
 * Employee self-service portal (Phase 19).
 *
 * Mill workers aren't in the `users` table, so the portal has its own light
 * auth: a per-worker self-service PIN (bcrypt-hashed) + an enabled flag. The
 * worker logs in with CNIC + PIN and gets a portal-scoped JWT to view only their
 * own payslips / tax certificate / advance balance. Additive + nullable.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('mill_workers', 'portal_pin_hash')) return;
  await knex.schema.alterTable('mill_workers', (t) => {
    t.string('portal_pin_hash', 100).nullable();
    t.boolean('portal_enabled').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('mill_workers', 'portal_pin_hash'))) return;
  await knex.schema.alterTable('mill_workers', (t) => {
    t.dropColumn('portal_pin_hash');
    t.dropColumn('portal_enabled');
  });
};
