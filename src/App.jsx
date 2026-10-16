import { Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { OwnerAuthProvider } from './context/OwnerAuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import Toast from './components/Toast';
import QueryErrorHandler from './components/QueryErrorHandler';
import { LoadingSpinner } from './components/LoadingState';
import {
  AppRoutes, Login, ResetPassword, ChangePassword, EmployeePortal, StandalonePrintReport,
} from './app/routeTable';

// The signed-in app: ONE shell (components/Layout) for every role, ONE route
// table (app/routeTable + app/routeGates). The shell and the home dashboard
// are chosen by permission set (app/workspace), not by the role's name.
//
// #9 A user flagged force_password_change sees only the change-password
// screen, outside the shell, until they set a new password (ProtectedRoute
// sends every other URL there; the backend clears the flag on success).
function SignedInApp() {
  const { user } = useAuth();
  const mustChangePw = !!(user?.force_password_change || user?.forcePasswordChange);
  if (mustChangePw) return <ChangePassword />;
  return (
    <Layout>
      <AppRoutes />
    </Layout>
  );
}

// Everything that needs the router (AuthProvider navigates on logout/expiry,
// every page reads the location) renders inside the one root route.
function RootProviders() {
  return (
    <AuthProvider>
      <AppProvider>
        <OwnerAuthProvider>
        <Suspense fallback={<LoadingSpinner message="Loading page..." />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Public: target of the emailed / admin-issued password-reset link. */}
            <Route path="/reset-password" element={<ResetPassword />} />
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
            {/* Everything else — including /profile and /change-password —
                renders inside the one shell. */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <SignedInApp />
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
  );
}

// A data router (was <BrowserRouter>) so unsaved-change guards (useBlocker /
// useDirtyGuard) can also intercept the browser Back button. One splat root
// route; the app's own <Routes> tables below it are unchanged, so every URL
// resolves exactly as before. The app ErrorBoundary sits inside the route as
// well, so a render error shows our own crash card, not the router's default
// error page.
const router = createBrowserRouter([
  { path: '*', element: <ErrorBoundary><RootProviders /></ErrorBoundary> },
]);

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
