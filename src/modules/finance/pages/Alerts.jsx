import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, AlertCircle, Info, Clock, ArrowUpRight } from 'lucide-react';
import { FinanceKPI } from '../../../components/finance';
import { useFinanceAlerts } from '../../../api/queries';
import { alertSeverity } from '../utils/alerts';
import { financeHref } from '../financeNav';
import { useFinanceDateRange } from '../hooks/useFinanceDateRange';
import { EmptyLine } from '../components/FinanceUI';
import { btnRowSecondary } from '../utils/uiClasses';

// Same look as Home's Needs Attention: a white card with a coloured edge, a
// different icon per severity and the severity in words — never colour alone.
const SEVERITY_CONFIG = {
  danger:  { edge: 'border-l-red-500',   icon: AlertTriangle, iconColor: 'text-red-600',   word: 'Critical' },
  warning: { edge: 'border-l-amber-500', icon: AlertCircle,   iconColor: 'text-amber-600', word: 'Warning' },
  info:    { edge: 'border-l-blue-400',  icon: Info,          iconColor: 'text-blue-600',  word: 'Info' },
};

// 'Resolved' was removed — alerts are computed from live conditions
// (overdue receivables, low stock, etc.) so clicking Resolve never
// persisted; fix the underlying condition and the alert auto-clears.
const FILTER_TABS = ['All', 'Critical', 'Warning', 'Info'];

export default function Alerts() {
  const navigate = useNavigate();
  const { rangeKey } = useFinanceDateRange();
  const { data: alertsData = [], isLoading } = useFinanceAlerts();
  const [filter, setFilter] = useState('All');
  // Local-only dismiss set so the user can hide a noisy alert this
  // session. There is no backend resolve endpoint — alerts are
  // recomputed from live conditions on each refresh.
  const [dismissed, setDismissed] = useState(new Set());

  const alerts = useMemo(() => {
    return alertsData
      .filter(a => !dismissed.has(a.id))
      .map(a => ({ ...a, severity: alertSeverity(a) }));
  }, [alertsData, dismissed]);

  const filtered = useMemo(() => {
    return alerts.filter(a => {
      if (filter === 'Critical') return a.severity === 'danger';
      if (filter === 'Warning') return a.severity === 'warning';
      if (filter === 'Info') return a.severity === 'info';
      return true;
    });
  }, [alerts, filter]);

  const criticalCount = alerts.filter(a => a.severity === 'danger').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  function handleDismiss(id) {
    setDismissed(prev => new Set([...prev, id]));
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
        <FinanceKPI icon={Info} title="Informational" value={String(infoCount)}
          status="info" loading={isLoading} />
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 w-fit" role="group" aria-label="Severity">
        {FILTER_TABS.map(t => (
          <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(t)}
            className={`px-3 min-h-10 sm:min-h-8 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              filter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}
            {t !== 'All' && (
              <span className="ml-1 text-xs tabular-nums">{
                t === 'Critical' ? criticalCount : t === 'Warning' ? warningCount : infoCount
              }</span>
            )}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <EmptyLine icon={Bell}>No alerts match the current filter.</EmptyLine>
          </div>
        )}
        {filtered.map((alert, i) => {
          const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
          const Icon = config.icon;
          return (
            <div key={alert.id || i}
              onClick={() => alert.link && navigate(financeHref(alert.link, rangeKey))}
              onKeyDown={(e) => { if (alert.link && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); navigate(financeHref(alert.link, rangeKey)); } }}
              role={alert.link ? 'link' : undefined} tabIndex={alert.link ? 0 : undefined}
              className={`bg-white border border-gray-200 border-l-4 ${config.edge} rounded-xl p-4 ${alert.link ? 'cursor-pointer hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''}`}>
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <Icon size={18} className={`${config.iconColor} mt-0.5 flex-shrink-0`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-gray-900">{alert.title}</h4>
                      <span className={`text-xs font-medium ${config.iconColor}`}>{config.word}</span>
                      {alert.link && <ArrowUpRight size={14} className="text-gray-400" aria-hidden="true" />}
                    </div>
                    <p className="text-sm text-gray-600">{alert.message}</p>
                    {alert.date && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Clock size={12} aria-hidden="true" /> {alert.date}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDismiss(alert.id); }}
                    title="Hide this alert in the current session. Alerts are recomputed on refresh — fix the underlying condition to make it go away."
                    className={btnRowSecondary}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
