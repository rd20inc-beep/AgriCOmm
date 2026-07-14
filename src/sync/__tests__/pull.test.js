// Stage 6a — client sync PULL tests. Mocks the network transport and uses the
// memory-backed LocalDB; verifies rows land in the replica, the watermark advances
// and is sent back as `since`, and pagination + empty pulls behave.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { openLocalDb } from '../../data/localdb/localdb';
import { createMemoryBackend } from '../../data/localdb/memoryBackend';
import { __setLocalDbForTests } from '../../data/localdb';
import { pullDomain, localRecords } from '../pull';

let calls;
function mockFetchSequence(responses) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const data = responses.shift();
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  });
}

beforeEach(async () => { __setLocalDbForTests(await openLocalDb(createMemoryBackend())); });
afterEach(() => vi.restoreAllMocks());

describe('sync pull', () => {
  test('writes rows into the local replica and advances the watermark', async () => {
    mockFetchSequence([{ domain: 'customers', rows: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], watermark: 'W1', hasMore: false }]);
    const res = await pullDomain('customers');
    expect(res.total).toBe(2);
    const recs = await localRecords('customers');
    expect(recs.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(recs.find((r) => r.id === 1).name).toBe('A');
  });

  test('paginates until hasMore is false, sending the watermark as `since`', async () => {
    mockFetchSequence([
      { domain: 'customers', rows: [{ id: 1 }], watermark: 'W1', hasMore: true },
      { domain: 'customers', rows: [{ id: 2 }], watermark: 'W2', hasMore: false },
    ]);
    const res = await pullDomain('customers');
    expect(res.total).toBe(2);
    expect(res.pages).toBe(2);
    expect(calls[0].body.since ?? null).toBe(null); // first pull: no watermark yet
    expect(calls[1].body.since).toBe('W1');          // second pull: advanced watermark
  });

  test('an empty pull is a no-op', async () => {
    mockFetchSequence([{ domain: 'customers', rows: [], watermark: null, hasMore: false }]);
    const res = await pullDomain('customers');
    expect(res.total).toBe(0);
    expect(await localRecords('customers')).toHaveLength(0);
  });

  test('sends a device id with each pull', async () => {
    mockFetchSequence([{ domain: 'customers', rows: [], watermark: null, hasMore: false }]);
    await pullDomain('customers');
    expect(calls[0].body.device_uuid).toBeTruthy();
    expect(calls[0].body.domain).toBe('customers');
  });
});
