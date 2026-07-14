// Stage 6a — sync pull path (DB-gated). Verifies device bootstrap (idempotent
// upsert), the pull gates (unknown domain / unregistered device), and incremental
// delta pull with a watermark. Runs only when DB_HOST is set (skipped in DB-less
// CI); needs a migrated DB. See docNumber.integration.test.js for the local recipe.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(c) { this.statusCode = c; return this; },
  json(j) { this.body = j; return this; },
});

d('sync pull path (DB-gated)', () => {
  let db, controller, saUser, deviceUuid;

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/sync/sync.controller');
    // Ensure a Super Admin role exists (bypasses per-domain RBAC).
    let sa = await db('roles').where({ name: 'Super Admin' }).first();
    if (!sa) { [sa] = await db('roles').insert({ name: 'Super Admin' }).returning('*'); }
    saUser = { id: 1, role_id: sa.id };
    deviceUuid = '11111111-1111-4111-8111-111111111111';
    // Seed two customers with distinct updated_at for the delta test.
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    await db('customers').insert([
      { name: 'ZZTEST Cust A', customer_type: 'local', currency: 'PKR', credit_limit: 0, is_active: true, is_favorite: false, archived: false, approval_status: 'approved', created_at: db.fn.now(), updated_at: '2026-01-01T00:00:00Z' },
      { name: 'ZZTEST Cust B', customer_type: 'local', currency: 'PKR', credit_limit: 0, is_active: true, is_favorite: false, archived: false, approval_status: 'approved', created_at: db.fn.now(), updated_at: '2026-06-01T00:00:00Z' },
    ]);
  });

  afterAll(async () => {
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    await db('devices').where({ device_uuid: deviceUuid }).del().catch(() => {});
    await db.destroy();
  });

  test('bootstrap registers the device, and is an idempotent upsert', async () => {
    let res = mockRes();
    await controller.bootstrap({ body: { device_uuid: deviceUuid, platform: 'web', label: 'test' }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    let count = await db('devices').where({ device_uuid: deviceUuid }).count('* as c').first();
    expect(Number(count.c)).toBe(1);

    res = mockRes();
    await controller.bootstrap({ body: { device_uuid: deviceUuid, platform: 'web' }, user: saUser }, res);
    count = await db('devices').where({ device_uuid: deviceUuid }).count('* as c').first();
    expect(Number(count.c)).toBe(1); // still one row (upsert, not duplicate)
  });

  test('pull rejects an unknown domain (400)', async () => {
    const res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'nope' }, user: saUser }, res);
    expect(res.statusCode).toBe(400);
  });

  test('pull rejects an unregistered device (403)', async () => {
    const res = mockRes();
    await controller.pull({ body: { device_uuid: '22222222-2222-4222-8222-222222222222', domain: 'customers' }, user: saUser }, res);
    expect(res.statusCode).toBe(403);
  });

  test('pull returns customers, and a watermark filters to newer rows only', async () => {
    let res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers' }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    const names = res.body.data.rows.map((r) => r.name).filter((n) => n && n.startsWith('ZZTEST'));
    expect(names).toEqual(expect.arrayContaining(['ZZTEST Cust A', 'ZZTEST Cust B']));

    // Pull again since Jan 1 → only the June row (and any other newer rows), never Cust A.
    res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers', since: '2026-01-01T00:00:00Z' }, user: saUser }, res);
    const after = res.body.data.rows.map((r) => r.name).filter((n) => n && n.startsWith('ZZTEST'));
    expect(after).toContain('ZZTEST Cust B');
    expect(after).not.toContain('ZZTEST Cust A');
  });
});
