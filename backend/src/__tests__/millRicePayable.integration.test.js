/**
 * P2-06 / MIL-01 — a yield books the batch-level supplier payable
 * (MILL-RICE-<batch>, Dr 1210 / Cr 2010) only for rice NOT already on the
 * books: truck intake, never a re-mill of a finished lot, an opening-stock lot,
 * a purchase lot or a blend. Plus the detection / correction scripts for the
 * duplicates the old rule left behind.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('MILL-RICE payable only for rice not yet on the books (DB-gated)', () => {
  let db; let controller; let inventory; let detectMod; let correctMod; let rpp;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const glNet = async (refNo, code, refTypes = null) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code });
    if (refTypes) q = q.whereIn('je.ref_type', refTypes);
    const r = await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return r.n;
  };
  const millRice = (batchId) => db('payables').where({ source_table: 'milling_raw_rice', source_id: batchId }).first();

  let seq = 0;
  const makeLot = async (over) => {
    seq += 1;
    const [l] = await db('inventory_lots').insert({
      lot_no: `ZZMR-${run}-${seq}`, item_name: 'ZZ Rice', type: 'raw', entity: 'mill',
      warehouse_id: ids.whRaw, product_id: ids.product, qty: 10000, available_qty: 10000, unit: 'KG',
      supplier_id: ids.sup, landed_cost_per_kg: 100, rate_per_kg: 100, cost_per_unit: 100,
      purchase_amount: 1000000, landed_cost_total: 1000000, total_value: 1000000,
      net_weight_kg: 10000, status: 'Available',
      ...over,
    }).returning('*');
    return l;
  };
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `M${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product,
      raw_qty_kg: 10000, status: 'In Progress', created_by: ids.user, mill_id: ids.mill, ...over,
    }).returning('*');
    return b;
  };
  const commit = async (batchId, lotId, qty = 10000) => {
    const { commitLotToBatch } = require('../modules/milling/batchLifecycle');
    await db.transaction((trx) => commitLotToBatch(trx, { batchId, lotId, qtyKg: qty }));
  };
  const yieldOf = async (batchId) => {
    const res = mockRes();
    await controller.recordYield({
      params: { id: String(batchId) },
      body: { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 1500, wastage_kg: 500 },
      user: { id: ids.user },
    }, res);
    return res;
  };

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/milling/milling.controller');
    inventory = require('../modules/inventory/inventory.service');
    detectMod = require('../../scripts/detectMillRiceDuplicatePayables');
    correctMod = require('../../scripts/correctMillRiceDuplicatePayables');
    rpp = require('../modules/milling/rawPurchasePayable');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-mr-${run}@test.local`, full_name: `ZZ MR ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ MR Supplier ${run}`, type: 'local' }).returning('*');
    const [sup2] = await db('suppliers').insert({ name: `ZZ MR Supplier2 ${run}`, type: 'local' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ MR Rice ${run}` }).returning('*');
    let wh = await db('warehouses').where({ entity: 'mill', type: 'raw' }).first();
    if (!wh) [wh] = await db('warehouses').insert({ name: `ZZ MR Raw ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ MR Mill ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, sup: sup.id, sup2: sup2.id, product: p.id, whRaw: wh.id, mill: mill.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('truck intake (no source lots) books the raw purchase once', async () => {
    const b = await makeBatch({ raw_qty_kg: 0 });
    await db.transaction((trx) => inventory.receiveRice(trx, {
      batchId: b.id, weightKg: 10000, costPerKg: 100, currency: 'PKR', supplierId: ids.sup, productId: ids.product, userId: ids.user,
    }));
    await db('milling_batches').where({ id: b.id }).update({ raw_qty_kg: 10000 });
    await db('milling_costs').insert({ batch_id: b.id, category: 'raw_rice', amount: 1000000, currency: 'PKR' });
    const res = await yieldOf(b.id);
    expect(res.body && res.body.message).toBeUndefined();
    expect(res.statusCode).toBe(200);
    const p = await millRice(b.id);
    expect(p).toBeTruthy();
    expect(Number(p.original_amount)).toBe(1000000);
    expect(await glNet(b.batch_no, '2010', ['Rice Purchase'])).toBe(-1000000);
  });

  test('re-mill of ONE finished lot creates no supplier payable', async () => {
    const fin = await makeLot({ type: 'finished', batch_ref: 'batch-999999' });
    const b = await makeBatch();
    await commit(b.id, fin.id);
    const res = await yieldOf(b.id);
    expect(res.statusCode).toBe(200);
    expect(await millRice(b.id)).toBeUndefined();
    expect(await glNet(b.batch_no, '2010')).toBe(0);
  });

  test('milling an opening-stock raw lot creates no supplier payable', async () => {
    const open = await makeLot({});
    await db('lot_transactions').insert({
      transaction_no: `TXN-OPEN-ZZ${run}`, lot_id: open.id, transaction_type: 'opening_balance',
      reference_module: 'opening_balance', quantity_kg: 10000, created_by: ids.user, performed_by: ids.user,
    });
    const b = await makeBatch();
    await commit(b.id, open.id);
    const res = await yieldOf(b.id);
    expect(res.statusCode).toBe(200);
    expect(await millRice(b.id)).toBeUndefined();
    expect(await glNet(b.batch_no, '2010')).toBe(0);
  });

  test('a purchase lot (own payable) and a blend create no supplier payable', async () => {
    const pl = await makeLot({});
    await db('payables').insert({
      pay_no: `ZZMR-PAY-${run}`, payable_type: 'vendor', entity: 'mill', supplier_id: ids.sup,
      original_amount: 1000000, outstanding: 1000000, paid_amount: 0, currency: 'PKR', status: 'Pending',
      linked_ref: pl.lot_no, source_id: pl.id,
    });
    const b = await makeBatch();
    await commit(b.id, pl.id);
    expect((await yieldOf(b.id)).statusCode).toBe(200);
    expect(await millRice(b.id)).toBeUndefined();

    const f1 = await makeLot({ type: 'finished', qty: 5000, available_qty: 5000 });
    const f2 = await makeLot({ type: 'finished', qty: 5000, available_qty: 5000 });
    const blend = await makeBatch({ processing_type: 'blended' });
    await commit(blend.id, f1.id, 5000);
    await commit(blend.id, f2.id, 5000);
    expect((await yieldOf(blend.id)).statusCode).toBe(200);
    expect(await millRice(blend.id)).toBeUndefined();
    expect(await glNet(blend.batch_no, '2010')).toBe(0);
  });

  test('rule: an unbilled raw source lot is still bought; of another supplier it is refused', async () => {
    const unbilled = await makeLot({});
    const b = await makeBatch();
    await commit(b.id, unbilled.id);
    const r = await rpp.rawPurchaseToBook(db, b);
    expect(r.amount).toBe(1000000);

    const other = await makeLot({ supplier_id: ids.sup2 });
    const b2 = await makeBatch();
    await commit(b2.id, other.id);
    await expect(rpp.rawPurchaseToBook(db, b2)).rejects.toMatchObject({ status: 409 });
  });

  test('detection finds unpaid vs paid duplicates; correction voids the unpaid one with a signed delta, idempotently', async () => {
    // Recreate the pre-fix state: two re-mill batches with a MILL-RICE payable + Rice Purchase journal.
    const legacy = async (paid) => {
      const fin = await makeLot({ type: 'finished' });
      const b = await makeBatch({ status: 'Completed' });
      await commit(b.id, fin.id);
      await db('batch_source_lots').where({ batch_id: b.id }).update({ cost_total_pkr: 1000000 });
      const [p] = await db('payables').insert({
        pay_no: `MILL-RICE-${b.batch_no}`, payable_type: 'vendor', entity: 'mill', supplier_id: ids.sup,
        original_amount: 1000000, paid_amount: paid, outstanding: 1000000 - paid, currency: 'PKR',
        status: paid ? 'Partial' : 'Pending', source_table: 'milling_raw_rice', source_id: b.id, linked_ref: b.batch_no,
      }).returning('*');
      await db.transaction((trx) => rpp.postRicePurchaseDelta(trx, {
        batchNo: b.batch_no, supplierId: ids.sup, delta: 1000000, description: 'legacy', userId: ids.user,
      }));
      return { b, p };
    };
    const unpaid = await legacy(0);
    const paid = await legacy(250000);

    const found = await detectMod.detect(db);
    const mine = found.filter((f) => [unpaid.p.id, paid.p.id].includes(f.payableId));
    expect(mine.find((f) => f.payableId === unpaid.p.id)).toMatchObject({ kind: 'unpaid', excess: 1000000, glNet: 1000000 });
    expect(mine.find((f) => f.payableId === paid.p.id)).toMatchObject({ kind: 'paid' });

    const r = await db.transaction((trx) => correctMod.correctOne(trx, unpaid.p.id, { userId: ids.user }));
    expect(r).toMatchObject({ corrected: true, whole: true });
    const after = await db('payables').where({ id: unpaid.p.id }).first();
    expect(after).toMatchObject({ status: 'Reversed', pay_no: `MILL-RICE-${unpaid.b.batch_no}` });
    expect(Number(after.outstanding)).toBe(0);
    expect(await glNet(unpaid.b.batch_no, '2010')).toBe(0);
    expect(await glNet(unpaid.b.batch_no, '1210')).toBe(0);
    // Nothing reversed or deleted — the original journal stays Posted.
    const js = await db('journal_entries').where({ ref_no: unpaid.b.batch_no }).select('ref_type', 'status');
    expect(js.every((j) => j.status === 'Posted')).toBe(true);

    // Paid one refused; a second run is a no-op.
    expect(await db.transaction((trx) => correctMod.correctOne(trx, paid.p.id))).toEqual({ skipped: 'paid' });
    expect(await db.transaction((trx) => correctMod.correctOne(trx, unpaid.p.id))).toEqual({ skipped: 'no_longer_duplicate' });
    expect(Number((await db('payables').where({ id: paid.p.id }).first()).paid_amount)).toBe(250000);
  });

  test('correction script is dry-run unless FIX_MILL_RICE_DUPLICATES=1', () => {
    const src = require('fs').readFileSync(require.resolve('../../scripts/correctMillRiceDuplicatePayables'), 'utf8');
    expect(src).toMatch(/env\.FIX_MILL_RICE_DUPLICATES === '1'/);
  });
});
