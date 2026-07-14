// Stage 9 — offline grace window (72h).
import { describe, test, expect, beforeEach } from 'vitest';
import {
  markOnlineAuth, isOfflineGraceValid, graceHoursRemaining,
  clearOnlineAuth, seedOnlineAuthIfMissing, OFFLINE_GRACE_MS, lastOnlineAuth,
} from '../offlineGrace';

beforeEach(() => { clearOnlineAuth(); });

describe('offline grace', () => {
  test('never authenticated online → no grace', () => {
    expect(isOfflineGraceValid()).toBe(false);
    expect(graceHoursRemaining()).toBe(0);
  });

  test('valid within the window, invalid past it', () => {
    markOnlineAuth();
    const t0 = lastOnlineAuth();
    expect(isOfflineGraceValid(t0 + 1000)).toBe(true);
    expect(isOfflineGraceValid(t0 + OFFLINE_GRACE_MS - 60_000)).toBe(true);   // 1 min before lapse
    expect(isOfflineGraceValid(t0 + OFFLINE_GRACE_MS + 60_000)).toBe(false);  // 1 min after lapse
  });

  test('window is 72 hours', () => {
    expect(OFFLINE_GRACE_MS).toBe(72 * 60 * 60 * 1000);
    markOnlineAuth();
    expect(graceHoursRemaining(lastOnlineAuth())).toBe(72);
  });

  test('seed only sets a timestamp when none exists (grandfathering)', () => {
    seedOnlineAuthIfMissing();
    const first = lastOnlineAuth();
    expect(first).toBeGreaterThan(0);
    seedOnlineAuthIfMissing(); // no-op — must not move an existing timestamp
    expect(lastOnlineAuth()).toBe(first);
  });
});
