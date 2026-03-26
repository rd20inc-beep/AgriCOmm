const express = require('express');
const router = express.Router();
const controller = require('../controllers/reportingController');
const authorize = require('../middleware/rbac');

// ═══════════════════════════════════════════════════════════════════
// Executive Dashboards
// ═══════════════════════════════════════════════════════════════════
router.get('/executive/summary', authorize('reports', 'view'), controller.executiveSummary);
router.get('/executive/pipeline', authorize('reports', 'view'), controller.orderPipeline);
router.get('/executive/advance-funnel', authorize('reports', 'view'), controller.advanceFunnel);

// ═══════════════════════════════════════════════════════════════════
// Profitability
// ═══════════════════════════════════════════════════════════════════
router.get('/profitability/orders', authorize('reports', 'view'), controller.orderProfitability);
router.get('/profitability/batches', authorize('reports', 'view'), controller.batchProfitability);
router.get('/profitability/customers', authorize('reports', 'view'), controller.customerProfitability);
router.get('/profitability/countries', authorize('reports', 'view'), controller.countryAnalysis);
router.get('/profitability/products', authorize('reports', 'view'), controller.productProfitability);
router.get('/profitability/monthly-trend', authorize('reports', 'view'), controller.monthlyTrend);

// ═══════════════════════════════════════════════════════════════════
// Supplier & Quality
// ═══════════════════════════════════════════════════════════════════
router.get('/quality/supplier-ranking', authorize('reports', 'view'), controller.supplierQualityRanking);
router.get('/quality/recovery-leaderboard', authorize('reports', 'view'), controller.batchRecoveryLeaderboard);
router.get('/quality/recovery-by-variety', authorize('reports', 'view'), controller.recoveryByVariety);

// ═══════════════════════════════════════════════════════════════════
// Financial
// ═══════════════════════════════════════════════════════════════════
router.get('/financial/receivable-recovery', authorize('reports', 'view'), controller.receivableRecovery);
router.get('/financial/payable-analysis', authorize('reports', 'view'), controller.payableAnalysis);
router.get('/financial/cash-forecast', authorize('reports', 'view'), controller.cashForecast);
router.get('/financial/fx-exposure', authorize('reports', 'view'), controller.fxExposure);

// ═══════════════════════════════════════════════════════════════════
// Inventory
// ═══════════════════════════════════════════════════════════════════
router.get('/inventory/stock-aging', authorize('reports', 'view'), controller.stockAging);
router.get('/inventory/stock-turnover', authorize('reports', 'view'), controller.stockTurnover);
router.get('/inventory/stock-valuation', authorize('reports', 'view'), controller.stockValuation);

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
