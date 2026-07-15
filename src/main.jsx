import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { queryClient } from './api/queryClient'
import { restoreQueryCache, startQueryCachePersistence } from './offline/queryPersist'
import { initOfflineSync } from './offline/sync'

// Register the service worker: notifications (call alerts on mobile) + offline
// shell/asset caching so the app still loads during an internet outage.
//
// Auto-update: when a new version is deployed the new SW takes control (it uses
// skipWaiting + clients.claim); we listen for that hand-over and reload ONCE so
// the phone always shows the latest app instead of a stale cached copy. We only
// reload on an UPDATE (a controller already existed), never on the very first
// install, and guard against reload loops.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (!reg) return;
      // Check for a new version now and hourly so long-running installs update.
      reg.update?.();
      setInterval(() => reg.update?.(), 60 * 60 * 1000);
    }).catch(() => {});
  });
}

// Boot: hydrate the last-synced query cache BEFORE first render so the app paints
// with saved data immediately (works even when starting offline), then keep the
// cache persisted as it updates.
async function boot() {
  await restoreQueryCache(queryClient);

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  startQueryCachePersistence(queryClient);
  initOfflineSync();
}

boot();
