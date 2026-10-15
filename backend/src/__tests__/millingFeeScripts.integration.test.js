/**
 * P4-02 / MIL-02 — detectMillingFeeDefault / fixMillingFeeDefault: read-only
 * detection; the fix is a dry run unless FIX_MILLING_FEE_DEFAULT=1 AND the
 * reviewed BATCH_IDS are given, and touches only those ids still at Rs 5.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('milling fee default scripts (DB-gated)', () => {
  let db; const run = `${Date.now()}`.slice(-7); const ids = {};
  const quiet = () => {};

  beforeAll(async () => {
    db = require('../config/database');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-fee-${run}@test.local`, full_name: `ZZ Fee ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ Fee Mill ${run}` }).returning('*');
    const b = async (n, fee) => (await db('milling_batches').insert({
      batch_no: `ZZFEE-${n}-${run}`, created_by: u.id, mill_id: mill.id, status: 'Completed', milling_fee_per_kg: fee,
    }).returning('*'))[0].id;
    Object.assign(ids, { five1: await b('A', 5), five2: await b('B', 5), typed: await b('C', 3) });
  });
  afterAll(async () => {
    if (!db) return;
    const all = [ids.five1, ids.five2, ids.typed];
    await db('audit_logs').where({ action: 'milling_fee_default_reset' }).whereIn('entity_id', all.map(String)).del();
    await db('milling_batches').whereIn('id', all).del();
    await db.destroy();
  });

  const fee = async (id) => Number((await db('milling_batches').where({ id }).first()).milling_fee_per_kg);

  test('detect lists the Rs 5 rows, leaves typed fees out', async () => {
    const { detect } = require('../../scripts/detectMillingFeeDefault');
    const r = await detect(db);
    expect(r.defaultFeeIds).toEqual(expect.arrayContaining([ids.five1, ids.five2]));
    expect(r.defaultFeeIds).not.toContain(ids.typed);
    expect(r.columnDefault).toMatch(/^0/);
  });

  test('dry run writes nothing; a write needs BATCH_IDS and touches only those', async () => {
    const { correct } = require('../../scripts/fixMillingFeeDefault');
    await correct(db, { write: false, ids: [ids.five1], log: quiet });
    expect(await fee(ids.five1)).toBe(5);
    expect((await correct(db, { write: true, ids: [], log: quiet })).reset).toBe(0);
    expect(await fee(ids.five1)).toBe(5);

    const r = await correct(db, { write: true, ids: [ids.five1, ids.typed], log: quiet });
    expect(r.reset).toBe(1);
    expect(await fee(ids.five1)).toBe(0);
    expect(await fee(ids.five2)).toBe(5); // not reviewed → untouched
    expect(await fee(ids.typed)).toBe(3); // typed fee → untouched
    const audit = await db('audit_logs').where({ action: 'milling_fee_default_reset', entity_id: String(ids.five1) });
    expect(audit).toHaveLength(1);
  });
});
