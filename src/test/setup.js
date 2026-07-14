// Vitest setup — provide a minimal in-memory IndexedDB so the offline modules
// (src/offline/idb.js and outbox.js) can run under Node without a browser.
// `globalThis.__resetIdb()` clears it between tests.

// Minimal localStorage polyfill (client.js getToken / device id use it directly).
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
const stores = {};
class FakeReq {
  constructor() { this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.result = undefined; }
}
const soon = (fn) => queueMicrotask(fn);

function makeDb() {
  return {
    objectStoreNames: { contains: (n) => !!stores[n] },
    createObjectStore: (n) => { stores[n] = stores[n] || new Map(); return {}; },
    transaction: (name) => {
      const store = stores[name] || (stores[name] = new Map());
      const tx = { oncomplete: null, onerror: null };
      const os = {
        get: (k) => { const r = new FakeReq(); soon(() => { r.result = store.get(k); r.onsuccess && r.onsuccess(); }); return r; },
        put: (v, k) => { soon(() => { store.set(k, v); tx.oncomplete && tx.oncomplete(); }); return {}; },
        delete: (k) => { soon(() => { store.delete(k); tx.oncomplete && tx.oncomplete(); }); return {}; },
      };
      tx.objectStore = () => os; // same object carries oncomplete + objectStore
      return tx;
    },
  };
}

globalThis.indexedDB = {
  open: () => {
    const req = new FakeReq();
    soon(() => {
      const db = makeDb();
      req.result = db;
      req.onupgradeneeded && req.onupgradeneeded({ target: req });
      req.onsuccess && req.onsuccess({ target: req });
    });
    return req;
  },
};

globalThis.__resetIdb = () => { for (const k of Object.keys(stores)) delete stores[k]; };
