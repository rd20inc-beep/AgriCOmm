const express = require('express');
const router = express.Router();
const db = require('../config/database');
const controller = require('../controllers/exportOrderController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

/**
 * Authorize if user has ANY of the listed module.action permissions.
 * Used for payment confirmation which can be done by export or finance users.
 */
function authorizeAny(...permPairs) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    try {
      // Super Admin bypass
      const role = await db('roles').where({ id: req.user.role_id }).select('name').first();
      if (role && role.name === 'Super Admin') return next();

      // Load permissions if not cached
      if (!req.user._permissionsLoaded) {
        const perms = await db('role_permissions as rp')
          .join('permissions as p', 'rp.permission_id', 'p.id')
          .where('rp.role_id', req.user.role_id)
          .select('p.module', 'p.action');
        req.user.permissions = new Set(perms.map((p) => `${p.module}.${p.action}`));
        req.user._permissionsLoaded = true;
      }

      const allowed = permPairs.some(([mod, act]) => req.user.permissions.has(`${mod}.${act}`));
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'Forbidden.' });
      }
      next();
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Authorization error.' });
    }
  };
}

router.get('/', authorize('export_orders', 'view'), controller.list);
router.get('/:id', authorize('export_orders', 'view'), controller.getById);
router.post(
  '/',
  authorize('export_orders', 'create'),
  validate(schemas.createExportOrder),
  auditAction('create', 'export_order', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.create
);
router.put(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('update', 'export_order', (req) => req.params.id),
  controller.update
);
router.put(
  '/:id/status',
  authorize('export_orders', 'approve'),
  auditAction('update_status', 'export_order', (req) => req.params.id),
  controller.updateStatus
);
router.put(
  '/:id/shipment',
  authorize('export_orders', 'approve'),
  validate(schemas.updateExportShipment),
  auditAction('update_shipment', 'export_order', (req) => req.params.id),
  controller.updateShipment
);
router.post(
  '/:id/start-docs',
  authorize('export_orders', 'approve'),
  validate(schemas.exportOrderAction),
  auditAction('start_docs', 'export_order', (req) => req.params.id),
  controller.startDocsPreparation
);
router.post(
  '/:id/request-balance',
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  validate(schemas.exportOrderAction),
  auditAction('request_balance', 'export_order', (req) => req.params.id),
  controller.requestBalance
);
router.post(
  '/:id/documents/upload',
  authorize('export_orders', 'edit'),
  validate(schemas.exportOrderDocumentAction),
  auditAction('upload_document', 'export_order', (req) => req.params.id),
  controller.uploadDocument
);
router.post(
  '/:id/documents/approve',
  authorize('export_orders', 'edit'),
  validate(schemas.exportOrderDocumentAction),
  auditAction('approve_document', 'export_order', (req) => req.params.id),
  controller.approveDocument
);
router.post(
  '/:id/documents/finalize',
  authorize('export_orders', 'edit'),
  validate(schemas.exportOrderDocumentAction),
  auditAction('finalize_document', 'export_order', (req) => req.params.id),
  controller.finalizeDocument
);
router.post(
  '/:id/costs',
  authorize('export_orders', 'edit'),
  auditAction('add_cost', 'export_order', (req) => req.params.id),
  controller.addCost
);
router.post(
  '/:id/confirm-advance',
  authorizeAny(['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']),
  auditAction('confirm_advance', 'export_order', (req) => req.params.id),
  controller.confirmAdvance
);
router.post(
  '/:id/confirm-balance',
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  auditAction('confirm_balance', 'export_order', (req) => req.params.id),
  controller.confirmBalance
);

module.exports = router;
