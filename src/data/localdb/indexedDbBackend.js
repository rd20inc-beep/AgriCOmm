// IndexedDB LocalDB backend (web + native webview). Multi-store, versioned:
// stores are created in the `upgradeneeded` transaction based on the schema, which
// is how IndexedDB "migrations" work. Uses a SEPARATE database name from the
// existing offline cache/outbox (src/offline/idb.js → 'riceflow-offline') so this
// stage cannot disturb the shipped offline features.
const DB_NAME = 'riceflow-localdb';

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export function createIndexedDbBackend(dbName = DB_NAME) {
  let dbPromise = null;

  function openDb(version, names) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const n of names) {
          if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  const db = () => dbPromise;
  const store = async (name, mode) => (await db()).transaction(name, mode).objectStore(name);

  return {
    async open(version, names) { await openDb(version, names); },
    async get(name, id) { return reqP((await store(name, 'readonly')).get(id)); },
    async put(name, record) { return reqP((await store(name, 'readwrite')).put(record)); },
    async bulkPut(name, records) {
      const tx = (await db()).transaction(name, 'readwrite');
      const os = tx.objectStore(name);
      for (const r of records) os.put(r);
      return txDone(tx);
    },
    async delete(name, id) { return reqP((await store(name, 'readwrite')).delete(id)); },
    async list(name) { return reqP((await store(name, 'readonly')).getAll()); },
    async clear(name) { return reqP((await store(name, 'readwrite')).clear()); },
  };
}
