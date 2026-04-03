const express = require('express');
const router = express.Router();
const controller = require('../controllers/financeController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');
const validate = require('../middleware/validate');
const schemas = require('../middleware/schemas');

router.get('/receivables', authorize('finance', 'view'), controller.getReceivables);
router.get('/payables', authorize('finance', 'view'), controller.getPayables);
router.get('/journal-entries', authorize('finance', 'view'), controller.getJournalEntries);
router.get('/alerts', authorize('finance', 'view'), controller.getAlerts);
router.get('/overview', authorize('finance', 'view'), controller.getOverview);
router.post(
  '/payments',
  authorize('finance', 'confirm_payment'),
  validate(schemas.recordPayment),
  auditAction('record_payment', 'finance', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.recordPayment
);
router.get('/bank-accounts', authorize('finance', 'view'), controller.getBankAccounts);
router.get('/bank-transactions', authorize('finance', 'view'), controller.getBankTransactions);
router.get('/internal-transfers', authorize('finance', 'view'), controller.getInternalTransfers);
router.post(
  '/internal-transfers',
  authorize('finance', 'confirm_payment'),
  validate(schemas.createInternalTransfer),
  auditAction('create_internal_transfer', 'finance', (req, data) => data.data && data.data.id ? data.data.id : null),
  controller.createInternalTransfer
);

// Cost Allocations
router.get('/cost-allocations', authorize('finance', 'view'), controller.listCostAllocations);
router.post(
  '/cost-allocations',
  authorize('finance', 'confirm_payment'),
  auditAction('create_cost_allocation', 'cost_allocation'),
  controller.createCostAllocation
);
router.post(
  '/cost-allocations/:id/lines',
  authorize('finance', 'confirm_payment'),
  auditAction('add_allocation_line', 'cost_allocation', (req) => req.params.id),
  controller.addAllocationLine
);
router.delete(
  '/cost-allocations/:allocationId/lines/:lineId',
  authorize('finance', 'confirm_payment'),
  auditAction('remove_allocation_line', 'cost_allocation', (req) => req.params.allocationId),
  controller.removeAllocationLine
);

module.exports = router;
