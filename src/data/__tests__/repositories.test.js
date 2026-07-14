// Stage 1 contract tests — the repository seam + platform adapter. Verifies the
// wrappers behave exactly like the raw fetch/EventSource they replaced, so the 5
// former bypasses (auth ×2, portal, 2 SSE) are behaviour-identical.
import { describe, test, expect, vi, afterEach } from 'vitest';
import { authRepo } from '../repositories/auth';
import { portalRepo } from '../repositories/portal';
import { realtimeRepo } from '../repositories/realtime';
import platform from '../../platform';

const mockFetch = (impl) => { globalThis.fetch = vi.fn(impl); };

describe('platform adapter (web)', () => {
  test('exposes the expected capabilities', () => {
    expect(platform.name).toBe('web');
    expect(platform.isNative).toBe(false);
    expect(typeof platform.net.fetch).toBe('function');
    expect(typeof platform.storage.get).toBe('function');
    expect(typeof platform.secureStore.get).toBe('function');
    expect(typeof platform.realtime.subscribe).toBe('function');
    expect(typeof platform.print.page).toBe('function');
  });
});

describe('authRepo (replaces AuthContext raw fetches)', () => {
  afterEach(() => vi.restoreAllMocks());

  test('me() returns { ok, status, data } on success', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: { user: { id: 1 }, permissions: ['x'] } }) }));
    const r = await authRepo.me('tkn');
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(r.data.data.user.id).toBe(1);
  });

  test('me() surfaces 401 WITHOUT throwing (so caller can log out)', async () => {
    mockFetch(async () => ({ ok: false, status: 401, json: async () => ({ message: 'bad' }) }));
    const r = await authRepo.me('tkn');
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  test('me() THROWS on a network failure (so caller keeps cached session)', async () => {
    mockFetch(async () => { throw new TypeError('Failed to fetch'); });
    await expect(authRepo.me('tkn')).rejects.toThrow();
  });

  test('login() POSTs credentials as JSON and returns shape', async () => {
    let captured;
    mockFetch(async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({ data: { token: 'T', user: { id: 2 } } }) }; });
    const r = await authRepo.login('e@x.com', 'pw');
    expect(r.ok).toBe(true);
    expect(r.data.data.token).toBe('T');
    expect(captured.opts.method).toBe('POST');
    expect(JSON.parse(captured.opts.body)).toEqual({ email: 'e@x.com', password: 'pw' });
  });
});

describe('portalRepo (replaces EmployeePortal raw fetch)', () => {
  afterEach(() => vi.restoreAllMocks());

  test('request() returns parsed data on 2xx', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ me: { id: 5 } }) }));
    const d = await portalRepo.request('/me', { token: 'p' });
    expect(d.me.id).toBe(5);
  });

  test('request() throws the server message on non-2xx', async () => {
    mockFetch(async () => ({ ok: false, status: 400, json: async () => ({ message: 'nope' }) }));
    await expect(portalRepo.request('/me')).rejects.toThrow('nope');
  });
});

describe('realtimeRepo (replaces raw EventSource)', () => {
  test('subscribe() opens a source and returns a working close()', () => {
    let closed = false;
    globalThis.EventSource = class { constructor(url) { this.url = url; } close() { closed = true; } };
    const close = realtimeRepo.subscribe('http://x/stream', { onMessage: () => {}, onError: () => {} });
    expect(typeof close).toBe('function');
    close();
    expect(closed).toBe(true);
  });
});
