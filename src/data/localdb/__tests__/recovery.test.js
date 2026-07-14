// Stage 17 — LocalDB corruption resilience (§6: local DB corruption). A first open
// failure is retried once (with a recover() hook if the backend offers one); a second
// failure flags corruption and rethrows so callers degrade gracefully (online-only).
import { describe, test, expect, vi } from 'vitest';
import { openLocalDb } from '../localdb';
import { createMemoryBackend } from '../memoryBackend';

describe('localdb open recovery', () => {
  test('retries once and succeeds after a transient open failure', async () => {
    const mem = createMemoryBackend();
    const realOpen = mem.open.bind(mem);
    let calls = 0;
    mem.open = (...a) => { calls++; if (calls === 1) throw new Error('locked'); return realOpen(...a); };
    const recover = vi.fn();
    mem.recover = recover;

    const db = await openLocalDb(mem);
    expect(calls).toBe(2);           // failed once, retried
    expect(recover).toHaveBeenCalled();
    await db.put('records', { id: 'x', data: 1 });
    expect((await db.get('records', 'x')).data).toBe(1);
  });

  test('a persistent open failure is detected and rethrown (caller degrades gracefully)', async () => {
    const mem = createMemoryBackend();
    let calls = 0;
    mem.open = () => { calls++; throw new Error('corrupt'); };
    // Rethrows after the retry so callers (read replica / outbox) can swallow and go
    // online-only; the browser build also emits riceflow:localdb-corrupt for the UI.
    await expect(openLocalDb(mem)).rejects.toThrow('corrupt');
    expect(calls).toBe(2); // tried once, retried once
  });
});
