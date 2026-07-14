// Stage 4 — read-replica tests (memory-backed LocalDB). Verifies write-through,
// per-endpoint keying, offline fallback semantics, clear-on-logout, and the flag.
import { describe, test, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../localdb/localdb';
import { createMemoryBackend } from '../localdb/memoryBackend';
import { __setLocalDbForTests } from '../localdb';
import { mirrorRead, getMirroredRead, clearReadReplica, setReadReplicaEnabled } from '../readReplica';

let db;
beforeEach(async () => {
  setReadReplicaEnabled(true);
  db = await openLocalDb(createMemoryBackend());
  __setLocalDbForTests(db);
});

describe('read replica', () => {
  test('mirror then read round-trips per endpoint', async () => {
    await mirrorRead('/api/milling/batches?limit=200', { batches: [{ id: 1 }] });
    expect((await getMirroredRead('/api/milling/batches?limit=200')).batches[0].id).toBe(1);
  });

  test('un-mirrored endpoint returns undefined (caller falls through)', async () => {
    expect(await getMirroredRead('/api/never-fetched')).toBeUndefined();
  });

  test('different query strings cache separately', async () => {
    await mirrorRead('/api/x?f=a', { v: 'A' });
    await mirrorRead('/api/x?f=b', { v: 'B' });
    expect((await getMirroredRead('/api/x?f=a')).v).toBe('A');
    expect((await getMirroredRead('/api/x?f=b')).v).toBe('B');
  });

  test('re-mirror overwrites (an online refresh updates the replica)', async () => {
    await mirrorRead('/api/x', { v: 1 });
    await mirrorRead('/api/x', { v: 2 });
    expect((await getMirroredRead('/api/x')).v).toBe(2);
  });

  test('null / undefined responses are not mirrored', async () => {
    await mirrorRead('/api/x', null);
    await mirrorRead('/api/y', undefined);
    expect(await getMirroredRead('/api/x')).toBeUndefined();
    expect(await getMirroredRead('/api/y')).toBeUndefined();
  });

  test('clear removes read entries but leaves other records intact', async () => {
    await mirrorRead('/api/x', { v: 1 });
    await db.put('records', { id: 'inventory:1', collection: 'inventory', data: { qty: 5 } });
    await clearReadReplica();
    expect(await getMirroredRead('/api/x')).toBeUndefined();          // read entry gone
    expect((await db.get('records', 'inventory:1')).data.qty).toBe(5); // domain record kept
  });

  test('disabled flag makes mirror + read no-ops (network-only rollback)', async () => {
    setReadReplicaEnabled(false);
    await mirrorRead('/api/x', { v: 1 });
    expect(await getMirroredRead('/api/x')).toBeUndefined();
    setReadReplicaEnabled(true);
  });
});
