import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { OwnerAuthProvider } from './context/OwnerAuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import MillLayout from './components/MillLayout';
import ExportLayout from './components/ExportLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import Toast from './components/Toast';
import QueryErrorHandler from './components/QueryErrorHandler';
import { LoadingSpinner } from './components/LoadingState';

// Lazy import that self-heals stale chunks after a deploy. A new build replaces
// every hashed chunk, so an already-open tab still pointing at an old chunk hash
// gets a "Failed to fetch dynamically imported module" 404 when it lazy-loads a
// route. On that failure, reload once to pull the fresh index.html + chunks. A
// short time-window guard prevents a reload loop if the chunk is genuinely
// unreachable (network down) rather than just stale.
function lazyWithReload(factory) {
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
const Login = lazyWithReload(() => import('./modules/admin/pages/Login'));
const EmployeePortal = lazyWithReload(() => import('./modules/portal/EmployeePortal'));
const Dashboard = lazyWithReload(() => import('./modules/dashboard/pages/Dashboard'));
const Buyers = lazyWithReload(() => import('./modules/exportOrders/pages/Buyers'));
const ExportOrders = lazyWithReload(() => import('./modules/exportOrders/pages/ExportOrders'));
const CreateExportOrder = lazyWithReload(() => import('./modules/exportOrders/pages/CreateExportOrder'));
const ExportOrderDetail = lazyWithReload(() => import('./modules/exportOrders/pages/ExportOrderDetail'));
const ExportHomeDashboard = lazyWithReload(() => import('./modules/exportOrders/pages/ExportHomeDashboard'));
const MillingDashboard = lazyWithReload(() => import('./modules/milling/pages/MillingDashboard'));
const MillHomeDashboard = lazyWithReload(() => import('./modules/milling/pages/MillHomeDashboard'));
const StoreOverview = lazyWithReload(() => import('./modules/millStore/pages/StoreOverview'));
const NewPurchase = lazyWithReload(() => import('./modules/millStore/pages/NewPurchase'));
const LocalSaleDetail = lazyWithReload(() => import('./modules/localSales/pages/LocalSaleDetail'));
const InvoiceView = lazyWithReload(() => import('./modules/localSales/pages/InvoiceView'));
const StoreAlerts = lazyWithReload(() => import('./modules/millStore/pages/StoreAlerts'));
const StoreAdjustments = lazyWithReload(() => import('./modules/millStore/pages/StoreAdjustments'));
const StoreRatios = lazyWithReload(() => import('./modules/millStore/pages/StoreRatios'));
const MillingBatchDetail = lazyWithReload(() => import('./modules/milling/pages/MillingBatchDetail'));
const MillFinanceDashboard = lazyWithReload(() => import('./modules/milling/pages/MillFinanceDashboard'));
const RicePurchasesLedger = lazyWithReload(() => import('./modules/milling/pages/RicePurchasesLedger'));
const MillCustomers = lazyWithReload(() => import('./modules/milling/pages/MillCustomers'));
const MillSuppliers = lazyWithReload(() => import('./modules/milling/pages/MillSuppliers'));
const QualityComparison = lazyWithReload(() => import('./modules/milling/pages/QualityComparison'));
const StockAdjustments = lazyWithReload(() => import('./modules/inventory/pages/StockAdjustments'));
const InternalTransfer = lazyWithReload(() => import('./modules/inventory/pages/InternalTransfer'));
const Inventory = lazyWithReload(() => import('./modules/inventory/pages/Inventory'));
const Documents = lazyWithReload(() => import('./modules/documents/pages/Documents'));
const Reports = lazyWithReload(() => import('./modules/analytics/pages/Reports'));
const PrintableReports = lazyWithReload(() => import('./modules/analytics/pages/PrintableReports'));
const LotReport = lazyWithReload(() => import('./modules/analytics/pages/LotReport'));
const InvoiceLedger = lazyWithReload(() => import('./modules/analytics/pages/InvoiceLedger'));
const PayrollLedger = lazyWithReload(() => import('./modules/analytics/pages/PayrollLedger'));
const PayrollAnalytics = lazyWithReload(() => import('./modules/analytics/pages/PayrollAnalytics'));
const LotLedger = lazyWithReload(() => import('./modules/analytics/pages/LotLedger'));
const BatchLedger = lazyWithReload(() => import('./modules/analytics/pages/BatchLedger'));
const StandalonePrintReport = lazyWithReload(() => import('./modules/analytics/pages/StandalonePrintReport'));
const Approvals = lazyWithReload(() => import('./modules/admin/pages/Approvals'));
const AuditLog = lazyWithReload(() => import('./modules/admin/pages/AuditLog'));
const LotInventory = lazyWithReload(() => import('./modules/inventory/pages/LotInventory'));
const StockSummary = lazyWithReload(() => import('./modules/inventory/pages/StockSummary'));
const StockCount = lazyWithReload(() => import('./modules/inventory/pages/StockCount'));
const LocalSales = lazyWithReload(() => import('./modules/localSales/pages/LocalSales'));
const LotDetail = lazyWithReload(() => import('./modules/inventory/pages/LotDetail'));
const PurchaseInvoiceView = lazyWithReload(() => import('./modules/inventory/pages/PurchaseInvoiceView'));
const ExceptionDashboard = lazyWithReload(() => import('./modules/analytics/pages/ExceptionDashboard'));
const AiAssistant = lazyWithReload(() => import('./modules/ai/pages/AiAssistant'));
const Intelligence = lazyWithReload(() => import('./modules/analytics/pages/Intelligence'));
const ScenarioSimulator = lazyWithReload(() => import('./modules/analytics/pages/ScenarioSimulator'));
const Admin = lazyWithReload(() => import('./modules/admin/pages/Admin'));

// Finance sub-pages (lazy) — money-flow structure
const FinanceLayout = lazyWithReload(() => import('./modules/finance/pages/FinanceLayout'));
const FinanceOverview = lazyWithReload(() => import('./modules/finance/pages/FinanceOverview'));
const MoneyIn = lazyWithReload(() => import('./modules/finance/pages/MoneyIn'));
const MoneyOut = lazyWithReload(() => import('./modules/finance/pages/MoneyOut'));
const DueDates = lazyWithReload(() => import('./modules/finance/pages/DueDates'));
const Cash = lazyWithReload(() => import('./modules/finance/pages/Cash'));
const Profit = lazyWithReload(() => import('./modules/finance/pages/Profit'));
const Accounting = lazyWithReload(() => import('./modules/finance/pages/Accounting'));
const PartyLedger = lazyWithReload(() => import('./modules/finance/pages/PartyLedger'));
const RatesCenter = lazyWithReload(() => import('./modules/finance/pages/RatesCenter'));
const FinanceAlerts = lazyWithReload(() => import('./modules/finance/pages/Alerts'));
// Legacy routes (still accessible via direct URL)
const FinanceConfirmations = lazyWithReload(() => import('./modules/finance/pages/Confirmations'));
const CostAllocation = lazyWithReload(() => import('./modules/finance/pages/CostAllocation'));
const FinanceTransfers = lazyWithReload(() => import('./modules/finance/pages/InternalTransfers'));
const Reconciliation = lazyWithReload(() => import('./modules/finance/pages/Reconciliation'));
const Expenses = lazyWithReload(() => import('./modules/finance/pages/Expenses'));
const Purchases = lazyWithReload(() => import('./modules/finance/pages/Purchases'));
const LocalSalesFinance = lazyWithReload(() => import('./modules/finance/pages/LocalSalesFinance'));

function FinanceRoutes() {
  return (
    <FinanceLayout>
      <Routes>
        {/* Primary money-flow tabs */}
        <Route index element={<FinanceOverview />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="money-in" element={<MoneyIn />} />
        <Route path="money-out" element={<MoneyOut />} />
        <Route path="due-dates" element={<DueDates />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="local-sales" element={<LocalSalesFinance />} />
        <Route path="cash" element={<Cash />} />
        <Route path="profit" element={<Profit />} />
        <Route path="rates" element={<RatesCenter />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="statements" element={<PartyLedger />} />
        <Route path="alerts" element={<FinanceAlerts />} />
        {/* Legacy routes — redirect-compatible */}
        <Route path="receivables" element={<MoneyIn />} />
        <Route path="payables" element={<MoneyOut />} />
        <Route path="confirmations" element={<FinanceConfirmations />} />
        <Route path="costs" element={<CostAllocation />} />
        <Route path="transfers" element={<FinanceTransfers />} />
        <Route path="profitability" element={<Profit />} />
        <Route path="ledger" element={<Accounting />} />
        <Route path="reconciliation" element={<Reconciliation />} />
      </Routes>
    </FinanceLayout>
  );
}

function ExportRoutes() {
  return (
    <ExportLayout>
      <Routes>
        <Route path="/" element={<ExportHomeDashboard />} />
        <Route path="/export" element={<ExportOrders />} />
        <Route path="/export/create" element={<CreateExportOrder />} />
        <Route path="/export/:id" element={<ExportOrderDetail />} />
        <Route path="/buyers" element={<Buyers />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/print" element={<PrintableReports />} />
        <Route path="/reports/lots" element={<LotReport />} />
        <Route path="/reports/invoices" element={<InvoiceLedger />} />
        <Route path="/reports/payroll" element={<PayrollLedger />} />
        <Route path="/reports/payroll-analytics" element={<PayrollAnalytics />} />
        <Route path="/reports/lot-ledger/:id" element={<LotLedger />} />
        <Route path="/reports/batch-ledger/:id" element={<BatchLedger />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ExportLayout>
  );
}

function MillRoutes() {
  return (
    <MillLayout>
      <Routes>
        <Route path="/" element={<MillHomeDashboard />} />
        <Route path="/milling" element={<MillingDashboard />} />
        <Route path="/milling/finance" element={<MillFinanceDashboard />} />
        <Route path="/milling/rice-purchases" element={<RicePurchasesLedger />} />
        <Route path="/milling/customers" element={<MillCustomers />} />
        <Route path="/milling/suppliers" element={<MillSuppliers />} />
        <Route path="/milling/statements" element={<PartyLedger />} />
        <Route path="/milling/:id" element={<MillingBatchDetail />} />
        <Route path="/quality" element={<QualityComparison />} />
        <Route path="/mill-store" element={<StoreOverview />} />
        <Route path="/mill-store/purchases/new" element={<NewPurchase />} />
        <Route path="/mill-store/alerts" element={<StoreAlerts />} />
        <Route path="/mill-store/adjustments" element={<StoreAdjustments />} />
        <Route path="/mill-store/ratios" element={<StoreRatios />} />
        <Route path="/stock-adjustments" element={<StockAdjustments />} />
        <Route path="/transfer" element={<InternalTransfer />} />
        <Route path="/lot-inventory" element={<LotInventory />} />
        <Route path="/stock-summary" element={<StockSummary />} />
        <Route path="/stock-count" element={<StockCount />} />
        <Route path="/lot-inventory/:id/purchase-invoice" element={<PurchaseInvoiceView />} />
        <Route path="/lot-inventory/:id" element={<LotDetail />} />
        <Route path="/local-sales" element={<LocalSales />} />
        <Route path="/local-sales/:id/invoice" element={<InvoiceView />} />
        <Route path="/local-sales/:id/print" element={<InvoiceView />} />
        <Route path="/local-sales/:id" element={<LocalSaleDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/print" element={<PrintableReports />} />
        <Route path="/reports/lots" element={<LotReport />} />
        <Route path="/reports/invoices" element={<InvoiceLedger />} />
        <Route path="/reports/payroll" element={<PayrollLedger />} />
        <Route path="/reports/payroll-analytics" element={<PayrollAnalytics />} />
        <Route path="/reports/lot-ledger/:id" element={<LotLedger />} />
        <Route path="/reports/batch-ledger/:id" element={<BatchLedger />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MillLayout>
  );
}

function StandardRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/buyers" element={<ProtectedRoute module="export_orders" action="view"><Buyers /></ProtectedRoute>} />
        <Route path="/export" element={<ProtectedRoute module="export_orders" action="view"><ExportOrders /></ProtectedRoute>} />
        <Route path="/export/create" element={<ProtectedRoute module="export_orders" action="create"><CreateExportOrder /></ProtectedRoute>} />
        <Route path="/export/:id" element={<ProtectedRoute module="export_orders" action="view"><ExportOrderDetail /></ProtectedRoute>} />
        <Route path="/finance/*" element={<ProtectedRoute module="finance" action="view"><FinanceRoutes /></ProtectedRoute>} />
        <Route path="/milling" element={<ProtectedRoute module="milling" action="view"><MillingDashboard /></ProtectedRoute>} />
        <Route path="/milling/finance" element={<ProtectedRoute module="milling" action="view"><MillFinanceDashboard /></ProtectedRoute>} />
        <Route path="/milling/rice-purchases" element={<ProtectedRoute module="milling" action="view"><RicePurchasesLedger /></ProtectedRoute>} />
        <Route path="/stock-adjustments" element={<ProtectedRoute module="inventory" action="view"><StockAdjustments /></ProtectedRoute>} />
        <Route path="/milling/:id" element={<ProtectedRoute module="milling" action="view"><MillingBatchDetail /></ProtectedRoute>} />
        <Route path="/quality" element={<ProtectedRoute module="milling" action="view"><QualityComparison /></ProtectedRoute>} />
        <Route path="/transfer" element={<ProtectedRoute module="finance" action="view"><InternalTransfer /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute module="inventory" action="view"><Inventory /></ProtectedRoute>} />
        <Route path="/lot-inventory" element={<ProtectedRoute module="inventory" action="view"><LotInventory /></ProtectedRoute>} />
        <Route path="/stock-summary" element={<ProtectedRoute module="inventory" action="view"><StockSummary /></ProtectedRoute>} />
        <Route path="/stock-count" element={<ProtectedRoute module="inventory" action="view"><StockCount /></ProtectedRoute>} />
        <Route path="/local-sales" element={<ProtectedRoute module="inventory" action="view"><LocalSales /></ProtectedRoute>} />
        <Route path="/local-sales/:id/invoice" element={<ProtectedRoute module="inventory" action="view"><InvoiceView /></ProtectedRoute>} />
        <Route path="/local-sales/:id/print" element={<ProtectedRoute module="inventory" action="view"><InvoiceView /></ProtectedRoute>} />
        <Route path="/local-sales/:id" element={<ProtectedRoute module="inventory" action="view"><LocalSaleDetail /></ProtectedRoute>} />
        <Route path="/lot-inventory/:id/purchase-invoice" element={<ProtectedRoute module="inventory" action="view"><PurchaseInvoiceView /></ProtectedRoute>} />
        <Route path="/lot-inventory/:id" element={<ProtectedRoute module="inventory" action="view"><LotDetail /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute module="documents" action="view"><Documents /></ProtectedRoute>} />
        {/* Mill Store — was previously only in MillRoutes, so non-Mill-Manager
            roles (Super Admin / Owner) couldn't reach the New Purchase form
            and got bounced to the dashboard by the catch-all. */}
        <Route path="/mill-store"               element={<ProtectedRoute module="mill_store" action="view"><StoreOverview /></ProtectedRoute>} />
        <Route path="/mill-store/purchases/new" element={<ProtectedRoute module="mill_store" action="create_purchase"><NewPurchase /></ProtectedRoute>} />
        <Route path="/mill-store/alerts"        element={<ProtectedRoute module="mill_store" action="view"><StoreAlerts /></ProtectedRoute>} />
        <Route path="/mill-store/adjustments"   element={<ProtectedRoute module="mill_store" action="view"><StoreAdjustments /></ProtectedRoute>} />
        <Route path="/mill-store/ratios"        element={<ProtectedRoute module="mill_store" action="view"><StoreRatios /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute module="reports" action="view"><Reports /></ProtectedRoute>} />
        <Route path="/reports/print" element={<ProtectedRoute module="reports" action="view"><PrintableReports /></ProtectedRoute>} />
        <Route path="/reports/lots" element={<ProtectedRoute module="reports" action="view"><LotReport /></ProtectedRoute>} />
        <Route path="/reports/invoices" element={<ProtectedRoute module="reports" action="view"><InvoiceLedger /></ProtectedRoute>} />
        <Route path="/reports/payroll" element={<ProtectedRoute module="reports" action="view"><PayrollLedger /></ProtectedRoute>} />
        <Route path="/reports/payroll-analytics" element={<ProtectedRoute module="reports" action="view"><PayrollAnalytics /></ProtectedRoute>} />
        <Route path="/reports/lot-ledger/:id" element={<ProtectedRoute module="reports" action="view"><LotLedger /></ProtectedRoute>} />
        <Route path="/reports/batch-ledger/:id" element={<ProtectedRoute module="reports" action="view"><BatchLedger /></ProtectedRoute>} />
        <Route path="/exceptions" element={<ProtectedRoute module="admin" action="view"><ExceptionDashboard /></ProtectedRoute>} />
        <Route path="/ai" element={<AiAssistant />} />
        <Route path="/intelligence" element={<ProtectedRoute anyOf={[{ module: 'finance', action: 'view' }, { module: 'admin', action: 'view' }]}><Intelligence /></ProtectedRoute>} />
        <Route path="/simulator" element={<ProtectedRoute anyOf={[{ module: 'finance', action: 'view' }, { module: 'admin', action: 'view' }]}><ScenarioSimulator /></ProtectedRoute>} />
        <Route path="/approvals" element={<ProtectedRoute module="admin" action="view"><Approvals /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute module="admin" action="view"><AuditLog /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute module="admin" action="view"><Admin /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function RoleGatedShell() {
  const { user } = useAuth();
  if (user?.role === 'Mill Manager') return <MillRoutes />;
  if (user?.role === 'Export Manager') return <ExportRoutes />;
  return <StandardRoutes />;
}

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <OwnerAuthProvider>
          <Suspense fallback={<LoadingSpinner message="Loading page..." />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              {/* Employee self-service portal — fully public (own CNIC+PIN auth),
                  mounted OUTSIDE the staff app shell / ProtectedRoute. */}
              <Route path="/portal" element={<EmployeePortal />} />
              {/* Standalone print page — mounted OUTSIDE the app shell
                  so the browser prints a clean document (no sidebar /
                  header / scroll container fight). */}
              <Route
                path="/print-report"
                element={
                  <ProtectedRoute module="reports" action="view">
                    <StandalonePrintReport />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <RoleGatedShell />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
          <Toast />
          <QueryErrorHandler />
          </OwnerAuthProvider>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
