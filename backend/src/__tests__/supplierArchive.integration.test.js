/**
 * listSuppliers must exclude archived suppliers (DB-gated).
 *
 * `archived` existed on suppliers and was written by the archive path, but
 * listSuppliers never filtered it — unlike listCustomers, which has always had
 * `.where('archived', false)`. Every picker and dropdown is fed from
 * GET /api/suppliers → listSuppliers, so archiving a supplier changed nothing a
 * user could see.
 *
 * Runs only when DB_HOST is set (skipped in DB-less CI). Needs a migrated DB.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

d('listSuppliers archived filter (DB-gated)', () => {
  let db, repo, liveId, archivedId;

  beforeAll(async () => {
    db = require('../config/database');
    repo = require('../modules/masterData/masterData.repository');
    const base = { type: 'Rice Supplier', is_active: true, archived: false, approval_status: 'approved', is_favorite: false };
    const [live] = await db('suppliers').insert({ ...base, name: 'ZZTEST Live Supplier' }).returning('id');
    const [arch] = await db('suppliers').insert({ ...base, name: 'ZZTEST Archived Supplier', archived: true, is_active: false }).returning('id');
    liveId = live.id ?? live;
    archivedId = arch.id ?? arch;
  });

  afterAll(async () => {
    if (db) {
      await db('suppliers').whereIn('id', [liveId, archivedId].filter(Boolean)).del();
      await db.destroy();
    }
  });

  test('an archived supplier is not listed', async () => {
    const { items } = await repo.listSuppliers({ limit: 1000 });
    const ids = items.map((s) => s.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(archivedId);
  });

  test('searching by its name does not surface it either', async () => {
    const { items, total } = await repo.listSuppliers({ search: 'ZZTEST Archived Supplier', limit: 100 });
    expect(items).toHaveLength(0);
    expect(total).toBe(0);
  });

  test('the total count excludes it, so pagination stays honest', async () => {
    const { total } = await repo.listSuppliers({ search: 'ZZTEST', limit: 100 });
    expect(total).toBe(1);   // the live one only
  });

  test('it is still retrievable by id, so historical records resolve', async () => {
    const row = await repo.getSupplierById(archivedId);
    expect(row).toBeTruthy();
    expect(row.archived).toBe(true);
  });
});
