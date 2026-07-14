// Stage 10 — file-upload outbox state machine (memory-backed LocalDB).
import { describe, test, expect, beforeEach } from 'vitest';
import { openLocalDb } from '../../data/localdb/localdb';
import { createMemoryBackend } from '../../data/localdb/memoryBackend';
import { __setLocalDbForTests } from '../../data/localdb';
import { enqueueFile, getFileOutbox, flushFileOutbox, __resetFileOutboxForTests } from '../fileOutbox';

const item = (id) => ({ id, endpoint: '/api/upload', entries: [{ key: 'file', blob: {}, filename: `${id}.jpg` }], label: `photo ${id}` });

beforeEach(async () => {
  __resetFileOutboxForTests();
  __setLocalDbForTests(await openLocalDb(createMemoryBackend()));
});

describe('file outbox', () => {
  test('FIFO; success removes; 4xx stays rejected', async () => {
    await enqueueFile(item('A'));
    await enqueueFile(item('B'));
    const order = [];
    await flushFileOutbox(async (it) => {
      order.push(it.id);
      return it.id === 'B' ? { ok: false, status: 413, body: { message: 'File too large' } } : { ok: true };
    });
    const ob = await getFileOutbox();
    expect(order).toEqual(['A', 'B']);
    expect(ob.find((i) => i.id === 'A')).toBeUndefined();
    expect(ob.find((i) => i.id === 'B').status).toBe('rejected');
  });

  test('network retry pauses, leaving the item pending', async () => {
    await enqueueFile(item('C'));
    await enqueueFile(item('D'));
    await flushFileOutbox(async (it) => (it.id === 'C' ? { ok: true } : { retry: true }));
    const ob = await getFileOutbox();
    expect(ob.find((i) => i.id === 'C')).toBeUndefined();
    expect(ob.find((i) => i.id === 'D').status).toBe('pending');
  });
});
