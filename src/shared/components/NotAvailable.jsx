import { Link, useLocation } from 'react-router-dom';
import { Compass, ArrowLeft, Home } from 'lucide-react';

// Shown for a URL that is not a page in this app (P5-05) — instead of the old
// silent redirect to the dashboard, which made a link look like it "did
// nothing". A page that exists but needs a permission the user lacks shows
// ProtectedRoute's Access Denied instead.
export default function NotAvailable() {
  const location = useLocation();
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4" data-testid="not-available">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-amber-50 mb-4">
          <Compass size={24} className="text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Not available in your workspace</h2>
        <p className="text-sm text-slate-500 mb-1">
          There is no page at <span className="font-mono text-slate-700 break-all">{location.pathname}</span>.
        </p>
        <p className="text-sm text-slate-500 mb-6">The link may be out of date. Use the menu or search to find what you need.</p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <ArrowLeft size={16} /> Go back
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Home size={16} /> Home
          </Link>
        </div>
      </div>
    </div>
  );
}
