// Stage 17 — read-replica storage budget (§6: insufficient local storage). Evicts the
// oldest mirrored reads over the cap, oldest-first, and NEVER touches the write outbox
// (which lives in a separate store).
import { describe, test, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../localdb/localdb';
import { createMemoryBackend } from '../localdb/memoryBackend';
import { __setLocalDbForTests } from '../localdb';
import { mirrorRead, getMirroredRead, pruneReadReplica, setReadReplicaEnabled } from '../readReplica';

let db;
beforeEach(async () => {
  setReadReplicaEnabled(true);
  db = await openLocalDb(createMemoryBackend());
  __setLocalDbForTests(db);
});

describe('read replica budget', () => {
  test('prune evicts oldest reads beyond the cap', async () => {
    for (let i = 0; i < 10; i++) {
      await db.put('records', { id: `read:/api/e${i}`, collection: 'read', endpoint: `/api/e${i}`, data: { i }, updatedAt: `2026-07-14T00:00:${String(i).padStart(2, '0')}.000Z` });
    }
    const dropped = await pruneReadReplica(4);
    expect(dropped).toBe(6);
    // Oldest (e0..e5) gone, newest (e6..e9) kept.
    expect(await getMirroredRead('/api/e0')).toBeUndefined();
    expect(await getMirroredRead('/api/e5')).toBeUndefined();
    expect((await getMirroredRead('/api/e9')).i).toBe(9);
  });

  test('prune never touches the write outbox (separate store)', async () => {
    await db.put('outbox', { id: 1, seq: 1, request: { path: '/api/local-sales' } });
    for (let i = 0; i < 6; i++) {
      await db.put('records', { id: `read:/api/x${i}`, collection: 'read', endpoint: `/api/x${i}`, data: { i }, updatedAt: `2026-07-14T00:00:0${i}.000Z` });
    }
    await pruneReadReplica(2);
    // The queued write is still there — eviction only prunes the read collection.
    expect(await db.get('outbox', 1)).toBeTruthy();
  });

  test('no-op when under the cap', async () => {
    await mirrorRead('/api/only', { v: 1 });
    expect(await pruneReadReplica(400)).toBe(0);
    expect((await getMirroredRead('/api/only')).v).toBe(1);
  });
});
