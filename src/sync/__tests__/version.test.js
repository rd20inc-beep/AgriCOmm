// Stage 17 — sync protocol + clock-skew helpers (pure).
import { describe, test, expect } from 'vitest';
import { SYNC_PROTOCOL_VERSION, isServerCompatible, computeClockSkew, isSkewLarge } from '../version';

describe('sync protocol compatibility', () => {
  test('compatible when our version meets the server minimum', () => {
    expect(isServerCompatible(SYNC_PROTOCOL_VERSION)).toBe(true);
    expect(isServerCompatible(SYNC_PROTOCOL_VERSION - 1)).toBe(true);
  });
  test('incompatible when the server requires a newer client', () => {
    expect(isServerCompatible(SYNC_PROTOCOL_VERSION + 1)).toBe(false);
  });
  test('missing/garbage minimum → assume compatible', () => {
    expect(isServerCompatible(undefined)).toBe(true);
    expect(isServerCompatible('x')).toBe(true);
  });
});

describe('clock skew', () => {
  test('computes device-minus-server milliseconds', () => {
    const server = '2026-07-14T00:00:00.000Z';
    expect(computeClockSkew(server, Date.parse(server))).toBe(0);
    expect(computeClockSkew(server, Date.parse(server) + 60000)).toBe(60000);
  });
  test('flags only a large skew (> 5 min)', () => {
    expect(isSkewLarge(0)).toBe(false);
    expect(isSkewLarge(4 * 60 * 1000)).toBe(false);
    expect(isSkewLarge(10 * 60 * 1000)).toBe(true);
    expect(isSkewLarge(-10 * 60 * 1000)).toBe(true);
  });
  test('bad inputs → 0 skew (never throws)', () => {
    expect(computeClockSkew('not-a-date', Date.now())).toBe(0);
  });
});
