import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import MillLayout from './components/MillLayout';
import ExportLayout from './components/ExportLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import Toast from './components/Toast';
import QueryErrorHandler from './components/QueryErrorHandler';
import { LoadingSpinner } from './components/LoadingState';

// Lazy-loaded page components (pointing at modular locations)
const Login = lazy(() => import('./modules/admin/pages/Login'));
const Dashboard = lazy(() => import('./modules/dashboard/pages/Dashboard'));
const Buyers = lazy(() => import('./modules/exportOrders/pages/Buyers'));
const AdvancePayments = lazy(() => import('./modules/exportOrders/pages/AdvancePayments'));
const ExportOrders = lazy(() => import('./modules/exportOrders/pages/ExportOrders'));
const CreateExportOrder = lazy(() => import('./modules/exportOrders/pages/CreateExportOrder'));
const ExportOrderDetail = lazy(() => import('./modules/exportOrders/pages/ExportOrderDetail'));
const ExportHomeDashboard = lazy(() => import('./modules/exportOrders/pages/ExportHomeDashboard'));
const MillingDashboard = lazy(() => import('./modules/milling/pages/MillingDashboard'));
const MillingBatchDetail = lazy(() => import('./modules/milling/pages/MillingBatchDetail'));
const MillFinanceDashboard = lazy(() => import('./modules/milling/pages/MillFinanceDashboard'));
const QualityComparison = lazy(() => import('./modules/milling/pages/QualityComparison'));
const StockAdjustments = lazy(() => import('./modules/inventory/pages/StockAdjustments'));
const InternalTransfer = lazy(() => import('./modules/inventory/pages/InternalTransfer'));
const Inventory = lazy(() => import('./modules/inventory/pages/Inventory'));
const Documents = lazy(() => import('./modules/documents/pages/Documents'));
const Reports = lazy(() => import('./modules/analytics/pages/Reports'));
const Approvals = lazy(() => import('./modules/admin/pages/Approvals'));
const AuditLog = lazy(() => import('./modules/admin/pages/AuditLog'));
const LotInventory = lazy(() => import('./modules/inventory/pages/LotInventory'));
const LocalSales = lazy(() => import('./modules/localSales/pages/LocalSales'));
const LotDetail = lazy(() => import('./modules/inventory/pages/LotDetail'));
const ExceptionDashboard = lazy(() => import('./modules/analytics/pages/ExceptionDashboard'));
const Intelligence = lazy(() => import('./modules/analytics/pages/Intelligence'));
const ScenarioSimulator = lazy(() => import('./modules/analytics/pages/ScenarioSimulator'));
const Admin = lazy(() => import('./modules/admin/pages/Admin'));

// Finance sub-pages (lazy) — money-flow structure
const FinanceLayout = lazy(() => import('./modules/finance/pages/FinanceLayout'));
const FinanceOverview = lazy(() => import('./modules/finance/pages/FinanceOverview'));
const MoneyIn = lazy(() => import('./modules/finance/pages/MoneyIn'));
const MoneyOut = lazy(() => import('./modules/finance/pages/MoneyOut'));
const Cash = lazy(() => import('./modules/finance/pages/Cash'));
const Profit = lazy(() => import('./modules/finance/pages/Profit'));
const Accounting = lazy(() => import('./modules/finance/pages/Accounting'));
const RatesCenter = lazy(() => import('./modules/finance/pages/RatesCenter'));
const FinanceAlerts = lazy(() => import('./modules/finance/pages/Alerts'));
// Legacy routes (still accessible via direct URL)
const Receivables = lazy(() => import('./modules/finance/pages/Receivables'));
const Payables = lazy(() => import('./modules/finance/pages/Payables'));
const FinanceConfirmations = lazy(() => import('./modules/finance/pages/Confirmations'));
const CostAllocation = lazy(() => import('./modules/finance/pages/CostAllocation'));
const FinanceTransfers = lazy(() => import('./modules/finance/pages/InternalTransfers'));
const Profitability = lazy(() => import('./modules/finance/pages/Profitability'));
const CashBank = lazy(() => import('./modules/finance/pages/CashBank'));
const Ledger = lazy(() => import('./modules/finance/pages/Ledger'));
const Reconciliation = lazy(() => import('./modules/finance/pages/Reconciliation'));

