/* eslint-disable react-refresh/only-export-components --
   The route table is data (PAGES, lazy page components) plus the small
   components that render it; App.jsx is the only importer, so fast refresh
   of this module is not a concern. */
// The ONE route table (P5-05). Every in-shell page, for every role, is
// declared once here; its permission gate lives beside the path in
// routeGates.js (the sidebar, the phone bar and the tests read the same
// table). A URL with no route shows "Not available in your workspace" instead
// of the old silent redirect to the dashboard.
import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import { useAuth } from '../context/AuthContext';
import NotAvailable from '../shared/components/NotAvailable';
import { LEGACY_FINANCE_REDIRECTS } from '../modules/finance/financeNav';
import { LegacyFinanceRedirect, FinanceCatchAll } from '../modules/finance/components/LegacyFinanceRedirect';
import { ROUTE_GATES } from './routeGates';
import { resolveWorkspace } from './workspace';

// Lazy import that self-heals stale chunks after a deploy. A new build replaces
// every hashed chunk, so an already-open tab still pointing at an old chunk hash
// gets a "Failed to fetch dynamically imported module" 404 when it lazy-loads a
// route. On that failure, reload once to pull the fresh index.html + chunks. A
// short time-window guard prevents a reload loop if the chunk is genuinely
// unreachable (network down) rather than just stale.
export function lazyWithReload(factory) {
  return lazy(() =>
    factory().catch((err) => {
      const KEY = 'rf_chunk_reload_ts';
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return new Promise(() => {}); // halt rendering until the reload happens
      }
      throw err; // already reloaded recently — let the error boundary show it
    })
  );
}

