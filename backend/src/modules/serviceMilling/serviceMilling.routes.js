const express = require('express');
const router = express.Router();
const controller = require('./serviceMilling.controller');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// Service-milling clients (the third-party rice owners) — mill-side perm, so the
// New Batch form's client picker works for Mill/Inventory users. Never exposes
// export customers.
router.get('/clients', authorize('service_milling', 'view'), controller.listClients);
router.post('/clients', authorize('service_milling', 'create_batch'), controller.createClient);

// Invoice/billing endpoints — gated by the invoice-side perms (Finance + Owner +
// Mill Manager), NOT service_milling.view (which is the milling/stock side). This
// is what keeps Finance to billing-only and Export out entirely.
router.get('/invoices', authorize('service_milling', 'view_invoice'), controller.listInvoices);
router.get('/invoices/:id', authorize('service_milling', 'view_invoice'), controller.getInvoice);
router.post(
  '/invoices',
  authorize('service_milling', 'create_invoice'),
  auditAction('create_service_invoice', 'service_milling_invoice', (req, data) => data?.id),
  controller.createInvoice,
);
router.post(
  '/invoices/:id/payments',
  authorize('service_milling', 'record_payment'),
  auditAction('record_service_payment', 'service_milling_invoice', (req) => req.params.id),
  controller.recordPayment,
);

// Dispatch — hand client-owned finished/by-product stock back to the client.
// Gated by the milling-side record_dispatch perm (not the invoice perms).
router.get('/batches/:id/dispatch-summary', authorize('service_milling', 'view'), controller.getDispatchSummary);
router.post(
  '/batches/:id/dispatches',
  authorize('service_milling', 'record_dispatch'),
  auditAction('service_dispatch', 'service_milling_dispatch', (req, data) => data?.id),
  controller.createDispatch,
);
router.delete(
  '/dispatches/:id',
  authorize('service_milling', 'record_dispatch'),
  auditAction('service_dispatch_reverse', 'service_milling_dispatch', (req) => req.params.id),
  controller.deleteDispatch,
);

module.exports = router;
