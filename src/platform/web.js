// Web platform adapter. The single seam for shell-specific capabilities on the
// browser/PWA target. Native shells (Tauri — Stage 12, Capacitor — Stage 13)
// provide their own adapters with the SAME shape; callers never branch on platform.
//
// Today everything delegates to existing web primitives, so behaviour is unchanged.
// Later stages swap the internals (storage → SQLite, secureStore → OS keychain,
// realtime → polling) without touching any caller.
import { API_BASE } from '../api/client';
import { idbGet, idbSet, idbDel } from '../offline/idb';

// Low-level HTTP for the repository layer (auth/portal live outside the react-query
// data client). Same fetch the app already uses — just centralized here.
async function netFetch(path, opts = {}) {
  return fetch(`${API_BASE}${path}`, opts);
}

export default {
  net: { fetch: netFetch, baseUrl: API_BASE },

  // Key/value local store. IndexedDB on web; SQLite/SQLCipher on native (Stage 2+).
  storage: { get: idbGet, set: idbSet, del: idbDel },

  // Small-secret store. NOTE: localStorage is NOT encrypted — on native this maps
  // to the OS keychain / Android Keystore (Stage 9/12/13). Kept behind this seam so
  // callers don't assume a storage medium.
  secureStore: {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota/disabled */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } },
  },

  // Filesystem — unavailable on web; native shells implement (Stage 10/12/13).
  fs: {
    async readFile() { throw new Error('fs is unavailable on the web platform'); },
    async writeFile() { throw new Error('fs is unavailable on the web platform'); },
    async exists() { return false; },
  },

  // Printing — browser print on web; native print bridge later (Stage 14).
  print: { page: () => { try { window.print(); } catch { /* noop */ } } },

  // Realtime — Server-Sent Events on web. Returns an unsubscribe function so native
  // shells can swap SSE for polling without changing callers (Stage 12/13).
  realtime: {
    subscribe(url, { onMessage, onError } = {}) {
      const es = new EventSource(url);
      if (onMessage) es.onmessage = onMessage;
      es.onerror = onError || (() => { /* EventSource auto-reconnects */ });
      return () => { try { es.close(); } catch { /* noop */ } };
    },
  },
};