// Lazy-loaded page components (pointing at modular locations)
export const Login = lazyWithReload(() => import('../modules/admin/pages/Login'));
export const ChangePassword = lazyWithReload(() => import('../modules/admin/pages/ChangePassword'));
export const ResetPassword = lazyWithReload(() => import('../modules/admin/pages/ResetPassword'));
const Profile = lazyWithReload(() => import('../modules/admin/pages/Profile'));
export const EmployeePortal = lazyWithReload(() => import('../modules/portal/EmployeePortal'));
const Dashboard = lazyWithReload(() => import('../modules/dashboard/pages/Dashboard'));
const Buyers = lazyWithReload(() => import('../modules/exportOrders/pages/Buyers'));
const ExportOrders = lazyWithReload(() => import('../modules/exportOrders/pages/ExportOrders'));
const CreateExportOrder = lazyWithReload(() => import('../modules/exportOrders/pages/CreateExportOrder'));
const ExportOrderDetail = lazyWithReload(() => import('../modules/exportOrders/pages/ExportOrderDetail'));
const ExportHomeDashboard = lazyWithReload(() => import('../modules/exportOrders/pages/ExportHomeDashboard'));
const MillingDashboard = lazyWithReload(() => import('../modules/milling/pages/MillingDashboard'));
const ServiceMilling = lazyWithReload(() => import('../modules/milling/pages/ServiceMilling'));
const ServiceInvoices = lazyWithReload(() => import('../modules/milling/pages/ServiceInvoices'));
const PurchaseRequirements = lazyWithReload(() => import('../modules/purchaseRequirements/pages/PurchaseRequirements'));
const SampleAnalysis = lazyWithReload(() => import('../modules/sampleAnalysis/pages/SampleAnalysis'));
const MillHomeDashboard = lazyWithReload(() => import('../modules/milling/pages/MillHomeDashboard'));
const StoreOverview = lazyWithReload(() => import('../modules/millStore/pages/StoreOverview'));
const LocalSaleDetail = lazyWithReload(() => import('../modules/localSales/pages/LocalSaleDetail'));
const InvoiceView = lazyWithReload(() => import('../modules/localSales/pages/InvoiceView'));
const StoreAlerts = lazyWithReload(() => import('../modules/millStore/pages/StoreAlerts'));
const StoreAdjustments = lazyWithReload(() => import('../modules/millStore/pages/StoreAdjustments'));
const StoreRatios = lazyWithReload(() => import('../modules/millStore/pages/StoreRatios'));
const MillingBatchDetail = lazyWithReload(() => import('../modules/milling/pages/MillingBatchDetail'));
const ServiceMillingBatchDetail = lazyWithReload(() => import('../modules/milling/pages/ServiceMillingBatchDetail'));
const MillFinanceDashboard = lazyWithReload(() => import('../modules/milling/pages/MillFinanceDashboard'));
const RicePurchasesLedger = lazyWithReload(() => import('../modules/milling/pages/RicePurchasesLedger'));
const MillCustomers = lazyWithReload(() => import('../modules/milling/pages/MillCustomers'));
const MillSuppliers = lazyWithReload(() => import('../modules/milling/pages/MillSuppliers'));
const QualityComparison = lazyWithReload(() => import('../modules/milling/pages/QualityComparison'));
const StockAdjustments = lazyWithReload(() => import('../modules/inventory/pages/StockAdjustments'));
const InternalTransfer = lazyWithReload(() => import('../modules/inventory/pages/InternalTransfer'));
const Inventory = lazyWithReload(() => import('../modules/inventory/pages/Inventory'));
const Documents = lazyWithReload(() => import('../modules/documents/pages/Documents'));
const Reports = lazyWithReload(() => import('../modules/analytics/pages/Reports'));
const PrintableReports = lazyWithReload(() => import('../modules/analytics/pages/PrintableReports'));
const LotReport = lazyWithReload(() => import('../modules/analytics/pages/LotReport'));
const InvoiceLedger = lazyWithReload(() => import('../modules/analytics/pages/InvoiceLedger'));
const PayrollLedger = lazyWithReload(() => import('../modules/analytics/pages/PayrollLedger'));
const PayrollAnalytics = lazyWithReload(() => import('../modules/analytics/pages/PayrollAnalytics'));
const LotLedger = lazyWithReload(() => import('../modules/analytics/pages/LotLedger'));
const BatchLedger = lazyWithReload(() => import('../modules/analytics/pages/BatchLedger'));
const SupplierLedger = lazyWithReload(() => import('../modules/analytics/pages/SupplierLedger'));
const RiceTypeLedger = lazyWithReload(() => import('../modules/analytics/pages/RiceTypeLedger'));
const WarehouseLedger = lazyWithReload(() => import('../modules/analytics/pages/WarehouseLedger'));
const ProcessingLossLedger = lazyWithReload(() => import('../modules/analytics/pages/ProcessingLossLedger'));
const FinishedGoodsLedger = lazyWithReload(() => import('../modules/analytics/pages/FinishedGoodsLedger'));
const ServiceMillingStock = lazyWithReload(() => import('../modules/analytics/pages/ServiceMillingStock'));
const ServiceMillingAgeing = lazyWithReload(() => import('../modules/analytics/pages/ServiceMillingAgeing'));
const ServiceMillingPendingDispatch = lazyWithReload(() => import('../modules/analytics/pages/ServiceMillingPendingDispatch'));
const ServiceMillingReconciliation = lazyWithReload(() => import('../modules/analytics/pages/ServiceMillingReconciliation'));
const InventoryMovementLedger = lazyWithReload(() => import('../modules/analytics/pages/InventoryMovementLedger'));
const StockLedger = lazyWithReload(() => import('../modules/analytics/pages/StockLedger'));
export const StandalonePrintReport = lazyWithReload(() => import('../modules/analytics/pages/StandalonePrintReport'));
// D-20: /approvals is the one approvals inbox (governance module); the old
// admin approvals page stays reachable at /approvals/legacy.
const ApprovalsInbox = lazyWithReload(() => import('../modules/governance/ApprovalsInbox'));
const LegacyApprovals = lazyWithReload(() => import('../modules/admin/pages/Approvals'));
const AuditLog = lazyWithReload(() => import('../modules/admin/pages/AuditLog'));
const LotInventory = lazyWithReload(() => import('../modules/inventory/pages/LotInventory'));
const StockSummary = lazyWithReload(() => import('../modules/inventory/pages/StockSummary'));
const StockCount = lazyWithReload(() => import('../modules/inventory/pages/StockCount'));
const LocalSales = lazyWithReload(() => import('../modules/localSales/pages/LocalSales'));
const LotDetail = lazyWithReload(() => import('../modules/inventory/pages/LotDetail'));
const PurchaseInvoiceView = lazyWithReload(() => import('../modules/inventory/pages/PurchaseInvoiceView'));
const ExceptionDashboard = lazyWithReload(() => import('../modules/analytics/pages/ExceptionDashboard'));
const AiAssistant = lazyWithReload(() => import('../modules/ai/pages/AiAssistant'));
const Intelligence = lazyWithReload(() => import('../modules/analytics/pages/Intelligence'));
const ScenarioSimulator = lazyWithReload(() => import('../modules/analytics/pages/ScenarioSimulator'));
const Admin = lazyWithReload(() => import('../modules/admin/pages/Admin'));

