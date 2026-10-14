// P1-10 / P1-04 — time-based login lockout + hashed password-reset tokens.
//
// 1. users.locked_until — a failed-sign-in lockout now EXPIRES (15 min) instead
//    of flipping the account to status 'locked' until an admin intervenes.
//    status='locked' remains the admin's deliberate lock.
// 2. password_reset_tokens.token — stored as 'sha256:<hex>' of the token, never
//    the token itself. Existing plaintext rows are hashed in place so links
//    already handed out keep working. The prefix makes this idempotent (a
//    plaintext token is 64 hex chars, same as a digest — the prefix is what tells
//    them apart).
//
// down(): drops locked_until. Hashing is one-way, so hashed tokens cannot be
// restored; down() marks every outstanding hashed token used (the old code would
// never match them anyway) — users simply request a new link.

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'locked_until'))) {
    await knex.schema.alterTable('users', (t) => {
      t.timestamp('locked_until', { useTz: true }).nullable();
    });
  }
  await knex.raw(`
    UPDATE password_reset_tokens
       SET token = 'sha256:' || encode(sha256(convert_to(token, 'UTF8')), 'hex')
     WHERE token NOT LIKE 'sha256:%'
  `);
};

exports.down = async function down(knex) {
  await knex('password_reset_tokens').where('token', 'like', 'sha256:%').update({ used: true });
  if (await knex.schema.hasColumn('users', 'locked_until')) {
    await knex.schema.alterTable('users', (t) => { t.dropColumn('locked_until'); });
  }
};
