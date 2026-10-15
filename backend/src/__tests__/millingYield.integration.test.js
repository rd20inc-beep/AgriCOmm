/**
 * D-14 yield: Σ finished ÷ Σ raw (weighted), completed company batches only —
 * a small trial batch must not weigh as much as a full run, and service
 * (toll) milling never counts.
 */
const { weightedYieldPct } = require('../modules/milling/millingYield');

describe('weightedYieldPct (pure)', () => {
  test('weights by raw input, skips open / service batches', () => {
    const rows = [
      { status: 'Completed', raw_qty_kg: 1000, actual_finished_kg: 900 },      // 90 %
      { status: 'Completed', raw_qty_kg: 49000, actual_finished_kg: 34300 },   // 70 %
      { status: 'Completed', raw_qty_kg: 10000, actual_finished_kg: 9900, is_service_milling: true },
      { status: 'In Progress', raw_qty_kg: 5000, actual_finished_kg: 0 },
    ];
    expect(weightedYieldPct(rows)).toBe(70.4); // 35,200 / 50,000 — not the 80 % simple average
    expect(weightedYieldPct([])).toBeNull();
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('supplier recovery comparison uses the weighted yield (DB-gated)', () => {
  let db; const run = `${Date.now()}`.slice(-6);
  afterAll(async () => { if (db) await db.destroy(); });
  test('Σ finished ÷ Σ raw over completed company batches', async () => {
    db = require('../config/database');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-my-${run}@test.local`, full_name: `ZZ MY ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ MY Mill ${run}` }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ MY Supplier ${run}`, type: 'local' }).returning('*');
    const b = (n, o) => ({ batch_no: `MY${run}-${n}`, supplier_id: sup.id, mill_id: mill.id, created_by: u.id, ...o });
    await db('milling_batches').insert([
      b(1, { status: 'Completed', raw_qty_kg: 1000, actual_finished_kg: 900, yield_pct: 90 }),
      b(2, { status: 'Completed', raw_qty_kg: 49000, actual_finished_kg: 34300, yield_pct: 70 }),
      b(3, { status: 'Completed', raw_qty_kg: 10000, actual_finished_kg: 9900, yield_pct: 99, is_service_milling: true }),
      b(4, { status: 'Queued', raw_qty_kg: 5000, actual_finished_kg: 0 }),
    ]);
    const svc = require('../modules/milling/milling.service');
    const row = (await svc.getSupplierRecoveryComparison()).find((r) => r.supplier_id === sup.id);
    expect(row.avg_yield_pct).toBe(70.4);
    expect(row.batch_count).toBe(2);
  });
});
