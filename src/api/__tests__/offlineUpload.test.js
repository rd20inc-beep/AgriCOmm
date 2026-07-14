// Stage 10 — offline file upload capture + idempotent replay + download cache.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import api, { uploadReplay } from '../client';
import { markServerOffline, markServerOnline } from '../../offline/useOnline';
import { openLocalDb } from '../../data/localdb/localdb';
import { createMemoryBackend } from '../../data/localdb/memoryBackend';
import { __setLocalDbForTests } from '../../data/localdb';
import { getFileOutbox, __resetFileOutboxForTests } from '../../offline/fileOutbox';
import { cacheDownload, getCachedDownload } from '../../offline/downloadCache';

function makeForm() {
  const f = new FormData();
  f.append('file', new Blob(['x'], { type: 'image/jpeg' }), 'photo.jpg');
  f.append('lot', 'LOT-1');
  return f;
}

beforeEach(async () => {
  __resetFileOutboxForTests();
  __setLocalDbForTests(await openLocalDb(createMemoryBackend()));
  markServerOnline();
});
afterEach(() => vi.restoreAllMocks());

describe('offline uploads', () => {
  test('online upload sends Idempotency-Key + X-Device-Id', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => { captured = opts; return { ok: true, status: 200, json: async () => ({ success: true }) }; });
    await api.upload('/api/smart/mobile/upload', makeForm());
    expect(captured.headers['Idempotency-Key']).toBeTruthy();
    expect(captured.headers['X-Device-Id']).toBeTruthy();
    expect(captured.body instanceof FormData).toBe(true);
  });

  test('offline upload is captured in the file outbox (blob + fields)', async () => {
    markServerOffline();
    const res = await api.upload('/api/smart/mobile/upload', makeForm());
    expect(res._offlineQueued).toBe(true);
    const q = await getFileOutbox();
    expect(q).toHaveLength(1);
    const fileEntry = q[0].entries.find((e) => e.key === 'file');
    expect(fileEntry.filename).toBe('photo.jpg');
    expect(q[0].entries.find((e) => e.key === 'lot').value).toBe('LOT-1');
    markServerOnline();
  });

  test('uploadReplay rebuilds the FormData and sends the item id as the key', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => { captured = opts; return { ok: true, status: 200, json: async () => ({}) }; });
    const r = await uploadReplay({
      id: 'ITEM-1', endpoint: '/api/x',
      entries: [{ key: 'file', blob: new Blob(['y']), filename: 'y.jpg' }, { key: 'lot', value: 'L' }],
    });
    expect(r.ok).toBe(true);
    expect(captured.headers['Idempotency-Key']).toBe('ITEM-1');
    expect(captured.body instanceof FormData).toBe(true);
  });
});

describe('download cache', () => {
  test('cache + retrieve a document by endpoint', async () => {
    await cacheDownload('/api/payslip/5', new Blob(['pdf'], { type: 'application/pdf' }), 'payslip.pdf');
    const c = await getCachedDownload('/api/payslip/5');
    expect(c.filename).toBe('payslip.pdf');
    expect(c.mime).toBe('application/pdf');
    expect(await getCachedDownload('/api/never')).toBeUndefined();
  });
});
