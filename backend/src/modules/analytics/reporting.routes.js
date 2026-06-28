const express = require('express');
const router = express.Router();
const controller = require('../../controllers/reportingController');
const authorize = require('../../middleware/rbac');
const { denyRoles } = require('../../middleware/rbac');
// The Mill Operator role holds reports.view (for production reports) but must
// never see finance: profit, margin, receivables, payables, cashflow, FX or
// the booked-profit executive summary. Additive blocklist on those routes only.
const noFinanceForOperator = denyRoles('Mill Operator');

// ═══════════════════════════════════════════════════════════════════
// Executive Dashboards
// ═══════════════════════════════════════════════════════════════════
router.get('/search', authorize('reports', 'view'), controller.globalSearch);
// Scheduled report emails — finance-free roles excluded (they can email finance data otherwise)
router.get('/scheduled-reports', authorize('reports', 'view'), noFinanceForOperator, controller.listScheduledReports);
router.post('/scheduled-reports', authorize('reports', 'view'), noFinanceForOperator, controller.createScheduledReport);
router.delete('/scheduled-reports/:id', authorize('reports', 'view'), noFinanceForOperator, controller.deleteScheduledReport);
router.post('/scheduled-reports/:id/run', authorize('reports', 'view'), noFinanceForOperator, controller.runScheduledReport);
router.get('/lot-ledger/:id', authorize('reports', 'view'), controller.lotLedger);
router.get('/batch-ledger/:id', authorize('reports', 'view'), controller.batchLedger);
router.get('/invoice-ledger', authorize('reports', 'view'), noFinanceForOperator, controller.invoiceLedger);
router.get('/payroll-ledger', authorize('reports', 'view'), noFinanceForOperator, controller.payrollLedger);
router.get('/payroll-overview', authorize('reports', 'view'), noFinanceForOperator, controller.payrollOverview);
router.get('/payroll-pending', authorize('reports', 'view'), noFinanceForOperator, controller.payrollPending);
router.get('/payroll-analytics', authorize('reports', 'view'), noFinanceForOperator, controller.payrollAnalytics);
router.get('/sale-detail/:id', authorize('reports', 'view'), noFinanceForOperator, controller.saleDetail);
router.get('/inventory-ledger', authorize('reports', 'view'), controller.inventoryLedger);
router.get('/finished-goods-ledger', authorize('reports', 'view'), controller.finishedGoodsLedger);
router.get('/executive/summary', authorize('reports', 'view'), noFinanceForOperator, controller.executiveSummary);
router.get('/executive/pipeline', authorize('reports', 'view'), noFinanceForOperator, controller.orderPipeline);
router.get('/executive/advance-funnel', authorize('reports', 'view'), noFinanceForOperator, controller.advanceFunnel);

// ═══════════════════════════════════════════════════════════════════
// Profitability
// ═══════════════════════════════════════════════════════════════════
router.get('/profitability/orders', authorize('reports', 'view'), noFinanceForOperator, controller.orderProfitability);
router.get('/profitability/batches', authorize('reports', 'view'), noFinanceForOperator, controller.batchProfitability);
router.get('/profitability/batch-margin', authorize('reports', 'view'), noFinanceForOperator, controller.batchMargin);
router.get('/lot-tracker', authorize('reports', 'view'), noFinanceForOperator, controller.lotTracker);
router.get('/sales-tracker', authorize('reports', 'view'), noFinanceForOperator, controller.salesTracker);
router.get('/profitability/customers', authorize('reports', 'view'), noFinanceForOperator, controller.customerProfitability);
router.get('/profitability/countries', authorize('reports', 'view'), noFinanceForOperator, controller.countryAnalysis);
router.get('/profitability/products', authorize('reports', 'view'), noFinanceForOperator, controller.productProfitability);
router.get('/profitability/monthly-trend', authorize('reports', 'view'), noFinanceForOperator, controller.monthlyTrend);

