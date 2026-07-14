// Local-data wipe helpers (Stage 9). Used when a device is revoked — a revoked
// device must not retain company data. We clear the READ caches (query snapshot +
// read replica) and the session; the write OUTBOX is intentionally NOT wiped
// (queued work is held per conflict rule C8, and can only sync if the device is
// re-admitted).
import { clearQueryCache } from '../offline/queryPersist';
import { clearReadReplica } from '../data/readReplica';

export async function wipeLocalReadData() {
  try { await clearQueryCache(); } catch { /* noop */ }
  try { await clearReadReplica(); } catch { /* noop */ }
}

export function clearSession() {
  try {
    localStorage.removeItem('riceflow_token');
    localStorage.removeItem('riceflow_user');
  } catch { /* noop */ }
}
