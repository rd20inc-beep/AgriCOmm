// Stage 6b — the outbox replay carries the Idempotency-Key AND X-Device-Id, and
// maps server responses to the right outbox verdict (ok / reject / retry).
import { describe, test, expect, vi, afterEach } from 'vitest';
import { replayRequest } from '../client';

afterEach(() => vi.restoreAllMocks());

describe('replayRequest', () => {
  test('sends Idempotency-Key + X-Device-Id + the original body', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => { captured = opts; return { ok: true, status: 200, json: async () => ({ ok: 1 }) }; });
    const r = await replayRequest({ id: 'idem-123', method: 'POST', endpoint: '/api/x', body: { a: 1 } });
    expect(r.ok).toBe(true);
    expect(captured.headers['Idempotency-Key']).toBe('idem-123');
    expect(captured.headers['X-Device-Id']).toBeTruthy();
    expect(JSON.parse(captured.body)).toEqual({ a: 1 });
  });

  test('4xx (data rejection) → { ok:false } for the tray', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ message: 'Oversold' }) }));
    const r = await replayRequest({ id: 'x', method: 'POST', endpoint: '/api/x', body: {} });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
  });

  test('409 / 401 / 5xx / network → { retry:true } (pause, keep queued)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) }));
    expect((await replayRequest({ id: 'x', method: 'POST', endpoint: '/api/x' })).retry).toBe(true);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect((await replayRequest({ id: 'x', method: 'POST', endpoint: '/api/x' })).retry).toBe(true);
    globalThis.fetch = vi.fn(async () => { throw new TypeError('network down'); });
    expect((await replayRequest({ id: 'x', method: 'POST', endpoint: '/api/x' })).retry).toBe(true);
  });
});
