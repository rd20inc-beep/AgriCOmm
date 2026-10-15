/**
 * P3-18 — export draft side effects and packaging purchase requirements, end to
 * end on a real, fully migrated Postgres:
 *
 *   EXP-17  printed bags + pallet cost typed on the create form:
 *           - a Draft holds them (draft_side_costs) — no payable, no journal;
 *             abandoning (cancelling) it leaves nothing behind;
 *           - Submit posts them in its own transaction;
 *           - a live order posts them in create()'s transaction — a bag order
 *             that cannot be saved saves no order either (one server call);
 *           - a Draft refuses a cost bill / printed-bag order directly.
 *   EXP-40  the order's material requests follow its quantity: pending ones
 *           shrink / are cancelled, an approved one is flagged (never changed),
 *           growth past an approved one is a pending top-up, and cancelling the
 *           order cancels them all (Finance told about the approved one).
 *   MIL-48  every packing-run shortage raises a request — a local batch too.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

d('P3-18 export draft side costs + purchase requirement sync (DB-gated)', () => {
  let db; let app; let request; let ownerTok; let ownerId; let packing; let prService;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    packing = require('../modules/millStore/packing.service');
    prService = require('../modules/purchaseRequirements/purchaseRequirements.service');
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Owner' }).first();
    const [u] = await db('users').insert({
      email: `zz-p318-${run}@test.local`, full_name: `ZZ P318 ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ownerId = u.id;
    ownerTok = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    // Someone for the masked Finance notifications to reach.
    const fm = await db('roles').where({ name: 'Finance Manager' }).first();
    await db('users').insert({
      email: `zz-p318-fm-${run}@test.local`, full_name: `ZZ P318 FM ${run}`, password_hash: 'x', role_id: fm.id, is_active: true, status: 'active',
    });
    const [bank] = await db('bank_accounts').insert({
      name: `ZZ P318 USD ${run}`, type: 'bank', is_active: true, currency: 'USD', entity: 'export', current_balance: 0,
    }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ P318 Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ P318 Kernel ${run}` }).returning('*');
    const [v] = await db('suppliers').insert({ name: `ZZ P318 Bag Vendor ${run}`, is_active: true }).returning('*');
    Object.assign(ids, { bank: bank.id, cust: c.id, product: p.id, vendor: v.id });
    const period = await db('accounting_periods').where('period_start', '<=', today).andWhere('period_end', '>=', today).first();
    if (!period) {
      await db('accounting_periods').insert({
        name: `ZZ P318 ${run}`, period_start: today, period_end: today, fiscal_year: Number(today.slice(0, 4)), status: 'Open',
      });
    }
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const auth = () => ({ Authorization: `Bearer ${ownerTok}` });
  // A 37 kg bag: no store item has that capacity, so the whole need is short.
  const body = (status, extra = {}) => ({
    customer_id: ids.cust, product_id: ids.product, qty_mt: 10, price_per_mt: 500, contract_value: 5000,
    currency: 'USD', booked_fx_rate: 280, incoterm: 'FOB', bank_account_id: ids.bank, advance_pct: 0,
    packing_type: 'retail', receiving_mode: 'bags', bag_size_kg: 37, status,
    items: [{ product_id: ids.product, qty_mt: 10, price_per_mt: 500, bag_size_kg: 37 }],
    ...extra,
  });
  const sides = {
    palletized: true,
    pallet_cost: 15000,
    printed_bags: [{ vendor_id: null, quantity: 2000, unit_cost: 60, printing: 'Buyer Logo', bag_type_name: 'PP' }],
  };
  const create = (b) => request(app).post('/api/export-orders').set(auth()).send(b);
  const payablesFor = async (orderId) => {
    const pbo = await db('printed_bag_orders').where({ order_id: orderId }).pluck('id');
    const eoc = await db('export_order_costs').where({ order_id: orderId }).pluck('id');
    return db('payables').where((q) => {
      q.where((w) => w.where('source_table', 'printed_bag_orders').whereIn('source_id', pbo.length ? pbo : [0]))
        .orWhere((w) => w.where('source_table', 'export_order_costs').whereIn('source_id', eoc.length ? eoc : [0]));
    });
  };
  const journalsFor = (orderNo) => db('journal_entries').where('ref_no', 'like', `${orderNo} %`)
    .whereIn('ref_type', ['Printed Bags', 'Export Order Cost']);

  test('a Draft holds its printed bags + pallet cost: no payable, no journal', async () => {
    const res = await create(body('Draft', sides));
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.draft_side_costs).toMatchObject({ pallet_cost: 15000, printed_bags: [{ quantity: 2000, unit_cost: 60 }] });
    expect(await db('printed_bag_orders').where({ order_id: order.id })).toHaveLength(0);
    expect(await db('export_order_costs').where({ order_id: order.id })).toHaveLength(0);
    expect(await payablesFor(order.id)).toHaveLength(0);
    expect(await journalsFor(order.order_no)).toHaveLength(0);
    ids.draft = order;
  });

  test('a Draft refuses a cost bill and a printed-bag order sent directly (409)', async () => {
    const cost = await request(app).post(`/api/export-orders/${ids.draft.id}/costs`).set(auth())
      .send({ category: 'freight', amount: 100 });
    expect(cost.status).toBe(409);
    const bag = await request(app).post('/api/printed-bag-orders').set(auth())
      .send({ order_id: ids.draft.id, quantity: 10, unit_cost: 5 });
    expect(bag.status).toBe(409);
    expect(await payablesFor(ids.draft.id)).toHaveLength(0);
  });

  test('Submit posts the held side costs in its own transaction', async () => {
    const res = await request(app).post(`/api/export-orders/${ids.draft.id}/submit`).set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.printedBagOrders).toHaveLength(1);
    expect(res.body.data.palletCostId).toBeTruthy();
    const row = await db('export_orders').where({ id: ids.draft.id }).first();
    expect(row.draft_side_costs).toBeNull();
    const pays = await payablesFor(ids.draft.id);
    expect(pays.map((p) => Number(p.original_amount)).sort((a, b) => a - b)).toEqual([15000, 120000]);
    const js = await journalsFor(ids.draft.order_no);
    expect(js.filter((j) => j.status === 'Posted')).toHaveLength(2);
  });

  test('abandoning a Draft (cancel) leaves no payable or journal behind', async () => {
    const res = await create(body('Draft', sides));
    const order = res.body.data.order;
    const cxl = await request(app).post(`/api/export-orders/${order.id}/cancel`).set(auth()).send({ reason: 'abandoned draft' });
    expect(cxl.status).toBe(200);
    const row = await db('export_orders').where({ id: order.id }).first();
    expect(row.status).toBe('Cancelled');
    expect(row.draft_side_costs).toBeNull();
    expect(await payablesFor(order.id)).toHaveLength(0);
    expect(await journalsFor(order.order_no)).toHaveLength(0);
  });

  test('a live order posts its side costs with it — one call', async () => {
    const res = await create(body('Awaiting Advance', sides));
    expect(res.status).toBe(201);
    expect(res.body.data.printedBagOrders).toHaveLength(1);
    expect(res.body.data.palletCostId).toBeTruthy();
    expect(await payablesFor(res.body.data.order.id)).toHaveLength(2);
  });

  test('a side record that cannot be saved saves no order (atomic)', async () => {
    const before = Number((await db('export_orders').count('id as n').first()).n);
    const bad = { ...sides, printed_bags: [{ vendor_id: 999999999, quantity: 10, unit_cost: 5 }] };
    const res = await create(body('Awaiting Advance', bad));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(Number((await db('export_orders').count('id as n').first()).n)).toBe(before);
  });

  test('a pallet cost without a palletized load is refused', async () => {
    const res = await create(body('Draft', { pallet_cost: 100 }));
    expect(res.status).toBe(400);
  });

  describe('material requests follow the order (EXP-40)', () => {
    let order;
    const prs = () => db('purchase_requirements').where({ linked_ref: order.order_no }).orderBy('id');
    const setQty = (q) => request(app).put(`/api/export-orders/${order.id}`).set(auth())
      .send({ qty_mt: q, price_per_mt: 500 });

    test('raised at create, shrunk with the order', async () => {
      const res = await create(body('Awaiting Advance'));
      order = res.body.data.order;
      let rows = await prs();
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].shortage_qty)).toBe(Math.ceil(10000 / 37));
      expect((await setQty(5)).status).toBe(200);
      rows = await prs();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(Number(rows[0].shortage_qty)).toBe(Math.ceil(5000 / 37));
    });

    test('an approved request is flagged, never changed; growth past it is a pending top-up', async () => {
      const [pr] = await prs();
      expect((await request(app).post(`/api/purchase-requirements/${pr.id}/approve`).set(auth()).send({})).status).toBe(200);
      expect((await setQty(2)).status).toBe(200);
      let rows = await prs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'approved', review_required: true });
      expect(Number(rows[0].shortage_qty)).toBe(Math.ceil(5000 / 37));
      expect(await db('notifications').where({ title: 'Purchase request on hold' }).where('message', 'like', `${pr.pr_no}%`)).not.toHaveLength(0);

      expect((await setQty(8)).status).toBe(200);
      rows = await prs();
      expect(rows).toHaveLength(2);
      expect(rows[1].status).toBe('pending');
      expect(Number(rows[1].shortage_qty)).toBe(Math.ceil(8000 / 37) - Math.ceil(5000 / 37));
      expect(Number(rows[0].shortage_qty)).toBe(Math.ceil(5000 / 37));
    });

    test('cancelling the order cancels its pending and approved requests', async () => {
      const res = await request(app).post(`/api/export-orders/${order.id}/cancel`).set(auth()).send({ reason: 'buyer withdrew' });
      expect(res.status).toBe(200);
      expect(res.body.data.cancelledRequirements).toBe(2);
      const rows = await prs();
      expect(rows.every((r) => r.status === 'cancelled' && r.cancelled_at)).toBe(true);
      expect(await db('notifications').where({ title: 'Purchase request cancelled' }).where('message', 'like', `${rows[0].pr_no}%`)).not.toHaveLength(0);
    });

    test('a pending request whose need disappears is cancelled', async () => {
      const res = await create(body('Awaiting Advance'));
      const o = res.body.data.order;
      const before = await db('purchase_requirements').where({ linked_ref: o.order_no });
      expect(before).toHaveLength(1);
      // Bulk container: no bags at all.
      const upd = await request(app).put(`/api/export-orders/${o.id}`).set(auth()).send({ packing_type: 'container' });
      expect(upd.status).toBe(200);
      const after = await db('purchase_requirements').where({ id: before[0].id }).first();
      expect(after.status).toBe('cancelled');
    });

    test('a person can cancel an open request with a reason', async () => {
      const res = await create(body('Awaiting Advance'));
      const [pr] = await db('purchase_requirements').where({ linked_ref: res.body.data.order.order_no });
      expect((await request(app).post(`/api/purchase-requirements/${pr.id}/cancel`).set(auth()).send({})).status).toBe(400);
      const ok = await request(app).post(`/api/purchase-requirements/${pr.id}/cancel`).set(auth()).send({ reason: 'bought locally' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.requirement.status).toBe('cancelled');
      // An approve racing it finds it changed.
      expect((await request(app).post(`/api/purchase-requirements/${pr.id}/approve`).set(auth()).send({})).status).toBe(409);
    });
  });

  test('raise() never changes an approved request; a larger shortage is a pending top-up', async () => {
    const ref = `ZZ-P318-RAISE-${run}`;
    const first = await prService.raise(db, { itemName: `ZZ item ${run}`, shortageQty: 10, linkedRef: ref });
    await db('purchase_requirements').where({ id: first.id }).update({ status: 'approved' });
    await prService.raise(db, { itemName: `ZZ item ${run}`, shortageQty: 8, linkedRef: ref });
    expect(await db('purchase_requirements').where({ linked_ref: ref })).toHaveLength(1);
    await prService.raise(db, { itemName: `ZZ item ${run}`, shortageQty: 14, linkedRef: ref });
    const rows = await db('purchase_requirements').where({ linked_ref: ref }).orderBy('id');
    expect(rows.map((r) => [r.status, Number(r.shortage_qty)])).toEqual([['approved', 10], ['pending', 4]]);
  });

  test('correction scripts: detect legacy draft bag bills + open PRs on cancelled orders, fix by delta', async () => {
    const detectMod = require('../../scripts/detectExportDraftSideCosts');
    const correctMod = require('../../scripts/correctExportDraftSideCosts');
    const printedBags = require('../modules/exportOrders/printedBags.service');
    // Legacy state: a Draft that got a bag bill the old way; a cancelled order with an open PR.
    const draft = (await create(body('Draft'))).body.data.order;
    const pbo = await db.transaction((trx) => printedBags.createInTrx(trx, draft, { quantity: 100, unit_cost: 7 }, ownerId));
    const cxl = (await create(body('Draft'))).body.data.order;
    await db('export_orders').where({ id: cxl.id }).update({ status: 'Cancelled' });
    const pr = await prService.raise(db, { itemName: `ZZ legacy ${run}`, shortageQty: 5, linkedRef: cxl.order_no });

    const s = detectMod.summarize(await detectMod.detect(db, { orderIds: [draft.id, cxl.id] }));
    expect(s.draftBagsUnpaid.map((f) => f.recordId)).toEqual([pbo.id]);
    expect(s.openPrsCancelled.map((f) => f.recordId)).toEqual([pr.id]);

    const net = async () => {
      const r = await db('journal_entries as je').join('journal_lines as jl', 'jl.journal_id', 'je.id')
        .where({ 'je.ref_no': `${draft.order_no} ${pbo.pbo_no}`, 'je.status': 'Posted' })
        .select(db.raw('COALESCE(SUM(jl.debit), 0) AS dr, COALESCE(SUM(jl.credit), 0) AS cr, COUNT(*) AS n')).first();
      return r;
    };
    expect(Number((await net()).n)).toBe(2);
    expect((await db.transaction((trx) => correctMod.voidDraftBag(trx, pbo.id))).corrected).toBe(true);
    expect((await db.transaction((trx) => correctMod.cancelOpenPr(trx, pr.id))).corrected).toBe(true);

    // Signed delta: original + reversing journal, both Posted, nothing deleted.
    const after = await net();
    expect(Number(after.n)).toBe(4);
    expect(Number(after.dr)).toBeCloseTo(Number(after.cr), 2);
    const pay = await db('payables').where({ source_table: 'printed_bag_orders', source_id: pbo.id }).first();
    expect(pay).toMatchObject({ status: 'Reversed' });
    expect(Number(pay.outstanding)).toBe(0);
    expect((await db('printed_bag_orders').where({ id: pbo.id }).first()).status).toBe('Cancelled');
    const held = (await db('export_orders').where({ id: draft.id }).first()).draft_side_costs;
    expect(held.printed_bags).toHaveLength(1);
    expect((await db('purchase_requirements').where({ id: pr.id }).first()).status).toBe('cancelled');
    // Idempotent.
    const again = detectMod.summarize(await detectMod.detect(db, { orderIds: [draft.id, cxl.id] }));
    expect(again.draftBagsUnpaid).toHaveLength(0);
    expect(again.openPrsCancelled).toHaveLength(0);
  });

  test('MIL-48: a packing-run shortage on a LOCAL batch raises a purchase request', async () => {
    let mill = await db('mills').first('id');
    if (!mill) [mill] = await db('mills').insert({ name: `ZZ P318 Mill ${run}` }).returning('id');
    const [batch] = await db('milling_batches').insert({
      batch_no: `ZZ-P318-B-${run}`, created_by: ownerId, mill_id: mill.id || mill, status: 'In Progress',
    }).returning('*');
    const [bag] = await db('mill_items').insert({
      code: `ZZ-P318-BAG-${run}`, name: `ZZ P318 Bag ${run}`, category: 'packaging', unit: 'pcs',
      avg_cost_per_unit: 10, capacity_kg: 25, tare_weight_kg: 0.1,
    }).returning('*');
    await db('mill_stock').insert({ item_id: bag.id, warehouse_id: null, quantity_available: 3, quantity_reserved: 0 });
    const log = await packing.pack(batch.id, { bag_item_id: bag.id, bags_count: 10 }, ownerId);
    expect(log.shortages).toHaveLength(1);
    expect(log.purchase_requirements).toHaveLength(1);
    const pr = await db('purchase_requirements').where({ pr_no: log.purchase_requirements[0] }).first();
    expect(pr).toMatchObject({ item_id: bag.id, status: 'pending', linked_ref: `${batch.batch_no} / run #${log.id}` });
    expect(Number(pr.shortage_qty)).toBe(7);
    expect(Number(pr.est_amount)).toBe(70);
    // A second short run is its own need, not swallowed by the first.
    const log2 = await packing.pack(batch.id, { bag_item_id: bag.id, bags_count: 5 }, ownerId);
    expect(log2.purchase_requirements).toHaveLength(1);
    expect(log2.purchase_requirements[0]).not.toBe(log.purchase_requirements[0]);
  });
});
