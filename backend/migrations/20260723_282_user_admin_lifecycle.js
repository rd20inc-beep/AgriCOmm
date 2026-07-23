// User Administration (client change request #9) — account lifecycle + security.
//
// Extends the bare is_active boolean into a real status lifecycle, adds a
// force-password-change flag, failed-login auto-lockout, and a token_version for
// "revoke all sessions" (stateless JWT invalidation). is_active is kept in sync
// (active/invited → true; suspended/locked/deactivated → false) so existing code
// that reads is_active keeps working.

const STATUSES = ['invited', 'active', 'suspended', 'locked', 'deactivated'];
const CNAME = 'chk_users_status_valid';

exports.up = async (knex) => {
  const add = async (col, fn) => {
    if (!(await knex.schema.hasColumn('users', col))) await knex.schema.alterTable('users', fn);
  };
  await add('status', (t) => t.string('status', 20).notNullable().defaultTo('active'));
  await add('force_password_change', (t) => t.boolean('force_password_change').notNullable().defaultTo(false));
  await add('locked_at', (t) => t.timestamp('locked_at').nullable());
  await add('failed_login_count', (t) => t.integer('failed_login_count').notNullable().defaultTo(0));
  await add('password_changed_at', (t) => t.timestamp('password_changed_at').nullable());
  await add('token_version', (t) => t.integer('token_version').notNullable().defaultTo(0));

  // Backfill status from the existing boolean.
  await knex.raw(`UPDATE users SET status = CASE WHEN is_active THEN 'active' ELSE 'deactivated' END`);

  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [CNAME]);
  if (!exists.rows.length) {
    await knex.raw(
      `ALTER TABLE users ADD CONSTRAINT ${CNAME} CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`
    );
  }
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CNAME}`);
  for (const col of ['status', 'force_password_change', 'locked_at', 'failed_login_count', 'password_changed_at', 'token_version']) {
    if (await knex.schema.hasColumn('users', col)) await knex.schema.alterTable('users', (t) => t.dropColumn(col));
  }
};