// Finance sub-pages (lazy) — money-flow structure
const FinanceLayout = lazyWithReload(() => import('../modules/finance/pages/FinanceLayout'));
const FinanceOverview = lazyWithReload(() => import('../modules/finance/pages/FinanceOverview'));
const MoneyIn = lazyWithReload(() => import('../modules/finance/pages/MoneyIn'));
const MoneyOut = lazyWithReload(() => import('../modules/finance/pages/MoneyOut'));
const DueDates = lazyWithReload(() => import('../modules/finance/pages/DueDates'));
const Cash = lazyWithReload(() => import('../modules/finance/pages/Cash'));
const Profit = lazyWithReload(() => import('../modules/finance/pages/Profit'));
const Accounting = lazyWithReload(() => import('../modules/finance/pages/Accounting'));
const PartyLedger = lazyWithReload(() => import('../modules/finance/pages/PartyLedger'));
const RatesCenter = lazyWithReload(() => import('../modules/finance/pages/RatesCenter'));
const FinanceAlerts = lazyWithReload(() => import('../modules/finance/pages/Alerts'));
// Legacy routes (still accessible via direct URL)
const FinanceConfirmations = lazyWithReload(() => import('../modules/finance/pages/Confirmations'));
const Expenses = lazyWithReload(() => import('../modules/finance/pages/Expenses'));
const Purchases = lazyWithReload(() => import('../modules/finance/pages/Purchases'));
const LocalSalesFinance = lazyWithReload(() => import('../modules/finance/pages/LocalSalesFinance'));
const FinancePayroll = lazyWithReload(() => import('../modules/finance/pages/FinancePayroll'));
const FinanceSuspense = lazyWithReload(() => import('../modules/finance/pages/Suspense'));
const BankReconciliation = lazyWithReload(() => import('../modules/finance/pages/BankReconciliation'));
const TrialBalance = lazyWithReload(() => import('../modules/finance/pages/TrialBalance'));
const GlProfitLoss = lazyWithReload(() => import('../modules/finance/pages/GlProfitLoss'));
const BalanceSheet = lazyWithReload(() => import('../modules/finance/pages/BalanceSheet'));
const AccountingPeriods = lazyWithReload(() => import('../modules/finance/pages/Periods'));

