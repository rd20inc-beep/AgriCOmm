const db = require('../../config/database');
const { redactSecrets, redactDetails } = require('../../utils/redactSecrets');

// Read-side redaction: rows written before secrets were stripped at write time
// (and any a future caller forgets) must not leak through the audit readers.
const redactRows = (rows) => rows.map((r) => (r && r.details != null ? { ...r, details: redactDetails(r.details) } : r));

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
   *
   * `details` is passed through redactSecrets(): every secret-named key
   * (password, pin, *_key, token, secret, credentials, …) is stored as
   * "[REDACTED]". This is the single choke point for the auditAction middleware
   * and every direct auditService.log() caller.
   */
  async log({ userId, action, entityType, entityId, details, ipAddress, db_instance }) {
    const knex = db_instance || db;
    await knex('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      details: details ? JSON.stringify(redactSecrets(details)) : null,
      ip_address: ipAddress || null,
    });
  },

  /**
   * Write the audit row INSIDE the caller's transaction (P2-30), so it commits
   * with the change it records and rolls back with it — a rolled-back change
   * leaves no audit row, a committed one leaves exactly one. It is awaited and
   * NOT caught: if the audit row cannot be written, the change is not saved.
   *
   * Marks the request (req.auditedInTrx) so the route's auditAction middleware
   * does not write a second, after-the-fact row for the same request. Details
   * default to the same { body, result } shape the middleware writes.
   */
  async logInTrx(trx, req, { action, entityType, entityId, details, result }) {
    if (req) req.auditedInTrx = true;
    await auditService.log({
      userId: req?.user ? req.user.id : null,
      action,
      entityType,
      entityId,
      details: details || { body: req?.body, result },
      ipAddress: req?.ip,
      db_instance: trx,
    });
  },

  /**
   * Get audit logs for a specific entity.
   */
  async getByEntity(entityType, entityId, limit = 50) {
    return redactRows(await db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where({ 'a.entity_type': entityType, 'a.entity_id': String(entityId) })
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit));
  },

  /**
   * Get audit logs for a specific user.
   */
  async getByUser(userId, limit = 50) {
    return redactRows(await db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .where('a.user_id', userId)
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit));
  },

  /**
   * Get recent audit logs.
   */
  async getRecent(limit = 100) {
    return redactRows(await db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .select('a.*', 'u.full_name as user_name', 'u.email as user_email')
      .orderBy('a.created_at', 'desc')
      .limit(limit));
  },
};

auditService.redactRows = redactRows;

module.exports = auditService;
