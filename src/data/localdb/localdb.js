// LocalDB facade — opens a backend at the schema version (running its store
// creation / migration), stamps the applied version in meta, and exposes a small
// CRUD + meta API. Backend-agnostic: same behaviour on memory / IndexedDB / SQLite.
import { LOCALDB_VERSION, STORES, META } from './schema';

export async function openLocalDb(backend) {
  // Corruption resilience (§6: local DB corruption). A first open failure gets one
  // retry (transient locks / interrupted upgrade). If the backend can recover a
  // corrupt store it does so; if the second open still fails, flag it so the UI can
  // warn — the app keeps working online (read replica + outbox callers swallow errors,
  // and the store re-bootstraps from the cloud once reopened).
  try {
    await backend.open(LOCALDB_VERSION, STORES);
  } catch (firstErr) {
    try {
      if (typeof backend.recover === 'function') await backend.recover();
      await backend.open(LOCALDB_VERSION, STORES);
    } catch (secondErr) {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try { window.dispatchEvent(new CustomEvent('riceflow:localdb-corrupt', { detail: { error: String(secondErr?.message || firstErr?.message || 'open failed') } })); } catch { /* ignore */ }
      }
      throw secondErr;
    }
  }
  // Stamp the schema version (idempotent — safe on every open).
  await backend.put(META, { id: 'schema_version', value: LOCALDB_VERSION });

  return {
    version: LOCALDB_VERSION,
    get: (store, id) => backend.get(store, id),
    put: (store, record) => backend.put(store, record),
    bulkPut: (store, records) => backend.bulkPut(store, records),
    delete: (store, id) => backend.delete(store, id),
    list: (store) => backend.list(store),
    clear: (store) => backend.clear(store),
    getMeta: async (key) => (await backend.get(META, key))?.value,
    setMeta: (key, value) => backend.put(META, { id: key, value }),
  };
}
