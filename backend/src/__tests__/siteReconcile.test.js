// Offline Stage 16 — site reconciliation policy (pure, no DB).
const { shouldApplyPulledRow, classifyPushResult } = require('../site/reconcile');

describe('shouldApplyPulledRow', () => {
  test('inserts a row the site has never seen', () => {
    expect(shouldApplyPulledRow(null, { id: 1 })).toBe(true);
  });

  test('applies a cloud row with an equal-or-newer record_version', () => {
    expect(shouldApplyPulledRow({ record_version: 2 }, { record_version: 3 })).toBe(true);
    expect(shouldApplyPulledRow({ record_version: 2 }, { record_version: 2 })).toBe(true);
  });

  test('keeps a local row the site edited more recently (pending push up)', () => {
    expect(shouldApplyPulledRow({ record_version: 4 }, { record_version: 3 })).toBe(false);
  });

  test('falls back to updated_at when no record_version', () => {
    expect(shouldApplyPulledRow({ updated_at: '2026-01-01' }, { updated_at: '2026-02-01' })).toBe(true);
    expect(shouldApplyPulledRow({ updated_at: '2026-03-01' }, { updated_at: '2026-02-01' })).toBe(false);
  });

  test('trusts the cloud when there is no version info at all', () => {
    expect(shouldApplyPulledRow({}, {})).toBe(true);
  });
});

describe('classifyPushResult', () => {
  test('2xx → synced', () => {
    expect(classifyPushResult(200, {})).toEqual({ outcome: 'synced' });
    expect(classifyPushResult(201, {})).toEqual({ outcome: 'synced' });
  });

  test('business 4xx → conflict with a mapped code', () => {
    expect(classifyPushResult(409, { code: 'insufficient_stock' })).toEqual({ outcome: 'conflict', code: 'insufficient_stock' });
    expect(classifyPushResult(422, { conflict_code: 'version_conflict' })).toEqual({ outcome: 'conflict', code: 'version_conflict' });
    expect(classifyPushResult(400, {})).toEqual({ outcome: 'conflict', code: 'rejected' });
  });

  test('auth/throttle and 5xx → retry (transient)', () => {
    expect(classifyPushResult(401, {}).outcome).toBe('retry');
    expect(classifyPushResult(429, {}).outcome).toBe('retry');
    expect(classifyPushResult(500, {}).outcome).toBe('retry');
    expect(classifyPushResult(0, {}).outcome).toBe('retry');
  });
});
