// Stage 15 — device management (DB-gated). Verifies the manager list join and
// the owner-only revoke/reactivate state flips. Runs only when DB_HOST is set
// (skipped in DB-less CI); needs a migrated DB. See sync.integration.test.js.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(c) { this.statusCode = c; return this; },
  json(j) { this.body = j; return this; },
});

d('sync device management (DB-gated)', () => {
  let db, controller, saUser, deviceUuid;

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/sync/sync.controller');
    let sa = await db('roles').where({ name: 'Super Admin' }).first();
    if (!sa) { [sa] = await db('roles').insert({ name: 'Super Admin' }).returning('*'); }
    saUser = { id: 1, role_id: sa.id };
    deviceUuid = '33333333-3333-4333-8333-333333333333';
    await db('devices').where({ device_uuid: deviceUuid }).del().catch(() => {});
    await controller.bootstrap({ body: { device_uuid: deviceUuid, platform: 'web', label: 'ZZTEST device' }, user: saUser }, mockRes());
  });

  afterAll(async () => {
    await db('devices').where({ device_uuid: deviceUuid }).del().catch(() => {});
    await db.destroy();
  });

  test('listDevices returns the registered device and flags the caller', async () => {
    const res = mockRes();
    await controller.listDevices({ headers: { 'x-device-id': deviceUuid }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.current_device_uuid).toBe(deviceUuid);
    const mine = res.body.data.devices.find((x) => x.device_uuid === deviceUuid);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('active');
  });

  test('revoke flips status to revoked with an audit stamp', async () => {
    const dev = await db('devices').where({ device_uuid: deviceUuid }).first();
    const res = mockRes();
    await controller.revokeDevice({ params: { id: dev.id }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.device.status).toBe('revoked');
    expect(res.body.data.device.revoked_by).toBe(saUser.id);
    expect(res.body.data.device.revoked_at).toBeTruthy();
  });

  test('reactivate clears the revoked state', async () => {
    const dev = await db('devices').where({ device_uuid: deviceUuid }).first();
    const res = mockRes();
    await controller.reactivateDevice({ params: { id: dev.id }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.device.status).toBe('active');
    expect(res.body.data.device.revoked_at).toBeNull();
  });

  test('revoke of a non-existent device is a clean 404', async () => {
    const res = mockRes();
    await controller.revokeDevice({ params: { id: 999999 }, user: saUser }, res);
    expect(res.statusCode).toBe(404);
  });
});
