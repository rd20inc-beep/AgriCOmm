const auditService = require('../services/auditService');

/**
 * Middleware factory that auto-logs actions to the audit trail.
 * Intercepts res.json to capture the response and log if successful.
 *
 * @param {string} action - The action name (e.g. 'confirm_advance', 'create')
 * @param {string} entityType - The entity type (e.g. 'export_order', 'user')
 * @param {Function} [getEntityId] - Optional function (req, data) => entityId. Defaults to req.params.id.
 */
function auditAction(action, entityType, getEntityId) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      if (data && data.success) {
        auditService
          .log({
            userId: req.user ? req.user.id : null,
            action,
            entityType,
            entityId: getEntityId ? getEntityId(req, data) : req.params.id,
            details: { body: req.body, result: data.data },
            ipAddress: req.ip,
          })
          .catch((err) => console.error('Audit log error:', err));
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = auditAction;
