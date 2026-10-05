const express = require('express');
const router = express.Router();
const controller = require('../../controllers/localSalesController');
const { authorize, authorizeRole, authorizeAny } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// Admin invoice copy exposes internal cost/margin — restrict to these roles.
// (Owner & Super Admin must be listed explicitly; authorizeRole has no bypass.)
const ADMIN_INVOICE_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];
// A local sale releases stock/revenue only once a Mill Manager or Owner confirms
// it (Batch 6 · item 9). Same roles may reject a pending sale.
const CONFIRM_ROLES = ['Super Admin', 'Owner', 'Mill Manager'];

// READ routes accept inventory.view OR finance.view — a payments-only Finance
// Manager gets read-only Local Sales (to match what they see in Money In) without
// gaining broad inventory access. Write routes below stay inventory/mill-gated.
const canReadSales = authorizeAny(['inventory', 'view'], ['finance', 'view']);
router.get('/', canReadSales, controller.list);
router.get('/summary', canReadSales, controller.summary);
router.get('/pending', canReadSales, controller.listPending);
// Selling-rate suggestion for a lot from the Rates Center (LS-10). Read-only.
router.get('/rate-suggestion', canReadSales, controller.rateSuggestion);
router.get('/:id', canReadSales, controller.getById);
router.post(
  '/',
  authorize('inventory', 'create'),
  auditAction('create_local_sale', 'local_sale'),
  controller.create
);
// Edit a sale. Presentation fields on any sale; quantity/rate only while Pending
// (see controller.update). Same permission as recording one.
router.put('/:id', authorize('inventory', 'create'),
  auditAction('update_local_sale', 'local_sale', (req) => req.params.id),
  controller.update);

router.post('/:id/confirm', authorizeRole(...CONFIRM_ROLES), auditAction('confirm_local_sale', 'local_sale'), controller.confirmSale);
router.post('/:id/reject', authorizeRole(...CONFIRM_ROLES), auditAction('reject_local_sale', 'local_sale'), controller.rejectSale);
router.post(
  '/:id/payments',
  // Recording a receipt against a local-sale receivable is a FINANCE action, so a
  // payments-only Finance Manager (finance.confirm_payment) must be able to do it
  // from Money In — not only inventory/mill roles (inventory.create). The Mill
  // Operator (milling.edit) takes receipts on MILL sales only, through a mill
  // account — enforced in the handler (shared/millPayer).
  authorizeAny(['inventory', 'create'], ['finance', 'confirm_payment'], ['milling', 'edit']),
  auditAction('accept_local_sale_payment', 'local_sale'),
  controller.acceptPayment
);
// One receipt for a whole multi-item sale, split across its lines (LS-08).
// Same permission as the per-line receipt above.
router.post(
  '/group/:groupNo/payments',
  authorizeAny(['inventory', 'create'], ['finance', 'confirm_payment'], ['milling', 'edit']),
  auditAction('accept_local_sale_group_payment', 'local_sale', (req) => req.params.groupNo),
  controller.acceptGroupPayment
);
router.get('/:id/payments', canReadSales, controller.getPayments);
router.get('/:id/invoice', canReadSales, controller.getInvoice);
router.get('/:id/invoice-admin', authorizeRole(...ADMIN_INVOICE_ROLES), controller.getInvoiceAdmin);
router.post('/:id/email-invoice', authorize('inventory', 'create'), controller.emailInvoice);

module.exports = router;
