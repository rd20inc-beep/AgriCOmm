/**
 * The notifications table is the ONE store a user's alerts are delivered to;
 * the header bell (NotificationBell.jsx) reads it (P5-01 / PLT-01, PLT-02).
 *
 * The other alert stores, and how they relate to it:
 *   alerts            automation scans' de-duplication ledger. Every NEW
 *                     finding is now also delivered here (automation.service
 *                     raiseAlert) — merged.
 *   AppContext.alerts React state nothing ever filled; the bell replaces it —
 *                     the shell drops it (merged by removal).
 *   exception_inbox   NOT merged: a work queue with its own lifecycle
 *                     (acknowledge / assign / snooze / escalate / resolve) on
 *                     /exceptions; flattening it into read/unread would lose
 *                     that workflow.
 *   predictive_alerts NOT merged: model output reviewed on /intelligence.
 *   finance alerts,   NOT merged: computed live from current balances / stock
 *   mill-store stock  (no rows) — copying them into notifications would leave
 *   alerts            stale copies once the condition clears.
 */
const db = require('../config/database');
const { loadAccess } = require('./accessContext');
const { resolveLinks } = require('./notificationLinks');

// Recipients are always resolved by role NAME or by PERMISSION — never by role
// id: ids differ between installs (Owner is 9 on prod, 10 locally), so a
// hard-coded id notifies the wrong people or nobody (PLT-15).
const BYPASS_ROLES = ['Super Admin', 'Owner'];

const uniq = (ids) => [...new Set(ids.filter((v) => v != null))];

async function insertFor(conn, userIds, { title, message, type, linkedRef, link }) {
  const out = [];
  for (const userId of uniq(userIds)) {
    const [row] = await conn('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        type: type || 'info',
        linked_ref: linkedRef || null,
        link: link || null,
      })
      .returning('*');
    out.push(row);
  }
  return out;
}

const notificationService = {
  /** Active users holding any of the named roles, oldest account first. */
  async usersInRoles(trx, roleNames) {
    const conn = trx || db;
    const names = [...new Set([].concat(roleNames || []).filter(Boolean))];
    const out = [];
    // Role by name, then its active users — two plain lookups per role.
    for (const name of names) {
      const role = await conn('roles').where({ name }).first();
      if (!role) continue;
      const users = await conn('users').where({ role_id: role.id, is_active: true });
      for (const u of users) out.push({ id: u.id, email: u.email, full_name: u.full_name, role_name: name });
    }
    return out.sort((a, b) => a.id - b.id);
  },

  /**
   * Active users who pass authorize(module, action): a role granted the
   * permission, plus Owner / Super Admin (who pass every authorize check). A
   * user whose module allow-list (user_scopes) excludes the module is left out.
   */
  async usersWithPermission(trx, module, action) {
    const conn = trx || db;
    const rows = await conn('users as u')
      .join('roles as r', 'u.role_id', 'r.id')
      .where('u.is_active', true)
      .where((q) => q.whereIn('r.name', BYPASS_ROLES).orWhereExists(function granted() {
        this.select(conn.raw('1')).from('role_permissions as rp')
          .join('permissions as p', 'rp.permission_id', 'p.id')
          .whereRaw('rp.role_id = u.role_id')
          .where({ 'p.module': module, 'p.action': action });
      }))
      .orderBy('u.id')
      .select('u.id', 'u.email', 'u.full_name', 'r.name as role_name');
    if (!rows.length) return rows;
    const scoped = await conn('user_scopes')
      .whereIn('user_id', rows.map((r) => r.id)).where('scope_type', 'module')
      .select('user_id', 'scope_value');
    if (!scoped.length) return rows;
    const byUser = new Map();
    for (const s of scoped) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, new Set());
      byUser.get(s.user_id).add(s.scope_value);
    }
    return rows.filter((r) => BYPASS_ROLES.includes(r.role_name)
      || !byUser.has(r.id) || byUser.get(r.id).has(module));
  },

  async create(trx, { userId, title, message, type, linkedRef, link }) {
    const [notification] = await insertFor(trx || db, [userId], { title, message, type, linkedRef, link });
    return notification;
  },

  /** One notification per active user in the role(s). `roleName` or `roleNames`. */
  async createForRole(trx, { roleName, roleNames, title, message, type, linkedRef, link }) {
    const conn = trx || db;
    const users = await this.usersInRoles(conn, roleNames || roleName);
    return insertFor(conn, users.map((u) => u.id), { title, message, type, linkedRef, link });
  },

  /**
   * One notification per active user who can perform `permission`
   * ([module, action]) — e.g. everyone who may approve a store adjustment.
   * `excludeUserId` skips the person who caused the event.
   */
  async createForPermission(trx, { permission, excludeUserId, title, message, type, linkedRef, link }) {
    const conn = trx || db;
    const [module, action] = permission;
    const users = await this.usersWithPermission(conn, module, action);
    const ids = users.map((u) => u.id).filter((id) => excludeUserId == null || Number(id) !== Number(excludeUserId));
    return insertFor(conn, ids, { title, message, type, linkedRef, link });
  },

  // Domain-separation guardrail (Phase 4). The ONLY sanctioned way to alert the
  // Finance Manager: always a 'payment'-type alert, and the caller MUST pass a
  // pre-masked message — no customer name, export order number, rice type, or
  // internal stock/production context. Inventory/production/order alerts must go
  // to Mill Manager / Owner / Export Manager instead, never here.
  async notifyFinance(conn, { title, message, linkedRef }) {
    return this.createForRole(conn, { roleName: 'Finance Manager', title, message, type: 'payment', linkedRef: linkedRef || null });
  },

  // Scoped to the owner (P1-11): marking someone else's notification read is
  // a no-op that returns undefined (→ 404), not a cross-user write.
  async markRead(notificationId, userId) {
    if (userId == null) return undefined;
    const [notification] = await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .update({ is_read: true })
      .returning('*');
    return notification;
  },

  async markAllRead(userId) {
    const count = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .update({ is_read: true });
    return { updated: count };
  },

  async getUnread(userId) {
    const notifications = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .orderBy('created_at', 'desc');
    return notifications;
  },

  /**
   * A user's notifications, newest first, each with `link` — the page it
   * opens, only when this user may open that page (else null).
   */
  async getAll(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pg - 1) * lim;
    const base = () => {
      const q = db('notifications').where({ user_id: userId });
      if (unreadOnly) q.where('is_read', false);
      return q;
    };

    const [rows, countResult, unreadResult, access] = await Promise.all([
      base().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(lim).offset(offset),
      base().count('id as total').first(),
      db('notifications').where({ user_id: userId, is_read: false }).count('id as c').first(),
      loadAccess(userId),
    ]);
    const notifications = await resolveLinks(rows, access);
    const total = parseInt(countResult.total, 10) || 0;

    return {
      notifications,
      unread: parseInt(unreadResult.c, 10) || 0,
      pagination: {
        page: pg,
        limit: lim,
        total,
        totalPages: Math.ceil(total / lim),
      },
    };
  },

  async getCount(userId) {
    const result = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .count('id as count')
      .first();
    return parseInt(result.count, 10);
  },
};

module.exports = notificationService;
