import { useState, useMemo } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle, Clock } from 'lucide-react';
import { FinanceKPI } from '../../components/finance';
import { useFinanceAlerts } from '../../api/queries';

const SEVERITY_CONFIG = {
  danger:  { bg: 'bg-red-50',   border: 'border-red-200',   dot: 'bg-red-500',   icon: AlertTriangle, iconColor: 'text-red-500' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', icon: AlertCircle,   iconColor: 'text-amber-500' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-200',  dot: 'bg-blue-500',  icon: Info,          iconColor: 'text-blue-500' },
};

const FILTER_TABS = ['All', 'Critical', 'Warning', 'Info', 'Resolved'];

export default function Alerts() {
  const { data: alertsData = [], isLoading } = useFinanceAlerts();
  const [filter, setFilter] = useState('All');
  const [resolved, setResolved] = useState(new Set());

  const alerts = useMemo(() => {
    return alertsData.map(a => ({
      ...a,
      severity: a.type === 'danger' ? 'danger' : a.type === 'warning' ? 'warning' : 'info',
      isResolved: resolved.has(a.id),
    }));
  }, [alertsData, resolved]);

  const filtered = useMemo(() => {
    return alerts.filter(a => {
      if (filter === 'Resolved') return a.isResolved;
      if (filter === 'Critical') return a.severity === 'danger' && !a.isResolved;
      if (filter === 'Warning') return a.severity === 'warning' && !a.isResolved;
      if (filter === 'Info') return a.severity === 'info' && !a.isResolved;
      return true;
    });
  }, [alerts, filter]);

  const criticalCount = alerts.filter(a => a.severity === 'danger' && !a.isResolved).length;
  const warningCount = alerts.filter(a => a.severity === 'warning' && !a.isResolved).length;
  const resolvedCount = alerts.filter(a => a.isResolved).length;

  function handleResolve(id) {
    setResolved(prev => new Set([...prev, id]));
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceKPI icon={Bell} title="Total Alerts" value={String(alerts.length)}
          subtitle="All alerts" status="info" loading={isLoading} />
        <FinanceKPI icon={AlertTriangle} title="Critical" value={String(criticalCount)}
          status={criticalCount > 0 ? 'danger' : 'good'} loading={isLoading} />
        <FinanceKPI icon={AlertCircle} title="Warnings" value={String(warningCount)}
          status={warningCount > 0 ? 'warning' : 'good'} loading={isLoading} />
        <FinanceKPI icon={CheckCircle} title="Resolved" value={String(resolvedCount)}
          status="good" loading={isLoading} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {FILTER_TABS.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}
            {t !== 'All' && t !== 'Resolved' && (
              <span className="ml-1 text-xs">{
                t === 'Critical' ? criticalCount : t === 'Warning' ? warningCount : alerts.filter(a => a.severity === 'info' && !a.isResolved).length
              }</span>
            )}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            No alerts match the current filter
          </div>
        )}
        {filtered.map((alert, i) => {
          const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
          const Icon = config.icon;
          return (
            <div key={alert.id || i}
              className={`${config.bg} border ${config.border} rounded-xl p-4 transition-opacity ${alert.isResolved ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3">
                <Icon size={18} className={`${config.iconColor} mt-0.5 flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-gray-900">{alert.title}</h4>
                    <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                    {alert.isResolved && (
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Resolved</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{alert.message}</p>
                  {alert.date && (
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Clock size={11} /> {alert.date}
                    </p>
                  )}
                </div>
                {!alert.isResolved && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleResolve(alert.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium">
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
