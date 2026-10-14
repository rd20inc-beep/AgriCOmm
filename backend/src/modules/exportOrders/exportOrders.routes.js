const express = require('express');
const router = express.Router();
const controller = require('../../controllers/exportOrderController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const ownerApproval = require('../../middleware/ownerApproval');

// The cancel route's Owner gate: the forfeit gate when the money received is
// being forfeited (P2-15 / D-7), the plain cancel gate otherwise.
function cancelOwnerApproval(forfeitGate, cancelGate) {
  const gate = (req, res, next) => (
    req.body && req.body.money_disposition === 'forfeit' ? forfeitGate : cancelGate
  )(req, res, next);
  gate.ownerApprovalGates = { forfeit: forfeitGate, other: cancelGate };
  return gate;
}

// Multi-permission gates use the shared rbac authorizeAny (Owner / Super Admin
// bypass and user module scopes, like every other gate). It replaces a local
// copy that only Super Admin bypassed.
const { authorizeAny, userHasPermission } = require('../../middleware/rbac');

// Closing an order is export_orders.close (granted by mig 339 to every
// export_orders.approve holder, so nobody who could close before is refused).
async function closeNeedsClosePermission(req, res, next) {
  if (req.body && req.body.status === 'Closed' && !(await userHasPermission(req, 'export_orders', 'close'))) {
    return res.status(403).json({ success: false, message: 'Forbidden. Closing an export order needs the close permission.' });
  }
  return next();
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
  // A Draft may leave quantities, prices, Incoterm and bank blank; anything
  // else gets the full schema. Submit re-validates the draft in full.
  (req, res, next) => validate(
    req.body && req.body.status === 'Draft' ? schemas.createExportOrderDraft : schemas.createExportOrder
  )(req, res, next),
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
  closeNeedsClosePermission,
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
// Submitting a draft is what creating a live order would have been, so it needs
// the create permission; the workflow re-validates everything at this point.
router.post(
  '/:id/submit',
  authorize('export_orders', 'create'),
  validate(schemas.exportOrderAction),
  auditAction('submit_draft', 'export_order', (req) => req.params.id),
  controller.submitDraft
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
  validate(schemas.addExportOrderCost),
  auditAction('add_cost', 'export_order', (req) => req.params.id),
  controller.addCost
);
router.post(
  '/:id/cancel',
  authorize('export_orders', 'approve'),
  // Cancelling is always Owner-authorised. Forfeiting money the buyer paid to
  // other income (D-7) is logged as its own kind of approval, so the Owner's
  // approval trail says that is what they authorised.
  cancelOwnerApproval(ownerApproval('export_cancel_forfeit'), ownerApproval('export_cancel')),
  validate(schemas.cancelExportOrder),
  auditAction('cancel', 'export_order', (req) => req.params.id),
  controller.cancelOrder
);
router.post(
  '/:id/confirm-advance',
  // Records AND posts in one step: needs finance.confirm_payment on top, and
  // the controller lets only an Owner / Super Admin through (maker-checker).
  authorizeAny(['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']),
  authorize('finance', 'confirm_payment'),
  validate(schemas.confirmAdvance),
  auditAction('confirm_advance', 'export_order', (req) => req.params.id),
  controller.confirmAdvance
);
router.post(
  '/:id/confirm-balance',
  // Records AND posts in one step: needs finance.confirm_payment on top, and
  // the controller lets only an Owner / Super Admin through (maker-checker).
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  authorize('finance', 'confirm_payment'),
  validate(schemas.confirmBalance),
  auditAction('confirm_balance', 'export_order', (req) => req.params.id),
  controller.confirmBalance
);

// ── Freight escalation debit notes ──
// Raised AFTER shipment, when the carrier's actual charge is known — which is
// why this is not an order edit: quantity, price and freight are locked by then.
// Issuing moves money the buyer owes, so it sits behind the same permission as
// confirming a balance rather than plain order edit.
router.get(
  '/:id/debit-notes',
  authorize('export_orders', 'view'),
  controller.listDebitNotes
);
router.post(
  '/:id/debit-notes',
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  validate(schemas.issueExportDebitNote),
  auditAction('issue_debit_note', 'export_order', (req) => req.params.id),
  controller.issueDebitNote
);
// Cancelling withdraws a claim already sent to the buyer and already in the GL,
// so it is owner-approved like the other reversals.
router.post(
  '/:id/debit-notes/:noteId/cancel',
  authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment']),
  ownerApproval('export_balance'),
  validate(schemas.cancelExportDebitNote),
  auditAction('cancel_debit_note', 'export_order', (req) => req.params.id),
  controller.cancelDebitNote
);

// ── Export receipt: record (pending) → Finance confirms with FX (item 14) ──
// Export/any records a PENDING receipt (no posting). Finance confirms → posts.
// Finance's confirmation is the whole control: an advance or balance receipt
// posts on it alone, with no Owner authorisation step (owner decision
// 2026-10-06). Same for confirm-advance / confirm-balance above. The permission
// check and the audit log stay.
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
  validate(schemas.confirmExportReceipt),
  auditAction('confirm_export_receipt', 'payment', (req) => req.params.paymentId),
  controller.confirmExportReceipt
);
router.post(
  '/receipts/:paymentId/reject',
  authorize('finance', 'confirm_payment'),
  validate(schemas.rejectExportReceipt),
  auditAction('reject_export_receipt', 'payment', (req) => req.params.paymentId),
  controller.rejectExportReceipt
);
// D-8: a short balance left after the last receipt (bank deductions the
// recorder did not enter, a buyer short-paying). Always Owner-approved.
router.post(
  '/:id/write-off-balance',
  authorize('finance', 'confirm_payment'),
  ownerApproval('export_short_write_off'),
  validate(schemas.writeOffExportBalance),
  auditAction('write_off_balance', 'export_order', (req) => req.params.id),
  controller.writeOffBalance
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
// #3 Fully-sourced-from-stock: skip milling and go straight to Documentation
// when active reservations cover the whole order (guarded server-side).
router.post(
  '/:id/source-from-stock',
  authorizeAny(['export_orders', 'edit'], ['milling', 'edit']),
  auditAction('source_from_stock', 'export_order', (req) => req.params.id),
  controller.sourceFromStock
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
// Download a selection of documents as one ZIP (stored files + generated PDFs).
router.post(
  '/:id/documents/bundle',
  authorize('export_orders', 'view'),
  validate(schemas.bundleDocuments),
  require('../../modules/documents/bundle.controller').bundle
);
router.get('/:id/documents/generate/:docType', authorize('export_orders', 'view'), docController.generate);

// Persisted / versioned generated documents (Phase E).
const genDocController = require('../../modules/documents/generatedDocument.controller');
router.put('/:id/documents/customer-style', authorize('export_orders', 'edit'), auditAction('set_customer_style', 'generated_document'), validate(schemas.documentCustomerStyle), genDocController.saveCustomerStyle);
// P1-08 / EXP-13: previewing writes nothing. A viewer previews through GET
// /current (an existing version) or GET /generate (a stateless render); a
// version row — and its GD number — is created only when someone who can edit
// documents first saves, changes a setting or stores the rendering.
const canEditDocuments = authorize.authorizeAny(['export_orders', 'edit'], ['documents', 'edit']);
router.post('/:id/documents/:docType/draft', canEditDocuments, auditAction('create_draft', 'generated_document'), genDocController.createDraft);
router.get('/:id/documents/:docType/current', authorize('export_orders', 'view'), genDocController.getCurrent);
// P1-08 / EXP-12: PDF and send render the STORED version on the server — the
// request carries no HTML. Sending needs an Approved version (Proforma Invoice
// excepted, D-30); the PDF needs the documents download permission on top of
// order view.
router.post('/:id/documents/:docType/send-whatsapp', authorize('export_orders', 'send_email'), auditAction('send_whatsapp', 'generated_document'), validate(schemas.sendDocumentWhatsApp), genDocController.sendWhatsApp);
router.post('/:id/documents/:docType/send-email', authorize('export_orders', 'send_email'), auditAction('send_email', 'generated_document'), validate(schemas.sendDocumentEmail), genDocController.sendEmail);
router.post('/:id/documents/:docType/pdf', authorize('export_orders', 'view'), authorize('documents', 'download'), validate(schemas.downloadDocumentPdf), genDocController.downloadPdf);
router.get('/:id/documents/:docType/versions', authorize('export_orders', 'view'), genDocController.listVersions);
router.put('/documents/:genId/overrides', authorize('export_orders', 'edit'), auditAction('set_overrides', 'generated_document', (req) => req.params.genId), validate(schemas.saveDocumentOverrides), genDocController.saveOverrides);
router.put('/documents/:genId/rendering', canEditDocuments, auditAction('set_rendering', 'generated_document', (req) => req.params.genId), validate(schemas.saveDocumentRendering), genDocController.saveRendering);
router.put('/documents/:genId/settings', authorize('export_orders', 'edit'), auditAction('set_settings', 'generated_document', (req) => req.params.genId), validate(schemas.documentSettings), genDocController.updateSettings);
router.put('/documents/:genId/submit', authorize('export_orders', 'edit'), auditAction('submit', 'generated_document', (req) => req.params.genId), genDocController.submit);
router.put('/documents/:genId/approve', authorize('documents', 'approve'), auditAction('approve', 'generated_document', (req) => req.params.genId), validate(schemas.documentApprove), genDocController.approve);
router.put('/documents/:genId/status', authorize('export_orders', 'edit'), auditAction('set_status', 'generated_document', (req) => req.params.genId), validate(schemas.documentStatus), genDocController.setStatus);
router.post('/documents/:genId/revise', authorize('export_orders', 'edit'), auditAction('revise', 'generated_document', (req) => req.params.genId), validate(schemas.documentRevise), genDocController.revise);
router.get('/documents/:genId', authorize('export_orders', 'view'), genDocController.getVersion);

module.exports = router;
