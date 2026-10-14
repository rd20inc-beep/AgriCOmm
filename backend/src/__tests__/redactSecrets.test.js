/**
 * P1-01 — secret redaction for audit payloads (ADM-01 / PLT-09 / TEC-01).
 * Table-driven key matcher, the recursive redactor, the auditService.log choke
 * point, the read-side helper, and the disabled-by-default historic script.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());

const db = require('../config/database');
const { isSecretKey, redactSecrets, redactDetails, REDACTED } = require('../utils/redactSecrets');
const auditService = require('../services/auditService');
const auditAction = require('../middleware/audit');
const { main: redactScriptMain } = require('../../scripts/redactAuditSecrets');

const FAKE = 'FAKE-test-secret-1';

describe('isSecretKey', () => {
  test.each([
    'password', 'Password', 'new_password', 'newPassword', 'old_password', 'current_password',
    'confirm_password', 'password_hash', 'pin', 'PIN', 'portal_pin', 'portalPin', 'new_pin', 'pin_hash',
    'api_key', 'apiKey', 'x-api-key', 'whatsapp_api_key', 'secret_key', 'private_key', 'apikey',
    'secret', 'client_secret', 'token', 'access_token', 'refreshToken', 'captchaToken', 'credential',
    'credentials', 'auth_credentials', 'authorization', 'Authorization', 'cookie', 'otp', 'smtp_pass',
    'smtp_password', 'passphrase', 'session_id',
  ])('%s is secret', (k) => expect(isSecretKey(k)).toBe(true));

  test.each([
    'email', 'full_name', 'role_id', 'group_key', 'idempotency_key', 'public_key', 'token_version',
    'force_password_change', 'password_changed_at', 'auth_type', 'gate_pass_no', 'shipping_line',
    'amount', 'key', 'value', 'pinned', 'spinner', 'status', 'notes', 'bank_name',
  ])('%s is not secret', (k) => expect(isSecretKey(k)).toBe(false));
});

describe('redactSecrets', () => {
  test('replaces secret values at any depth, keeps everything else', () => {
    const input = {
      body: { email: 'a@b.c', password: FAKE, role_id: 3, nested: { apiKey: FAKE, list: [{ pin: '1234', qty: 2 }] } },
      result: { user: { id: 7, password_hash: FAKE } },
    };
    const out = redactSecrets(input);
    expect(out).toEqual({
      body: { email: 'a@b.c', password: REDACTED, role_id: 3, nested: { apiKey: REDACTED, list: [{ pin: REDACTED, qty: 2 }] } },
      result: { user: { id: 7, password_hash: REDACTED } },
    });
    expect(JSON.stringify(out)).not.toContain(FAKE);
    // input untouched
    expect(input.body.password).toBe(FAKE);
  });

  test('a secret-named object/array is replaced whole; null/empty kept as-is', () => {
    const out = redactSecrets({ auth_credentials: { token: FAKE }, token: null, password: '' });
    expect(out).toEqual({ auth_credentials: REDACTED, token: null, password: '' });
  });

  test('cycles and primitives do not throw', () => {
    const a = { x: 1 }; a.self = a;
    expect(redactSecrets(a)).toEqual({ x: 1, self: '[CIRCULAR]' });
    expect(redactSecrets('s')).toBe('s');
    expect(redactSecrets(null)).toBe(null);
    const d = new Date('2026-01-01');
    expect(redactSecrets({ when: d }).when).toBe(d);
  });

  test('redactDetails handles a JSON string as well as an object', () => {
    const s = redactDetails(JSON.stringify({ body: { password: FAKE } }));
    expect(typeof s).toBe('string');
    expect(s).not.toContain(FAKE);
    expect(redactDetails({ body: { whatsapp_api_key: FAKE } }).body.whatsapp_api_key).toBe(REDACTED);
  });
});

describe('auditService.log is the choke point', () => {
  beforeEach(() => db.__set({ audit_logs: [] }));

  test('direct log() call stores no secret', async () => {
    await auditService.log({ userId: 1, action: 'x', entityType: 'user', entityId: 2, details: { password: FAKE, email: 'e@x' } });
    const ins = db.__calls.find((c) => c.table === 'audit_logs').inserts[0];
    expect(ins.details).not.toContain(FAKE);
    expect(JSON.parse(ins.details)).toEqual({ password: REDACTED, email: 'e@x' });
  });

  test('auditAction middleware (raw req.body) stores no secret', async () => {
    const mw = auditAction('create_user', 'user');
    const req = { user: { id: 1 }, params: {}, ip: '127.0.0.1', body: { email: 'n@x', password: FAKE, full_name: 'N' } };
    const res = { json: jest.fn() };
    await mw(req, res, () => {});
    res.json({ success: true, data: { user: { id: 9 } } });
    await new Promise((r) => setImmediate(r));
    const ins = db.__calls.find((c) => c.table === 'audit_logs').inserts[0];
    expect(ins.details).not.toContain(FAKE);
    expect(JSON.parse(ins.details).body).toEqual({ email: 'n@x', password: REDACTED, full_name: 'N' });
  });

  test('read-side redactRows hides secrets in rows written before the fix', () => {
    const rows = auditService.redactRows([{ id: 1, details: { body: { password: FAKE } } }, { id: 2, details: null }]);
    expect(JSON.stringify(rows)).not.toContain(FAKE);
    expect(rows[1].details).toBe(null);
  });
});

describe('historic redaction script', () => {
  test('refuses to write without REDACT_AUDIT_SECRETS=1', async () => {
    const lines = [];
    const code = await redactScriptMain([], {}, (l) => lines.push(l));
    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/disabled/);
  });
});
