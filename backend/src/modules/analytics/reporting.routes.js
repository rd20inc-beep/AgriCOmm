const express = require('express');
const auditAction = require('../../middleware/audit');
const router = express.Router();
const controller = require('../../controllers/reportingController');
const authorize = require('../../middleware/rbac');
const { authorizeAny } = require('../../middleware/rbac');
// Company-wide finance reports need reports.view_finance (mig 470): payroll,
// export / customer / country / product profitability, the executive summary,
// AR / AP, cash forecast, FX, P&L, the invoice + export sales ledgers and
// scheduled reports. It replaces the role-name block on the Mill Operator
// (owner decision 2026-10-05) and is withheld from the Mill Manager too
// (owner request 2026-10-27). The mill reports (batch profitability + margin,
// lot tracker, supplier / rice-type / warehouse / processing-loss ledgers, the
// rice purchase ledger) stay on reports.view with the reports.view_cost /
// view_profit redaction (#535).
const financeReports = authorize('reports', 'view_finance');
// Export profitability (orders / customers / countries / products / monthly
// trend) is the export desk's own report: reports.view_finance OR
// export_orders.view. The Mill roles hold neither; the Export Manager keeps
// these without the company finance reports (owner request 2026-10-27).
const exportReports = authorizeAny(['reports', 'view_finance'], ['export_orders', 'view']);
// Local-sale reports also need local_sales.view — a role kept out of Local
// Sales (the Export Manager) must not read them here either.
const localSalesReports = authorize('local_sales', 'view');
// One parameter contract for every report (P4-05): period / entity / page /
// format validated with Joi, the period written back under every name a
// service reads. See reportContract.js.
const { reportQuery } = require('./reportContract');
router.use(reportQuery);

// ═══════════════════════════════════════════════════════════════════
// Executive Dashboards
// ═══════════════════════════════════════════════════════════════════
router.get('/search', authorize('reports', 'view'), controller.globalSearch);
// Scheduled report emails — finance-free roles excluded (they can email finance data otherwise).
// P1-11: managing schedules needs an admin or finance permission on top of
// reports.view; run-now / delete are further limited (controller) to report_email
// schedules the caller created, or any for admin.manage_settings.
const canSchedule = authorizeAny(['admin', 'manage_settings'], ['finance', 'view']);
router.get('/scheduled-reports', authorize('reports', 'view'), canSchedule, financeReports, controller.listScheduledReports);
router.post('/scheduled-reports', authorize('reports', 'view'), auditAction('create', 'scheduled_report'), canSchedule, financeReports, controller.createScheduledReport);
router.delete('/scheduled-reports/:id', authorize('reports', 'view'), auditAction('delete', 'scheduled_report'), canSchedule, financeReports, controller.deleteScheduledReport);
router.post('/scheduled-reports/:id/run', authorize('reports', 'view'), auditAction('run', 'scheduled_report'), canSchedule, financeReports, controller.runScheduledReport);
router.get('/lot-ledger/:id', authorize('reports', 'view'), controller.lotLedger);
router.get('/batch-ledger/:id', authorize('reports', 'view'), controller.batchLedger);
router.get('/invoice-ledger', authorize('reports', 'view'), financeReports, controller.invoiceLedger);
// Salaries (owner decision D-24): payroll reports need payroll.view on top of
// reports.view — reports.view alone is held by roles with no payroll access.
// They are not finance reports: whoever runs payroll (the Mill Manager) reads
// them without reports.view_finance; the Mill Operator holds no payroll.view.
router.get('/payroll-ledger', authorize('reports', 'view'), authorize('payroll', 'view'), controller.payrollLedger);
router.get('/payroll-overview', authorize('reports', 'view'), authorize('payroll', 'view'), controller.payrollOverview);
router.get('/payroll-pending', authorize('reports', 'view'), authorize('payroll', 'view'), controller.payrollPending);
router.get('/payroll-analytics', authorize('reports', 'view'), authorize('payroll', 'view'), controller.payrollAnalytics);
// One local sale's Sale-360 (lot, provenance, payments) — opened from the mill
// Sales tab, so it follows the sales tracker: no role deny, money redacted.
router.get('/sale-detail/:id', authorize('reports', 'view'), localSalesReports, controller.saleDetail);
router.get('/inventory-ledger', authorize('reports', 'view'), controller.inventoryLedger);
// Stock movement ledger by dimension (variety|grade|byproduct|product) — Batch 5.
router.get('/stock-ledger', authorize('reports', 'view'), controller.stockLedger);
router.get('/finished-goods-ledger', authorize('reports', 'view'), controller.finishedGoodsLedger);
// Client-owned service-milling stock reports (qty-only) — no finance data.
// Register supports ?group_by=client|batch|warehouse; ageing / pending-dispatch /
// reconciliation are dedicated views over the same client-owned lot set.
router.get('/service-milling-stock', authorize('reports', 'view'), controller.serviceMillingStock);
router.get('/service-milling-ageing', authorize('reports', 'view'), controller.serviceMillingAgeing);
router.get('/service-milling-pending-dispatch', authorize('reports', 'view'), controller.serviceMillingPendingDispatch);
router.get('/service-milling-reconciliation', authorize('reports', 'view'), controller.serviceMillingReconciliation);
router.get('/executive/summary', authorize('reports', 'view'), financeReports, controller.executiveSummary);
router.get('/executive/pipeline', authorize('reports', 'view'), financeReports, controller.orderPipeline);
router.get('/executive/advance-funnel', authorize('reports', 'view'), financeReports, controller.advanceFunnel);

