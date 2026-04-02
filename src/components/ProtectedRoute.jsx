import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowLeft } from 'lucide-react';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="inline-block w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="mt-4 text-sm text-slate-500 font-medium">Loading...</p>
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-red-50 mb-4">
          <Lock size={24} className="text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Access Denied
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          You do not have permission to access this page. Contact your administrator if you believe this is an error.
        </p>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={16} />
          Go Back
        </button>
      </div>
    </div>
  );
}

export default function ProtectedRoute({ children, module, action, anyOf = [] }) {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (module && action && !hasPermission(module, action)) return <AccessDenied />;
  if (anyOf.length > 0 && !anyOf.some((perm) => hasPermission(perm.module, perm.action))) {
    return <AccessDenied />;
  }

  return children;
}
