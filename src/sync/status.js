// Pure sync-status computation (Stage 11) — shared by the header chip. Priority:
// needs-attention (rejected) > offline > syncing (pending, online) > synced.
export function computeSyncStatus({ online, pending = 0, rejected = 0 }) {
  if (rejected > 0) {
    return { key: 'attention', tone: 'red', label: `${rejected} need${rejected === 1 ? 's' : ''} attention` };
  }
  if (!online) {
    return { key: 'offline', tone: 'amber', label: pending > 0 ? `Offline · ${pending} queued` : 'Offline' };
  }
  if (pending > 0) {
    return { key: 'syncing', tone: 'blue', label: `Syncing ${pending}` };
  }
  return { key: 'synced', tone: 'green', label: 'Synced' };
}
