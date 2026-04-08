import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

const alertBorderColors = {
  danger: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
};

const alertBgColors = {
  danger: 'bg-red-50',
  warning: 'bg-amber-50',
  info: 'bg-blue-50',
};

const alertIconColors = {
  danger: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export default function AlertsPanel({ filteredAlerts, entityFilter, dismissAlert }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          Alerts
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-400">
            {filteredAlerts.length} active{entityFilter !== 'All' ? ` (${entityFilter})` : ''}
          </span>
          <Link to="/finance/alerts" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All &rarr;</Link>
        </div>
      </div>
      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {filteredAlerts.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            No active alerts
          </div>
        )}
        {filteredAlerts.map((alert) => (
          <div
            key={alert.id}
            className={`relative border-l-4 ${alertBorderColors[alert.type]} ${alertBgColors[alert.type]} rounded-r-lg p-3 group`}
          >
            <button
              onClick={() => dismissAlert(alert.id)}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/60"
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <Link
              to={
                alert.orderId
                  ? `/export/${alert.orderId}`
                  : alert.batchId
                    ? `/milling/${alert.batchId}`
                    : '#'
              }
              className="block w-full overflow-hidden"
            >
              <div className="flex items-start gap-2 pr-5">
                <AlertTriangle
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${alertIconColors[alert.type]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-800 leading-tight break-words">
                    {alert.title}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 leading-relaxed break-words">
                    {alert.message}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {alert.date}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
