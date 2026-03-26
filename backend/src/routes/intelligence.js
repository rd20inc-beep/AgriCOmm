const express = require('express');
const router = express.Router();
const controller = require('../controllers/intelligenceController');
const authorize = require('../middleware/rbac');
const auditAction = require('../middleware/audit');

// ═══════════════════════════════════════════════════════════════════
// EXCEPTION INBOX
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/exceptions/scan',
  authorize('admin', 'create'),
  auditAction('scan_exceptions', 'exception_inbox'),
  controller.scanExceptions
);
router.get('/exceptions/stats', authorize('admin', 'view'), controller.getExceptionStats);
router.get('/exceptions', authorize('admin', 'view'), controller.listExceptions);
router.put(
  '/exceptions/:id/acknowledge',
  authorize('admin', 'update'),
  auditAction('acknowledge_exception', 'exception_inbox'),
  controller.acknowledgeException
);
router.put(
  '/exceptions/:id/assign',
  authorize('admin', 'update'),
  auditAction('assign_exception', 'exception_inbox'),
  controller.assignException
);
router.put(
  '/exceptions/:id/resolve',
  authorize('admin', 'update'),
  auditAction('resolve_exception', 'exception_inbox'),
  controller.resolveException
);
router.put(
  '/exceptions/:id/snooze',
  authorize('admin', 'update'),
  auditAction('snooze_exception', 'exception_inbox'),
  controller.snoozeException
);
router.put(
  '/exceptions/:id/escalate',
  authorize('admin', 'update'),
  auditAction('escalate_exception', 'exception_inbox'),
  controller.escalateException
);

// ═══════════════════════════════════════════════════════════════════
// RISK MONITORING
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/risk/order/:id',
  authorize('finance', 'create'),
  auditAction('calculate_order_risk', 'risk_scores'),
  controller.calculateOrderRisk
);
router.post(
  '/risk/customer/:id',
  authorize('finance', 'create'),
  auditAction('calculate_customer_risk', 'risk_scores'),
  controller.calculateCustomerRisk
);
router.get('/risk/top-orders', authorize('finance', 'view'), controller.getTopRiskOrders);
router.get('/risk/top-customers', authorize('finance', 'view'), controller.getTopRiskCustomers);
router.get('/risk/dashboard', authorize('finance', 'view'), controller.getRiskDashboard);

// ═══════════════════════════════════════════════════════════════════
// ROOT CAUSE ANALYSIS
// ═══════════════════════════════════════════════════════════════════
router.post(
  '/rca/margin/:orderId',
  authorize('finance', 'create'),
  auditAction('analyze_margin_drop', 'root_cause_analyses'),
  controller.analyzeMarginDrop
);
router.post(
  '/rca/cost/:orderId',
  authorize('finance', 'create'),
  auditAction('analyze_cost_overrun', 'root_cause_analyses'),
  controller.analyzeCostOverrun
);
router.post(
  '/rca/yield/:batchId',
  authorize('admin', 'create'),
  auditAction('analyze_yield_loss', 'root_cause_analyses'),
  controller.analyzeYieldLoss
);
router.post(
  '/rca/payment/:orderId',
  authorize('finance', 'create'),
  auditAction('analyze_payment_delay', 'root_cause_analyses'),
  controller.analyzePaymentDelay
);
router.get('/rca', authorize('admin', 'view'), controller.listRootCauseAnalyses);

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
router.get('/dashboard', authorize('admin', 'view'), controller.getDashboardData);
router.get('/dashboard/drilldown/:kpi', authorize('admin', 'view'), controller.getKPIDrilldown);
router.post(
  '/dashboard/snapshot',
  authorize('admin', 'create'),
  auditAction('save_dashboard_snapshot', 'dashboard_snapshots'),
  controller.saveSnapshot
);
router.get('/dashboard/history', authorize('admin', 'view'), controller.getSnapshotHistory);

module.exports = router;
