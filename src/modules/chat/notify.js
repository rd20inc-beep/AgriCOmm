// Cross-platform (desktop + mobile) notifications. On Android Chrome a page's
// `new Notification()` throws, so we prefer the service worker's showNotification;
// `new Notification()` is the desktop fallback.

export async function ensureNotifyPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export async function showNotify(title, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) { await reg.showNotification(title, options); return; }
    }
    // eslint-disable-next-line no-new
    new Notification(title, options);
  } catch { /* noop */ }
}