export function FinanceRoutes() {
  return (
    <FinanceLayout>
      <Routes>
        {/* Six workspaces; a workspace's default view is its own path, the
            other views are nested paths (map: modules/finance/financeNav.js). */}
        <Route index element={<FinanceOverview />} />
        {/* Money In */}
        <Route path="money-in" element={<MoneyIn />} />
        <Route path="money-in/to-confirm" element={<FinanceConfirmations />} />
        <Route path="money-in/local-sales" element={<LocalSalesFinance />} />
        {/* Money Out */}
        <Route path="money-out" element={<MoneyOut />} />
        <Route path="money-out/purchases" element={<Purchases />} />
        <Route path="money-out/expenses" element={<Expenses />} />
        {/* Accounts */}
        <Route path="accounts" element={<Cash />} />
        <Route path="accounts/cheques" element={<DueDates />} />
        <Route path="accounts/suspense" element={<FinanceSuspense />} />
        <Route path="accounts/reconcile" element={<ProtectedRoute module="finance" action="view"><BankReconciliation /></ProtectedRoute>} />
        {/* Accounting */}
        <Route path="accounting" element={<Accounting />} />
        <Route path="accounting/trial-balance" element={<ProtectedRoute module="finance" action="view"><TrialBalance /></ProtectedRoute>} />
        <Route path="accounting/pnl" element={<ProtectedRoute module="finance" action="view"><GlProfitLoss /></ProtectedRoute>} />
        <Route path="accounting/balance-sheet" element={<ProtectedRoute module="finance" action="view"><BalanceSheet /></ProtectedRoute>} />
        <Route path="accounting/periods" element={<ProtectedRoute module="finance" action="view"><AccountingPeriods /></ProtectedRoute>} />
        <Route path="accounting/profit" element={<Profit />} />
        <Route path="accounting/statements" element={<PartyLedger />} />
        <Route path="accounting/rates" element={<RatesCenter />} />
        {/* Mill → Export STOCK transfers (not money) live on one page, /transfer
            (P5 CLICKS); the old Finance URL redirects there. */}
        <Route path="accounting/stock-transfers" element={<Navigate to="/transfer" replace />} />
        {/* Payroll */}
        <Route path="payroll" element={<ProtectedRoute module="payroll" action="view"><FinancePayroll /></ProtectedRoute>} />
        {/* Reached from Home's alerts panel (Needs Attention replaces it later). */}
        <Route path="alerts" element={<FinanceAlerts />} />
        {/* Every pre-redesign path → its new view, query string kept. The
            orphan Cost Allocation (/finance/costs) and Reconciliation
            (/finance/reconciliation) pages summed PKR and USD (FIN-23) and are
            deleted; their URLs redirect too (Profit, Money In). */}
        {Object.keys(LEGACY_FINANCE_REDIRECTS).map((seg) => (
          <Route key={seg} path={seg} element={<LegacyFinanceRedirect />} />
        ))}
        <Route path="*" element={<FinanceCatchAll />} />
      </Routes>
    </FinanceLayout>
  );
}


// Home is chosen by permission set (workspace.js), never by role name: Mill
// users land on the Mill home, Export users on the Export home, money-only
// users on Finance, everyone else on the company Dashboard.
export function HomeRoute() {
  const { hasPermission } = useAuth();
  const ws = resolveWorkspace(hasPermission);
  if (ws === 'mill') return <MillHomeDashboard />;
  if (ws === 'export') return <ExportHomeDashboard />;
  if (ws === 'finance') return <Navigate to="/finance" replace />;
  return <Dashboard />;
}

const LOCAL_SALE_INVOICE = <InvoiceView />;

