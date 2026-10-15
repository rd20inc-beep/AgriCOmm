/**
 * P3-09 cut-over scripts: detectMillingWipBacklog (read-only) finds batches in
 * flight before D-6 — committed rice still in 1210, truck lots never bought —
 * and correctMillingWip books them once (dry-run by default, idempotent).
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('Milling WIP cut-over scripts (DB-gated)', () => {
  let db; let detectMod; let correctMod; let wip;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const glNet = async (refNo, code) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };

  beforeAll(async () => {
    db = require('../config/database');
    detectMod = require('../../scripts/detectMillingWipBacklog');
    correctMod = require('../../scripts/correctMillingWip');
    wip = require('../modules/milling/millingWip');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-wc-${run}@test.local`, full_name: `ZZ WC ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ WC Mill ${run}` }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ WC Supplier ${run}`, type: 'local' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ WC Rice ${run}` }).returning('*');
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ WC Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const lot = (n, o) => ({
      lot_no: `ZZWC-${run}-${n}`, item_name: 'ZZ Rice', type: 'raw', entity: 'mill', warehouse_id: wh.id,
      product_id: p.id, unit: 'KG', supplier_id: sup.id, status: 'Available', ...o,
    });
    // Pre-D-6 state, written straight to the tables (no GL), as on production:
    // a truck batch with its received lot, and a lot-fed batch with a committed source.
    const [truckB] = await db('milling_batches').insert({ batch_no: `MWC${run}-1`, supplier_id: sup.id, product_id: p.id, raw_qty_kg: 5000, status: 'In Progress', created_by: u.id, mill_id: mill.id }).returning('*');
    const [truckLot] = await db('inventory_lots').insert(lot('T', { batch_ref: `batch-${truckB.id}`, qty: 5000, available_qty: 5000, net_weight_kg: 5000, landed_cost_per_kg: 100 })).returning('*');
    const [srcLot] = await db('inventory_lots').insert(lot('S', { qty: 8000, available_qty: 4000, milling_reserved_qty: 4000, net_weight_kg: 8000, landed_cost_per_kg: 90, milling_status: 'In Milling' })).returning('*');
    const [srcB] = await db('milling_batches').insert({ batch_no: `MWC${run}-2`, supplier_id: sup.id, product_id: p.id, raw_qty_kg: 4000, status: 'Queued', created_by: u.id, mill_id: mill.id }).returning('*');
    await db('batch_source_lots').insert({ batch_id: srcB.id, lot_id: srcLot.id, qty_kg: 4000, lot_type: 'raw' });
    Object.assign(ids, { truckB, truckLot, srcB });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const mine = async () => (await detectMod.detect(db)).filter((f) => [ids.truckB.id, ids.srcB.id].includes(f.batchId));

  test('detection lists both batches and the truck lot (IDs only), and writes nothing', async () => {
    const before = await db('journal_entries').count('id as c').first();
    const f = await mine();
    expect(f).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'truck_not_bought', batchId: ids.truckB.id, lotId: ids.truckLot.id, value: 500000 }),
      expect.objectContaining({ kind: 'wip_not_booked', batchId: ids.truckB.id, gap: 500000 }),
      expect.objectContaining({ kind: 'wip_not_booked', batchId: ids.srcB.id, gap: 360000 }),
    ]));
    expect((await db('journal_entries').count('id as c').first()).c).toBe(before.c);
  });

  test('correction is dry-run unless FIX_MILLING_WIP=1', async () => {
    const src = require('fs').readFileSync(require.resolve('../../scripts/correctMillingWip'), 'utf8');
    expect(src).toMatch(/env\.FIX_MILLING_WIP === '1'/);
  });

  test('correction books the truck purchase + the WIP reclass once; a second run is a no-op', async () => {
    const r1 = await db.transaction((trx) => correctMod.correctOne(trx, ids.truckB.id));
    expect(r1).toMatchObject({ corrected: true, purchase: true, wip: true });
    expect(await glNet(ids.truckLot.lot_no, '2010')).toBe(-500000);
    expect(await wip.wipBalance(db, ids.truckB.batch_no)).toBe(500000);
    const r2 = await db.transaction((trx) => correctMod.correctOne(trx, ids.srcB.id));
    expect(r2).toMatchObject({ corrected: true, purchase: false, wip: true });
    expect(await glNet(ids.srcB.batch_no, '1210')).toBe(-360000);
    expect(await wip.wipBalance(db, ids.srcB.batch_no)).toBe(360000);

    expect(await mine()).toEqual([]);
    expect(await db.transaction((trx) => correctMod.correctOne(trx, ids.srcB.id))).toEqual({ skipped: 'nothing_to_book' });
    const js = await db('journal_entries').whereIn('ref_no', [ids.truckB.batch_no, ids.srcB.batch_no, ids.truckLot.lot_no]).select('status');
    expect(js.every((j) => j.status === 'Posted')).toBe(true);
  });
});
