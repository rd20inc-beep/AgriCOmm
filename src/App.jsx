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
                        <Route path="/export" element={<ExportOrders />} />
                        <Route path="/export/create" element={<CreateExportOrder />} />
                        <Route path="/export/:id" element={<ExportOrderDetail />} />
                        <Route path="/finance/*" element={<FinanceRoutes />} />
                        <Route path="/milling" element={<MillingDashboard />} />
                        <Route path="/milling/:id" element={<MillingBatchDetail />} />
                        <Route path="/quality" element={<QualityComparison />} />
                        <Route path="/transfer" element={<InternalTransfer />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/lot-inventory" element={<LotInventory />} />
                        <Route path="/local-sales" element={<LocalSales />} />
                        <Route path="/lot-inventory/:id" element={<LotDetail />} />
                        <Route path="/documents" element={<Documents />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/exceptions" element={<ExceptionDashboard />} />
                        <Route path="/intelligence" element={<Intelligence />} />
                        <Route path="/simulator" element={<ScenarioSimulator />} />
                        <Route path="/approvals" element={<Approvals />} />
                        <Route path="/audit" element={<AuditLog />} />
                        <Route path="/admin" element={<Admin />} />
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
