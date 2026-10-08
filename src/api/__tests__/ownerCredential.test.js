// Owner approval (G-11): the owner's password rides ONLY on the request that
// names that owner, as the X-Owner-Credential header (base64 of UTF-8) — never
// in the body, never on other requests, never queued offline.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import api, { withOwnerCredential } from '../client';

const ok = () => ({ status: 200, ok: true, json: async () => ({ success: true }) });
const decode = (h) => new TextDecoder().decode(Uint8Array.from(atob(h), (c) => c.charCodeAt(0)));

beforeEach(() => { localStorage.setItem('riceflow_token', 'T'); });
afterEach(() => vi.restoreAllMocks());

describe('withOwnerCredential', () => {
  test('attaches the owner password to the request naming that owner only', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, cfg) => { calls.push({ url, cfg }); return ok(); });

    await withOwnerCredential(7, 'pässwörd', async () => {
      await api.post('/api/export-orders/1/cancel', { reason: 'x', authorized_by_owner_id: 7 });
      await api.post('/api/other', { authorized_by_owner_id: 8 }); // a different owner
      await api.get('/api/anything');
    });
    await api.post('/api/export-orders/1/cancel', { authorized_by_owner_id: 7 }); // after: none

    const [named, other, read, after] = calls;
    expect(decode(named.cfg.headers['X-Owner-Credential'])).toBe('pässwörd');
    expect(named.cfg.body).not.toContain('pässwörd');
    expect(other.cfg.headers['X-Owner-Credential']).toBeUndefined();
    expect(read.cfg.headers['X-Owner-Credential']).toBeUndefined();
    expect(after.cfg.headers['X-Owner-Credential']).toBeUndefined();
  });

  test('a wrong-password 403 surfaces its code and clears the credential', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 403, ok: false, json: async () => ({ code: 'OWNER_AUTH_FAILED', message: "The owner's password is incorrect." }),
    }));
    const err = await withOwnerCredential(7, 'bad', () => api.post('/api/x/1/approve', { authorized_by_owner_id: 7 })).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.data.code).toBe('OWNER_AUTH_FAILED');
    expect(localStorage.getItem('riceflow_token')).toBe('T'); // not a logout

    const calls = [];
    globalThis.fetch = vi.fn(async (url, cfg) => { calls.push(cfg); return ok(); });
    await api.post('/api/x/1/approve', { authorized_by_owner_id: 7 });
    expect(calls[0].headers['X-Owner-Credential']).toBeUndefined();
  });
});
