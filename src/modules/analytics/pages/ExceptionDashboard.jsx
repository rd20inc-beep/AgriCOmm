import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, AlertCircle, Clock, CheckCircle, Shield, Search,
  RefreshCw, ChevronRight, Zap, Ship, DollarSign, Package,
  FileText, TrendingDown, Eye, XCircle,
} from 'lucide-react';
import { useExceptions, useExceptionStats, useScanExceptions, useResolveException, useEscalateException } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState } from '../../../components/LoadingState';
import Modal from '../../../components/Modal';
import { fmtDateTime, fmtMoney } from '../../../shared/utils/format';

// The severities the scan stores (intelligence.service): critical / warning /
// info. The page used to offer High / Medium / Low, which never matched, and
// read stats.high / stats.resolvedToday, which were never sent (RPT-18).
const SEVERITY_CONFIG = {
  critical: { color: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', ring: 'ring-red-200', icon: AlertCircle },
  warning: { color: 'bg-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', ring: 'ring-amber-200', icon: AlertTriangle },
  info: { color: 'bg-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', ring: 'ring-blue-200', icon: Shield },
};
const SEVERITIES = ['critical', 'warning', 'info'];
// Money at risk is in the exception's own currency — never shown as $ by default.
const atRisk = (ex) => fmtMoney(Number(ex.amountAtRisk) || 0, ex.currency || 'USD', { decimals: 2 });
const entityHref = (ex) => (ex.linkedType === 'export_order' ? `/export/${ex.linkedRef}` : ex.linkedType === 'milling_batch' ? `/milling/${ex.linkedId || ex.linkedRef}` : null);

const TYPE_ICONS = {
  overdue_advance: Clock, overdue_balance: DollarSign, delayed_shipment: Ship,
  low_margin: TrendingDown, negative_margin: TrendingDown, missing_documents: FileText,
  qc_failure: AlertTriangle, stock_shortage: Package, high_cost_variance: DollarSign,
  yield_below_benchmark: TrendingDown,
};

const STATUS_TABS = ['Open', 'Acknowledged', 'Resolved'];

const formatDate = (d) => fmtDateTime(d);

export default function ExceptionDashboard() {
  const { addToast } = useApp();
  const [statusFilter, setStatusFilter] = useState('Open');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEx, setSelectedEx] = useState(null);
  const [resolveNotes, setResolveNotes] = useState('');

  // Severity filters on the server, so the list is not "200 rows then filter".
  const { data: exceptions = [], isLoading, error, refetch } = useExceptions({
    ...(statusFilter !== 'All' && { status: statusFilter }),
    ...(severityFilter !== 'All' && { severity: severityFilter }),
  });
  const { data: stats = {} } = useExceptionStats();
  const scanMutation = useScanExceptions();
  const resolveMutation = useResolveException();
  const escalateMutation = useEscalateException();

  const filtered = useMemo(() => {
    let list = exceptions;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(e =>
        (e.title || '').toLowerCase().includes(term) ||
        (e.linkedRef || '').toLowerCase().includes(term) ||
        (e.exceptionType || '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [exceptions, searchTerm]);

  async function handleScan() {
    try {
      await scanMutation.mutateAsync();
      addToast('Exception scan completed', 'success');
    } catch (err) {
      addToast(err.message || 'Scan failed', 'error');
    }
  }

  async function handleResolve(ex) {
    try {
      await resolveMutation.mutateAsync({ id: ex.id, data: { notes: resolveNotes } });
      addToast('Exception resolved', 'success');
      setSelectedEx(null);
      setResolveNotes('');
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  async function handleEscalate(ex) {
    try {
      await escalateMutation.mutateAsync(ex.id);
      addToast('Exception escalated to critical', 'warning');
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  if (isLoading) return <LoadingSpinner message="Loading exceptions..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  // Tiles are the server's counts over the whole inbox (not the loaded page).
  const openCount = stats.open ?? 0;
  const criticalCount = stats.critical ?? 0;
  const warningCount = stats.warning ?? 0;
  const riskLines = Object.entries(stats.amountAtRiskByCurrency || {});

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Exception Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Auto-detected issues requiring attention</p>
        </div>
        <button onClick={handleScan} disabled={scanMutation.isPending}
          className="btn btn-primary">
          <RefreshCw className={`w-4 h-4 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
          Run Scan
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Open</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{openCount}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <p className="text-xs font-medium text-red-600 uppercase">Critical</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{criticalCount}</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <p className="text-xs font-medium text-amber-600 uppercase">Warning</p>
          <p className="text-3xl font-bold text-amber-700 mt-1">{warningCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Resolved Today</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{stats.resolvedToday ?? 0}</p>
        </div>
      </div>
      {riskLines.length > 0 && (
        <p className="text-xs text-gray-600" data-testid="risk-by-currency">
          Money at risk on open exceptions: {riskLines.map(([cur, v]) => `${fmtMoney(v.amount, cur, { decimals: 2 })} (${v.count})`).join(' · ')} — per currency, never added together.
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {STATUS_TABS.map(tab => (
            <button key={tab} onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                statusFilter === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}>
              {tab}
            </button>
          ))}
        </div>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="form-input py-1.5 pr-8 text-sm w-auto">
          <option value="All">All Severity</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search exceptions..."
            className="form-input pl-9 py-1.5 text-sm" />
        </div>
      </div>

      {/* Exception List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
            <p className="text-gray-500">No exceptions found. All clear.</p>
          </div>
        ) : filtered.map(ex => {
          const sev = SEVERITY_CONFIG[ex.severity] || SEVERITY_CONFIG.warning;
          const TypeIcon = TYPE_ICONS[ex.exceptionType] || AlertTriangle;
          const href = entityHref(ex);
          return (
            <div key={ex.id} className={`bg-white rounded-xl border ${sev.border} p-4 hover:shadow-md transition-shadow`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl ${sev.bg} flex items-center justify-center flex-shrink-0`}>
                  <TypeIcon className={`w-5 h-5 ${sev.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${sev.bg} ${sev.text} ${sev.ring}`}>
                      {(ex.severity || 'warning').toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-400">{(ex.exceptionType || '').replace(/_/g, ' ')}</span>
                    {ex.linkedRef && (href
                      ? <Link to={href} className="text-xs text-blue-600 hover:text-blue-800 font-medium">{ex.linkedRef}</Link>
                      : <span className="text-xs text-gray-500">{ex.linkedRef}</span>)}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">{ex.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ex.description || ex.message}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>{formatDate(ex.detectedAt || ex.createdAt)}</span>
                    {ex.assignedToName && <span>Assigned: {ex.assignedToName}</span>}
                    {Number(ex.amountAtRisk) > 0 && (
                      <span className="font-medium text-red-600">{atRisk(ex)} at risk</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => setSelectedEx(ex)} className="btn btn-ghost btn-sm" aria-label="View exception" title="View"><Eye className="w-4 h-4" /></button>
                  {ex.status === 'Open' && (
                    <>
                      <button onClick={() => { setSelectedEx(ex); }} className="btn btn-sm btn-secondary">Resolve</button>
                      <button onClick={() => handleEscalate(ex)} className="btn btn-sm btn-danger" title="Escalate" aria-label="Escalate">
                        <AlertCircle className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Resolve Modal */}
      <Modal isOpen={!!selectedEx} onClose={() => { setSelectedEx(null); setResolveNotes(''); }} title="Exception Detail" size="lg">
        {selectedEx && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Type</p>
                <p className="text-sm text-gray-900 mt-1">{(selectedEx.exceptionType || '').replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Severity</p>
                <p className={`text-sm font-semibold mt-1 ${(SEVERITY_CONFIG[selectedEx.severity] || {}).text || 'text-gray-700'}`}>
                  {(selectedEx.severity || 'warning').toUpperCase()}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Entity</p>
                <p className="text-sm text-gray-900 mt-1">{selectedEx.linkedRef || (selectedEx.linkedType ? `${selectedEx.linkedType} #${selectedEx.linkedId}` : '—')}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Detected</p>
                <p className="text-sm text-gray-900 mt-1">{formatDate(selectedEx.detectedAt || selectedEx.createdAt)}</p>
              </div>
              {Number(selectedEx.amountAtRisk) > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Amount at Risk</p>
                  <p className="text-sm font-semibold text-red-600 mt-1">{atRisk(selectedEx)}</p>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Description</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selectedEx.description || selectedEx.message || 'No description'}</p>
            </div>
            {selectedEx.suggestedAction && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Suggested Action</p>
                <p className="text-sm text-blue-700 bg-blue-50 rounded-lg p-3">{selectedEx.suggestedAction}</p>
              </div>
            )}
            {selectedEx.status === 'Open' && (
              <div className="border-t pt-4 space-y-3">
                <textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)}
                  placeholder="Resolution notes..."
                  className="form-input resize-none" rows={3} />
                <div className="flex gap-3">
                  <button onClick={() => handleResolve(selectedEx)} disabled={resolveMutation.isPending}
                    className="btn btn-primary flex-1">
                    <CheckCircle className="w-4 h-4" /> Mark Resolved
                  </button>
                  <button onClick={() => handleEscalate(selectedEx)}
                    className="btn btn-danger">
                    <AlertCircle className="w-4 h-4" /> Escalate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
