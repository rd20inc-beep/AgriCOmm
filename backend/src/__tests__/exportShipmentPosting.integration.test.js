/**
 * P2-03 — a shipment and its journals are one event, end to end on a real,
 * fully migrated Postgres: with the export_shipment (COGS) posting rule
 * missing, marking the order Shipped fails with a business message and NOTHING
 * changes — status, status history, reservations, lot stock, journals. With the
 * rule back, the same transition ships and posts once. The health report lists
 * shipped orders whose revenue never posted.
 *
 * DB-gated: skipped unless DB_HOST is set (see exportShipmentCogs.integration).
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('export shipment posting is atomic (DB-gated)', () => {
  let db; let inventory; let workflow; let health;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const ORDER_NO = `ZZ-SHP-${run}`;

  beforeAll(async () => {
    db = require('../config/database');
    inventory = require('../modules/inventory/inventory.service');
    workflow = require('../modules/exportOrders/exportOrders.workflow');
    health = require('../modules/exportOrders/shipmentPostingHealth');

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-shp-${run}@test.local`, full_name: `ZZ SHP ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [w] = await db('warehouses').insert({ name: `ZZ SHP WH ${run}`, type: 'finished' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ SHP Kernel ${run}` }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ SHP Buyer ${run}` }).returning('*');
    const [lot] = await db('inventory_lots').insert({
      lot_no: `ZZ-SHP-L-${run}`, item_name: 'Super Kernel', type: 'finished', entity: 'export',
      warehouse_id: w.id, product_id: p.id, qty: 10000, available_qty: 10000, unit: 'kg', export_ready: true,
      landed_cost_per_kg: 100, cost_per_unit: 100,
    }).returning('*');
    const [o] = await db('export_orders').insert({
      order_no: ORDER_NO, customer_id: c.id, product_id: p.id, created_by: u.id,
      status: 'Ready to Ship', qty_mt: 5, contract_value: 4000, currency: 'USD',
      booked_fx_rate: 280, contract_value_pkr_locked: 1120000,
    }).returning('*');
    Object.assign(ids, { user: u.id, lot: lot.id, order: o.id });
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 5000, userId: u.id }));
  });

  afterAll(async () => {
    if (!db) return;
    await db('posting_rules').where({ trigger_event: 'export_shipment' }).update({ is_active: true });
    await db.destroy();
  });

  const ship = () => db.transaction(async (trx) => {
    const order = await trx('export_orders').where({ id: ids.order }).first();
    return workflow.transitionOrder(trx, { order, toStatus: 'Shipped', userId: ids.user, skipValidation: true });
  });
  const journals = () => db('journal_entries').where({ ref_no: ORDER_NO, status: 'Posted' });

  test('missing COGS rule → no ship: status, history, stock, reservations and journals unchanged', async () => {
    await db('posting_rules').where({ trigger_event: 'export_shipment' }).update({ is_active: false });
    const err = await ship().then(() => null, (e) => e);
    await db('posting_rules').where({ trigger_event: 'export_shipment' }).update({ is_active: true });

    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(new RegExp(`Cannot ship ${ORDER_NO}: its revenue and cost-of-sales journals could not be posted`));
    expect(err.message).toMatch(/export_shipment/);

    const o = await db('export_orders').where({ id: ids.order }).first();
    expect(o.status).toBe('Ready to Ship');
    expect(o.revenue_posted).toBe(false);
    expect(o.cost_locked_at_dispatch).not.toBe(true);
    expect(await db('export_order_status_history').where({ order_id: ids.order, to_status: 'Shipped' })).toHaveLength(0);
    const res = await db('inventory_reservations').where({ order_id: ids.order });
    expect(res.map((r) => r.status)).toEqual(['Active']);
    expect(Number((await db('inventory_lots').where({ id: ids.lot }).first()).qty)).toBe(10000);
    expect(await journals()).toHaveLength(0); // the revenue journal posted first was rolled back too
  });

  test('the health report does not list an order that never shipped', async () => {
    const { orders } = await health.findShippedWithoutRevenue(db);
    expect(orders.some((r) => r.id === ids.order)).toBe(false);
  });

  test('with the rule back the same transition ships and posts revenue + COGS once', async () => {
    await ship();
    const o = await db('export_orders').where({ id: ids.order }).first();
    expect(o.status).toBe('Shipped');
    expect(o.revenue_posted).toBe(true);
    expect(Number(o.inventory_cogs_total_pkr)).toBe(500000);
    const js = await journals();
    expect(js.length).toBeGreaterThanOrEqual(2);

    await ship(); // re-driven: idempotent
    expect((await journals()).length).toBe(js.length);
  });

  test('the health report lists a shipped order whose revenue never posted (ids + flags only)', async () => {
    // Simulate a legacy row: shipped before P2-03 with the flag still false.
    await db('export_orders').where({ id: ids.order }).update({ revenue_posted: false });
    const { total, orders } = await health.findShippedWithoutRevenue(db);
    const row = orders.find((r) => r.id === ids.order);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(row).toEqual({
      id: ids.order, order_no: ORDER_NO, status: 'Shipped', currency: 'USD',
      hasBookedRate: true, hasLockedCogs: true, postedRevenueJournals: 1,
    });
    await db('export_orders').where({ id: ids.order }).update({ revenue_posted: true });
  });
});
