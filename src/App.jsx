import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Toast from './components/Toast';
import QueryErrorHandler from './components/QueryErrorHandler';
import { LoadingSpinner } from './components/LoadingState';

// Lazy-loaded page components
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Buyers = lazy(() => import('./pages/Buyers'));
const AdvancePayments = lazy(() => import('./pages/AdvancePayments'));
const ExportOrders = lazy(() => import('./pages/ExportOrders'));
const CreateExportOrder = lazy(() => import('./pages/CreateExportOrder'));
const ExportOrderDetail = lazy(() => import('./pages/ExportOrderDetail'));
const MillingDashboard = lazy(() => import('./pages/MillingDashboard'));
const MillingBatchDetail = lazy(() => import('./pages/MillingBatchDetail'));
const QualityComparison = lazy(() => import('./pages/QualityComparison'));
const InternalTransfer = lazy(() => import('./pages/InternalTransfer'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Documents = lazy(() => import('./pages/Documents'));
const Reports = lazy(() => import('./pages/Reports'));
const Approvals = lazy(() => import('./pages/Approvals'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const LotInventory = lazy(() => import('./pages/LotInventory'));
const LocalSales = lazy(() => import('./pages/LocalSales'));
const LotDetail = lazy(() => import('./pages/LotDetail'));
const ExceptionDashboard = lazy(() => import('./pages/ExceptionDashboard'));
const Intelligence = lazy(() => import('./pages/Intelligence'));
const ScenarioSimulator = lazy(() => import('./pages/ScenarioSimulator'));
const Admin = lazy(() => import('./pages/Admin'));

// Finance sub-pages (lazy)
const FinanceLayout = lazy(() => import('./pages/finance/FinanceLayout'));
const FinanceOverview = lazy(() => import('./pages/finance/FinanceOverview'));
const Receivables = lazy(() => import('./pages/finance/Receivables'));
const Payables = lazy(() => import('./pages/finance/Payables'));
const FinanceConfirmations = lazy(() => import('./pages/finance/Confirmations'));
const CostAllocation = lazy(() => import('./pages/finance/CostAllocation'));
const FinanceTransfers = lazy(() => import('./pages/finance/InternalTransfers'));
const Profitability = lazy(() => import('./pages/finance/Profitability'));
const CashBank = lazy(() => import('./pages/finance/CashBank'));
const Ledger = lazy(() => import('./pages/finance/Ledger'));
const FinanceAlerts = lazy(() => import('./pages/finance/FinanceAlerts'));
const Reconciliation = lazy(() => import('./pages/finance/Reconciliation'));

function FinanceRoutes() {
  return (
    <FinanceLayout>
      <Routes>
        <Route index element={<FinanceOverview />} />
        <Route path="receivables" element={<Receivables />} />
        <Route path="payables" element={<Payables />} />
        <Route path="confirmations" element={<FinanceConfirmations />} />
        <Route path="costs" element={<CostAllocation />} />
        <Route path="transfers" element={<FinanceTransfers />} />
        <Route path="profitability" element={<Profitability />} />
        <Route path="cash" element={<CashBank />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="alerts" element={<FinanceAlerts />} />
        <Route path="reconciliation" element={<Reconciliation />} />
      </Routes>
    </FinanceLayout>
  );
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
