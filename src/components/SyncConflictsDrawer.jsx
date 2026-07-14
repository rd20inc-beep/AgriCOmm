// Manager conflicts review (Stage 11) — a right drawer listing offline-sync
// conflicts across all devices (Stage-8 `sync_conflicts`), with resolve actions.
// Opens on the 'riceflow:open-conflicts' event (dispatched from the pending-sync
// tray's manager-only link). The list endpoint is RBAC-gated server-side.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { conflictsApi } from '../sync/syncApi';
import { CONFLICT_LABELS } from '../sync/conflicts';

export default function SyncConflictsDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('riceflow:open-conflicts', onOpen);
    return () => window.removeEventListener('riceflow:open-conflicts', onOpen);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: async () => {
      const res = await conflictsApi.list('pending');
      return res?.data?.conflicts || res?.conflicts || [];
    },
    enabled: open,
    retry: false,
  });
  const conflicts = Array.isArray(data) ? data : [];

  const resolve = async (id, resolution) => {
    try { await conflictsApi.resolve(id, resolution); refetch(); } catch { /* surfaced by refetch */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={() => setOpen(false)}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Sync conflicts</h2>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 p-4">
          {isLoading ? <p className="text-sm text-gray-400">Loading…</p>
            : isError ? <p className="text-sm text-red-600">Couldn&rsquo;t load conflicts (managers only).</p>
              : conflicts.length === 0 ? <p className="text-sm text-gray-400">No open conflicts.</p>
                : conflicts.map((c) => (
                  <div key={c.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        {CONFLICT_LABELS[c.conflict_code] || c.conflict_code || 'Rejected'}
                      </span>
                      <span className="text-[10px] text-gray-400">{c.created_at ? new Date(c.created_at).toLocaleString('en-GB') : ''}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-800">{c.label || c.endpoint}</p>
                    {c.message && <p className="text-xs text-gray-500">{c.message}</p>}
                    <p className="mt-0.5 font-mono text-[10px] text-gray-400">{c.method} {c.endpoint}</p>
                    <div className="mt-2 flex gap-3">
                      <button onClick={() => resolve(c.id, 'resolved')} className="text-xs font-medium text-emerald-700 hover:text-emerald-900">Mark resolved</button>
                      <button onClick={() => resolve(c.id, 'dismissed')} className="text-xs font-medium text-gray-500 hover:text-gray-700">Dismiss</button>
                    </div>
                  </div>
                ))}
        </div>
      </div>
    </div>
  );
}