// ═══════════════════════════════════════════════════════════════════
// Profitability
// ═══════════════════════════════════════════════════════════════════
router.get('/profitability/orders', authorize('reports', 'view'), exportReports, controller.orderProfitability);
router.get('/profitability/batches', authorize('reports', 'view'), controller.batchProfitability);
router.get('/profitability/batch-margin', authorize('reports', 'view'), controller.batchMargin);
router.get('/lot-tracker', authorize('reports', 'view'), controller.lotTracker);
router.get('/sales-tracker', authorize('reports', 'view'), localSalesReports, controller.salesTracker);
// Confirmed local sales: page + server totals + CSV (Margin by Sale, Finance ▸
// Profit ▸ Local, Finance ▸ Local Sales). Read by reports or finance roles;
// money redacted per view_cost / view_profit, buyer masked like the sales list.
router.get('/local-sales', authorizeAny(['reports', 'view'], ['finance', 'view']), localSalesReports, controller.localSalesReport);
router.get('/profitability/customers', authorize('reports', 'view'), exportReports, controller.customerProfitability);
router.get('/profitability/countries', authorize('reports', 'view'), exportReports, controller.countryAnalysis);
router.get('/profitability/products', authorize('reports', 'view'), exportReports, controller.productProfitability);
router.get('/profitability/monthly-trend', authorize('reports', 'view'), exportReports, controller.monthlyTrend);

// ═══════════════════════════════════════════════════════════════════
// Supplier & Quality
// ═══════════════════════════════════════════════════════════════════
// Supplier Inventory Ledger / Supplier 360 — stock value, revenue & profit of the
// mill's suppliers; money redacted for roles without view_cost / view_profit.
router.get('/supplier-ledger', authorize('reports', 'view'), controller.supplierInventoryIndex);
router.get('/supplier-ledger/:id', authorize('reports', 'view'), controller.supplierInventoryLedger);
// Rice Type Ledger — per-variety stock + revenue + profit, redacted like above.
router.get('/rice-type-ledger', authorize('reports', 'view'), controller.riceTypeIndex);
router.get('/rice-type-ledger/:id', authorize('reports', 'view'), controller.riceTypeLedger);
// Warehouse Ledger — per-warehouse stock roll-forward + value (value redacted like above).
router.get('/warehouse-ledger', authorize('reports', 'view'), controller.warehouseIndex);
router.get('/warehouse-ledger/:id', authorize('reports', 'view'), controller.warehouseLedger);
// Processing-Loss Ledger — milling loss by batch / rice type / supplier / operator / machine / month.
router.get('/processing-loss-ledger', authorize('reports', 'view'), controller.processingLossLedger);
router.get('/quality/supplier-ranking', authorize('reports', 'view'), controller.supplierQualityRanking);
router.get('/quality/recovery-leaderboard', authorize('reports', 'view'), controller.batchRecoveryLeaderboard);
router.get('/quality/recovery-by-variety', authorize('reports', 'view'), controller.recoveryByVariety);

// ═══════════════════════════════════════════════════════════════════
// Financial
// ═══════════════════════════════════════════════════════════════════
router.get('/financial/receivable-recovery', authorize('reports', 'view'), financeReports, controller.receivableRecovery);
router.get('/financial/payable-analysis', authorize('reports', 'view'), financeReports, controller.payableAnalysis);
router.get('/financial/cash-forecast', authorize('reports', 'view'), financeReports, controller.cashForecast);
router.get('/financial/fx-exposure', authorize('reports', 'view'), financeReports, controller.fxExposure);

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
router.get('/printable/pnl',        authorize('reports', 'view'), financeReports, controller.printablePnl);
router.get('/printable/cashflow',   authorize('reports', 'view'), financeReports, controller.printableCashflow);
router.get('/printable/ar-aging',   authorize('reports', 'view'), financeReports, controller.printableArAging);
router.get('/printable/ap-aging',   authorize('reports', 'view'), financeReports, controller.printableApAging);
router.get('/printable/purchase-ledger', authorize('reports', 'view'), controller.printablePurchaseLedger);
router.get('/printable/sales-ledger',     authorize('reports', 'view'), financeReports, controller.printableSalesLedger);
router.get('/printable/stock-detail',     authorize('reports', 'view'), controller.printableStockDetail);
// Freight charged to buyers against freight paid to carriers, per order — the
// number that says whether the freight terms are working while rates are moving.
router.get('/printable/freight-recovery', authorize('reports', 'view'), controller.printableFreightRecovery);
router.get('/printable/sweeping',         authorize('reports', 'view'), controller.printableSweeping);
router.get('/printable/pnl-accrual',      authorize('reports', 'view'), financeReports, controller.printablePnlAccrual);
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
// Saved reports run finance reports (profitability, receivables, cash forecast),
// so the finance-free Mill Operator is kept out like the live routes; run is
// limited to the caller's own + shared reports, delete to the owner (service).
router.get('/saved', authorize('reports', 'view'), financeReports, controller.list);
router.post('/saved', authorize('reports', 'view'), auditAction('create', 'saved_report'), financeReports, controller.save);
router.post('/saved/:id/run', authorize('reports', 'view'), financeReports, controller.run);
router.delete('/saved/:id', authorize('reports', 'view'), auditAction('delete', 'saved_report'), financeReports, controller.delete);

// ═══════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════
router.post('/export', authorize('reports', 'export'), controller.exportReport);

module.exports = router;
