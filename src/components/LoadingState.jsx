import { Loader2, AlertCircle, RefreshCw, Inbox } from 'lucide-react';

export function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 w-full min-h-[50vh]">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export function LoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-xl">
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );
}

export function ErrorState({ message = 'Something went wrong', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-red-500" />
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">Error</p>
      <p className="text-sm text-gray-500 mb-5 text-center max-w-sm px-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn btn-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">{title || 'No data'}</p>
      {description && <p className="text-sm text-gray-500 mb-5 text-center max-w-sm px-4">{description}</p>}
      {action}
    </div>
  );
}

/**
 * Wrapper that shows loading/error/empty states automatically.
 */
export default function DataWrapper({ loading, error, data, onRetry, children, emptyMessage, emptyIcon }) {
  if (loading && !data) return <LoadingSpinner />;
  if (error && !data) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return <EmptyState title={emptyMessage || 'No data available'} icon={emptyIcon} />;
  }
  return (
    <div className="relative">
      {loading && <LoadingOverlay />}
      {typeof children === 'function' ? children(data) : children}
    </div>
  );
}
