import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, RefreshCw, Search, ExternalLink, Check, X, Eye, Trash2, Inbox } from 'lucide-react';
import { useApprovalsInbox, APPROVALS_INBOX_KEY } from './useApprovalsInbox';
import { useApp } from '../../context/AppContext';
import { useAcceptFundTransfer, useApproveRequest, useRejectRequest } from '../../api/queries';
import { documentsApi } from '../documents/api/services';
import { fmtDateTime, fmtMoney } from '../../shared/utils/format';
import { filterInboxItems } from './inboxFilter';

/**
 * ONE approvals inbox (P5-02 / D-20 (a)). Every approval the user can act on,
 * across every queue, filtered on the server by each type's approve guard.
 *
 * Deciding stays where it always was: "Open" goes to the record's own page,
 * where the Owner-authorisation modal, maker-checker and amount checks run.
 * Decided here, through their EXISTING endpoints, are only: uploaded documents
 * and the retired generic request queue (their only screen was the old
 * Approvals page), and fund-transfer acceptance (already inline in chat).
 */

const TYPE_STYLE = {
  master_data: 'bg-slate-100 text-slate-700',
  document: 'bg-sky-100 text-sky-700',
  generated_document: 'bg-sky-100 text-sky-700',
  stock_adjustment: 'bg-blue-100 text-blue-700',
  store_adjustment: 'bg-indigo-100 text-indigo-700',
  stock_count: 'bg-blue-100 text-blue-700',
  milling_batch: 'bg-amber-100 text-amber-700',
  export_receipt: 'bg-emerald-100 text-emerald-700',
  fund_transfer: 'bg-emerald-100 text-emerald-700',
  payroll_run: 'bg-violet-100 text-violet-700',
  salary_advance: 'bg-violet-100 text-violet-700',
  leave_request: 'bg-violet-100 text-violet-700',
  worker_request: 'bg-violet-100 text-violet-700',
  purchase_requirement: 'bg-orange-100 text-orange-700',
  packing_variance: 'bg-red-100 text-red-700',
  local_sale: 'bg-teal-100 text-teal-700',
  approval_queue: 'bg-gray-100 text-gray-700',
};

export function TypeChips({ types, total, active, onChange = () => {} }) {
  const chip = (key, label, count) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(key)}
      aria-pressed={active === key}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active === key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
      <span className={`min-w-[18px] px-1 rounded-full text-[10px] ${active === key ? 'bg-white/25' : 'bg-gray-100'}`}>{count}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by approval type">
      {chip('all', 'All', total)}
      {types.map((t) => chip(t.type, t.label, t.count))}
    </div>
  );
}

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50';

