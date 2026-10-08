/**
 * Profit definitions (owner decisions G-2 / G-3) against a real, fully-migrated
 * Postgres — the SQL in finance/profitDefinitions.js, end to end.
 *
 * Every row this test writes is dated in 2091, and every read is for 2091, so
 * whatever else is in the database never reaches the figures asserted here.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_g1 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55452:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55452 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest profitDefinitions.integration
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

const PERIOD = { startDate: '2091-01-01', endDate: '2091-12-31 23:59:59.999' };
const AT = '2091-06-15';

d('profit definitions (DB-gated)', () => {
  let db; let pd; let financeService; let reportingService;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  beforeAll(async () => {
    db = require('../config/database');
    pd = require('../modules/finance/profitDefinitions');
    financeService = require('../modules/finance/finance.service');
    reportingService = require('../modules/analytics/reporting.service');

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-profit-${run}@test.local`, full_name: `ZZ Profit ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [w] = await db('warehouses').insert({ name: `ZZ PWH ${run}`, type: 'finished' }).returning('*');
    const product = async (n) => (await db('products').insert({ name: `ZZ ${n} ${run}` }).returning('*'))[0].id;
    const [c] = await db('customers').insert({ name: `ZZ Profit Buyer ${run}` }).returning('*');
    Object.assign(ids, {
      user: u.id, wh: w.id, customer: c.id,
      pReserved: await product('Reserved'), pStock: await product('Stocked'), pNone: await product('Nostock'), pMill: await product('Milled'),
    });

    const lot = async (suffix, fields) => (await db('inventory_lots').insert({
      lot_no: `ZZP-${suffix}-${run}`, item_name: `ZZ ${suffix}`, type: 'finished', entity: 'export',
      warehouse_id: w.id, unit: 'kg', created_at: `${AT} 10:00`, ...fields,
    }).returning('*'))[0];

    // Export stock: one lot reserved for order A; one lot of pStock that only
    // serves as the ESTIMATE basis for order D (Rs 100/kg).
    ids.lotRes = (await lot('RES', { product_id: ids.pReserved, qty: 10000, available_qty: 0, reserved_qty: 10000, landed_cost_per_kg: 200, cost_per_unit: 200 })).id;
    ids.lotStock = (await lot('STK', { product_id: ids.pStock, qty: 50000, available_qty: 50000, landed_cost_per_kg: 100, cost_per_unit: 100 })).id;

    const order = async (suffix, fields) => (await db('export_orders').insert({
      order_no: `ZZP-${suffix}-${run}`, customer_id: c.id, created_by: u.id, currency: 'USD',
      booked_fx_rate: 280, created_at: `${AT} 09:00`, ...fields,
    }).returning('*'))[0];

    // A — confirmed, 10 MT fully reserved @200/kg, Rs 100k freight:
    //     2,800,000 − 100,000 − 2,000,000 = 700,000 (basis 'reserved').
    const A = await order('A', { status: 'Advance Received', product_id: ids.pReserved, qty_mt: 10, contract_value: 10000, contract_value_pkr_locked: 2800000 });
    await db('inventory_reservations').insert({ order_id: A.id, lot_id: ids.lotRes, reserved_qty: 10000, status: 'Active' });
    await db('export_order_costs').insert({ order_id: A.id, category: 'freight', amount: 100000, currency: 'PKR', base_amount_pkr: 100000 });
    // B — shipped, COGS locked 1,500,000; advance 3,000 USD received at 285:
    //     2,800,000 − 1,500,000 = 1,300,000 booked AND realised; FX +15,000.
    const B = await order('B', {
      status: 'Shipped', product_id: ids.pReserved, qty_mt: 10, contract_value: 10000, contract_value_pkr_locked: 2800000,
      inventory_cogs_total_pkr: 1500000, cost_locked_at_dispatch: true,
      advance_received: 3000, advance_received_pkr: 855000,
    });
    // C — confirmed, no reservation, no allocation, no stock of its product → unpriced.
    const C = await order('C', { status: 'Awaiting Advance', product_id: ids.pNone, qty_mt: 5, contract_value: 5000, contract_value_pkr_locked: 1400000 });
    // D — confirmed, 2 MT of pStock: estimate 2,000 kg × 100 = 200,000 →
    //     560,000 − 200,000 = 360,000, flagged estimated.
    const D = await order('D', { status: 'Advance Received', product_id: ids.pStock, qty_mt: 2, contract_value: 2000, contract_value_pkr_locked: 560000 });
    await db('export_order_items').insert({ order_id: D.id, line_no: 1, product_id: ids.pStock, qty_mt: 2, price_per_mt: 1000, line_total: 2000 });
    // E (Draft) and F (Cancelled) — never in Booked.
    const E = await order('E', { status: 'Draft', product_id: ids.pStock, qty_mt: 1, contract_value: 9999, contract_value_pkr_locked: 2799720 });
    const F = await order('F', { status: 'Cancelled', product_id: ids.pStock, qty_mt: 1, contract_value: 9999, contract_value_pkr_locked: 2799720 });
    // G — confirmed but dated outside the period.
    const G = await order('G', { status: 'Advance Received', product_id: ids.pStock, qty_mt: 1, contract_value: 1000, contract_value_pkr_locked: 280000, created_at: '2090-06-15 09:00' });
    Object.assign(ids, { A: A.id, B: B.id, C: C.id, D: D.id, E: E.id, F: F.id, G: G.id });

    // ── Mill ──
    const [mill] = await db('mills').insert({ name: `ZZ Mill ${run}` }).returning('*').catch(async () => [await db('mills').first()]);
    const [batch] = await db('milling_batches').insert({
      batch_no: `ZZP-M-${run}`, status: 'Completed', created_by: u.id, mill_id: mill ? mill.id : null,
      raw_qty_kg: 10000, actual_finished_kg: 6000, completed_at: `${AT} 12:00`,
    }).returning('*');
    ids.batch = batch.id;
    const millLot = async (suffix, fields) => (await db('inventory_lots').insert({
      lot_no: `ZZP-${suffix}-${run}`, item_name: `ZZ ${suffix}`, entity: 'mill', warehouse_id: w.id, unit: 'kg',
      product_id: ids.pMill, created_at: `${AT} 10:00`, ...fields,
    }).returning('*'))[0];
    // Finished output 6,000 kg @150, by-product 1,000 kg @50, from the batch.
    ids.fin = (await millLot('FIN', { type: 'finished', batch_ref: `batch-${batch.id}`, qty: 3000, available_qty: 3000, landed_cost_per_kg: 150, cost_per_unit: 150 })).id;
    ids.byp = (await millLot('BYP', { type: 'byproduct', batch_ref: `batch-${batch.id}`, qty: 800, available_qty: 800, landed_cost_per_kg: 50, cost_per_unit: 50 })).id;
    ids.raw = (await millLot('RAW', { type: 'raw', qty: 5000, available_qty: 5000, landed_cost_per_kg: 90, cost_per_unit: 90 })).id;
    const txn = async (lotId, type, kg, extra = {}) => db('lot_transactions').insert({
      transaction_no: `ZZP-T-${run}-${Math.random().toString(36).slice(2, 8)}`, lot_id: lotId, transaction_type: type,
      quantity_kg: kg, transaction_date: AT, created_by: u.id, performed_by: u.id, ...extra,
    });
    await txn(ids.fin, 'milling_receipt', 6000, { reference_module: 'milling_batch', reference_id: batch.id });
    await txn(ids.byp, 'byproduct_receipt', 1000, { reference_module: 'milling_batch', reference_id: batch.id });

    const sale = async (suffix, fields) => db('local_sales').insert({
      sale_no: `ZZP-LS-${suffix}-${run}`, status: 'Completed', sale_date: AT, item_name: `ZZ ${suffix}`,
      quantity_input: fields.quantity_kg || 1, rate_input: 1, rate_per_kg: 1, entity: 'mill', ...fields,
    });
    // Mill output sales: finished 1,000 kg for 200,000 (COGS 150,000) and
    // by-product 200 kg for 8,000 with NO COGS (left out, counted).
    await sale('FIN', { lot_id: ids.fin, quantity_kg: 1000, total_amount: 200000, cogs_total_pkr: 150000 });
    await sale('BYP', { lot_id: ids.byp, quantity_kg: 200, total_amount: 8000 });
    // Local other: a raw-rice lot sale (100,000 − 90,000) and a labour line (1,540).
    await sale('RAW', { lot_id: ids.raw, quantity_kg: 1000, total_amount: 100000, cogs_total_pkr: 90000 });
    await sale('LAB', { item_type: 'labour', quantity_kg: 1, total_amount: 1540 });
    // Cancelled and out-of-period sales never count.
    await sale('CXL', { lot_id: ids.fin, status: 'Cancelled', quantity_kg: 10, total_amount: 99999, cogs_total_pkr: 1 });
    await sale('OLD', { lot_id: ids.fin, sale_date: '2090-01-01', quantity_kg: 10, total_amount: 99999, cogs_total_pkr: 1 });

    // Transfer to export: 2,000 kg of the finished lot at Rs 180,000/MT
    // → revenue 360,000, cost 2,000 × 150 = 300,000.
    const [it] = await db('internal_transfers').insert({
      transfer_no: `ZZP-IT-${run}`, qty_kg: 2000, transfer_price_pkr: 180000, total_value_pkr: 360000, status: 'Completed', dispatch_date: AT,
    }).returning('*');
    await txn(ids.fin, 'warehouse_transfer_out', 2000, { reference_no: `transfer-${it.id}`, unit_cost: 150, entity_from: 'mill', entity_to: 'export' });
    ids.transfer = it.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db('lot_transactions').whereIn('lot_id', [ids.fin, ids.byp, ids.raw].filter(Boolean)).del();
    await db('local_sales').where('sale_no', 'like', `ZZP-LS-%-${run}`).del();
    await db('internal_transfers').where({ id: ids.transfer }).del();
    const orders = [ids.A, ids.B, ids.C, ids.D, ids.E, ids.F, ids.G].filter(Boolean);
    await db('inventory_reservations').whereIn('order_id', orders).del();
    await db('export_order_items').whereIn('order_id', orders).del();
    await db('export_order_costs').whereIn('order_id', orders).del();
    await db('export_orders').whereIn('id', orders).del();
    await db('inventory_lots').where('lot_no', 'like', `ZZP-%-${run}`).del();
    await db('milling_batches').where({ id: ids.batch }).del();
    await db.destroy();
  });

  test('export: Booked / Realised / Pipeline / FX, unpriced and estimated counted', async () => {
    const { rows, totals } = await pd.exportProfit(db, PERIOD);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(Object.keys(byId).map(Number).sort()).toEqual([ids.A, ids.B, ids.C, ids.D].sort());
    expect(byId[ids.A]).toMatchObject({ riceCostBasis: 'reserved', riceCostPkr: 2000000, opCostsPkr: 100000, bookedProfitPkr: 700000, realised: false });
    expect(byId[ids.B]).toMatchObject({ riceCostBasis: 'locked', bookedProfitPkr: 1300000, realisedProfitPkr: 1300000, fxRealisedPkr: 15000 });
    expect(byId[ids.C]).toMatchObject({ riceCostBasis: 'unpriced', priced: false, bookedProfitPkr: null });
    expect(byId[ids.D]).toMatchObject({ riceCostBasis: 'estimate', estimated: true, riceCostPkr: 200000, bookedProfitPkr: 360000 });

    expect(totals).toMatchObject({
      bookedPkr: 700000 + 1300000 + 360000,
      realisedPkr: 1300000,
      pipelinePkr: 700000 + 360000,
      fxRealisedPkr: 15000,
      unpricedCount: 1,
      unpricedRevenuePkr: 1400000,
      estimatedCount: 1,
      realisedCount: 1,
    });
  });

  test('mill = sales of mill output − COGS; local = the rest; each sale once', async () => {
    const { mill, local, saleSegments } = await pd.millAndLocalProfit(db, PERIOD);
    // 200,000 − 150,000 (local sale) + 360,000 − 300,000 (transfer).
    expect(mill).toMatchObject({ revenuePkr: 560000, cogsPkr: 450000, profitPkr: 110000, transferCount: 1, uncostedCount: 1, uncostedRevenuePkr: 8000 });
    // Raw-rice lot 10,000 + labour 1,540.
    expect(local).toMatchObject({ revenuePkr: 101540, cogsPkr: 90000, profitPkr: 11540, saleCount: 2 });
    const names = saleSegments.map((s) => s.saleNo);
    expect(new Set(names).size).toBe(names.length);
  });

  test('per-batch rows: output at cost, sold so far, unsold stock', async () => {
    const rows = await pd.millBatchRows(db, PERIOD);
    const b = rows.find((r) => r.id === ids.batch);
    expect(b).toMatchObject({
      outputKg: 7000,
      outputValueAtCostPkr: 6000 * 150 + 1000 * 50,
      // Sold so far is TO DATE (not the period): the 2090 sale counts here.
      soldKg: 1000 + 200 + 2000 + 10,
      soldRevenuePkr: 200000 + 8000 + 360000 + 99999,
      unsoldKg: 3800,
      unsoldValueAtCostPkr: 3000 * 150 + 800 * 50,
      uncostedSales: 1,
    });
  });

  test('every tile reads the same numbers', async () => {
    const overview = await financeService.getOverviewSummary(PERIOD);
    const prof = await financeService.getProfitabilitySummary(PERIOD);
    const exec = await reportingService.getExecutiveSummary({ dateFrom: PERIOD.startDate, dateTo: PERIOD.endDate });

    const booked = 2360000;
    expect(overview.export.bookedProfitPkr).toBe(booked);
    expect(prof.export.totalBookedProfitPkr).toBe(booked);
    expect(exec.bookedProfitPkr).toBe(booked);
    expect(exec.realisedProfitPkr).toBe(1300000);
    expect(exec.pipelineProfitPkr).toBe(1060000);

    expect(overview.mill.grossProfit).toBe(110000);
    expect(prof.mill.totalProfitPkr).toBe(110000);
    expect(overview.local.grossProfit).toBe(11540);
    expect(overview.consolidated.bookedPkr).toBe(booked + 110000 + 11540);
    expect(overview.consolidated.realisedPkr).toBe(1300000 + 110000 + 11540);
    expect(prof.consolidated.bookedPkr).toBe(overview.consolidated.bookedPkr);
  });
});
