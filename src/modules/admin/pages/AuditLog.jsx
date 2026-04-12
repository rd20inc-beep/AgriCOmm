import { useState, useMemo } from 'react';
import { Shield, Search, Filter, Clock, User, FileText, Eye, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAuditLogs } from '../../../api/queries';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import Modal from '../../../components/Modal';

const ACTION_COLORS = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  approve: 'bg-emerald-100 text-emerald-700',
  reject: 'bg-orange-100 text-orange-700',
  login: 'bg-indigo-100 text-indigo-700',
  confirm: 'bg-cyan-100 text-cyan-700',
  status_change: 'bg-violet-100 text-violet-700',
};

function getActionColor(action) {
  const lower = (action || '').toLowerCase();
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return 'bg-gray-100 text-gray-700';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DiffViewer({ before, after }) {
  if (!before && !after) return <p className="text-sm text-gray-400 italic">No change details available</p>;
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];

  allKeys.forEach(key => {
    const b = before?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push({ key, before: b, after: a });
    }
  });

  if (changes.length === 0) return <p className="text-sm text-gray-400 italic">No field changes detected</p>;

  return (
    <div className="space-y-2">
      {changes.map(({ key, before: b, after: a }) => (
        <div key={key} className="grid grid-cols-3 gap-2 text-xs border-b border-gray-100 pb-2">
          <div className="font-medium text-gray-700 break-all">{key}</div>
          <div className="text-red-600 bg-red-50 px-2 py-1 rounded break-all">
            {b !== undefined ? (typeof b === 'object' ? JSON.stringify(b) : String(b)) : <span className="text-gray-400">—</span>}
          </div>
          <div className="text-green-600 bg-green-50 px-2 py-1 rounded break-all">
            {a !== undefined ? (typeof a === 'object' ? JSON.stringify(a) : String(a)) : <span className="text-gray-400">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AuditLog() {
  const [actionFilter, setActionFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  const { data: logs = [], isLoading, error, refetch } = useAuditLogs({
    ...(actionFilter !== 'All' && { action: actionFilter }),
    ...(entityFilter !== 'All' && { entity_type: entityFilter }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  });

  // Derive filter options from data
  const actions = useMemo(() => ['All', ...new Set(logs.map(l => l.action).filter(Boolean))], [logs]);
  const entityTypes = useMemo(() => ['All', ...new Set(logs.map(l => l.entityType).filter(Boolean))], [logs]);

  const filtered = useMemo(() => {
    if (!searchTerm) return logs;
    const term = searchTerm.toLowerCase();
    return logs.filter(l =>
      (l.action || '').toLowerCase().includes(term) ||
      (l.entityType || '').toLowerCase().includes(term) ||
      (l.entityId || '').toString().includes(term) ||
      (l.userName || l.userEmail || '').toLowerCase().includes(term) ||
      JSON.stringify(l.details || {}).toLowerCase().includes(term)
    );
  }, [logs, searchTerm]);

  if (isLoading) return <LoadingSpinner message="Loading audit trail..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-600" />
            Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Complete record of all system actions</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Entries</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{logs.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Creates</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{logs.filter(l => (l.action || '').toLowerCase().includes('create')).length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Updates</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{logs.filter(l => (l.action || '').toLowerCase().includes('update')).length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Financial</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{logs.filter(l => (l.action || '').toLowerCase().includes('confirm') || (l.action || '').toLowerCase().includes('payment')).length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search actions, entities, users..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none">
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none">
          {entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none" placeholder="From" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none" placeholder="To" />
      </div>

      {/* Table */}
      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Timestamp</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Action</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Entity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Entity ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">IP Address</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((log, i) => (
                <tr key={log.id || i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {formatDate(log.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-indigo-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{log.userName || log.userEmail || 'System'}</div>
                        {log.userEmail && log.userName && <div className="text-xs text-gray-400">{log.userEmail}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{log.entityType || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.entityId || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.ipAddress || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    No audit log entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)} title="Audit Log Detail" size="lg">
        {selectedLog && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Action</p>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium mt-1 ${getActionColor(selectedLog.action)}`}>
                  {selectedLog.action}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Timestamp</p>
                <p className="text-sm text-gray-900 mt-1">{formatDate(selectedLog.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">User</p>
                <p className="text-sm text-gray-900 mt-1">{selectedLog.userName || selectedLog.userEmail || 'System'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Entity</p>
                <p className="text-sm text-gray-900 mt-1">{selectedLog.entityType} #{selectedLog.entityId}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">IP Address</p>
                <p className="text-sm font-mono text-gray-600 mt-1">{selectedLog.ipAddress || '—'}</p>
              </div>
            </div>

            {/* Changes */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Change Details
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-500 uppercase mb-2 pb-2 border-b border-gray-200">
                  <div>Field</div>
                  <div>Before</div>
                  <div>After</div>
                </div>
                <DiffViewer
                  before={selectedLog.details?.before || selectedLog.details?.previousData}
                  after={selectedLog.details?.after || selectedLog.details?.body || selectedLog.details?.newData}
                />
              </div>
            </div>

            {/* Raw Details */}
            {selectedLog.details && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Raw Data</h3>
                <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto max-h-64">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
