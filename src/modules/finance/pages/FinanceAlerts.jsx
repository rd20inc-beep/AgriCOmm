import { useState, useMemo, useEffect } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Shield,
  Eye,
  Clock,
  CheckCircle2,
  ArrowUpRight,
  Filter,
  DollarSign,
} from 'lucide-react';
import { useFinanceAlerts } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';

function formatRisk(value) {
  if (!value) return '--';
  return value.toLocaleString('en-US');
}

const severityConfig = {
  critical: {
    bar: 'bg-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: AlertCircle,
    iconColor: 'text-red-600',
    label: 'Critical',
    labelBg: 'bg-red-100 text-red-700',
  },
  warning: {
    bar: 'bg-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: AlertTriangle,
    iconColor: 'text-amber-600',
    label: 'Warning',
    labelBg: 'bg-amber-100 text-amber-700',
  },
  info: {
    bar: 'bg-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: Info,
    iconColor: 'text-blue-600',
    label: 'Info',
    labelBg: 'bg-blue-100 text-blue-700',
  },
};

export default function FinanceAlerts() {
  const { addToast } = useApp();
  const { data: apiAlerts = [] } = useFinanceAlerts();
  const [alerts, setAlerts] = useState([]);
  const [severityFilter, setSeverityFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Open');

  // Persist snooze/resolve state in localStorage (alerts are computed on-the-fly, no DB table)
  const STORAGE_KEY = 'riceflow_alert_actions';
  function getStoredActions() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function storeAction(alertId, status) {
    const actions = getStoredActions();
    actions[alertId] = { status, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  }

  // Sync from API when data arrives, applying stored actions
  useEffect(() => {
    if (apiAlerts.length > 0) {
      const stored = getStoredActions();
      // Expire stored actions older than 7 days
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const merged = apiAlerts.map(a => {
        const action = stored[a.id];
        if (action && action.timestamp > weekAgo) {
          return { ...a, status: action.status };
        }
        return a;
      });
      setAlerts(merged);
    }
  }, [apiAlerts]);

  const entities = ['All', ...new Set((apiAlerts.length > 0 ? apiAlerts : alerts).map((a) => a.entity).filter(Boolean))];

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (severityFilter !== 'All' && a.severity !== severityFilter.toLowerCase()) return false;
      if (entityFilter !== 'All' && a.entity !== entityFilter) return false;
      if (statusFilter !== 'All' && a.status !== statusFilter) return false;
      return true;
    });
  }, [alerts, severityFilter, entityFilter, statusFilter]);

  // Summary counts
  const summary = useMemo(() => {
    const critical = alerts.filter((a) => a.severity === 'critical' && a.status === 'Open').length;
    const warnings = alerts.filter((a) => a.severity === 'warning' && a.status === 'Open').length;
    const info = alerts.filter((a) => a.severity === 'info' && a.status === 'Open').length;
    const totalAtRisk = alerts
      .filter((a) => a.status === 'Open')
      .reduce((sum, a) => sum + (parseFloat(a.amountAtRisk) || 0), 0);
    return { critical, warnings, info, totalAtRisk };
  }, [alerts]);

  function handleViewDetail(alert) {
    addToast(`Viewing details for: ${alert.title}`);
  }

  function handleSnooze(alertId) {
    storeAction(alertId, 'Snoozed');
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: 'Snoozed' } : a))
    );
    addToast('Alert snoozed for 7 days', 'success');
  }

  function handleResolve(alertId) {
    storeAction(alertId, 'Resolved');
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: 'Resolved' } : a))
    );
    addToast('Alert resolved', 'success');
  }

  function handleEscalate(alert) {
    storeAction(alert.id, 'Escalated');
    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, status: 'Escalated' } : a))
    );
    addToast(`Escalated: ${alert.title} — flagged for senior management`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Finance Alerts</h1>

      {/* Summary Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm font-semibold text-gray-700">
              {summary.critical} Critical
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm font-semibold text-gray-700">
              {summary.warnings} Warnings
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-sm font-semibold text-gray-700">
              {summary.info} Info
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DollarSign size={16} className="text-red-500" />
            <span className="text-sm text-gray-500">Total Amount at Risk:</span>
            <span className="text-sm font-bold text-red-600">
              {formatRisk(summary.totalAtRisk)}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <span className="text-sm text-gray-600">Severity:</span>
            {['All', 'Critical', 'Warning', 'Info'].map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  severityFilter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Entity:</span>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e === 'All' ? 'All Entities' : e}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Status:</span>
            {['All', 'Open', 'Snoozed', 'Resolved'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alert Cards */}
      <div className="space-y-4">
        {filtered.map((alert) => {
          const config = severityConfig[alert.severity];
          const SevIcon = config.icon;

          return (
            <div
              key={alert.id}
              className={`relative bg-white rounded-xl border ${config.border} overflow-hidden ${
                alert.status !== 'Open' ? 'opacity-60' : ''
              }`}
            >
              {/* Severity bar on left */}
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${config.bar}`} />

              <div className="pl-6 pr-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Left content */}
                  <div className="flex-1 space-y-3">
                    {/* Title row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <SevIcon size={18} className={config.iconColor} />
                      <h3 className="text-sm font-semibold text-gray-900">{alert.title}</h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.labelBg}`}
                      >
                        {config.label}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          alert.entity === 'Export'
                            ? 'bg-blue-100 text-blue-700'
                            : alert.entity === 'Mill'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {alert.entity}
                      </span>
                      {alert.status !== 'Open' && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            alert.status === 'Snoozed'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {alert.status}
                        </span>
                      )}
                    </div>

                    {/* Summary */}
                    <p className="text-sm text-gray-600">{alert.summary}</p>

                    {/* Amount and age */}
                    <div className="flex items-center gap-6">
                      {alert.amountAtRisk > 0 && (
                        <div className="flex items-center gap-1.5">
                          <DollarSign size={14} className="text-red-500" />
                          <span className="text-sm text-gray-500">Amount at Risk:</span>
                          <span className="text-sm font-bold text-gray-900">
                            {formatRisk(alert.amountAtRisk)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-500">{alert.ageDays} days</span>
                      </div>
                    </div>

                    {/* Recommended action */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1 font-medium">Recommended Action</p>
                      <p className="text-sm text-gray-700">{alert.recommendedAction}</p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => handleViewDetail(alert)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Eye size={14} />
                    View Detail
                  </button>
                  {alert.status === 'Open' && (
                    <>
                      <button
                        onClick={() => handleSnooze(alert.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                      >
                        <Clock size={14} />
                        Snooze
                      </button>
                      <button
                        onClick={() => handleResolve(alert.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        <CheckCircle2 size={14} />
                        Resolve
                      </button>
                      <button
                        onClick={() => handleEscalate(alert)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <ArrowUpRight size={14} />
                        Escalate
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Shield size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">No alerts match the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}
