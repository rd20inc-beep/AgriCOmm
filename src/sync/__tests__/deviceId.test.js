// Stage 6b — device id is stable per session and a valid UUID.
import { describe, test, expect } from 'vitest';
import { getDeviceId } from '../deviceId';

describe('device id', () => {
  test('is stable across calls', () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });
  test('is a UUID (accepted by the server uuid column)', () => {
    expect(getDeviceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
