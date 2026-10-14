// Role-permission matrix snapshot for the permissions P1-14 / P1-18 touched
// (mig 339), on a freshly migrated database. Runs only when DB_HOST is set
// (skipped in DB-less CI). On prod the confirm_payment split follows whatever
// roles hold confirm_payment there (granted by query, not by name list).
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const KEYS = [
  'finance.confirm_payment', 'finance.reverse_payment', 'finance.set_rates',
  'inventory.adjust', 'inventory.approve_write_off', 'milling.delete',
  'mill_store.approve_adjustment', 'mill_store.override_negative_stock',
  'documents.upload', 'documents.reject', 'documents.approve', 'export_orders.close', 'export_orders.approve',
];

d('permission matrix after mig 339 (DB-gated)', () => {
  let db;
  let matrix;

  beforeAll(async () => {
    db = require('../config/database');
    const rows = await db('permissions as p')
      .leftJoin('role_permissions as rp', 'rp.permission_id', 'p.id')
      .leftJoin('roles as r', 'r.id', 'rp.role_id')
      .whereIn(db.raw("p.module || '.' || p.action"), KEYS)
      .select(db.raw("p.module || '.' || p.action as key"), 'r.name as role');
    matrix = {};
    for (const k of KEYS) matrix[k] = [];
    for (const r of rows) if (r.role) matrix[r.key].push(r.role);
    for (const k of KEYS) matrix[k].sort();
  });

  afterAll(async () => { await db.destroy(); });

  test('reversal and rate-setting follow confirm_payment exactly', () => {
    expect(matrix['finance.reverse_payment']).toEqual(matrix['finance.confirm_payment']);
    expect(matrix['finance.set_rates']).toEqual(matrix['finance.confirm_payment']);
  });

  test('write-offs stay Owner-only (plus Super Admin), as the old role lists', () => {
    expect(matrix['inventory.approve_write_off']).toEqual(['Owner', 'Super Admin']);
    expect(matrix['mill_store.approve_adjustment']).toEqual(['Owner', 'Super Admin']);
    expect(matrix['mill_store.override_negative_stock']).toEqual(['Owner', 'Super Admin']);
  });

  test('enforced permissions hold exactly the roles that passed the route before', () => {
    expect(matrix['documents.reject']).toEqual(matrix['documents.approve']);
    expect(matrix['export_orders.close']).toEqual(expect.arrayContaining(matrix['export_orders.approve']));
    expect(matrix['milling.delete']).toEqual(['Mill Manager', 'Owner', 'Super Admin']);
  });
});
