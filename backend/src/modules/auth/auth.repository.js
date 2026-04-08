const db = require('../../config/database');

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
      .select('u.id', 'u.email', 'u.full_name', 'u.role_id', 'r.name as role', 'u.is_active', 'u.last_login', 'u.created_at')
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

  async updatePassword(userId, password_hash) {
    await db('users').where({ id: userId }).update({ password_hash, updated_at: db.fn.now() });
  },

  async updateProfile(userId, { full_name }) {
    const [user] = await db('users')
      .where({ id: userId })
      .update({ full_name, updated_at: db.fn.now() })
      .returning(['id', 'email', 'full_name', 'role_id']);
    return user;
  },

  async createPasswordResetToken(userId, token, expiresAt) {
    await db('password_reset_tokens').insert({ user_id: userId, token, expires_at: expiresAt });
  },

  async findValidResetToken(token) {
    return db('password_reset_tokens')
      .where({ token, used: false })
      .where('expires_at', '>', new Date())
      .first();
  },

  async markResetTokenUsed(trx, tokenId) {
    await (trx || db)('password_reset_tokens').where({ id: tokenId }).update({ used: true });
  },

  async resetPasswordInTransaction(userId, password_hash, tokenId) {
    await db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ password_hash, updated_at: trx.fn.now() });
      await trx('password_reset_tokens').where({ id: tokenId }).update({ used: true });
    });
  },
};

module.exports = authRepository;
