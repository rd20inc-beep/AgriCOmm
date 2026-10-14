const crypto = require('crypto');
const db = require('../../config/database');

// Password-reset tokens are stored as a SHA-256 digest (prefixed so a migrated
// row is distinguishable from a legacy plaintext one) — a DB/backup reader can't
// use them. The raw token only ever exists in the emailed/copied link.
function hashResetToken(token) {
  return `sha256:${crypto.createHash('sha256').update(String(token), 'utf8').digest('hex')}`;
}

const LEGACY_AUTOLOCK_COUNT = 5;

// Bump token_version → every JWT/stream ticket issued before now stops working.
// Used on role, status and password changes and on session/device revocation.
async function bumpTokenVersion(userId, trx) {
  await (trx || db)('users').where({ id: userId }).increment('token_version', 1);
}

const authRepository = {
  async findUserByEmail(email) {
    return db('users as u')
      .leftJoin('roles as r', 'u.role_id', 'r.id')
      .where({ 'u.email': email.toLowerCase() })
      .select('u.*', 'r.name as role_name')
      .first();
  },

  async findUserById(id) {
    return db('users as u')
      .leftJoin('roles as r', 'u.role_id', 'r.id')
      .where({ 'u.id': id })
      .select('u.*', 'r.name as role_name')
      .first();
  },

  async getUserProfile(id) {
    return db('users as u')
      .leftJoin('roles as r', 'u.role_id', 'r.id')
      .where({ 'u.id': id })
      .select('u.id', 'u.email', 'u.full_name', 'u.role_id', 'r.name as role', 'u.is_active', 'u.last_login', 'u.created_at',
        'u.status', 'u.force_password_change')
      .first();
  },

  async getPermissionsForRole(roleId) {
    const perms = await db('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .where('rp.role_id', roleId)
      .select('p.module', 'p.action');
    return perms.map((p) => `${p.module}.${p.action}`);
  },

  async getRoleName(roleId) {
    const role = await db('roles').where({ id: roleId }).select('name').first();
    return role ? role.name : null;
  },

  // The role's configured phone bottom-nav item keys (null = app default).
  async getMobileNavForRole(roleId) {
    const role = await db('roles').where({ id: roleId }).select('mobile_nav').first();
    const v = role ? role.mobile_nav : null;
    if (!v) return null;
    // jsonb comes back parsed on pg, but be defensive if it's a string.
    try { return Array.isArray(v) ? v : JSON.parse(v); } catch { return null; }
  },

  async getRoleByName(name) {
    return db('roles').where({ name }).first();
  },

  async createUser(trx, { email, password_hash, full_name, role_id }) {
    const knex = trx || db;
    const [user] = await knex('users')
      .insert({ email: email.toLowerCase(), password_hash, full_name, role_id, is_active: true })
      .returning(['id', 'email', 'full_name', 'role_id']);
    return user;
  },

  async updateLastLogin(userId) {
    await db('users').where({ id: userId }).update({ last_login: db.fn.now() });
  },

  // Also ends every other session (token_version bump).
  async updatePassword(userId, password_hash) {
    await db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ password_hash, updated_at: trx.fn.now() });
      await bumpTokenVersion(userId, trx);
    });
  },

  async updateProfile(userId, { full_name }) {
    const [user] = await db('users')
      .where({ id: userId })
      .update({ full_name, updated_at: db.fn.now() })
      .returning(['id', 'email', 'full_name', 'role_id']);
    return user;
  },

  hashResetToken,
  bumpTokenVersion,
  LEGACY_AUTOLOCK_COUNT,

  async createPasswordResetToken(userId, token, expiresAt) {
    await db('password_reset_tokens').insert({ user_id: userId, token: hashResetToken(token), expires_at: expiresAt, used: false });
  },

  async findValidResetToken(token) {
    return db('password_reset_tokens')
      .where({ token: hashResetToken(token), used: false })
      .where('expires_at', '>', new Date())
      .first();
  },

  async markResetTokenUsed(trx, tokenId) {
    await (trx || db)('password_reset_tokens').where({ id: tokenId }).update({ used: true });
  },

  // Reset = new password + every outstanding reset token for the user spent +
  // sessions ended + failed-sign-in lockout cleared (an account auto-locked by the
  // old lock-until-admin rule is reactivated; an admin's deliberate lock and
  // suspended/deactivated accounts stay as they are).
  async resetPasswordInTransaction(userId, password_hash, tokenId) {
    await db.transaction(async (trx) => {
      // Legacy auto-lock marker: status 'locked' with the failure counter at the
      // threshold (an admin's deliberate lock never touches the counter).
      await trx('users').where({ id: userId, status: 'locked' }).where('failed_login_count', '>=', LEGACY_AUTOLOCK_COUNT)
        .update({ status: 'active', is_active: true, locked_at: null });
      await trx('users').where({ id: userId }).update({
        password_hash, updated_at: trx.fn.now(), password_changed_at: trx.fn.now(),
        failed_login_count: 0, locked_until: null, force_password_change: false,
      });
      await trx('password_reset_tokens').where({ user_id: userId, used: false }).update({ used: true });
      await trx('password_reset_tokens').where({ id: tokenId }).update({ used: true });
      await bumpTokenVersion(userId, trx);
    });
  },
};

module.exports = authRepository;
