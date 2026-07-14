// Stage 6b — deviceGuard (DB-gated). A revoked device's WRITES are blocked (403);
// active/unknown devices and reads pass. Runs only when DB_HOST is set.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mkReq = (method, deviceId) => ({ method, get: (h) => (h === 'X-Device-Id' ? deviceId : undefined) });
const mockRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; } });

d('deviceGuard (DB-gated)', () => {
  let db, guard;
  const devUuid = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    db = require('../config/database');
    guard = require('../middleware/deviceGuard');
    await db('devices').where({ device_uuid: devUuid }).del();
    await db('devices').insert({ device_uuid: devUuid, status: 'active' });
  });
  afterAll(async () => {
    await db('devices').where({ device_uuid: devUuid }).del();
    await db.destroy();
  });

  const setStatus = (s) => db('devices').where({ device_uuid: devUuid }).update({ status: s });

  test('active device: write allowed', async () => {
    await setStatus('active');
    let nexted = false;
    await guard(mkReq('POST', devUuid), mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  test('revoked device: write blocked with 403 device_revoked', async () => {
    await setStatus('revoked');
    let nexted = false;
    const res = mockRes();
    await guard(mkReq('POST', devUuid), res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('device_revoked');
    await setStatus('active');
  });

  test('revoked device: GET is NOT blocked here', async () => {
    await setStatus('revoked');
    let nexted = false;
    await guard(mkReq('GET', devUuid), mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
    await setStatus('active');
  });

  test('unknown device: allowed (fail-open)', async () => {
    let nexted = false;
    await guard(mkReq('POST', '44444444-4444-4444-8444-444444444444'), mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  test('no device header: allowed', async () => {
    let nexted = false;
    await guard(mkReq('POST', undefined), mockRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
