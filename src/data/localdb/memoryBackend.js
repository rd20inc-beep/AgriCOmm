// In-memory LocalDB backend — non-persistent. Used in tests and as a safe
// fallback when IndexedDB is unavailable (private mode / storage disabled), so
// the app degrades to session-only local state rather than crashing.
// All backends implement this same async interface (records keyed by `record.id`).
export function createMemoryBackend() {
  const stores = new Map(); // name -> Map(id -> record)
  const ensure = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    async open(_version, names) { for (const n of names) ensure(n); },
    async get(store, id) { return ensure(store).get(id); },
    async put(store, record) { ensure(store).set(record.id, record); },
    async bulkPut(store, records) { const s = ensure(store); for (const r of records) s.set(r.id, r); },
    async delete(store, id) { ensure(store).delete(id); },
    async list(store) { return [...ensure(store).values()]; },
    async clear(store) { ensure(store).clear(); },
  };
}
