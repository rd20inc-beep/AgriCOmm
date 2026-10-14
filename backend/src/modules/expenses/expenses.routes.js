const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const { requireIdempotencyKey } = require('../../middleware/idempotency');
const ctrl = require('./expenses.controller');

router.get('/', authorize('finance', 'view'), ctrl.list);
router.get('/summary', authorize('finance', 'view'), ctrl.getSummary);
router.get('/categories', authorize('finance', 'view'), ctrl.getCategories);
router.get('/:id', authorize('finance', 'view'), ctrl.getById);

router.post(
  '/',
  authorize('finance', 'allocate_cost'),
  requireIdempotencyKey, // money-creating: one record per submit (P2-12)
  auditAction('create', 'business_expense'),
  ctrl.create
);

// Attach (or clear) the supplier on an expense recorded without one, so it
// reaches that supplier's ledger. Behind allocate_cost — it decides whose ledger
// the money lands on, not whether it was paid — and audited.
router.put(
  '/:id/supplier',
  authorize('finance', 'allocate_cost'),
  auditAction('link_supplier', 'business_expense', (req) => req.params.id),
  ctrl.linkSupplier
);

router.put(
  '/:id/pay',
  authorize('finance', 'confirm_payment'),
  requireIdempotencyKey,
  auditAction('pay', 'business_expense', (req) => req.params.id),
  ctrl.markPaid
);

module.exports = router;
