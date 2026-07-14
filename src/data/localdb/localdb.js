// LocalDB facade — opens a backend at the schema version (running its store
// creation / migration), stamps the applied version in meta, and exposes a small
// CRUD + meta API. Backend-agnostic: same behaviour on memory / IndexedDB / SQLite.
import { LOCALDB_VERSION, STORES, META } from './schema';

export async function openLocalDb(backend) {
  await backend.open(LOCALDB_VERSION, STORES);
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
