/**
 * P3-11 / INV-09 — void a purchase lot or a mill-store purchase (D-23),
 * against a real, migrated Postgres:
 *
 *   - Owner-approved; the purchase stays on record (voided_at, reason);
 *   - stock leaves by a 'purchase_void_out' lot transaction (lot qty 0);
 *   - every bill (rice, hauler freight, broker commission) → Reversed, figure
 *     kept; the lot's journals net to zero by signed deltas (no journal is
 *     marked Reversed); AP subledger (live bills) = 2010 for the lot = 0;
 *     the transport record is cancelled; TB stays balanced;
 *   - refused once anything was paid or drawn from it, or without the Owner;
 *   - a store purchase: stock, average cost, payable and GL come back out;
 *     refused once its bags were used.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

d('purchase void (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who))
    .set('Idempotency-Key', `pv-${Math.random()}`).send(body);
  const net = async (refNo, code) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };
  const trialBalance = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted').select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['owner', 'Owner'], ['mm', 'Mill Manager']]) {
      const [u] = await db('users').insert({
        email: `zz-pv-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const [sup] = await db('suppliers').insert({ name: `ZZ PV Sup ${run}`, is_active: true }).returning('*');
    const [broker] = await db('suppliers').insert({ name: `ZZ PV Broker ${run}`, is_active: true }).returning('*');
    const [hauler] = await db('haulers').insert({ name: `ZZ PV Hauler ${run}`, phone: `0333${run}` }).returning('*');
    const [wh] = await db('warehouses').insert({ name: `ZZ PVWH ${run}`, entity: 'mill', type: 'raw' }).returning('*');
    const product = await db('products').first('id');
    Object.assign(ids, { sup: sup.id, broker: broker.id, hauler: hauler.id, wh: wh.id, product: product.id });
  });

  afterAll(async () => { if (db) await db.destroy(); });

  const buyLot = async () => {
    const r = await post('owner', '/api/lot-inventory/lots/purchase', {
      item_name: 'ZZ Paddy', warehouse_id: ids.wh, product_id: ids.product,
      supplier_id: ids.sup, broker_id: ids.broker, commission_total: 5000,
      hauler_id: ids.hauler, transport_cost: 12000, transport_paid_by: 'company',
      quantity_input: 200, quantity_unit: 'katta', bag_weight_kg: 50, rate_input: 100, rate_unit: 'kg',
      labor_cost: 3000,
    });
    expect(r.status).toBeLessThan(300);
    return r.body.data.lot;
  };

  test('an untouched purchase lot voids: stock, every bill and the GL come back out; history kept', async () => {
    const tb0 = await trialBalance();
    const lot = await buyLot();
    expect(Number(lot.qty)).toBe(10000);
    expect(await net(lot.lot_no, '2010')).toBeLessThan(0);

    const noOwner = await post('mm', `/api/lot-inventory/lots/${lot.id}/void`, { reason: 'Duplicate entry' });
    expect(noOwner.status).toBe(403);
    expect((await post('owner', `/api/lot-inventory/lots/${lot.id}/void`, {})).status).toBe(400);

    const r = await post('owner', `/api/lot-inventory/lots/${lot.id}/void`, { reason: 'Duplicate entry' });
    expect(r.status).toBe(200);
    const l = await db('inventory_lots').where({ id: lot.id }).first();
    expect(l).toMatchObject({ status: 'Closed', void_reason: 'Duplicate entry', voided_by: ids.owner, void_authorized_by: ids.owner });
    expect(Number(l.qty)).toBe(0);
    expect(Number(l.available_qty)).toBe(0);
    const out = await db('lot_transactions').where({ lot_id: lot.id, transaction_type: 'purchase_void_out' }).first();
    expect(Number(out.quantity_kg)).toBe(-10000);

    const bills = await db('payables').where({ linked_ref: lot.lot_no });
    expect(bills.length).toBeGreaterThanOrEqual(4); // rice, labour, freight, commission
    bills.forEach((b) => { expect(b.status).toBe('Reversed'); expect(Number(b.outstanding)).toBe(0); });
    expect(bills.every((b) => Number(b.original_amount) > 0)).toBe(true);
    const liveAp = bills.filter((b) => b.status !== 'Reversed').reduce((s, b) => s + Number(b.outstanding), 0);
    expect(liveAp).toBe(0);
    expect(await net(lot.lot_no, '2010')).toBe(0);
    expect(await net(lot.lot_no, '1210')).toBe(0);
    expect(await db('journal_entries').where({ ref_no: lot.lot_no, status: 'Reversed' })).toHaveLength(0);
    const tc = await db('transport_costs').where({ lot_id: lot.id });
    tc.forEach((t) => expect(t.status).toBe('cancelled'));
    expect(await trialBalance()).toBe(tb0);

    expect((await post('owner', `/api/lot-inventory/lots/${lot.id}/void`, { reason: 'again' })).status).toBe(409);
    // Nothing can be paid on a voided purchase — not the lot, not a reversed bill.
    const payLot = await post('owner', '/api/finance/purchases/pay', { source: 'lot', source_id: lot.id, amount: 100, payment_method: 'cash' });
    expect(payLot.status).toBe(400);
    const { assertWithinOutstanding } = require('../modules/finance/paymentEngine');
    await expect(assertWithinOutstanding(db, { row: bills[0], isReceipt: false, amount: 1 })).rejects.toThrow(/reversed/);
  });

  test('refused once a bill is paid or rice has left the lot', async () => {
    const paidLot = await buyLot();
    const bill = await db('payables').where({ linked_ref: paidLot.lot_no, category: 'Raw Material' }).first();
    await db('payables').where({ id: bill.id }).update({ paid_amount: 1000, outstanding: Number(bill.original_amount) - 1000, status: 'Partial' });
    const r1 = await post('owner', `/api/lot-inventory/lots/${paidLot.id}/void`, { reason: 'Wrong supplier' });
    expect(r1.status).toBe(409);
    expect(r1.body.message).toMatch(/reverse the payment/);
    expect(Number((await db('inventory_lots').where({ id: paidLot.id }).first()).qty)).toBe(10000);

    const drawnLot = await buyLot();
    const inventoryService = require('../modules/inventory/inventory.service');
    await db.transaction((trx) => inventoryService.postMovement(trx, {
      movementType: 'adjustment_minus', lotId: drawnLot.id, qty: 50, notes: 'ZZ draw', costPerUnit: 0, userId: ids.owner,
    }));
    const r2 = await post('owner', `/api/lot-inventory/lots/${drawnLot.id}/void`, { reason: 'Wrong supplier' });
    expect(r2.status).toBe(409);
    expect(await db('payables').where({ linked_ref: drawnLot.lot_no, status: 'Reversed' })).toHaveLength(0);
  });

  test('D-25b: the PO / GRN chain is retired — creates answer 410, existing records stay readable', async () => {
    for (const url of ['/api/procurement/requisitions', '/api/procurement/purchase-orders', '/api/procurement/grns',
      '/api/procurement/invoices', '/api/procurement/returns']) {
      const r = await post('owner', url, { supplier_id: ids.sup });
      expect(r.status).toBe(410);
      expect(r.body.code).toBe('PROCUREMENT_RETIRED');
    }
    const list = await request(app).get('/api/procurement/purchase-orders').set(auth('owner'));
    expect(list.status).toBe(200);
  });

  describe('mill-store purchase', () => {
    let item;
    beforeAll(async () => {
      [item] = await db('mill_items').insert({
        code: `ZZPV-${run}`, name: `ZZ Bag ${run}`, category: 'packaging', unit: 'pcs', is_active: true, avg_cost_per_unit: 20,
      }).returning('*');
      await db('mill_stock').insert({ item_id: item.id, warehouse_id: null, quantity_available: 100, quantity_reserved: 0 });
    });
    const buy = async (qty, cost) => {
      const service = require('../modules/millStore/millStore.service');
      return service.createPurchase({
        supplier_id: ids.sup, purchase_date: new Date().toISOString().slice(0, 10),
        lines: [{ item_id: item.id, quantity: qty, cost_per_unit: cost }],
      }, ids.owner);
    };

    test('voids: stock and average cost unwound, payable Reversed, GL nets to zero', async () => {
      const tb0 = await trialBalance();
      const p = await buy(100, 30); // avg (100×20 + 100×30) / 200 = 25
      expect(Number((await db('mill_items').where({ id: item.id }).first()).avg_cost_per_unit)).toBe(25);
      const r = await post('owner', `/api/mill-store/purchases/${p.id}/void`, { reason: 'Invoice entered twice' });
      expect(r.status).toBe(200);
      expect(Number((await db('mill_stock').where({ item_id: item.id, warehouse_id: null }).first()).quantity_available)).toBe(100);
      expect(Number((await db('mill_items').where({ id: item.id }).first()).avg_cost_per_unit)).toBe(20);
      const pay = await db('payables').where({ source_table: 'mill_purchases', source_id: p.id }).first();
      expect(pay.status).toBe('Reversed');
      expect(await net(p.purchase_no, '1250')).toBe(0);
      expect(await net(p.purchase_no, '2010')).toBe(0);
      expect((await db('mill_purchases').where({ id: p.id }).first()).voided_at).toBeTruthy();
      expect(await trialBalance()).toBe(tb0);
    });

    test('refused once its bags were used', async () => {
      const p = await buy(50, 30);
      await db('mill_stock').where({ item_id: item.id, warehouse_id: null }).update({ quantity_available: 20 });
      const r = await post('owner', `/api/mill-store/purchases/${p.id}/void`, { reason: 'Mistake' });
      expect(r.status).toBe(409);
      expect((await db('payables').where({ source_table: 'mill_purchases', source_id: p.id }).first()).status).toBe('Pending');
    });
  });
});
