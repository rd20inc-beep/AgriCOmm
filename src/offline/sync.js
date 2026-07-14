// Offline sync driver — flushes the write outbox when the connection returns and
// refreshes the query cache so synced records replace their pending placeholders.
import { queryClient } from '../api/queryClient';
import { flushOutbox } from './outbox';
import { flushFileOutbox } from './fileOutbox';
import { replayRequest, uploadReplay } from '../api/client';
import { isOnline } from './useOnline';
import { bootstrapDevice } from '../sync/device';
import { classifyConflict, reportConflict } from '../sync/conflicts';

let running = false;

// Replay a queued write; on a server refusal (4xx) classify + record the conflict
// and tag the verdict so the outbox stores the conflict type.
async function replayAndRecord(item) {
  const verdict = await replayRequest(item);
  if (verdict && verdict.ok === false) {
    const code = classifyConflict(verdict.status, verdict.body);
    reportConflict(item, verdict, code).catch(() => {});
    return { ...verdict, code };
  }
  return verdict;
}

export async function flushNow() {
  if (running || !isOnline()) return;
  running = true;
  try {
    // Register/refresh this device (so it can be revoked) — best-effort.
    bootstrapDevice().catch(() => {});
    await flushOutbox(replayAndRecord);
    await flushFileOutbox(uploadReplay); // sync queued offline file uploads
  } finally {
    running = false;
  }
  // Pull fresh data so just-synced items appear and offline placeholders clear.
  if (isOnline()) queryClient.invalidateQueries();
}

export function initOfflineSync() {
  // Reconnect signals: our own event (server became reachable) + the browser's.
  window.addEventListener('riceflow:reconnect', () => { flushNow(); });
  window.addEventListener('online', () => { flushNow(); });
  // Flush anything left from a previous session shortly after boot (if online).
  if (isOnline()) setTimeout(() => { flushNow(); }, 1500);
}
