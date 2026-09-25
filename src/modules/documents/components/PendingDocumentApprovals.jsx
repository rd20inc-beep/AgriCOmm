import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Check, X, Trash2, RefreshCw, Eye } from 'lucide-react';
import { documentsApi } from '../api/services';
import api from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';

/**
 * Documents waiting on an Owner / Super Admin, across every order.
 *
 * Approve/reject also exist inline on each order's Documents tab, but that only
 * helps someone who already knows which order is waiting. This is the queue:
 * the approver opens one page and sees everything outstanding.
 */
export default function PendingDocumentApprovals() {
  const { addToast } = useApp();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('documents', 'approve');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!canApprove) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get('/api/documents/pending-approvals');
      setRows(res?.data?.documents || res?.documents || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [canApprove]);
  useEffect(() => { load(); }, [load]);

  if (!canApprove) return null;

  async function act(row, fn, okMsg) {
    setBusyId(row.id);
    try { await fn(); addToast?.(okMsg, 'success'); await load(); }
    catch (e) { addToast?.(e?.data?.message || e.message || 'Action failed', 'error'); }
    finally { setBusyId(null); }
  }

  const preview = async (row) => {
    try {
      const opened = await documentsApi.open(row.id, row.file_name || row.title);
      if (!opened) await documentsApi.download(row.id, row.file_name || row.title);
    } catch (e) { addToast?.(e?.message || 'Could not open document', 'error'); }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <FileText size={15} /> Documents awaiting approval
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            A change stays pending until you approve it — the previously approved copy remains the live one.
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">Nothing waiting — every document change has been decided.</p>
      ) : (
        <table className="w-full text-sm mobile-cards">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b">
              <th className="text-left py-2">Document</th>
              <th className="text-left py-2">Order</th>
              <th className="text-left py-2">Requested by</th>
              <th className="text-left py-2">Change</th>
              <th className="text-right py-2">Decide</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => {
              const isDelete = r.pending_action === 'delete';
              const busy = busyId === r.id;
              return (
                <tr key={r.id}>
                  <td data-label="Document" className="py-2 text-gray-800">
                    {r.title || r.file_name}
                    <span className="block text-[11px] text-gray-400">{r.file_name}{r.version ? ` · v${r.version}` : ''}</span>
                  </td>
                  <td data-label="Order" className="py-2">
                    {r.order_no
                      ? <Link to={`/export-orders/${r.linked_id}`} className="text-blue-600 hover:underline">{r.order_no}</Link>
                      : <span className="text-gray-400">{r.linked_type} #{r.linked_id}</span>}
                  </td>
                  <td data-label="Requested by" className="mob-hide py-2 text-gray-500">{r.requested_by_name || r.uploaded_by_name || '—'}</td>
                  <td data-label="Change" className="py-2">
                    {isDelete
                      ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">deletion requested</span>
                      : <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">new version</span>}
                  </td>
                  <td data-label="Decide" className="py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => preview(r)} disabled={busy}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-50">
                        <Eye size={13} /> View
                      </button>
                      <button
                        onClick={() => act(r, () => documentsApi.approve(r.id, {}), isDelete ? 'Deletion approved — document removed.' : 'Approved — this version is now live.')}
                        disabled={busy}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white rounded disabled:opacity-50 ${isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                      >
                        {isDelete ? <><Trash2 size={13} /> Approve deletion</> : <><Check size={13} /> Approve</>}
                      </button>
                      <button
                        onClick={() => act(r, () => (isDelete ? documentsApi.cancelDelete(r.id) : documentsApi.reject(r.id, {})), isDelete ? 'Kept — deletion request withdrawn.' : 'Rejected.')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                      >
                        <X size={13} /> {isDelete ? 'Keep' : 'Reject'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
