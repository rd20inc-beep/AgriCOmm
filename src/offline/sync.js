// Offline sync driver — flushes the write outbox when the connection returns and
// refreshes the query cache so synced records replace their pending placeholders.
import { queryClient } from '../api/queryClient';
import { flushOutbox } from './outbox';
import { replayRequest } from '../api/client';
import { isOnline } from './useOnline';

let running = false;

export async function flushNow() {
  if (running || !isOnline()) return;
  running = true;
  try {
    await flushOutbox(replayRequest);
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
