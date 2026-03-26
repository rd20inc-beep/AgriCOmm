const db = require('../config/database');

const notificationService = {
  async create(trx, { userId, title, message, type, linkedRef }) {
    const conn = trx || db;
    const [notification] = await conn('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        type: type || 'info',
        linked_ref: linkedRef || null,
      })
      .returning('*');
    return notification;
  },

  async createForRole(trx, { roleName, title, message, type, linkedRef }) {
    const conn = trx || db;
    const role = await conn('roles').where({ name: roleName }).first();
    if (!role) return [];

    const users = await conn('users').where({ role_id: role.id, is_active: true });
    const notifications = [];

    for (const user of users) {
      const [notification] = await conn('notifications')
        .insert({
          user_id: user.id,
          title,
          message,
          type: type || 'info',
          linked_ref: linkedRef || null,
        })
        .returning('*');
      notifications.push(notification);
    }

    return notifications;
  },

  async markRead(notificationId) {
    const [notification] = await db('notifications')
      .where({ id: notificationId })
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

  async getAll(userId, { page = 1, limit = 20 } = {}) {
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const countQuery = db('notifications')
      .where({ user_id: userId })
      .count('id as total')
      .first();

    const [notifications, countResult] = await Promise.all([
      db('notifications')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  async getCount(userId) {
    const result = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .count('id as count')
      .first();
    return parseInt(result.count);
  },
};

module.exports = notificationService;
