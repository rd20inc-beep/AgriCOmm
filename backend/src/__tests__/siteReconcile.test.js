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

  // P2-12: an in-flight duplicate is transient; a business 403 is parked, not
  // retried forever; a revoked device / inactive sync account holds the queue.
  test('409 idempotency_in_progress → retry; other 409 → conflict', () => {
    expect(classifyPushResult(409, { code: 'idempotency_in_progress' }).outcome).toBe('retry');
    expect(classifyPushResult(409, { code: 'duplicate' })).toEqual({ outcome: 'conflict', code: 'duplicate' });
  });

  test('403 → conflict not_permitted, except device/account revocation → retry', () => {
    expect(classifyPushResult(403, { message: 'Forbidden' })).toEqual({ outcome: 'conflict', code: 'not_permitted' });
    expect(classifyPushResult(403, { code: 'device_revoked' }).outcome).toBe('retry');
    expect(classifyPushResult(403, { code: 'account_inactive' }).outcome).toBe('retry');
  });
});
