// Stage 9 — a 403 device_revoked response wipes the session (and throws).
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import api from '../client';

beforeEach(() => { localStorage.setItem('riceflow_token', 'T'); localStorage.setItem('riceflow_user', '{}'); });
afterEach(() => vi.restoreAllMocks());

describe('device revoked handling', () => {
  test('403 device_revoked clears the session and throws', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 403, ok: false, json: async () => ({ code: 'device_revoked', message: 'This device has been revoked.' }),
    }));
    await expect(api.get('/api/anything')).rejects.toThrow(/revoked/i);
    expect(localStorage.getItem('riceflow_token')).toBeNull();
    expect(localStorage.getItem('riceflow_user')).toBeNull();
  });

  test('an ordinary 403 (not device_revoked) does NOT clear the session', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 403, ok: false, json: async () => ({ message: 'Forbidden' }),
    }));
    await expect(api.get('/api/anything')).rejects.toThrow();
    expect(localStorage.getItem('riceflow_token')).toBe('T'); // preserved
  });
});
