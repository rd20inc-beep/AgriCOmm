/**
 * P3-01 / P3-02 — the drift detection + correction scripts.
 *
 * Builds the production shapes the CHECK (migration 371) now refuses — so the
 * CHECK is dropped while they are written and re-added NOT VALID, as a deploy
 * onto drifted data leaves it — then: detect lists them by class, the dry run
 * writes nothing, the write run restates only what is safe by default, the
 * opt-ins convert an old Use in Batch into a real commitment, and the CHECK is
 * validated once no row breaks it.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

const CHECK = 'inventory_lots_available_derived_chk';
const PRED = 'abs(available_qty - (qty - reserved_qty - milling_reserved_qty)) <= 0.01';

d('lot quantity drift scripts (DB-gated)', () => {
  let db; let detectMod; let correctMod; let inventory;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const n = (v) => parseFloat(v) || 0;
  const quiet = () => {};

  const lot = async (sfx, over) => {
    const [l] = await db('inventory_lots').insert({
      lot_no: `ZZD-${run}-${sfx}`, item_name: 'ZZ D Rice', type: 'raw', entity: 'mill',
      warehouse_id: ids.wh, product_id: ids.product, unit: 'KG', status: 'Available', qty: 0, available_qty: 0,
      created_by: ids.user, landed_cost_per_kg: 100, ...over,
    }).returning('*');
    if (n(over.qty) > 0) {
      // A matching ledger row so only the availability drifts.
      await db('lot_transactions').insert({
        transaction_no: `ZZD-${run}-${sfx}`, transaction_date: '2026-10-01', lot_id: l.id, transaction_type: 'purchase_in',
        quantity_kg: n(over.qty), currency: 'PKR', created_by: ids.user, performed_by: ids.user,
      });
    }
    return l;
  };

  beforeAll(async () => {
    db = require('../config/database');
    inventory = require('../modules/inventory/inventory.service');
    detectMod = require('../../scripts/detectLotQuantityDrift');
    correctMod = require('../../scripts/correctLotQuantityDrift');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-d-${run}@test.local`, full_name: `ZZ D ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ D Rice ${run}` }).returning('*');
    const wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first()
      || (await db('warehouses').insert({ name: `ZZ D Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*'))[0];
    const [mill] = await db('mills').insert({ name: `ZZ D Mill ${run}`, status: 'Active' }).returning('*');
    Object.assign(ids, { user: u.id, product: p.id, wh: wh.id, mill: mill.id });

    await db.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${CHECK}`);
    // A3a: the old add-purchase split left available = committed while held.
    ids.lower = (await lot('lower', { qty: 1000, net_weight_kg: 1000, milling_reserved_qty: 600, available_qty: 1000 })).id;
    // A3b: availability lowered with no record of why.
    ids.raise = (await lot('raise', { qty: 1000, net_weight_kg: 1000, available_qty: 700 })).id;
    // A1: old Use in Batch — 400 kg "allocated" to an open batch, available only lowered.
    ids.uib = (await lot('uib', { qty: 1000, net_weight_kg: 1000, available_qty: 600 }));
    const [b] = await db('milling_batches').insert({
      batch_no: `MD${run}`, raw_qty_kg: 400, status: 'Queued', created_by: ids.user, mill_id: ids.mill, product_id: ids.product,
    }).returning('*');
    ids.batch = b.id;
    await db('milling_vehicle_arrivals').insert({ batch_id: b.id, vehicle_no: ids.uib.lot_no, weight_kg: 400, notes: `Allocated from purchase lot ${ids.uib.lot_no}` });
    // E: emptied lot still 'Available'.
    ids.empty = (await lot('empty', { qty: 0, net_weight_kg: 0, available_qty: 0 })).id;
    await db.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT ${CHECK} CHECK (${PRED}) NOT VALID`);
  });

  afterAll(async () => {
    if (!db) return;
    // Leave the CHECK as migration 371 does on a clean DB.
    const bad = await db.raw(`SELECT count(*)::int AS n FROM inventory_lots WHERE NOT (${PRED})`);
    if (bad.rows[0].n === 0) await db.raw(`ALTER TABLE inventory_lots VALIDATE CONSTRAINT ${CHECK}`);
    await db.destroy();
  });

  test('detect classifies the drift and reports the CHECK NOT VALID', async () => {
    const r = await detectMod.detect(db);
    expect(r.other).toEqual(expect.arrayContaining([ids.lower, ids.raise]));
    expect(r.useInBatch).toEqual(expect.arrayContaining([{ id: ids.uib.id, batchIds: [ids.batch] }]));
    expect(r.toDepleted).toContain(ids.empty);
    expect(r.constraints[CHECK]).toBe('NOT VALID');
    const lines = [];
    detectMod.report(r, (s) => lines.push(s));
    expect(lines.join('\n')).not.toMatch(/ZZ D/); // ids only, no names
  });

  test('a dry run writes nothing', async () => {
    const before = await db('inventory_lots').whereIn('id', [ids.lower, ids.raise, ids.uib.id]).orderBy('id').select('id', 'available_qty');
    await correctMod.correct(db, { write: false, convertUseInBatch: true, raiseAvailable: true, log: quiet });
    const after = await db('inventory_lots').whereIn('id', [ids.lower, ids.raise, ids.uib.id]).orderBy('id').select('id', 'available_qty');
    expect(after).toEqual(before);
  });

  test('the default write lowers what is safe and leaves the rest for review', async () => {
    const r = await correctMod.correct(db, { write: true, log: quiet });
    expect(n((await db('inventory_lots').where({ id: ids.lower }).first()).available_qty)).toBe(400);
    expect(n((await db('inventory_lots').where({ id: ids.raise }).first()).available_qty)).toBe(700);
    expect(n((await db('inventory_lots').where({ id: ids.uib.id }).first()).available_qty)).toBe(600);
    expect((await db('inventory_lots').where({ id: ids.empty }).first()).status).toBe('Depleted');
    expect(r.validated).not.toContain(CHECK);
    const logs = await db('audit_logs').where({ action: 'lot_quantity_restated', entity_id: String(ids.lower) });
    expect(logs).toHaveLength(1);
  });

  test('the opt-ins convert Use in Batch into a commitment, raise A3b, and validate the CHECK', async () => {
    const r = await correctMod.correct(db, { write: true, convertUseInBatch: true, raiseAvailable: true, log: quiet });
    const uib = await db('inventory_lots').where({ id: ids.uib.id }).first();
    expect([n(uib.qty), n(uib.milling_reserved_qty), n(uib.available_qty), uib.milling_status]).toEqual([1000, 400, 600, 'In Milling']);
    const src = await db('batch_source_lots').where({ batch_id: ids.batch, lot_id: ids.uib.id }).first();
    expect(n(src.qty_kg)).toBe(400);
    const hold = await db('lot_transactions').where({ lot_id: ids.uib.id, transaction_type: 'milling_hold' }).first();
    expect(n(hold.reservation_effect)).toBe(400);
    expect(n((await db('inventory_lots').where({ id: ids.raise }).first()).available_qty)).toBe(1000);
    expect(r.validated).toContain(CHECK);
    const after = await detectMod.detect(db);
    expect(after.other).not.toEqual(expect.arrayContaining([ids.lower]));
    expect(after.constraints[CHECK]).toBe('VALID');
    // The converted lot now mills like any committed lot: the hold is released at yield.
    await db.transaction((trx) => inventory.consumeForMilling(trx, { batchId: ids.batch, userId: ids.user }));
    const consumed = await db('inventory_lots').where({ id: ids.uib.id }).first();
    expect([n(consumed.qty), n(consumed.milling_reserved_qty), n(consumed.available_qty)]).toEqual([600, 0, 600]);
  });
});
