// Stage 0 — behaviour lock for the offline WRITE OUTBOX state machine
// (src/offline/outbox.js). This protects the offline foundation through every
// later migration stage: FIFO order, remove-on-success, keep-4xx-as-rejected
// (and skip on later flushes), pause-on-retry, clear-on-reflush.
import { describe, test, expect, beforeEach } from 'vitest';
import { enqueue, getOutbox, flushOutbox } from '../outbox';

beforeEach(() => { globalThis.__resetIdb(); });

const item = (id) => ({ id, method: 'POST', endpoint: '/api/x', body: {}, label: id });

describe('write outbox flush state machine', () => {
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
    expect(order).toEqual(['A', 'B', 'C']);                     // FIFO
    expect(ob.find((i) => i.id === 'A')).toBeUndefined();       // removed
    expect(ob.find((i) => i.id === 'C')).toBeUndefined();       // removed
    const b = ob.find((i) => i.id === 'B');
    expect(b.status).toBe('rejected');
    expect(b.lastError).toMatch(/Oversold/);
  });

  test('network retry pauses the flush and leaves the item pending', async () => {
    await enqueue(item('D'));
    await enqueue(item('E'));
    const seen = [];
    await flushOutbox(async (it) => {
      seen.push(it.id);
      if (it.id === 'D') return { ok: true };
      return { retry: true }; // still offline
    });
    const ob = await getOutbox();
    expect(ob.find((i) => i.id === 'D')).toBeUndefined();       // synced
    expect(ob.find((i) => i.id === 'E').status).toBe('pending'); // paused, not lost
  });

  test('rejected item is skipped on later flushes until retried', async () => {
    await enqueue(item('F'));
    await flushOutbox(async () => ({ ok: false, status: 400, body: { message: 'bad' } }));
    let ob = await getOutbox();
    expect(ob[0].status).toBe('rejected');

    const seen = [];
    await flushOutbox(async (it) => { seen.push(it.id); return { ok: true }; });
    expect(seen).not.toContain('F');                            // skipped while rejected
    ob = await getOutbox();
    expect(ob.length).toBe(1);                                  // still there for the user
  });
});
