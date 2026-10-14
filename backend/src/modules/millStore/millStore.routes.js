const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const ownerApproval = require('../../middleware/ownerApproval');
const { requireIdempotencyKey } = require('../../middleware/idempotency');
const ctrl = require('./millStore.controller');
const { redactCostInResponses } = require('../../utils/costVisibility');

// Cost-blind roles (QC, Inventory Officer…) see store quantities, never what the
// stock cost (owner decision 2026-10-05; P1-12 follow-up). Purchase totals are
// named *_amount, so they are listed explicitly.
router.use(redactCostInResponses({ extraCostKeys: ['total_amount', 'original_amount', 'amount', 'line_total', 'subtotal'] }));

// Items
router.get('/items', authorize('mill_store', 'view'), ctrl.listItems);
router.get('/items/:id', authorize('mill_store', 'view'), ctrl.getItem);
router.post(
  '/items',
  authorize('mill_store', 'manage_items'),
  auditAction('create', 'mill_item'),
  ctrl.createItem
);
router.put(
  '/items/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('update', 'mill_item', (req) => req.params.id),
  ctrl.updateItem
);
router.delete(
  '/items/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('delete', 'mill_item', (req) => req.params.id),
  ctrl.deleteItem
);
// Stock write-offs and adjustments are approved by the Owner only (owner
// decision 2026-10-05). The gate is mill_store.approve_adjustment, held by Owner
// and Super Admin only — the same people the old hard-coded role list admitted.
const canApproveAdjustment = authorize('mill_store', 'approve_adjustment');

// Direct, audit-logged stock set. It skips the approval queue, so it is an
// Owner action — everyone else requests an adjustment instead.
router.put(
  '/items/:id/stock',
  canApproveAdjustment,
  auditAction('set_stock', 'mill_item', (req) => req.params.id),
  ctrl.setStock
);

// Consumption ratios
router.get('/ratios', authorize('mill_store', 'view'), ctrl.listRatios);
router.post(
  '/ratios',
  authorize('mill_store', 'manage_items'),
  auditAction('create', 'mill_consumption_ratio'),
  ctrl.createRatio
);
router.put(
  '/ratios/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('update', 'mill_consumption_ratio', (req) => req.params.id),
  ctrl.updateRatio
);
router.delete(
  '/ratios/:id',
  authorize('mill_store', 'manage_items'),
  auditAction('delete', 'mill_consumption_ratio', (req) => req.params.id),
  ctrl.deleteRatio
);

// Purchases
router.get('/purchases', authorize('mill_store', 'view'), ctrl.listPurchases);
router.get('/purchases/:id', authorize('mill_store', 'view'), ctrl.getPurchase);
router.post(
  '/purchases',
  authorize('mill_store', 'create_purchase'),
  requireIdempotencyKey, // money-creating: one record per submit (P2-12)
  auditAction('create', 'mill_purchase'),
  ctrl.createPurchase
);
// Paying is a finance action, not a store one: Mill Operators hold
// create_purchase and could settle purchases through here.
router.put(
  '/purchases/:id/pay',
  authorize('finance', 'confirm_payment'),
  requireIdempotencyKey,
  auditAction('update', 'mill_purchase', (req) => req.params.id),
  ctrl.updatePurchasePayment
);

// Stock
router.get('/stock', authorize('mill_store', 'view'), ctrl.getStockLevels);
router.get('/stock/alerts', authorize('mill_store', 'view'), ctrl.getStockAlerts);

// Item movement ledger
router.get('/items/:id/movements', authorize('mill_store', 'view'), ctrl.getItemMovements);

// Summary / dashboard
router.get('/summary', authorize('mill_store', 'view'), ctrl.getSummary);
router.get('/katta-summary', authorize('mill_store', 'view'), ctrl.getKattaSummary);
router.get('/forecast', authorize('mill_store', 'view'), ctrl.getForecast);

// Adjustments (approval-gated)
router.get('/adjustments', authorize('mill_store', 'view'), ctrl.listAdjustments);
router.post(
  '/adjustments',
  authorize('mill_store', 'request_adjustment'),
  auditAction('request', 'mill_stock_adjustment'),
  ctrl.requestAdjustment
);
router.put(
  '/adjustments/:id/approve',
  canApproveAdjustment,
  auditAction('approve', 'mill_stock_adjustment', (req) => req.params.id),
  ctrl.approveAdjustment
);
router.put(
  '/adjustments/:id/reject',
  canApproveAdjustment,
  auditAction('reject', 'mill_stock_adjustment', (req) => req.params.id),
  ctrl.rejectAdjustment
);

module.exports = router;
