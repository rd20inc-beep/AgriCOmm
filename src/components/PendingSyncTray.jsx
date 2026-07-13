// Pending Sync tray — a small fixed widget (bottom-left, clear of the chat
// widget) that appears whenever the write outbox has items. Shows what's waiting
// to sync, lets the user trigger a sync, and surfaces server-rejected items with
// their reason so they can be re-done or dismissed.
import { useEffect, useState } from 'react';
import { RefreshCw, X, AlertTriangle, CloudUpload, ChevronUp } from 'lucide-react';
import { getOutbox, subscribeOutbox, removeItem, retryItem } from '../offline/outbox';
import { flushNow } from '../offline/sync';
import { useOnline } from '../offline/useOnline';

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

  useEffect(() => {
    let alive = true;
    const load = () => getOutbox().then((l) => { if (alive) setItems(l); });
    load();
    const unsub = subscribeOutbox(load);
    return () => { alive = false; unsub(); };
  }, []);

  if (items.length === 0) return null;

  const rejected = items.filter((i) => i.status === 'rejected');
  const waiting = items.length - rejected.length;
  const tone = rejected.length ? 'bg-red-600' : online ? 'bg-blue-600' : 'bg-amber-500';

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
                  <span className="font-medium text-gray-800 truncate">{it.label || `${it.method} ${it.endpoint}`}</span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{timeAgo(it.createdAt)}</span>
                </div>
                {it.status === 'rejected' ? (
                  <div className="mt-1">
                    <p className="text-[11px] text-red-600 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{it.lastError || 'Rejected by server'}</p>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => { retryItem(it.id).then(() => flushNow()); }} className="text-[11px] font-medium text-blue-600 hover:text-blue-800">Retry</button>
                      <button onClick={() => removeItem(it.id)} className="text-[11px] font-medium text-gray-500 hover:text-gray-700">Dismiss</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {it.status === 'syncing' ? 'Syncing…' : online ? 'Waiting to sync…' : 'Saved offline'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-white text-xs font-semibold shadow-lg ${tone}`}>
        {rejected.length ? <AlertTriangle size={15} /> : <CloudUpload size={15} />}
        <span>
          {rejected.length ? `${rejected.length} need${rejected.length === 1 ? 's' : ''} attention` : `${waiting} pending sync`}
        </span>
        <ChevronUp size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}