// ═══════════════════════════════════════════════════════════════════
// Supplier & Quality
// ═══════════════════════════════════════════════════════════════════
router.get('/quality/supplier-ranking', authorize('reports', 'view'), controller.supplierQualityRanking);
router.get('/quality/recovery-leaderboard', authorize('reports', 'view'), controller.batchRecoveryLeaderboard);
router.get('/quality/recovery-by-variety', authorize('reports', 'view'), controller.recoveryByVariety);

// ═══════════════════════════════════════════════════════════════════
// Financial
// ═══════════════════════════════════════════════════════════════════
router.get('/financial/receivable-recovery', authorize('reports', 'view'), noFinanceForOperator, controller.receivableRecovery);
router.get('/financial/payable-analysis', authorize('reports', 'view'), noFinanceForOperator, controller.payableAnalysis);
router.get('/financial/cash-forecast', authorize('reports', 'view'), noFinanceForOperator, controller.cashForecast);
router.get('/financial/fx-exposure', authorize('reports', 'view'), noFinanceForOperator, controller.fxExposure);

// ═══════════════════════════════════════════════════════════════════
// Inventory
// ═══════════════════════════════════════════════════════════════════
router.get('/inventory/stock-aging', authorize('reports', 'view'), controller.stockAging);
router.get('/inventory/stock-turnover', authorize('reports', 'view'), controller.stockTurnover);
router.get('/inventory/stock-valuation', authorize('reports', 'view'), controller.stockValuation);

// ═══════════════════════════════════════════════════════════════════
// Printable reports — production & stock for daily / weekly / monthly
// ═══════════════════════════════════════════════════════════════════
router.get('/printable/production', authorize('reports', 'view'), controller.printableProduction);
router.get('/printable/stock',      authorize('reports', 'view'), controller.printableStock);
router.get('/printable/pnl',        authorize('reports', 'view'), noFinanceForOperator, controller.printablePnl);
router.get('/printable/cashflow',   authorize('reports', 'view'), noFinanceForOperator, controller.printableCashflow);
router.get('/printable/ar-aging',   authorize('reports', 'view'), noFinanceForOperator, controller.printableArAging);
router.get('/printable/ap-aging',   authorize('reports', 'view'), noFinanceForOperator, controller.printableApAging);
router.get('/printable/purchase-ledger', authorize('reports', 'view'), noFinanceForOperator, controller.printablePurchaseLedger);
router.get('/printable/sales-ledger',     authorize('reports', 'view'), noFinanceForOperator, controller.printableSalesLedger);
router.get('/printable/stock-detail',     authorize('reports', 'view'), controller.printableStockDetail);
router.get('/printable/sweeping',         authorize('reports', 'view'), controller.printableSweeping);
router.get('/printable/pnl-accrual',      authorize('reports', 'view'), noFinanceForOperator, controller.printablePnlAccrual);
// Audit trail is sensitive — gate on admin.view (not reports.view).
router.get('/printable/audit-trail',      authorize('admin', 'view'),   controller.printableAuditTrail);

// ═══════════════════════════════════════════════════════════════════
// Production
// ═══════════════════════════════════════════════════════════════════
router.get('/production/mill-efficiency', authorize('reports', 'view'), controller.millEfficiency);
router.get('/production/operator-productivity', authorize('reports', 'view'), controller.operatorProductivity);
router.get('/production/utility-consumption', authorize('reports', 'view'), controller.utilityConsumption);

// ═══════════════════════════════════════════════════════════════════
// KPI Benchmarks
// ═══════════════════════════════════════════════════════════════════
router.get('/kpi/benchmarks', authorize('reports', 'view'), controller.benchmarkComparison);

// ═══════════════════════════════════════════════════════════════════
// Saved Reports
// ═══════════════════════════════════════════════════════════════════
router.get('/saved', authorize('reports', 'view'), controller.list);
router.post('/saved', authorize('reports', 'view'), controller.save);
router.post('/saved/:id/run', authorize('reports', 'view'), controller.run);
router.delete('/saved/:id', authorize('reports', 'view'), controller.delete);

// ═══════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════
router.post('/export', authorize('reports', 'export'), controller.exportReport);

module.exports = router;
