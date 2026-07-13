import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { queryClient } from './api/queryClient'
import { restoreQueryCache, startQueryCachePersistence } from './offline/queryPersist'
import { initOfflineSync } from './offline/sync'

// Register the service worker: notifications (call alerts on mobile) + offline
// shell/asset caching so the app still loads during an internet outage.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
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
