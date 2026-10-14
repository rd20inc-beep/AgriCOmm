/**
 * P1-01 / P1-02 / P1-17 over HTTP against a real, fully-migrated Postgres.
 *   - creating a user / setting a password / saving the WhatsApp key leaves no
 *     secret in audit_logs.details, nor in /api/audit-logs
 *   - settings GET never returns the key; a saved setting reaches its reader
 *   - an admin.view role without finance.view_bank_details sees masked bank numbers
 *   - the historic redaction script rewrites an old row in place
 *
 * DB-gated: skipped unless DB_HOST is set (see bankAccountBalanceGuard.integration.test.js).
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

const FAKE_PW = 'FAKE-test-secret-1-Pw!';
const FAKE_KEY = 'FAKE-test-secret-1-key';

d('audit secret redaction (DB-gated)', () => {
  let db; let app; let request; let token; let viewerToken; let viewerRoleId;
  const run = `${Date.now()}`.slice(-7);
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const savedSettings = {};

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-audit-${run}@test.local`, full_name: `ZZ Audit ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    token = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);

    // A role with admin.view but not finance.view_bank_details.
    const [vr] = await db('roles').insert({ name: `ZZ Viewer ${run}`, description: 'test' }).returning('*');
    viewerRoleId = vr.id;
    const perm = await db('permissions').where({ module: 'admin', action: 'view' }).first();
    await db('role_permissions').insert({ role_id: vr.id, permission_id: perm.id });
    const [v] = await db('users').insert({
      email: `zz-audit-v-${run}@test.local`, full_name: `ZZ Viewer ${run}`, password_hash: 'x', role_id: vr.id, is_active: true, status: 'active',
    }).returning('*');
    viewerToken = jwt.sign({ id: v.id, role_id: v.role_id, email: v.email }, config.jwt.secret);

    for (const k of ['whatsapp_api_key', 'pkr_rate', 'min_margin_pct']) {
      savedSettings[k] = await db('system_settings').where({ key: k }).first();
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const [k, row] of Object.entries(savedSettings)) {
      if (row) await db('system_settings').where({ key: k }).update({ value: row.value, updated_by: row.updated_by });
      else await db('system_settings').where({ key: k }).del();
    }
    await db.destroy();
  });

  const auditText = async (where) => JSON.stringify(await db('audit_logs').where(where).select('details'));

  test('create user + set password: no password in audit_logs or /api/audit-logs', async () => {
    const created = await request(app).post('/api/users').set(auth()).send({
      email: `zz-new-${run}@test.local`, password: FAKE_PW, full_name: `ZZ New ${run}`, role_id: viewerRoleId,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.user.id;
    await new Promise((r) => setTimeout(r, 300)); // auditAction logs after res.json

    const rows = await db('audit_logs').where({ action: 'create_user', entity_id: String(id) });
    expect(rows).toHaveLength(1);
    expect(rows[0].details.body.password).toBe('[REDACTED]');
    expect(rows[0].details.body.email).toBe(`zz-new-${run}@test.local`);
    expect(await auditText({ entity_type: 'user', entity_id: String(id) })).not.toContain(FAKE_PW);

    const list = await request(app).get('/api/audit-logs').query({ entity_type: 'user' }).set(auth());
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(FAKE_PW);
  });

  test('WhatsApp key: write-only in settings, redacted in audit; saved settings reach their readers', async () => {
    const put = await request(app).put('/api/admin/settings').set(auth()).send({
      whatsapp_api_key: FAKE_KEY, pkr_rate: 287.25, min_margin_pct: 6,
    });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain(FAKE_KEY);
    await new Promise((r) => setTimeout(r, 300));

    const get = await request(app).get('/api/admin/settings').set(auth(viewerToken));
    expect(get.status).toBe(200);
    expect(JSON.stringify(get.body)).not.toContain(FAKE_KEY);
    expect(get.body.data.secrets.whatsapp_api_key).toEqual({ is_set: true });

    const audit = await db('audit_logs').where({ entity_type: 'settings' }).orderBy('id', 'desc').first();
    expect(audit.details.body.whatsapp_api_key).toBe('[REDACTED]');
    expect(JSON.stringify(audit.details)).not.toContain(FAKE_KEY);

    // the key itself is still stored for the WhatsApp sender
    const wa = await require('../modules/communications/whatsapp.service').getWhatsAppSettings();
    expect(wa.apiKey).toBe(FAKE_KEY);
    const row = await db('system_settings').where({ key: 'pkr_rate' }).first();
    expect(row.updated_by).toBeTruthy();
    // fxRate fallback reads pkr_rate (no fx_rates row for this made-up currency)
    const fx = await require('../modules/finance/fxRate.service').getLatestRate('ZZQ');
    expect(fx.rate).toBe(287.25);

    const bad = await request(app).put('/api/admin/settings').set(auth()).send({ pkrRate: 1 });
    expect(bad.status).toBe(400);
  });

  test('admin.view without view_bank_details gets masked bank numbers', async () => {
    const [acct] = await db('bank_accounts').insert({
      name: `ZZ Mask ${run}`, bank_name: 'ZZ', type: 'bank', currency: 'PKR', account_number: '00112233445566', iban: 'PK00ZZZZ0000112233445566',
    }).returning('*');
    const v = await request(app).get(`/api/admin/bank-accounts/${acct.id}`).set(auth(viewerToken));
    expect(v.status).toBe(200);
    expect(v.body.data.bank_account.account_number).toBe('•••• 5566');
    const a = await request(app).get(`/api/admin/bank-accounts/${acct.id}`).set(auth());
    expect(a.body.data.bank_account.account_number).toBe('00112233445566');
    await db('bank_accounts').where({ id: acct.id }).del();
  });

  test('historic script redacts an old row in place', async () => {
    const [old] = await db('audit_logs').insert({
      action: 'create_user', entity_type: 'zz_hist', entity_id: run,
      details: JSON.stringify({ body: { email: 'h@x', password: FAKE_PW } }),
    }).returning('*');
    const { scan } = require('../../scripts/redactAuditSecrets');
    const dry = await scan(db, { write: false });
    expect(dry.byEntity.zz_hist).toBe(1);
    expect((await db('audit_logs').where({ id: old.id }).first()).details.body.password).toBe(FAKE_PW);
    await scan(db, { write: true });
    const after = await db('audit_logs').where({ id: old.id }).first();
    expect(after.details).toEqual({ body: { email: 'h@x', password: '[REDACTED]' } });
    expect((await scan(db, { write: false })).affected).toBe(0);
  });
});
