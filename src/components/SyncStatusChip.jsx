// Always-visible sync status chip (Stage 11) — sits in the header so users can
// always see online / offline / syncing / needs-attention. Clicking it opens the
// Pending Sync tray (via a window event) for details + actions.
import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { useOnline } from '../offline/useOnline';
import { getOutbox, subscribeOutbox } from '../offline/outbox';
import { getFileOutbox, subscribeFileOutbox } from '../offline/fileOutbox';
import { computeSyncStatus } from '../sync/status';

const TONES = {
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-gray-50 text-gray-500 border-gray-200',
};
const ICON = { attention: AlertTriangle, offline: CloudOff, syncing: RefreshCw, synced: Check };

export default function SyncStatusChip() {
  const online = useOnline();
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });

  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([getOutbox(), getFileOutbox()]).then(([w, f]) => {
      if (!alive) return;
      const all = [...w, ...f];
      setCounts({
        pending: all.filter((i) => i.status !== 'rejected').length,
        rejected: all.filter((i) => i.status === 'rejected').length,
      });
    });
    load();
    const u1 = subscribeOutbox(load);
    const u2 = subscribeFileOutbox(load);
    return () => { alive = false; u1(); u2(); };
  }, []);

  const status = computeSyncStatus({ online, ...counts });
  // When fully synced and online, stay subtle (just a small dot) to avoid noise.
  const Icon = ICON[status.key];
  const openTray = () => { try { window.dispatchEvent(new Event('riceflow:open-sync-tray')); } catch { /* noop */ } };

  return (
    <button
      onClick={openTray}
      title="Sync status — click for details"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONES[status.tone]}`}
    >
      <Icon size={13} className={status.key === 'syncing' ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{status.label}</span>
    </button>
  );
}
