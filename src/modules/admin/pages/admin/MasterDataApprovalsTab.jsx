import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Clock, User as UserIcon, Calendar, RefreshCw, Truck, Package, AlertCircle, Loader2 } from 'lucide-react';
import { adminApi } from '../../api/services';
import { useApp } from '../../../../context/AppContext';

/**
 * Reviews pending product / supplier submissions made via the Purchase
 * Lot drawer's "+ Add new" affordances. Admin can Approve or Reject
 * with an optional note that the submitter sees on their side.
 */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusFilter({ value, onChange }) {
  const tabs = [
    { value: 'pending',  label: 'Pending',  cls: 'bg-amber-100 text-amber-800' },
    { value: 'approved', label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
    { value: 'rejected', label: 'Rejected', cls: 'bg-red-100 text-red-700' },
    { value: 'all',      label: 'All',      cls: 'bg-gray-100 text-gray-700' },
  ];
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
      {tabs.map(t => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === t.value ? 'bg-white shadow-sm text-blue-700' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ApprovalBadge({ status }) {
  const map = {
    pending:  { cls: 'bg-amber-100 text-amber-800',  label: 'Pending'  },
    approved: { cls: 'bg-emerald-100 text-emerald-800', label: 'Approved' },
    rejected: { cls: 'bg-red-100 text-red-700',       label: 'Rejected' },
  };
  const s = map[status] || { cls: 'bg-gray-100 text-gray-700', label: status };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function RejectModal({ open, onClose, onConfirm, target }) {
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) setNotes(''); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Reject {target?.type === 'products' ? 'rice type' : 'supplier'}</h3>
          <p className="text-sm text-gray-500 mt-1">
            Reject <span className="font-medium text-gray-800">{target?.name}</span>?
            They&apos;ll see your note so they can fix and resubmit.
          </p>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Reason / what to fix (optional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
            Cancel
          </button>
          <button onClick={() => onConfirm(notes)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">
            <XCircle size={14} /> Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, color, rows, onApprove, onReject, busyId }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-200 flex items-center justify-between ${color}`}>
        <div className="flex items-center gap-2">
          <Icon size={18} />
          <h3 className="font-semibold">{title}</h3>
          <span className="text-xs opacity-80">({rows.length})</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-sm text-gray-500 text-center">Nothing to review.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(r => {
            const isBusy = busyId === `${r._type}:${r.id}`;
            return (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.code && <span className="font-mono text-xs text-gray-500">{r.code}</span>}
                    <span className="font-medium text-gray-900">{r.name}</span>
                    {r.grade && <span className="text-xs text-gray-400">({r.grade})</span>}
                    <ApprovalBadge status={r.approval_status} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.submitted_by_name && (
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={11} /> {r.submitted_by_name}
                      </span>
                    )}
                    {r.submitted_at && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} /> Submitted {fmtDate(r.submitted_at)}
                      </span>
                    )}
                    {r.reviewed_at && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> Reviewed {fmtDate(r.reviewed_at)}
                        {r.reviewed_by_name && <span>by {r.reviewed_by_name}</span>}
                      </span>
                    )}
                  </div>
                  {r.review_notes && (
                    <div className="mt-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                      <span className="font-semibold text-gray-700">Notes:</span> {r.review_notes}
                    </div>
                  )}
                </div>
                {r.approval_status === 'pending' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => onApprove(r)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Approve
                    </button>
                    <button
                      onClick={() => onReject(r)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
                    >
                      <XCircle size={12} /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MasterDataApprovalsTab() {
  const { addToast } = useApp();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.approvalsList({ status: statusFilter });
      const data = res?.data || res;
      setProducts((data?.products || []).map(p => ({ ...p, _type: 'products' })));
      setSuppliers((data?.suppliers || []).map(s => ({ ...s, _type: 'suppliers' })));
    } catch (err) {
      addToast?.(err.message || 'Failed to load approvals', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, addToast]);

  useEffect(() => { load(); }, [load]);

  async function approve(row) {
    setBusyId(`${row._type}:${row.id}`);
    try {
      await adminApi.approvalApprove(row._type, row.id);
      addToast?.(`Approved ${row.name}`, 'success');
      load();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to approve', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row, notes) {
    setBusyId(`${row._type}:${row.id}`);
    try {
      await adminApi.approvalReject(row._type, row.id, { notes });
      addToast?.(`Rejected ${row.name}`, 'success');
      setRejectTarget(null);
      load();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to reject', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Master Data Approvals</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Review rice types and suppliers added on-the-go by operators from the Purchase Lot screen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusFilter value={statusFilter} onChange={setStatusFilter} />
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {statusFilter === 'pending' && (suppliers.length + products.length) === 0 && !loading && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} /> All caught up — no pending submissions.
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <Section
            title="Rice types"
            icon={Package}
            color="bg-amber-50 text-amber-900"
            rows={products}
            busyId={busyId}
            onApprove={approve}
            onReject={(r) => setRejectTarget(r)}
          />
          <Section
            title="Suppliers"
            icon={Truck}
            color="bg-blue-50 text-blue-900"
            rows={suppliers}
            busyId={busyId}
            onApprove={approve}
            onReject={(r) => setRejectTarget(r)}
          />
        </div>
      )}

      <RejectModal
        open={!!rejectTarget}
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={(notes) => reject(rejectTarget, notes)}
      />

      <div className="text-xs text-gray-400 border-t pt-3 flex items-start gap-1.5">
        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
        Pending submissions are usable in lots immediately — admins approve them retroactively. Rejected entries are deactivated and won&apos;t appear in dropdowns.
      </div>
    </div>
  );
}
