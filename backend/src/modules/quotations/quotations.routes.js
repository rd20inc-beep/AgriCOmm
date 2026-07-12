const express = require('express');
const router = express.Router();
const controller = require('./quotations.controller');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// Quotations are a pre-order sales artefact for export customers — gated by the
// same export_orders permissions (view to read, create to author/convert, edit
// to amend / change status). No new permission module, so Export Managers and
// owners already have access.
router.get('/', authorize('export_orders', 'view'), controller.list);
router.get('/:id', authorize('export_orders', 'view'), controller.getById);

router.post(
  '/',
  authorize('export_orders', 'create'),
  auditAction('create_quotation', 'export_quotation', (req, data) => data?.data?.quotation?.id),
  controller.create,
);

router.put(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('update_quotation', 'export_quotation', (req) => req.params.id),
  controller.update,
);

router.put(
  '/:id/status',
  authorize('export_orders', 'edit'),
  auditAction('quotation_status', 'export_quotation', (req) => req.params.id),
  controller.updateStatus,
);

router.post(
  '/:id/convert',
  authorize('export_orders', 'create'),
  auditAction('convert_quotation', 'export_quotation', (req) => req.params.id),
  controller.convert,
);

router.delete(
  '/:id',
  authorize('export_orders', 'edit'),
  auditAction('delete_quotation', 'export_quotation', (req) => req.params.id),
  controller.remove,
);

module.exports = router;
