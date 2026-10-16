/**
 * P5-13 — GET /api/company-profile: the letterhead for print headers, open to
 * every signed-in role, returning ONLY the public letterhead fields.
 *
 *   - unit: pickPublic keeps name/tagline/address/phone/email/website/ntn/logo
 *     and drops everything else (unknown keys, nested objects, secrets);
 *   - wiring: routes/index mounts it behind authenticate (no anonymous read);
 *   - DB-gated: the lowest-permission role (QC Analyst, no admin.view) reads
 *     the saved profile with a real token; no token → 401; a secret-looking
 *     key saved inside companyProfile and other system_settings never appear.
 */
const fs = require('fs');
const path = require('path');
const { pickPublic, PUBLIC_FIELDS } = require('../modules/admin/companyProfile.routes');

describe('company profile — field allowlist', () => {
  it('returns only the letterhead fields', () => {
    expect(PUBLIC_FIELDS).toEqual(['name', 'tagline', 'address', 'phone', 'email', 'website', 'ntn', 'logo']);
    const out = pickPublic({
      name: 'ZZ Rice', tagline: 't', address: 'a', phone: 'p', email: 'e@x', website: 'w', ntn: '123', logo: '/l.png',
      whatsapp_api_key: 'SECRET', smtp_password: 'SECRET', bank: { iban: 'PK00' }, proprietorCnic: '42301',
    });
    expect(Object.keys(out).sort()).toEqual([...PUBLIC_FIELDS].sort());
    expect(JSON.stringify(out)).not.toMatch(/SECRET|PK00|42301/);
  });

  it('drops null / object values and tolerates junk', () => {
    expect(pickPublic(null)).toEqual({});
    expect(pickPublic('x')).toEqual({});
    expect(pickPublic({ name: null, address: { line1: 'x' }, phone: 123 })).toEqual({ phone: '123' });
  });

  it('is mounted behind authenticate', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/index.js'), 'utf8');
    expect(src).toMatch(/router\.use\('\/company-profile', authenticate, require\('\.\.\/modules\/admin\/companyProfile\.routes'\)\)/);
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('GET /api/company-profile (DB-gated)', () => {
  let db; let request; let app; let token; let userId; let prevProfile; let hadRow;
  const run = `${Date.now()}`.slice(-7);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const config = require('../config');
    const authenticate = require('../middleware/auth');

    const qc = await db('roles').where({ name: 'QC Analyst' }).first();
    userId = (await db('users').insert({
      email: `zz-cp-${run}@test.local`, full_name: `ZZ cp ${run}`,
      password_hash: await bcrypt.hash('pw', 4), role_id: qc.id, is_active: true, status: 'active',
    }).returning('id'))[0];
    userId = userId.id || userId;
    token = jwt.sign({ id: userId, email: `zz-cp-${run}@test.local`, role: 'QC Analyst', tv: 0 }, config.jwt.secret, { expiresIn: '5m' });

    const row = await db('system_settings').where({ key: 'companyProfile' }).first();
    hadRow = !!row;
    prevProfile = row ? row.value : null;
    const value = JSON.stringify({ name: `ZZ Rice ${run}`, address: 'ZZ Street', phone: '+92 0', whatsapp_api_key: 'SECRET-KEY', bank: { iban: 'PK00SECRET' } });
    if (hadRow) await db('system_settings').where({ key: 'companyProfile' }).update({ value });
    else await db('system_settings').insert({ key: 'companyProfile', value });

    app = express();
    app.use('/api/company-profile', authenticate, require('../modules/admin/companyProfile.routes'));
  });

  afterAll(async () => {
    if (hadRow) await db('system_settings').where({ key: 'companyProfile' }).update({ value: typeof prevProfile === 'string' ? prevProfile : JSON.stringify(prevProfile) });
    else await db('system_settings').where({ key: 'companyProfile' }).del();
    if (userId) await db('users').where({ id: userId }).del();
    await db.destroy();
  });

  it('a role without admin.view reads the configured letterhead', async () => {
    const r = await request(app).get('/api/company-profile').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ name: `ZZ Rice ${run}`, address: 'ZZ Street', phone: '+92 0' });
  });

  it('never returns secrets or non-letterhead keys', async () => {
    const r = await request(app).get('/api/company-profile').set('Authorization', `Bearer ${token}`);
    const body = JSON.stringify(r.body);
    expect(body).not.toMatch(/SECRET|whatsapp|iban|bank/i);
    for (const k of Object.keys(r.body.data)) expect(PUBLIC_FIELDS).toContain(k);
  });

  it('refuses an anonymous request', async () => {
    const r = await request(app).get('/api/company-profile');
    expect(r.status).toBe(401);
  });
});
