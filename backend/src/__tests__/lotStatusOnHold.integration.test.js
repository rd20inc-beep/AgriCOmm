/**
 * P3-15 / DAT-23: one "On Hold" lot status. Migration 380 drops 'OnHold' from
 * inventory_lots_status_chk; the dry-run-by-default correction script
 * relabels any remaining rows and then tightens the CHECK. DB-gated.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('lot status On Hold (DB-gated)', () => {
  let db; let detect; let correct; let mig;
  const run = `${Date.now()}`.slice(-7);
  const quiet = () => {};

  beforeAll(async () => {
    db = require('../config/database');
    ({ detect } = require('../../scripts/detectLotStatusOnHold'));
    ({ correct } = require('../../scripts/correctLotStatusOnHold'));
    mig = require('../../migrations/20261017_380_lot_status_single_on_hold');
  });
  afterAll(async () => {
    if (db) {
      await mig.up(db); // leave the tight CHECK in place
      await db.destroy();
    }
  });

  const lotRow = async (status) => {
    const wh = (await db('warehouses').first('id')) || (await db('warehouses').insert({ name: `ZZ OH ${run}`, entity: 'mill', type: 'raw' }).returning('id'))[0];
    const p = (await db('products').first('id')) || (await db('products').insert({ name: `ZZ OH ${run}` }).returning('id'))[0];
    return db('inventory_lots').insert({
      lot_no: `ZZOH-${run}-${Math.random().toString(36).slice(2, 6)}`, item_name: 'ZZ', type: 'raw', entity: 'mill',
      warehouse_id: wh.id, product_id: p.id, qty: 0, unit: 'KG', status,
    });
  };

  test('after migration 380 the CHECK refuses the duplicate spelling', async () => {
    const r = await detect(db);
    expect(r.constraintAdmitsOnHold).toBe(false);
    await expect(lotRow('OnHold')).rejects.toThrow(/inventory_lots_status_chk/);
    await lotRow('On Hold');
  });

  test('a DB still holding OnHold rows: migration skips, script relabels + tightens (dry-run writes nothing)', async () => {
    await mig.down(db);
    await lotRow('OnHold');
    await mig.up(db); // rows exist → CHECK left as is
    expect((await detect(db)).constraintAdmitsOnHold).toBe(true);
    const before = (await detect(db)).onHoldIds.length;
    expect(before).toBeGreaterThan(0);

    await correct(db, { write: false, log: quiet });
    expect((await detect(db)).onHoldIds).toHaveLength(before);

    const res = await correct(db, { write: true, log: quiet });
    expect(res).toMatchObject({ relabelled: before, tightened: true });
    const after = await detect(db);
    expect(after).toMatchObject({ onHoldIds: [], constraintAdmitsOnHold: false });
  });
});
