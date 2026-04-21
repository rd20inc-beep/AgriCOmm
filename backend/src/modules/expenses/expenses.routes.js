const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const ctrl = require('./expenses.controller');

router.get('/', authorize('finance', 'view'), ctrl.list);
router.get('/summary', authorize('finance', 'view'), ctrl.getSummary);
router.get('/categories', authorize('finance', 'view'), ctrl.getCategories);
router.get('/:id', authorize('finance', 'view'), ctrl.getById);

router.post(
  '/',
  authorize('finance', 'allocate_cost'),
  auditAction('create', 'business_expense'),
  ctrl.create
);

router.put(
  '/:id/pay',
  authorize('finance', 'confirm_payment'),
  auditAction('pay', 'business_expense', (req) => req.params.id),
  ctrl.markPaid
);

module.exports = router;
