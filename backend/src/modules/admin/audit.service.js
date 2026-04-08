const db = require('../../config/database');

const auditService = {
  /**
   * Log an audit event.
   * @param {Object} params
   * @param {number} params.userId - The ID of the user performing the action
   * @param {string} params.action - The action performed (e.g. 'create', 'update', 'delete')
   * @param {string} params.entityType - The type of entity (e.g. 'export_order', 'user')
   * @param {string|number} params.entityId - The ID of the entity
   * @param {Object} params.details - Additional details about the action
   * @param {string} params.ipAddress - The IP address of the request
   * @param {Object} [params.db_instance] - Optional knex instance (for transactions)
   */
  async log({ userId, action, entityType, entityId, details, ipAddress, db_instance }) {
    const knex = db_instance || db;
    await knex('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      details: details ? JSON.stringify(details) : null,
      ip_address: ipAddress || null,
    });
  },

  /**
   * Get audit logs for a specific entity.
   */
  async getByEntity(entityType, entityId, limit = 50) {
    return db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where({ 'a.entity_type': entityType, 'a.entity_id': String(entityId) })
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit);
  },

  /**
   * Get audit logs for a specific user.
   */
  async getByUser(userId, limit = 50) {
    return db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.user_id', userId)
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit);
  },

  /**
   * Get recent audit logs.
   */
  async getRecent(limit = 100) {
    return db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit);
  },
};

module.exports = auditService;
