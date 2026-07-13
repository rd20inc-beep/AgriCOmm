// Persist the React Query cache to IndexedDB so already-loaded data (dashboards,
// lots, batches, reports, etc.) stays viewable during a long internet outage and
// survives a page reload while offline. React Query ships dehydrate/hydrate in
// its core, so this needs no extra dependency.
//
// The cache is the LAST-SYNCED snapshot: online, queries still refetch on their
// normal staleTime and overwrite it; offline, refetch fails and React Query keeps
// showing the hydrated data. It is per-device and cleared on logout.
import { dehydrate, hydrate } from '@tanstack/react-query';
import { idbGet, idbSet, idbDel } from './idb';

const KEY = 'react-query-cache';
// Bump when the cache shape / app data contract changes so stale snapshots are
// dropped rather than hydrated into a newer build.
const CACHE_VERSION = 'v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // discard snapshots older than 24h

// Restore a saved snapshot into the query client. Call BEFORE the first render
// so the app paints with cached data immediately (important when booting offline).
export async function restoreQueryCache(queryClient) {
  try {
    const saved = await idbGet(KEY);
    if (!saved || saved.version !== CACHE_VERSION) { if (saved) await idbDel(KEY); return; }
    if (Date.now() - (saved.savedAt || 0) > MAX_AGE_MS) { await idbDel(KEY); return; }
    hydrate(queryClient, saved.state);
  } catch { /* cache is best-effort — never block boot */ }
}

let saveTimer = null;
let started = false;

// Begin persisting the cache: debounced on cache changes, plus a flush when the
// tab is hidden/closed. Idempotent — safe to call once at startup.
export function startQueryCachePersistence(queryClient) {
  if (started) return;
  started = true;

  const save = async () => {
    try {
      const state = dehydrate(queryClient, {
        // Only persist settled, successful reads — never errors or in-flight queries.
        shouldDehydrateQuery: (q) => q.state.status === 'success',
      });
      await idbSet(KEY, { version: CACHE_VERSION, savedAt: Date.now(), state });
    } catch { /* ignore quota / serialization issues */ }
  };

  queryClient.getQueryCache().subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 4000); // coalesce bursts of updates
  });

  const flush = () => { clearTimeout(saveTimer); save(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

// Wipe the offline snapshot — call on logout so a device doesn't retain another
// user's data.
export async function clearQueryCache() {
  try { await idbDel(KEY); } catch { /* ignore */ }
}
