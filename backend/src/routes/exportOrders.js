const express = require('express');
const router = express.Router();
const controller = require('../controllers/exportOrderController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

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
router.post(
  '/:id/costs',
  authorize('export_orders', 'edit'),
  auditAction('add_cost', 'export_order', (req) => req.params.id),
  controller.addCost
);
router.post(
  '/:id/documents',
  authorize('export_orders', 'edit'),
  auditAction('add_document', 'export_order', (req) => req.params.id),
  controller.addDocument
);
router.post(
  '/:id/confirm-advance',
  authorize('export_orders', 'confirm_advance'),
  auditAction('confirm_advance', 'export_order', (req) => req.params.id),
  controller.confirmAdvance
);
router.post(
  '/:id/confirm-balance',
  authorize('export_orders', 'confirm_balance'),
  auditAction('confirm_balance', 'export_order', (req) => req.params.id),
  controller.confirmBalance
);

module.exports = router;
