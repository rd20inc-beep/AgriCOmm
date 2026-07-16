const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const controller = require('../../controllers/exportOrderController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const ownerApproval = require('../../middleware/ownerApproval');

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
// Literal paths before /:id so they aren't captured as an order id.
router.get('/pending-receipts', authorize('finance', 'view'), controller.listPendingExportReceipts);
// Export-ready stock pool (redacted for export users). Batch 4.
router.get('/available-stock', authorizeAny(['export_orders', 'view'], ['inventory', 'view']), controller.listExportReadyStock);
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
  '/:id/cancel',
  authorize('export_orders', 'approve'),
  ownerApproval('export_cancel'),
  auditAction('cancel', 'export_order', (req) => req.params.id),
  controller.cancelOrder
);
router.post(
  '/:id/confirm-advance',
  authorizeAny(['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']),
  ownerApproval('export_advance'),
  validate(schemas.confirmAdvance),
  auditAction('confirm_advance', 'export_order', (req) => req.params.id),
  controller.confirmAdvance
);
router.post(
  '/:id/confirm-balance',
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  ownerApproval('export_balance'),
  validate(schemas.confirmBalance),
  auditAction('confirm_balance', 'export_order', (req) => req.params.id),
  controller.confirmBalance
);

// ── Export receipt: record (pending) → Finance confirms with FX (item 14) ──
// Export/any records a PENDING receipt (no posting). Finance confirms → posts.
// (GET /pending-receipts is registered above, before /:id.)
router.post(
  '/:id/record-receipt',
  authorizeAny(['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']),
  validate(schemas.recordExportReceipt),
  auditAction('record_export_receipt', 'export_order', (req) => req.params.id),
  controller.recordExportReceipt
);
router.post(
  '/receipts/:paymentId/confirm',
  authorize('finance', 'confirm_payment'),
  ownerApproval('export_advance'),
  validate(schemas.confirmExportReceipt),
  auditAction('confirm_export_receipt', 'payment', (req) => req.params.paymentId),
  controller.confirmExportReceipt
);
router.post(
  '/receipts/:paymentId/reject',
  authorize('finance', 'confirm_payment'),
  auditAction('reject_export_receipt', 'payment', (req) => req.params.paymentId),
  controller.rejectExportReceipt
);
router.post(
  '/:id/allocate-stock',
  // Export can allocate; the mill can also fulfil an order from its own finished
  // stock (then the export manager is notified).
  authorizeAny(['export_orders', 'edit'], ['milling', 'edit']),
  validate(schemas.allocateExportStock),
  auditAction('allocate_stock', 'export_order', (req) => req.params.id),
  controller.allocateStock
);

// Packed-weight variance (Phase 1). The mill records the actual packed net rice +
// packing-material weight; the system computes gross + variance vs the order qty.
router.get('/:id/packing-weight', authorizeAny(['export_orders', 'view'], ['milling', 'view']), controller.getPackingWeight);
router.put(
  '/:id/packing-weight',
  authorize('milling', 'edit'),
  validate(schemas.exportPackingWeight),
  auditAction('packing_weight', 'export_order', (req) => req.params.id),
  controller.upsertPackingWeight
);
// Proactive material requirements — compute needed bags/masters/poly/pallets vs
// stock; raise Purchase Requirements for the shortages.
router.get('/:id/material-requirements', authorizeAny(['export_orders', 'view'], ['milling', 'view'], ['inventory', 'view']), controller.getMaterialRequirements);
router.post(
  '/:id/material-requirements/raise',
  authorizeAny(['milling', 'edit'], ['inventory', 'create'], ['mill_store', 'create_purchase']),
  auditAction('raise_material_requirements', 'export_order', (req) => req.params.id),
  controller.raiseMaterialRequirements
);

router.post(
  '/:id/packing-weight/resolve',
  authorize('export_orders', 'edit'),
  ownerApproval('packing_variance'),
  auditAction('packing_weight_resolve', 'export_order', (req) => req.params.id),
  controller.resolvePackingWeight
);

// Document generation
const docController = require('../../controllers/exportDocumentController');
router.get('/:id/documents/available', authorize('export_orders', 'view'), docController.available);
router.get('/:id/documents/generate/:docType', authorize('export_orders', 'view'), docController.generate);

// Persisted / versioned generated documents (Phase E).
const genDocController = require('../../modules/documents/generatedDocument.controller');
router.put('/:id/documents/customer-style', authorize('export_orders', 'edit'), validate(schemas.documentCustomerStyle), genDocController.saveCustomerStyle);
router.post('/:id/documents/:docType/draft', authorize('export_orders', 'view'), genDocController.createDraft);
router.get('/:id/documents/:docType/current', authorize('export_orders', 'view'), genDocController.getCurrent);
router.post('/:id/documents/:docType/send-whatsapp', authorize('export_orders', 'send_email'), validate(schemas.sendDocumentWhatsApp), genDocController.sendWhatsApp);
router.get('/:id/documents/:docType/versions', authorize('export_orders', 'view'), genDocController.listVersions);
router.put('/documents/:genId/overrides', authorize('export_orders', 'edit'), validate(schemas.saveDocumentOverrides), genDocController.saveOverrides);
router.put('/documents/:genId/settings', authorize('export_orders', 'edit'), validate(schemas.documentSettings), genDocController.updateSettings);
router.put('/documents/:genId/submit', authorize('export_orders', 'edit'), genDocController.submit);
router.put('/documents/:genId/approve', authorize('documents', 'approve'), genDocController.approve);
router.put('/documents/:genId/status', authorize('export_orders', 'edit'), validate(schemas.documentStatus), genDocController.setStatus);
router.post('/documents/:genId/revise', authorize('export_orders', 'edit'), validate(schemas.documentRevise), genDocController.revise);
router.get('/documents/:genId', authorize('export_orders', 'view'), genDocController.getVersion);

module.exports = router;
