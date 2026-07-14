// Offline Stage 16 — site outbox recordability (pure, no DB).
const { isRecordableRequest, buildOutboxEntry } = require('../site/recordable');

describe('site recordable', () => {
  test('records business mutations', () => {
    expect(isRecordableRequest('POST', '/api/local-sales')).toBe(true);
    expect(isRecordableRequest('PUT', '/api/lots/5/purchase-rate')).toBe(true);
    expect(isRecordableRequest('DELETE', '/api/milling/batches/9')).toBe(true);
  });

  test('never records reads', () => {
    expect(isRecordableRequest('GET', '/api/local-sales')).toBe(false);
  });

  test('never records auth / sync / streams / portal', () => {
    expect(isRecordableRequest('POST', '/api/auth/login')).toBe(false);
    expect(isRecordableRequest('POST', '/api/sync/pull')).toBe(false);
    expect(isRecordableRequest('POST', '/api/sync/devices/1/revoke')).toBe(false);
    expect(isRecordableRequest('GET', '/api/streams/export-orders/1')).toBe(false);
    expect(isRecordableRequest('POST', '/api/portal/requests')).toBe(false);
  });

  test('skips non-durable / read-only actions and non-api paths', () => {
    expect(isRecordableRequest('POST', '/api/reporting/build')).toBe(false);
    expect(isRecordableRequest('POST', '/api/lots/export')).toBe(false);
    expect(isRecordableRequest('POST', '/api/documents/upload')).toBe(false);
    expect(isRecordableRequest('POST', '/health')).toBe(false);
  });

  test('buildOutboxEntry reuses an inbound Idempotency-Key (device→site→cloud dedupe)', () => {
    const req = { method: 'POST', originalUrl: '/api/local-sales', headers: { 'idempotency-key': 'abc-123' }, body: { total: 5 }, user: { id: 7 } };
    const e = buildOutboxEntry(req);
    expect(e).toMatchObject({ idempotency_key: 'abc-123', method: 'POST', path: '/api/local-sales', user_id: 7 });
    expect(e.body).toEqual({ total: 5 });
  });

  test('buildOutboxEntry mints a key when none is supplied, and returns null for non-recordable', () => {
    const e = buildOutboxEntry({ method: 'POST', originalUrl: '/api/payments', headers: {}, body: { amount: 1 }, user: { id: 1 } });
    expect(e.idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(buildOutboxEntry({ method: 'GET', originalUrl: '/api/payments', headers: {} })).toBeNull();
  });
});
