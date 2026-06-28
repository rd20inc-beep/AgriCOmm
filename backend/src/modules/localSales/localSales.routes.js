const express = require('express');
const router = express.Router();
const controller = require('../../controllers/localSalesController');
const { authorize, authorizeRole } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');

// Admin invoice copy exposes internal cost/margin — restrict to these roles.
// (Owner & Super Admin must be listed explicitly; authorizeRole has no bypass.)
const ADMIN_INVOICE_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];

router.get('/', authorize('inventory', 'view'), controller.list);
router.get('/summary', authorize('inventory', 'view'), controller.summary);
router.get('/:id', authorize('inventory', 'view'), controller.getById);
router.post(
  '/',
  authorize('inventory', 'create'),
  auditAction('create_local_sale', 'local_sale'),
  controller.create
);
router.post(
  '/:id/payments',
  authorize('inventory', 'create'),
  auditAction('accept_local_sale_payment', 'local_sale'),
  controller.acceptPayment
);
router.get('/:id/payments', authorize('inventory', 'view'), controller.getPayments);
router.get('/:id/invoice', authorize('inventory', 'view'), controller.getInvoice);
router.get('/:id/invoice-admin', authorizeRole(...ADMIN_INVOICE_ROLES), controller.getInvoiceAdmin);
router.post('/:id/email-invoice', authorize('inventory', 'create'), controller.emailInvoice);

module.exports = router;
