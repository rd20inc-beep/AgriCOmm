// P1-07 — employee portal login hardening (DB-gated; runs only when DB_HOST is
// set and migration 335 has run). Wrong PINs lock the worker, disabling the
// portal / resetting the PIN / deactivating the worker kills issued tokens, and
// a duplicate active CNIC cannot be inserted.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const CNIC = '99999-0000001-9';
const CNIC2 = '99999-0000002-9';
const PIN = '246810';

d('employee portal login (DB-gated)', () => {
  let db, request, app, bcrypt, workerId;

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    bcrypt = require('bcryptjs');
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/api/portal', require('../modules/portal/portal.routes'));
    await db('mill_workers').whereIn('cnic', [CNIC, CNIC2]).del();
    const [w] = await db('mill_workers').insert({
      name: 'ZZTEST Portal Worker', pay_type: 'daily', daily_wage: 100, cnic: CNIC,
      portal_enabled: true, portal_pin_hash: await bcrypt.hash(PIN, 4),
    }).returning('id');
    workerId = w.id || w;
  });
  afterAll(async () => {
    await db('mill_workers').whereIn('cnic', [CNIC, CNIC2]).del();
    await db.destroy();
  });

  const reset = () => db('mill_workers').where('id', workerId).update({
    portal_failed_attempts: 0, portal_locked_until: null, portal_enabled: true, is_active: true,
  });
  const login = (pin, cnic = CNIC) => request(app).post('/api/portal/login').send({ cnic, pin });
  const me = (token) => request(app).get('/api/portal/me').set('Authorization', `Bearer ${token}`);

  test('correct PIN logs in and the token works', async () => {
    await reset();
    const r = await login(PIN);
    expect(r.status).toBe(200);
    expect((await me(r.body.data.token)).status).toBe(200);
  });

  test('5 wrong PINs lock the worker for 15 minutes — even the right PIN is refused', async () => {
    await reset();
    for (let i = 1; i <= 4; i += 1) expect((await login('000000')).status).toBe(401);
    const fifth = await login('000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.message).toMatch(/locked/i);
    const right = await login(PIN);
    expect(right.status).toBe(429);
    const w = await db('mill_workers').where('id', workerId).first('portal_locked_until');
    const mins = (new Date(w.portal_locked_until) - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15.1);
  });

  test('lock expires; a successful login clears the counter', async () => {
    await db('mill_workers').where('id', workerId).update({ portal_locked_until: db.raw("now() - interval '1 second'"), portal_failed_attempts: 3 });
    expect((await login(PIN)).status).toBe(200);
    const w = await db('mill_workers').where('id', workerId).first('portal_failed_attempts', 'portal_locked_until');
    expect(w.portal_failed_attempts).toBe(0);
    expect(w.portal_locked_until).toBeNull();
  });

  test('parallel wrong guesses cannot get more than 5 PIN compares', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 10 }, () => login('000000')));
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(4);
    expect((await login(PIN)).status).toBe(429);
  });

  test('disabling self-service invalidates an issued token', async () => {
    await reset();
    const { token } = (await login(PIN)).body.data;
    await db('mill_workers').where('id', workerId).update({ portal_enabled: false, portal_pin_version: db.raw('portal_pin_version + 1') });
    const r = await me(token);
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/session/i);
  });

  test('a PIN reset (version bump) invalidates an issued token even with the portal still on', async () => {
    await reset();
    const { token } = (await login(PIN)).body.data;
    await db('mill_workers').where('id', workerId).update({ portal_pin_version: db.raw('portal_pin_version + 1') });
    expect((await me(token)).status).toBe(401);
  });

  test('deactivating the worker invalidates an issued token', async () => {
    await reset();
    const { token } = (await login(PIN)).body.data;
    await db('mill_workers').where('id', workerId).update({ is_active: false });
    expect((await me(token)).status).toBe(401);
    await reset();
  });

  test('change-pin needs 6–8 digits, ends old sessions and returns a working token', async () => {
    await reset();
    const { token } = (await login(PIN)).body.data;
    const short = await request(app).post('/api/portal/change-pin').set('Authorization', `Bearer ${token}`).send({ current_pin: PIN, new_pin: '1234' });
    expect(short.status).toBe(400);
    const ok = await request(app).post('/api/portal/change-pin').set('Authorization', `Bearer ${token}`).send({ current_pin: PIN, new_pin: '135792' });
    expect(ok.status).toBe(200);
    expect((await me(token)).status).toBe(401);
    expect((await me(ok.body.data.token)).status).toBe(200);
    await db('mill_workers').where('id', workerId).update({ portal_pin_hash: await bcrypt.hash(PIN, 4) });
  });

  test('an existing 4-digit PIN still logs in', async () => {
    await reset();
    await db('mill_workers').where('id', workerId).update({ portal_pin_hash: await bcrypt.hash('4321', 4) });
    expect((await login('4321')).status).toBe(200);
    await db('mill_workers').where('id', workerId).update({ portal_pin_hash: await bcrypt.hash(PIN, 4) });
  });

  test('a second ACTIVE worker with the same CNIC is rejected by the database', async () => {
    await expect(db('mill_workers').insert({ name: 'ZZTEST Dup', pay_type: 'daily', daily_wage: 100, cnic: CNIC }))
      .rejects.toMatchObject({ code: '23505' });
  });
});
