const express = require('express');
const router = express.Router();
const controller = require('../../controllers/controlController');
const authorize = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const validate = require('../../middleware/validate');
const schemas = require('../../middleware/schemas');

// Each admin.manage_settings route here writes a row (scores, risk scores,
// RCAs, scenarios, snapshots, predictions, exceptions, approvals). It stays
// Owner/Super Admin, as before: these checked admin.create/update and
// finance.create, which were never seeded, so no other role could reach them.
// This names a real permission without widening access.

// ═══════════════════════════════════════════════════════════════════
// APPROVALS (Maker-Checker)
// ═══════════════════════════════════════════════════════════════════
router.get('/approvals/pending', authorize('admin', 'view'), controller.getPendingApprovals);
router.get('/approvals/requests', authorize('admin', 'view'), controller.getMyRequests);
router.post(
  '/approvals/submit',
  authorize('admin', 'manage_settings'),
  validate(schemas.submitApproval),
  auditAction('submit_approval', 'approval_queue'),
  controller.submitForApproval
);
router.put(
  '/approvals/:id/approve',
  authorize('admin', 'manage_settings'),
  auditAction('approve_request', 'approval_queue'),
  controller.approveRequest
);
router.put(
  '/approvals/:id/reject',
  authorize('admin', 'manage_settings'),
  validate(schemas.rejectApproval),
  auditAction('reject_request', 'approval_queue'),
  controller.rejectRequest
);

// ═══════════════════════════════════════════════════════════════════
// MARGIN ANALYSIS
// ═══════════════════════════════════════════════════════════════════
router.get('/margin/order/:id', authorize('finance', 'view'), controller.calculateOrderMargin);
router.get('/margin/comparison', authorize('finance', 'view'), controller.getMarginComparison);
router.post(
  '/margin/simulate',
  authorize('admin', 'manage_settings'),
  auditAction('pricing_simulation', 'pricing_simulations'),
  controller.simulatePricing
);

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/supplier-score/:id',
  authorize('admin', 'manage_settings'),
  auditAction('calculate_supplier_score', 'supplier_scores'),
  controller.calculateSupplierScore
);
router.get('/supplier-scoreboard', authorize('admin', 'view'), controller.getSupplierScoreboard);

// ═══════════════════════════════════════════════════════════════════
// CUSTOMER INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/customer-score/:id',
  authorize('admin', 'manage_settings'),
  auditAction('calculate_customer_score', 'customer_scores'),
  controller.calculateCustomerScore
);
router.get('/customer-scoreboard', authorize('admin', 'view'), controller.getCustomerScoreboard);
router.get('/customer-trends/:id', authorize('admin', 'view'), controller.getCustomerPaymentTrends);

// ═══════════════════════════════════════════════════════════════════
// MILLING INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/mill-performance/:id',
  authorize('admin', 'manage_settings'),
  auditAction('calculate_mill_performance', 'mill_performance'),
  controller.calculateMillPerformance
);
router.get('/recovery-analysis', authorize('admin', 'view'), controller.getRecoveryAnalysis);

// ═══════════════════════════════════════════════════════════════════
// STOCK COUNT / INVENTORY AUDIT
// ═══════════════════════════════════════════════════════════════════
router.get('/stock-counts', authorize('inventory', 'view'), controller.getStockCounts);
router.post(
  '/stock-counts',
  authorize('inventory', 'create'),
  auditAction('create_stock_count', 'stock_counts'),
  controller.createStockCount
);
router.get('/stock-counts/:id', authorize('inventory', 'view'), controller.getStockCountDetail);
router.put(
  '/stock-counts/:id/record',
  authorize('inventory', 'update'),
  auditAction('record_stock_count', 'stock_count_items'),
  controller.recordCountItem
);
router.put(
  '/stock-counts/:id/items/:itemId/review',
  authorize('inventory', 'update'),
  auditAction('review_stock_count_line', 'stock_count_items'),
  controller.reviewCountItem
);
router.put(
  '/stock-counts/:id/approve',
  authorize('inventory', 'update'),
  auditAction('approve_stock_count', 'stock_counts'),
  controller.approveStockCount
);

module.exports = router;
