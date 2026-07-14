// Tracks connectivity. navigator.onLine only tells us the browser has *a*
// network; it can be true while the server is unreachable. So we also listen for
// a custom 'riceflow:offline' / 'riceflow:online' event that the API client emits
// when requests actually fail/succeed against the server — a truer signal.
import { useSyncExternalStore } from 'react';

let serverReachable = true;
const listeners = new Set();

function emit() { listeners.forEach((l) => l()); }

export function markServerOffline() {
  if (serverReachable) { serverReachable = false; emit(); }
}
export function markServerOnline() {
  if (!serverReachable) {
    serverReachable = true;
    emit();
    // Transitioned offline → online: let the sync layer flush the write outbox.
    try { window.dispatchEvent(new Event('riceflow:reconnect')); } catch { /* noop */ }
  }
}

// Plain (non-hook) connectivity read for imperative code (API client, sync).
export function isOnline() {
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return browserOnline && serverReachable;
}

function subscribe(cb) {
  listeners.add(cb);
  const on = () => cb();
  window.addEventListener('online', on);
  window.addEventListener('offline', on);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('online', on);
    window.removeEventListener('offline', on);
  };
}

function getSnapshot() {
  // navigator.onLine is only authoritative when it's explicitly false; if the
  // property is missing (non-browser env), assume online.
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return browserOnline && serverReachable;
}

// Returns true when the app can reach the server, false otherwise.
export function useOnline() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
