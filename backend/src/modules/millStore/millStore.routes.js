const express = require('express');
const router = express.Router();
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const ownerApproval = require('../../middleware/ownerApproval');
const { requireIdempotencyKey } = require('../../middleware/idempotency');
const ctrl = require('./millStore.controller');
const db = require('../../config/database');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');
const { voidStorePurchase } = require('./storePurchaseVoid');
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
// Revaluing the stock on hand moves 1250, so the Owner approves it (INV-46).
router.put(
  '/items/:id/revalue',
  authorize('mill_store', 'manage_items'),
  ownerApproval('mill_item_revaluation'),
  auditAction('revalue', 'mill_item', (req) => req.params.id),
  ctrl.revalueItem
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
// Void a store purchase entered by mistake (P3-11, D-23): stock, payable and
// GL back out by signed deltas, the purchase kept on record. Unpaid and still
// in the store only — see storePurchaseVoid.js. The Owner approves it.
router.post(
  '/purchases/:id/void',
  authorize('mill_store', 'create_purchase'),
  ownerApproval('store_purchase_void'),
  validate(schemas.voidPurchase),
  auditAction('void', 'mill_purchase', (req) => req.params.id),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(404).json({ success: false, message: 'Purchase not found.' });
      const result = await db.transaction((trx) => voidStorePurchase(trx, id, {
        reason: req.body.reason, userId: req.user?.id || null, ownerId: req.ownerAuth?.ownerId || null,
      }));
      return res.json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || err.status || 500;
      if (status >= 500) console.error('void store purchase error:', err);
      return res.status(status).json({ success: false, message: status >= 500 ? 'Internal server error.' : err.message });
    }
  }
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
