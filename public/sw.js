// Service worker: (1) mobile notifications (Android Chrome needs
// ServiceWorkerRegistration.showNotification; the page's `new Notification()` is
// unsupported there), and (2) offline caching of the app shell + static assets
// so the ERP still loads during an internet outage.
//
// Caching strategy:
//   - Navigations (SPA routes)  → network-first, fall back to the cached shell.
//   - Hashed build assets       → cache-first (names are content-hashed, immutable).
//   - /api/* and everything else → network only (offline data is served by the
//     app's React Query IndexedDB snapshot, not by caching API responses here).
const CACHE = 'riceflow-shell-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', SHELL]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isAsset(url) {
  return url.pathname.startsWith('/assets/')
    || /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|gif|webp|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // don't touch cross-origin
  if (url.pathname.startsWith('/api/')) return;        // API is network-only

  // SPA navigations: network-first so a fresh deploy is picked up online; fall
  // back to the cached shell when offline so routes still render.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Hashed static assets: cache-first, and populate the cache on first fetch so
  // visited pages/chunks are available offline afterwards.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) { if ('focus' in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return undefined;
    })
  );
});
