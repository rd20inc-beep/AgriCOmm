// Service worker: (1) mobile notifications, and (2) FULL offline support — on
// first online load it precaches the entire built app (index.html + every JS/CSS
// chunk listed in /precache.json), so every route works offline even if you never
// opened it before. `__BUILD__` is replaced at build time with a content hash so
// the browser re-installs this SW (and re-precaches) on each deploy.
const BUILD = '__BUILD__';
const CACHE = 'riceflow-' + BUILD;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch('/precache.json', { cache: 'no-store' });
      const { bundleUrls = [], extraUrls = [] } = await res.json();
      const cache = await caches.open(CACHE);
      // Built files are guaranteed to exist → addAll (atomic).
      await cache.addAll(bundleUrls);
      // Public files best-effort — a missing one must not fail the whole precache.
      await Promise.allSettled(extraUrls.map((u) => cache.add(u)));
    } catch { /* precache is best-effort; runtime caching still fills gaps */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isAsset(url) {
  return url.pathname.startsWith('/assets/')
    || /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|gif|webp|ico|json|webmanifest)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin
  if (url.pathname.startsWith('/api/')) return;      // API is network-only

  // SPA navigations (full loads / reloads / launching the installed app):
  // network-first so a fresh deploy is picked up online, fall back to the
  // precached shell when offline so the app still opens and routes render.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(SHELL, res.clone())).catch(() => {}); return res; })
        .catch(() => caches.match(SHELL).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Built assets + manifest/icons: cache-first (precached), so lazy-loaded page
  // chunks resolve instantly and offline. Populate the cache on any miss.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
          return res;
        }).catch(() => cached);
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
