// P2-12 — every mutating request carries a per-submit Idempotency-Key that is
// REUSED on double-click, on a retry after an ambiguous outcome and on the
// offline replay; queueable endpoints are an allowlist; business 409/403 land
// in the Pending Sync tray instead of being retried forever.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import api, { replayRequest, isQueueable, __resetIdempotencyForTests } from '../client';
import { markServerOffline, markServerOnline } from '../../offline/useOnline';
import { openLocalDb } from '../../data/localdb/localdb';
import { createMemoryBackend } from '../../data/localdb/memoryBackend';
import { __setLocalDbForTests } from '../../data/localdb';
import { getOutbox, __resetOutboxForTests } from '../../offline/outbox';

const okResponse = (body = { success: true }) => ({ ok: true, status: 201, json: async () => body });
const keyOf = (call) => call[1].headers['Idempotency-Key'];

beforeEach(async () => {
  globalThis.__resetIdb?.();
  __resetOutboxForTests();
  __setLocalDbForTests(await openLocalDb(createMemoryBackend()));
  __resetIdempotencyForTests();
  markServerOnline();
});
afterEach(() => vi.restoreAllMocks());

describe('per-submit idempotency keys', () => {
  test('every online mutating request carries a key; separate submits get separate keys', async () => {
    globalThis.fetch = vi.fn(async () => okResponse());
    await api.post('/api/local-sales', { qty: 5 });
    await api.post('/api/local-sales', { qty: 5 }); // a NEW, deliberate submit
    await api.put('/api/expenses/3/pay', { amount: 1 });
    await api.delete('/api/milling/batches/9/costs/1');
    const keys = globalThis.fetch.mock.calls.map(keyOf);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(4);
  });

  test('GET carries no key', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({ data: [] }));
    await api.get('/api/local-sales');
    expect(globalThis.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBeUndefined();
  });

  test('double-click: an identical submit while the first is in flight sends ONE request', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise((r) => { release = () => r(okResponse({ success: true, id: 1 })); }));
    const a = api.post('/api/local-sales', { qty: 5 });
    const b = api.post('/api/local-sales', { qty: 5 });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(ra).toEqual(rb);
  });

  test('timeout after commit → the retry reuses the key (server replays, no duplicate)', async () => {
    globalThis.fetch = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await expect(api.post('/api/finance/payments', { amount: 100 })).rejects.toMatchObject({ status: 408 });
    globalThis.fetch.mockImplementation(async () => okResponse());
    await api.post('/api/finance/payments', { amount: 100 });
    const [first, retry] = globalThis.fetch.mock.calls;
    expect(keyOf(retry)).toBe(keyOf(first));
    // Answered now — the next identical submit is a NEW one.
    await api.post('/api/finance/payments', { amount: 100 });
    expect(keyOf(globalThis.fetch.mock.calls[2])).not.toBe(keyOf(first));
  });

  test('connection dropped mid-write → queued under the SAME key the request carried', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('network down'); });
    const res = await api.post('/api/local-sales', { qty: 7 });
    expect(res._offlineQueued).toBe(true);
    const [item] = await getOutbox();
    expect(item.id).toBe(keyOf(globalThis.fetch.mock.calls[0]));
  });

  test('offline capture → replay sends the queued key', async () => {
    markServerOffline();
    await api.post('/api/local-sales', { qty: 3 });
    const [item] = await getOutbox();
    globalThis.fetch = vi.fn(async () => okResponse());
    markServerOnline();
    const v = await replayRequest(item);
    expect(v.ok).toBe(true);
    expect(keyOf(globalThis.fetch.mock.calls[0])).toBe(item.id);
  });
});

describe('queueable endpoints are an allowlist', () => {
  test.each([
    ['POST', '/api/local-sales'],
    ['POST', '/api/milling/batches/4/yield'],
    ['POST', '/api/finance/payments'],
    ['PUT', '/api/expenses/2/pay'],
  ])('%s %s is queueable', (m, e) => expect(isQueueable(m, e, {})).toBe(true));

  test.each([
    ['DELETE', '/api/admin/danger/lots/4'],
    ['POST', '/api/admin/danger/reset'],
    ['POST', '/api/finance/payments/7/reverse'],
    ['POST', '/api/finance/fund-transfers/7/reverse'],
    ['POST', '/api/milling/payroll/runs/3/pay'],
    ['POST', '/api/milling/payroll/run'],
    ['POST', '/api/milling/advances/2/pay'],
    ['POST', '/api/milling/batches/2/approve'],
    ['POST', '/api/accounting/journals'],
    ['POST', '/api/users'],
    ['DELETE', '/api/milling/batches/9/costs/1'],
    ['POST', '/api/export-orders'],
  ])('%s %s is NOT queueable', (m, e) => expect(isQueueable(m, e, {})).toBe(false));

  test('a non-queueable write fails loudly offline instead of being held', async () => {
    markServerOffline();
    globalThis.fetch = vi.fn(async () => { throw new TypeError('network down'); });
    await expect(api.post('/api/finance/payments/7/reverse', { reason: 'x' })).rejects.toMatchObject({ status: 0 });
    expect(await getOutbox()).toHaveLength(0);
  });
});

describe('replay verdicts', () => {
  const replayWith = async (status, body) => {
    globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    return replayRequest({ id: 'k1', method: 'POST', endpoint: '/api/local-sales', body: {} });
  };
  test('409 still in progress → retry', async () => {
    expect((await replayWith(409, { code: 'idempotency_in_progress' })).retry).toBe(true);
  });
  test('business 409 → tray (not retried forever)', async () => {
    const v = await replayWith(409, { message: 'Lot already sold' });
    expect(v.ok).toBe(false);
    expect(v.status).toBe(409);
  });
  test('permission 403 → tray; revoked device → held for retry', async () => {
    expect((await replayWith(403, { message: 'Forbidden' })).ok).toBe(false);
    expect((await replayWith(403, { code: 'device_revoked' })).retry).toBe(true);
  });
});
