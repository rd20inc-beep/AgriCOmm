// Minimal service worker — exists so the app can show notifications on mobile
// (Android Chrome requires ServiceWorkerRegistration.showNotification; the page's
// `new Notification()` is unsupported there) and to focus the app when a
// notification (e.g. an incoming call) is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