/** Presentational list (no data fetching) — rendered by the page and the tests. */
export function InboxList({ items, busyKey = null, onAction = () => {}, rejecting = null, onRejectStart = () => {}, onRejectCancel = () => {} }) {
  const [reason, setReason] = useState('');
  if (!items.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <ShieldCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" aria-hidden="true" />
        <p className="text-gray-500">Nothing waiting for you.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Approvals waiting for you">
      {items.map((it) => {
        const busy = busyKey === it.key;
        const a = it.action || {};
        return (
          <li key={it.key} data-key={it.key} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[it.type] || 'bg-gray-100 text-gray-700'}`}>
                    {it.typeLabel}
                  </span>
                  {it.amount != null && it.currency && (
                    <span className="text-sm font-semibold text-gray-900">{fmtMoney(it.amount, it.currency, { decimals: 2 })}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-900 break-words">{it.title}</p>
                {it.summary && <p className="text-xs text-gray-500 mt-0.5 break-words">{it.summary}</p>}
                <p className="text-xs text-gray-400 mt-1.5">
                  {it.requestedBy ? `${it.requestedBy} · ` : ''}{it.requestedAt ? fmtDateTime(it.requestedAt) : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap sm:justify-end flex-shrink-0">
                {a.kind === 'document' && (
                  <>
                    <button type="button" disabled={busy} onClick={() => onAction(it, 'view')} className={`${btn} text-blue-700 bg-blue-50 hover:bg-blue-100`}>
                      <Eye size={13} aria-hidden="true" /> View
                    </button>
                    <button type="button" disabled={busy} onClick={() => onAction(it, 'approve')}
                      className={`${btn} text-white ${a.isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                      {a.isDelete ? <><Trash2 size={13} aria-hidden="true" /> Approve deletion</> : <><Check size={13} aria-hidden="true" /> Approve</>}
                    </button>
                    <button type="button" disabled={busy} onClick={() => onAction(it, 'reject')} className={`${btn} text-gray-600 bg-gray-50 border border-gray-200 hover:bg-gray-100`}>
                      <X size={13} aria-hidden="true" /> {a.isDelete ? 'Keep' : 'Reject'}
                    </button>
                  </>
                )}
                {a.kind === 'accept_transfer' && (
                  <button type="button" disabled={busy} onClick={() => onAction(it, 'accept')} className={`${btn} text-white bg-emerald-600 hover:bg-emerald-700`}>
                    <Check size={13} aria-hidden="true" /> Accept funds
                  </button>
                )}
                {a.kind === 'approval_queue' && (
                  <>
                    <button type="button" disabled={busy} onClick={() => onAction(it, 'approve')} className={`${btn} text-white bg-emerald-600 hover:bg-emerald-700`}>
                      <Check size={13} aria-hidden="true" /> Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setReason(''); onRejectStart(it); }} className={`${btn} text-white bg-red-600 hover:bg-red-700`}>
                      <X size={13} aria-hidden="true" /> Reject
                    </button>
                  </>
                )}
                {it.link ? (
                  <Link to={it.link} data-open="1" className={`${btn} text-gray-700 bg-gray-100 hover:bg-gray-200`}>
                    Open <ExternalLink size={12} aria-hidden="true" />
                  </Link>
                ) : !a.kind ? (
                  <span className="text-xs text-gray-400" title="Ask an administrator for access to this page">No page access</span>
                ) : null}
              </div>
            </div>

            {rejecting === it.key && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col sm:flex-row gap-2">
                <label className="sr-only" htmlFor={`reason-${it.key}`}>Reason for rejecting</label>
                <input id={`reason-${it.key}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500" />
                <div className="flex gap-2">
                  <button type="button" onClick={onRejectCancel} className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                  <button type="button" disabled={!reason.trim() || busy} onClick={() => onAction(it, 'reject', reason.trim())}
                    className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">Reject</button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ApprovalsInbox() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const { data, isLoading, error, refetch, isFetching } = useApprovalsInbox();
  const acceptTransfer = useAcceptFundTransfer();
  const approveRequest = useApproveRequest();
  const rejectRequest = useRejectRequest();

  const items = useMemo(() => data?.items ?? [], [data]);
  const types = data?.types ?? [];
  // ?type= keeps the filter on refresh / Back (and is what chat links to).
  const requested = params.get('type') || 'all';
  const type = requested === 'all' || types.some((t) => t.type === requested) ? requested : 'all';
  const shown = useMemo(() => filterInboxItems(items, { type, q }), [items, type, q]);

  const setType = (next) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('type'); else p.set('type', next);
    setParams(p, { replace: true });
  };

  async function onAction(it, what, reason) {
    const a = it.action || {};
    if (a.kind === 'document' && what === 'view') {
      try {
        const opened = await documentsApi.open(a.documentId, a.fileName);
        if (!opened) await documentsApi.download(a.documentId, a.fileName);
      } catch (e) { addToast?.(e?.message || 'Could not open document', 'error'); }
      return;
    }
    setBusyKey(it.key);
    try {
      if (a.kind === 'document') {
        if (what === 'approve') await documentsApi.approve(a.documentId, {});
        else if (a.isDelete) await documentsApi.cancelDelete(a.documentId);
        else await documentsApi.reject(a.documentId, {});
      } else if (a.kind === 'accept_transfer') {
        await acceptTransfer.mutateAsync(a.transferId);
      } else if (a.kind === 'approval_queue') {
        if (what === 'approve') await approveRequest.mutateAsync({ id: a.approvalId, data: {} });
        else await rejectRequest.mutateAsync({ id: a.approvalId, data: { reason } });
        setRejecting(null);
      }
      addToast?.(what === 'reject' ? 'Rejected.' : 'Done.', 'success');
    } catch (e) {
      addToast?.(e?.data?.message || e?.message || 'Action failed', 'error');
    } finally {
      setBusyKey(null);
      qc.invalidateQueries({ queryKey: APPROVALS_INBOX_KEY });
    }
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-emerald-600" aria-hidden="true" />
            Approvals
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Everything waiting for your decision, in one place.</p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <TypeChips types={types} total={items.length} active={type} onChange={setType} />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
        <label htmlFor="approvals-search" className="sr-only">Search approvals</label>
        <input id="approvals-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search approvals…"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading approvals…</p>
      ) : error ? (
        <p className="text-sm text-red-600 py-8 text-center">
          Could not load approvals. <button type="button" className="underline" onClick={() => refetch()}>Try again</button>
        </p>
      ) : (
        <InboxList items={shown} busyKey={busyKey} onAction={onAction}
          rejecting={rejecting} onRejectStart={(it) => setRejecting(it.key)} onRejectCancel={() => setRejecting(null)} />
      )}
    </div>
  );
}
