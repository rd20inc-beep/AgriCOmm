// Pending Sync tray — a small fixed widget (bottom-left, clear of the chat
// widget) that appears whenever the write outbox has items. Shows what's waiting
// to sync, lets the user trigger a sync, and surfaces server-rejected items with
// their reason so they can be re-done or dismissed.
import { useEffect, useState } from 'react';
import { RefreshCw, X, AlertTriangle, CloudUpload, ChevronUp } from 'lucide-react';
import { getOutbox, subscribeOutbox, removeItem, retryItem } from '../offline/outbox';
import { getFileOutbox, subscribeFileOutbox, removeFileItem, retryFileItem } from '../offline/fileOutbox';
import { flushNow } from '../offline/sync';
import { CONFLICT_LABELS } from '../sync/conflicts';
import { useOnline } from '../offline/useOnline';
import { useAuth } from '../context/AuthContext';

const MANAGER_ROLES = ['Super Admin', 'Owner', 'Mill Manager', 'Finance Manager'];

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function PendingSyncTray() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(user?.role);

  // Open when the header status chip is clicked.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('riceflow:open-sync-tray', onOpen);
    return () => window.removeEventListener('riceflow:open-sync-tray', onOpen);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([getOutbox(), getFileOutbox()]).then(([w, f]) => {
      if (!alive) return;
      const merged = [
        ...w.map((i) => ({ ...i, _kind: 'write' })),
        ...f.map((i) => ({ ...i, _kind: 'file' })),
      ].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setItems(merged);
    });
    load();
    const unsub1 = subscribeOutbox(load);
    const unsub2 = subscribeFileOutbox(load);
    return () => { alive = false; unsub1(); unsub2(); };
  }, []);

  const doRetry = (it) => (it._kind === 'file' ? retryFileItem(it.id) : retryItem(it.id)).then(() => flushNow());
  const doDismiss = (it) => (it._kind === 'file' ? removeFileItem(it.id) : removeItem(it.id));

  // Hidden unless there's something queued OR the user opened it from the chip.
  if (items.length === 0 && !open) return null;

  const rejected = items.filter((i) => i.status === 'rejected');
  const waiting = items.length - rejected.length;
  const tone = rejected.length ? 'bg-red-600' : online ? 'bg-blue-600' : 'bg-amber-500';
  const openConflicts = () => { try { window.dispatchEvent(new Event('riceflow:open-conflicts')); } catch { /* noop */ } };

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-[19rem] max-w-[calc(100vw-2rem)]">
      {open && (
        <div className="mb-2 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">Pending sync ({items.length})</span>
            <div className="flex items-center gap-2">
              <button onClick={() => flushNow()} disabled={!online}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-300"
                title={online ? 'Sync now' : 'Offline — will sync when connected'}>
                <RefreshCw size={13} /> Sync now
              </button>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {items.map((it) => (
              <div key={it.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800 truncate">
                    {it.label || `${it.method || ''} ${it.endpoint}`}{it._kind === 'file' ? <span className="text-gray-400 font-normal"> · file</span> : null}
                  </span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{timeAgo(it.createdAt)}</span>
                </div>
                {it.status === 'rejected' ? (
                  <div className="mt-1">
                    {it.conflictCode && (
                      <span className="inline-block mb-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                        {CONFLICT_LABELS[it.conflictCode] || 'Rejected'}
                      </span>
                    )}
                    <p className="text-[11px] text-red-600 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{it.lastError || 'Rejected by server'}</p>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => doRetry(it)} className="text-[11px] font-medium text-blue-600 hover:text-blue-800">Retry</button>
                      <button onClick={() => doDismiss(it)} className="text-[11px] font-medium text-gray-500 hover:text-gray-700">Dismiss</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {it.status === 'syncing' ? 'Syncing…' : online ? 'Waiting to sync…' : 'Saved offline'}
                  </p>
                )}
              </div>
            ))}
            {items.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">Everything is synced.</div>
            )}
          </div>
          {isManager && (
            <button onClick={openConflicts} className="w-full border-t border-gray-100 px-3 py-2 text-left text-[11px] font-medium text-blue-600 hover:bg-blue-50">
              Review all devices&rsquo; sync conflicts &rarr;
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <button onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-white text-xs font-semibold shadow-lg ${tone}`}>
          {rejected.length ? <AlertTriangle size={15} /> : <CloudUpload size={15} />}
          <span>
            {rejected.length ? `${rejected.length} need${rejected.length === 1 ? 's' : ''} attention` : `${waiting} pending sync`}
          </span>
          <ChevronUp size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
