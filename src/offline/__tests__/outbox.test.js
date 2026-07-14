// Stage 0/5 — behaviour lock for the offline WRITE OUTBOX state machine, now
// backed by the unified LocalDB (Stage 5). Same guarantees: FIFO, remove-on-
// success, keep-4xx-rejected (and skip on later flushes), pause-on-retry, plus
// durability across a reopen and migration from the legacy store.
import { describe, test, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../../data/localdb/localdb';
import { createMemoryBackend } from '../../data/localdb/memoryBackend';
import { __setLocalDbForTests } from '../../data/localdb';
import { idbSet, idbGet } from '../idb';
import {
  enqueue, getOutbox, flushOutbox, __resetOutboxForTests,
} from '../outbox';

const item = (id) => ({ id, method: 'POST', endpoint: '/api/x', body: {}, label: id });

beforeEach(async () => {
  globalThis.__resetIdb();          // clear the legacy idb.js store
  __resetOutboxForTests();
  __setLocalDbForTests(await openLocalDb(createMemoryBackend()));
});

describe('write outbox (LocalDB-backed)', () => {
  test('FIFO order; success removes; 4xx stays rejected with reason', async () => {
    await enqueue(item('A'));
    await enqueue(item('B'));
    await enqueue(item('C'));
    const order = [];
    await flushOutbox(async (it) => {
      order.push(it.id);
      if (it.id === 'B') return { ok: false, status: 422, body: { message: 'Oversold' } };
      return { ok: true };
    });
    const ob = await getOutbox();
    expect(order).toEqual(['A', 'B', 'C']);
    expect(ob.find((i) => i.id === 'A')).toBeUndefined();
    expect(ob.find((i) => i.id === 'C')).toBeUndefined();
    const b = ob.find((i) => i.id === 'B');
    expect(b.status).toBe('rejected');
    expect(b.lastError).toMatch(/Oversold/);
  });

  test('network retry pauses the flush and leaves the item pending', async () => {
    await enqueue(item('D'));
    await enqueue(item('E'));
    const seen = [];
    await flushOutbox(async (it) => { seen.push(it.id); return it.id === 'D' ? { ok: true } : { retry: true }; });
    const ob = await getOutbox();
    expect(ob.find((i) => i.id === 'D')).toBeUndefined();
    expect(ob.find((i) => i.id === 'E').status).toBe('pending');
  });

  test('rejected item is skipped on later flushes until retried', async () => {
    await enqueue(item('F'));
    await flushOutbox(async () => ({ ok: false, status: 400, body: { message: 'bad' } }));
    expect((await getOutbox())[0].status).toBe('rejected');
    const seen = [];
    await flushOutbox(async (it) => { seen.push(it.id); return { ok: true }; });
    expect(seen).not.toContain('F');
    expect(await getOutbox()).toHaveLength(1);
  });

  test('items survive a reopen (crash / relaunch durability)', async () => {
    const backend = createMemoryBackend();
    __setLocalDbForTests(await openLocalDb(backend));
    await enqueue(item('R1'));
    __setLocalDbForTests(await openLocalDb(backend)); // simulate app relaunch on same store
    const ob = await getOutbox();
    expect(ob.find((i) => i.id === 'R1')).toBeTruthy();
  });

  test('migrates items left in the legacy store, then clears it', async () => {
    await idbSet('write-outbox', [
      { id: 'L1', method: 'POST', endpoint: '/api/x', status: 'pending' },
      { id: 'L2', method: 'PUT', endpoint: '/api/y', status: 'rejected', lastError: 'x' },
    ]);
    const ob = await getOutbox(); // triggers migration
    expect(ob.map((i) => i.id).sort()).toEqual(['L1', 'L2']);
    expect(await idbGet('write-outbox')).toBeUndefined(); // legacy cleared
  });
});
