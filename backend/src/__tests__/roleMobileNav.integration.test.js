// Per-role mobile bottom-nav config (DB-gated). Verifies updateRoleMobileNav stores
// an ordered/capped/deduped key list (and null-resets), and that the auth repo reads
// it back. Runs only when DB_HOST is set (skipped in DB-less CI).
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockRes = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this; },
  json(j) { this.body = j; return this; },
});

d('role mobile-nav (DB-gated)', () => {
  let db, controller, authRepo, roleId;

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/admin/admin.controller');
    authRepo = require('../modules/auth/auth.repository');
    await db('roles').where('name', 'ZZTEST Role').del().catch(() => {});
    [roleId] = await db('roles').insert({ name: 'ZZTEST Role' }).returning('id');
    roleId = roleId.id ?? roleId;
  });

  afterAll(async () => {
    await db('roles').where({ id: roleId }).del().catch(() => {});
    await db.destroy();
  });

  test('stores a deduped, capped, ordered key list', async () => {
    const res = mockRes();
    await controller.updateRoleMobileNav(
      { params: { id: roleId }, body: { items: ['home', 'finance', 'home', 'reports', 'export', 'quality'] } },
      res,
    );
    expect(res.body.success).toBe(true);
    // deduped (home once) + capped to 4, order preserved
    expect(res.body.data.mobile_nav).toEqual(['home', 'finance', 'reports', 'export']);
    expect(await authRepo.getMobileNavForRole(roleId)).toEqual(['home', 'finance', 'reports', 'export']);
  });

  test('empty array resets to default (null)', async () => {
    const res = mockRes();
    await controller.updateRoleMobileNav({ params: { id: roleId }, body: { items: [] } }, res);
    expect(res.body.data.mobile_nav).toBeNull();
    expect(await authRepo.getMobileNavForRole(roleId)).toBeNull();
  });

  test('rejects a non-array items', async () => {
    const res = mockRes();
    await controller.updateRoleMobileNav({ params: { id: roleId }, body: { items: 'nope' } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('404 for an unknown role', async () => {
    const res = mockRes();
    await controller.updateRoleMobileNav({ params: { id: 999999 }, body: { items: ['home'] } }, res);
    expect(res.statusCode).toBe(404);
  });
});
