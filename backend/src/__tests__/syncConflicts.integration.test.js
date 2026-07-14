// Stage 8 — sync conflicts (DB-gated). A device records a refused write; managers
// list + resolve. Runs only when DB_HOST is set. (Route-level RBAC is exercised by
// authorizeRole middleware; here we test the controller handlers directly.)
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; } });

d('sync conflicts (DB-gated)', () => {
  let db, controller, user;
  const devUuid = '66666666-6666-4666-8666-666666666666';
  const itemUuid = '77777777-7777-4777-8777-777777777777';

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/sync/sync.controller');
    user = { id: 1 };
    await db('sync_conflicts').where('item_uuid', itemUuid).del().catch(() => {});
    await db('devices').where({ device_uuid: devUuid }).del();
    await db('devices').insert({ device_uuid: devUuid, status: 'active' });
  });
  afterAll(async () => {
    await db('sync_conflicts').where('item_uuid', itemUuid).del().catch(() => {});
    await db('devices').where({ device_uuid: devUuid }).del();
    await db.destroy();
  });

  const conflictBody = {
    device_uuid: devUuid, item_uuid: itemUuid, endpoint: '/api/local-sales', method: 'POST',
    conflict_code: 'insufficient_stock', status_code: 422, message: 'Insufficient stock', label: 'New local sale',
  };

  test('records a conflict for a registered device', async () => {
    const res = mockRes();
    await controller.recordConflict({ body: conflictBody, user }, res);
    expect(res.body.success).toBe(true);
    const row = await db('sync_conflicts').where('item_uuid', itemUuid).first();
    expect(row.conflict_code).toBe('insufficient_stock');
    expect(row.resolution).toBe('pending');
  });

  test('rejects an unregistered device (403)', async () => {
    const res = mockRes();
    await controller.recordConflict({ body: { ...conflictBody, device_uuid: '88888888-8888-4888-8888-888888888888' }, user }, res);
    expect(res.statusCode).toBe(403);
  });

  test('rejects a malformed device_uuid (400)', async () => {
    const res = mockRes();
    await controller.recordConflict({ body: { ...conflictBody, device_uuid: 'not-a-uuid' }, user }, res);
    expect(res.statusCode).toBe(400);
  });

  test('lists open (pending) conflicts', async () => {
    const res = mockRes();
    await controller.listConflicts({ query: { status: 'pending' } }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.conflicts.some((c) => c.item_uuid === itemUuid)).toBe(true);
  });

  test('resolves a conflict (dismiss)', async () => {
    const row = await db('sync_conflicts').where('item_uuid', itemUuid).first();
    const res = mockRes();
    await controller.resolveConflict({ params: { id: row.id }, body: { resolution: 'dismissed' }, user }, res);
    expect(res.body.success).toBe(true);
    const after = await db('sync_conflicts').where({ id: row.id }).first();
    expect(after.resolution).toBe('dismissed');
    expect(after.resolved_by).toBe(1);
  });
});
