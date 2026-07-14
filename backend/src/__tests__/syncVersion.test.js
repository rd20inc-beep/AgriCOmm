// Stage 17 — sync protocol handshake (pure, no DB). A client below the server minimum
// is refused with 426 so it pauses sync before pushing an incompatible payload
// (§6: server schema migration / app version mismatch). Legacy clients (no header) are
// allowed for back-compat.
const controller = require('../modules/sync/sync.controller');

const mockRes = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this; },
  json(j) { this.body = j; return this; },
});

describe('checkSyncProtocol', () => {
  test('allows a client at or above the minimum (returns null)', () => {
    const res = mockRes();
    const out = controller.checkSyncProtocol({ headers: { 'x-sync-protocol': String(controller.MIN_CLIENT_PROTOCOL) } }, res);
    expect(out).toBeNull();
    expect(res.statusCode).toBe(200);
  });

  test('refuses a client below the minimum with 426 + code', () => {
    const res = mockRes();
    const out = controller.checkSyncProtocol({ headers: { 'x-sync-protocol': String(controller.MIN_CLIENT_PROTOCOL - 1) } }, res);
    expect(out).toBe(true);
    expect(res.statusCode).toBe(426);
    expect(res.body.code).toBe('sync_outdated');
    expect(res.body.data.minClientProtocol).toBe(controller.MIN_CLIENT_PROTOCOL);
  });

  test('allows a legacy client that sends no protocol header (back-compat)', () => {
    const res = mockRes();
    expect(controller.checkSyncProtocol({ headers: {} }, res)).toBeNull();
    expect(res.statusCode).toBe(200);
  });
});