// path → page. Every key must be a ROUTE_GATES path and vice versa (tested).
export const PAGES = {
  '/': <HomeRoute />,
  '/profile': <Profile />,
  '/change-password': <ChangePassword />,
  '/approvals': <ApprovalsInbox />,
  '/approvals/legacy': <LegacyApprovals />,

  '/export': <ExportOrders />,
  '/export/create': <CreateExportOrder />,
  '/export/:id': <ExportOrderDetail />,
  '/buyers': <Buyers />,
  '/documents': <Documents />,

  '/finance/*': <FinanceRoutes />,

  '/milling': <MillingDashboard />,
  '/milling/service': <ServiceMilling />,
  '/service-milling/invoices': <ServiceInvoices />,
  '/service-milling/:id': <ServiceMillingBatchDetail />,
  '/milling/finance': <MillFinanceDashboard />,
  '/milling/rice-purchases': <RicePurchasesLedger />,
  '/milling/customers': <MillCustomers />,
  '/milling/suppliers': <MillSuppliers />,
  '/milling/statements': <PartyLedger />,
  '/milling/:id': <MillingBatchDetail />,
  '/quality': <QualityComparison />,
  '/sample-analysis': <SampleAnalysis />,
  '/purchase-requirements': <PurchaseRequirements />,

  '/inventory': <Inventory />,
  '/lot-inventory': <LotInventory />,
  '/lot-inventory/:id': <LotDetail />,
  '/lot-inventory/:id/purchase-invoice': <PurchaseInvoiceView />,
  '/stock-summary': <StockSummary />,
  '/stock-count': <StockCount />,
  '/stock-adjustments': <StockAdjustments />,
  '/transfer': <InternalTransfer />,
  '/local-sales': <LocalSales />,
  '/local-sales/:id': <LocalSaleDetail />,
  '/local-sales/:id/invoice': LOCAL_SALE_INVOICE,
  '/local-sales/:id/print': LOCAL_SALE_INVOICE,

  '/mill-store': <StoreOverview />,
  '/mill-store/purchases/new': <Navigate to="/mill-store?action=purchase" replace />,
  '/mill-store/alerts': <StoreAlerts />,
  '/mill-store/adjustments': <StoreAdjustments />,
  '/mill-store/ratios': <StoreRatios />,

  '/reports': <Reports />,
  '/reports/print': <PrintableReports />,
  '/reports/lots': <LotReport />,
  '/reports/invoices': <InvoiceLedger />,
  '/reports/payroll': <PayrollLedger />,
  '/reports/payroll-analytics': <PayrollAnalytics />,
  '/reports/lot-ledger/:id': <LotLedger />,
  '/reports/batch-ledger/:id': <BatchLedger />,
  '/reports/supplier-ledger': <SupplierLedger />,
  '/reports/supplier-ledger/:id': <SupplierLedger />,
  '/reports/rice-type-ledger': <RiceTypeLedger />,
  '/reports/rice-type-ledger/:id': <RiceTypeLedger />,
  '/reports/warehouse-ledger': <WarehouseLedger />,
  '/reports/warehouse-ledger/:id': <WarehouseLedger />,
  '/reports/processing-loss-ledger': <ProcessingLossLedger />,
  '/reports/finished-goods-ledger': <FinishedGoodsLedger />,
  '/reports/service-milling-stock': <ServiceMillingStock />,
  '/reports/service-milling-ageing': <ServiceMillingAgeing />,
  '/reports/service-milling-pending-dispatch': <ServiceMillingPendingDispatch />,
  '/reports/service-milling-reconciliation': <ServiceMillingReconciliation />,
  '/reports/inventory-movement-ledger': <InventoryMovementLedger />,
  '/reports/stock-ledger': <StockLedger />,

  '/ai': <AiAssistant />,
  '/exceptions': <ExceptionDashboard />,
  '/intelligence': <Intelligence />,
  '/simulator': <ScenarioSimulator />,
  '/audit': <AuditLog />,
  '/admin': <Admin />,
};

/** Wrap a page in the gate the route table declares for its path. */
export function Gated({ gate, children }) {
  if (!gate) return children;
  return (
    <ProtectedRoute module={gate.module} action={gate.action} anyOf={gate.anyOf || []}>
      {children}
    </ProtectedRoute>
  );
}

/** Every in-shell route, gated, plus the "not available" catch-all. */
export function AppRoutes() {
  return (
    <Routes>
      {ROUTE_GATES.map(({ path, gate }) => (
        <Route key={path} path={path} element={<Gated gate={gate}>{PAGES[path]}</Gated>} />
      ))}
      <Route path="*" element={<NotAvailable />} />
    </Routes>
  );
}