function FinanceRoutes() {
  return (
    <FinanceLayout>
      <Routes>
        {/* Primary money-flow tabs */}
        <Route index element={<FinanceOverview />} />
        <Route path="money-in" element={<MoneyIn />} />
        <Route path="money-out" element={<MoneyOut />} />
        <Route path="cash" element={<Cash />} />
        <Route path="profit" element={<Profit />} />
        <Route path="rates" element={<RatesCenter />} />
        <Route path="accounting" element={<Accounting />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ExportLayout>
  );
}

function MillRoutes() {
  return (
    <MillLayout>
      <Routes>
        <Route path="/" element={<MillingDashboard />} />
        <Route path="/milling" element={<MillingDashboard />} />
        <Route path="/milling/finance" element={<MillFinanceDashboard />} />
        <Route path="/milling/:id" element={<MillingBatchDetail />} />
        <Route path="/quality" element={<QualityComparison />} />
        <Route path="/stock-adjustments" element={<StockAdjustments />} />
        <Route path="/transfer" element={<InternalTransfer />} />
        <Route path="/lot-inventory" element={<LotInventory />} />
        <Route path="/lot-inventory/:id" element={<LotDetail />} />
        <Route path="/reports" element={<Reports />} />
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
        <Route path="/advances" element={<ProtectedRoute module="finance" action="view"><AdvancePayments /></ProtectedRoute>} />
        <Route path="/export" element={<ProtectedRoute module="export_orders" action="view"><ExportOrders /></ProtectedRoute>} />
        <Route path="/export/create" element={<ProtectedRoute module="export_orders" action="create"><CreateExportOrder /></ProtectedRoute>} />
        <Route path="/export/:id" element={<ProtectedRoute module="export_orders" action="view"><ExportOrderDetail /></ProtectedRoute>} />
        <Route path="/finance/*" element={<ProtectedRoute module="finance" action="view"><FinanceRoutes /></ProtectedRoute>} />
        <Route path="/milling" element={<ProtectedRoute module="milling" action="view"><MillingDashboard /></ProtectedRoute>} />
        <Route path="/milling/finance" element={<ProtectedRoute module="milling" action="view"><MillFinanceDashboard /></ProtectedRoute>} />
        <Route path="/stock-adjustments" element={<ProtectedRoute module="inventory" action="view"><StockAdjustments /></ProtectedRoute>} />
        <Route path="/milling/:id" element={<ProtectedRoute module="milling" action="view"><MillingBatchDetail /></ProtectedRoute>} />
        <Route path="/quality" element={<ProtectedRoute module="milling" action="view"><QualityComparison /></ProtectedRoute>} />
        <Route path="/transfer" element={<ProtectedRoute module="finance" action="view"><InternalTransfer /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute module="inventory" action="view"><Inventory /></ProtectedRoute>} />
        <Route path="/lot-inventory" element={<ProtectedRoute module="inventory" action="view"><LotInventory /></ProtectedRoute>} />
        <Route path="/local-sales" element={<ProtectedRoute module="inventory" action="view"><LocalSales /></ProtectedRoute>} />
        <Route path="/lot-inventory/:id" element={<ProtectedRoute module="inventory" action="view"><LotDetail /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute module="documents" action="view"><Documents /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute module="reports" action="view"><Reports /></ProtectedRoute>} />
        <Route path="/exceptions" element={<ProtectedRoute module="admin" action="view"><ExceptionDashboard /></ProtectedRoute>} />
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
          <Suspense fallback={<LoadingSpinner message="Loading page..." />}>
            <Routes>
              <Route path="/login" element={<Login />} />
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
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
