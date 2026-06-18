import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureException } from '../utils/errorReporter';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[RiceFlow] Error caught by boundary:', error, info);
    captureException(error, {
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false, error: null });
      const message = this.state.error?.message || 'Something went wrong rendering this page.';

      // Scoped (content-pane) fallback — fits inside the layout's <main> so the
      // sidebar + header stay mounted. "Try again" re-renders this page in place;
      // navigating to another page also clears it (the wrapper is keyed by route).
      if (this.props.scoped) {
        return (
          <div className="flex items-center justify-center min-h-[60vh] p-6">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1.5">This page hit an error</h2>
              <p className="text-sm text-gray-500 mb-6 break-words">{message}</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Try again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  Reload
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Full-screen fallback — last-resort (whole shell), e.g. providers/router.
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-6">{message}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Content-pane error boundary keyed by route — a crashing page shows the scoped
 * fallback in the right pane while the sidebar/header stay; navigating to another
 * route remounts it (key change) so the next page renders fresh.
 */
export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary scoped key={pathname}>
      {children}
    </ErrorBoundary>
  );
}
