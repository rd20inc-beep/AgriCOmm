/**
 * Export COGS at shipment, end to end against a real, fully-migrated Postgres —
 * real reserveStock, real Shipped transition (release → dispatchForShipment →
 * postMovement → lockOrderCOGS) and real posting rules (export_shipment =
 * Dr 5020 / Cr 1230). The DB-less version is exportShipmentCogs.test.js.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_fix -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55440:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55440 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest exportShipmentCogs.integration
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('export COGS at shipment (DB-gated)', () => {
  let db; let inventory; let workflow;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  beforeAll(async () => {
    db = require('../config/database');
    inventory = require('../modules/inventory/inventory.service');
    workflow = require('../modules/exportOrders/exportOrders.workflow');

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-cogs-${run}@test.local`, full_name: `ZZ COGS ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [w] = await db('warehouses').insert({ name: `ZZ WH ${run}`, type: 'finished' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ Super Kernel ${run}` }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ Buyer ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, wh: w.id, product: p.id, customer: c.id });

    const lot = async (suffix, qty, cost) => (await db('inventory_lots').insert({
      lot_no: `ZZ-${suffix}-${run}`, item_name: 'Super Kernel', type: 'finished', entity: 'export',
      warehouse_id: w.id, product_id: p.id, qty, available_qty: qty, unit: 'kg', export_ready: true,
      ...cost,
    }).returning('*'))[0];
    // Lot A priced by landed cost; lot B only by cost_per_unit (per KG) — both
    // pass allocate-stock's cost guard, so both must be costed at shipment.
    ids.lotA = (await lot('A', 20000, { landed_cost_per_kg: 120, cost_per_unit: 120 })).id;
    ids.lotB = (await lot('B', 5000, { cost_per_unit: 150 })).id;

    const [o] = await db('export_orders').insert({
      order_no: `ZZ-EX-${run}`, customer_id: c.id, product_id: p.id, created_by: u.id,
      status: 'Ready to Ship', qty_mt: 15, contract_value: 50000, currency: 'USD',
      booked_fx_rate: 280, contract_value_pkr_locked: 14000000,
    }).returning('*');
    ids.order = o.id;

    await db.transaction(async (trx) => {
      await inventory.reserveStock(trx, { lotId: ids.lotA, orderId: o.id, qtyKg: 10000, userId: u.id });
      await inventory.reserveStock(trx, { lotId: ids.lotB, orderId: o.id, qtyKg: 5000, userId: u.id });
    });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const EXPECTED = 10000 * 120 + 5000 * 150; // 1,950,000
  const ship = async () => db.transaction(async (trx) => {
    const order = await trx('export_orders').where({ id: ids.order }).first();
    return workflow.transitionOrder(trx, { order, toStatus: 'Shipped', userId: ids.user, skipValidation: true });
  });
  const cogsLines = async () => db('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': `ZZ-EX-${run}`, 'je.status': 'Posted' })
    .whereIn('c.code', ['5020', '1230'])
    .select('je.id', 'c.code', 'jl.debit', 'jl.credit');

  test('Shipped locks COGS = Σ dispatched kg × cost/kg and posts Dr 5020 / Cr 1230 for it', async () => {
    await ship();

    const o = await db('export_orders').where({ id: ids.order }).first();
    expect(o.status).toBe('Shipped');
    expect(Number(o.inventory_cogs_total_pkr)).toBe(EXPECTED);
    expect(Number(o.inventory_cogs_per_mt_pkr)).toBe(130000);
    expect(o.cost_locked_at_dispatch).toBe(true);
    expect(o.revenue_posted).toBe(true);

    const res = await db('inventory_reservations').where({ order_id: ids.order });
    expect(res.every((r) => r.status === 'Consumed')).toBe(true);
    expect(Number((await db('inventory_lots').where({ id: ids.lotA }).first()).qty)).toBe(10000);
    expect(Number((await db('inventory_lots').where({ id: ids.lotB }).first()).qty)).toBe(0);

    const lines = await cogsLines();
    expect(new Set(lines.map((l) => l.id)).size).toBe(1);
    expect(lines.map((l) => [l.code, Number(l.debit), Number(l.credit)]).sort())
      .toEqual([['1230', 0, EXPECTED], ['5020', EXPECTED, 0]]);
  });

  test('re-running the transition does not re-dispatch, re-cost or re-post', async () => {
    await db('inventory_lots').where({ id: ids.lotA }).update({ landed_cost_per_kg: 500 });
    await ship();

    const o = await db('export_orders').where({ id: ids.order }).first();
    expect(Number(o.inventory_cogs_total_pkr)).toBe(EXPECTED);
    expect(Number((await db('inventory_lots').where({ id: ids.lotA }).first()).qty)).toBe(10000);
    const lines = await cogsLines();
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.id)).size).toBe(1);
  });
});
