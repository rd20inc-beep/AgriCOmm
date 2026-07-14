// Stage 2 — LocalDB logic tests against the in-memory backend (fully exercises
// open/migrate/CRUD/meta; the IndexedDB backend is the same interface and gets its
// real round-trip in Stage 4 / the browser).
import { describe, test, expect } from 'vitest';
import { openLocalDb } from '../localdb';
import { createMemoryBackend } from '../memoryBackend';
import { LOCALDB_VERSION, STORES } from '../schema';

const open = () => openLocalDb(createMemoryBackend());

describe('LocalDB (memory backend)', () => {
  test('opens at the schema version and stamps it in meta', async () => {
    const db = await open();
    expect(db.version).toBe(LOCALDB_VERSION);
    expect(await db.getMeta('schema_version')).toBe(LOCALDB_VERSION);
  });

  test('all schema stores are usable', async () => {
    const db = await open();
    for (const store of STORES) {
      await db.put(store, { id: `probe-${store}`, ok: true });
      expect((await db.get(store, `probe-${store}`)).ok).toBe(true);
    }
  });

  test('put / get round-trip', async () => {
    const db = await open();
    await db.put('records', { id: 'inventory:42', collection: 'inventory', data: { qty: 100 } });
    const r = await db.get('records', 'inventory:42');
    expect(r.data.qty).toBe(100);
  });

  test('bulkPut + list', async () => {
    const db = await open();
    await db.bulkPut('records', [
      { id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 },
    ]);
    const all = await db.list('records');
    expect(all).toHaveLength(3);
    expect(all.map((x) => x.n).sort()).toEqual([1, 2, 3]);
  });

  test('delete removes one; clear empties the store', async () => {
    const db = await open();
    await db.bulkPut('records', [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
    await db.delete('records', 'a');
    expect(await db.get('records', 'a')).toBeUndefined();
    expect(await db.list('records')).toHaveLength(1);
    await db.clear('records');
    expect(await db.list('records')).toHaveLength(0);
  });

  test('meta get/set (e.g. sync watermark)', async () => {
    const db = await open();
    await db.setMeta('sync:inventory', '2026-07-14T00:00:00Z');
    expect(await db.getMeta('sync:inventory')).toBe('2026-07-14T00:00:00Z');
    expect(await db.getMeta('nope')).toBeUndefined();
  });

  test('re-opening the same backend is idempotent and keeps data', async () => {
    const backend = createMemoryBackend();
    const db1 = await openLocalDb(backend);
    await db1.put('records', { id: 'x', v: 1 });
    const db2 = await openLocalDb(backend); // e.g. app relaunch
    expect((await db2.get('records', 'x')).v).toBe(1);
    expect(await db2.getMeta('schema_version')).toBe(LOCALDB_VERSION);
  });

  test('forward migration: a later version can add a store', async () => {
    // Simulates bumping LOCALDB_VERSION + adding a store — the backend creates it.
    const backend = createMemoryBackend();
    await backend.open(2, [...STORES, 'new_store']);
    await backend.put('new_store', { id: 'k', ok: true });
    expect((await backend.get('new_store', 'k')).ok).toBe(true);
  });
});
