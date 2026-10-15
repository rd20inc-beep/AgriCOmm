/**
 * P4-01 / P4-02 golden numbers — every screen and report showing a KPI
 * returns the same value on a seeded scenario (docs/AGRIRICE_KPI_CONTRACTS.md).
 *
 * The mill scenario is dated 2093 and read for 2093, so other rows in the
 * database never reach the period figures. Point-in-time KPIs (working
 * capital, overdue, active orders) are compared surface-to-surface: every
 * surface must give the same number as the canonical module.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

const FROM = '2093-01-01';
const TO = '2093-12-31';
const AT = '2093-03-15';

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

d('KPI golden numbers (DB-gated)', () => {
  let db; let kpi; let pd; let financeService; let financeController; let millCtl; let reporting;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  let superUser;

  beforeAll(async () => {
    db = require('../config/database');
    kpi = require('../modules/kpi/millFinance');
    pd = require('../modules/finance/profitDefinitions');
    financeService = require('../modules/finance/finance.service');
    financeController = require('../modules/finance/finance.controller');
    millCtl = require('../modules/milling/millingAdvanced.controller');
    reporting = require('../modules/analytics/reporting.service');
    await cleanup();

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-kpi-${run}@test.local`, full_name: `ZZ KPI ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    superUser = { id: u.id, role: 'Super Admin', role_name: 'Super Admin', role_id: role.id };
    const [w] = await db('warehouses').insert({ name: `ZZ KPI WH ${run}`, entity: 'mill', type: 'finished' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ KPI Rice ${run}` }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ KPI Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ KPI Supplier ${run}`, type: 'local' }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ KPI Mill ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, wh: w.id, product: p.id, customer: c.id, sup: sup.id, mill: mill.id });

    const batch = async (n, o) => (await db('milling_batches').insert({
      batch_no: `ZZKPI-${n}-${run}`, created_by: u.id, mill_id: mill.id, supplier_id: sup.id, ...o,
    }).returning('*'))[0];
    // A: the company batch in the period. It still carries the old Rs 5/kg
    // default fee, which must change nothing.
    const A = await batch('A', {
      status: 'Completed', completed_at: `${AT} 12:00`, raw_qty_kg: 10000, actual_finished_kg: 7000, wastage_kg: 300,
      broken_kg: 500, finished_price_per_kg: 200, broken_price_per_kg: 50, milling_fee_per_kg: 5, yield_pct: 70,
    });
    // S: service (toll) milling — never in yield or production.
    const S = await batch('S', { status: 'Completed', completed_at: `${AT} 13:00`, raw_qty_kg: 5000, actual_finished_kg: 4900, is_service_milling: true });
    // OLD: completed outside the period.
    const OLD = await batch('OLD', { status: 'Completed', completed_at: '2092-12-31 12:00', raw_qty_kg: 1000, actual_finished_kg: 100 });
    Object.assign(ids, { A: A.id, S: S.id, OLD: OLD.id });
    await db('milling_costs').insert([
      { batch_id: A.id, category: 'raw_rice', amount: 1000000 },
      { batch_id: A.id, category: 'packaging', amount: 20000 },
      { batch_id: A.id, category: 'labor', amount: 30000 },
    ]);

    const lot = async (n, o) => (await db('inventory_lots').insert({
      lot_no: `ZZKPI-${n}-${run}`, item_name: `ZZ KPI ${n}`, entity: 'mill', warehouse_id: w.id, product_id: p.id,
      unit: 'kg', status: 'Available', ...o,
    }).returning('*'))[0];
    ids.fin = (await lot('FIN', { type: 'finished', batch_ref: `batch-${A.id}`, qty: 3900, available_qty: 3900, net_weight_kg: 3900, landed_cost_per_kg: 150, cost_per_unit: 150 })).id;
    ids.byp = (await lot('BYP', { type: 'byproduct', batch_ref: `batch-${A.id}`, qty: 300, available_qty: 300, net_weight_kg: 300, landed_cost_per_kg: 50, cost_per_unit: 50 })).id;
    ids.raw = (await lot('RAW', { type: 'raw', qty: 4000, available_qty: 4000, net_weight_kg: 4000, landed_cost_per_kg: 100, cost_per_unit: 100 })).id;
    const txn = (lotId, type, kg, extra = {}) => db('lot_transactions').insert({
      transaction_no: `ZZKPI-T-${run}-${Math.random().toString(36).slice(2, 8)}`, lot_id: lotId, transaction_type: type,
      quantity_kg: kg, transaction_date: AT, created_by: u.id, performed_by: u.id, ...extra,
    });
    await txn(ids.fin, 'milling_receipt', 7000, { reference_module: 'milling_batch', reference_id: A.id });
    await txn(ids.byp, 'byproduct_receipt', 500, { reference_module: 'milling_batch', reference_id: A.id });

    const sale = async (n, o) => (await db('local_sales').insert({
      sale_no: `ZZKPI-LS-${n}-${run}`, status: 'Completed', sale_date: AT, item_name: `ZZ ${n}`, entity: 'mill',
      quantity_input: o.quantity_kg, rate_input: 1, rate_per_kg: 1, ...o,
    }).returning('*'))[0];
    await sale('FIN', { lot_id: ids.fin, quantity_kg: 1000, total_amount: 200000, cogs_total_pkr: 150000 });
    await sale('BYP', { lot_id: ids.byp, quantity_kg: 200, total_amount: 10000, cogs_total_pkr: 10000 });
    // No COGS yet: left out of profit, counted.
    ids.saleNoCogs = (await sale('NOCOGS', { lot_id: ids.fin, quantity_kg: 100, total_amount: 20000 })).id;

    // Transfer to export: 2,000 kg at Rs 180,000/MT → 360,000 revenue, 300,000 cost.
    const [it] = await db('internal_transfers').insert({
      transfer_no: `ZZKPI-IT-${run}`, qty_kg: 2000, transfer_price_pkr: 180000, total_value_pkr: 360000, status: 'Completed', dispatch_date: AT,
    }).returning('*');
    ids.transfer = it.id;
    await txn(ids.fin, 'warehouse_transfer_out', 2000, { reference_no: `transfer-${it.id}`, unit_cost: 150, entity_from: 'mill', entity_to: 'export' });

    // Overheads: 25,000 unlinked + 5,000 legacy count; a batch-linked 7,000 is
    // in the batch's cost already; a Reversed one never counts.
    const biz = (n, o) => db('business_expenses').insert({
      expense_no: `ZZKPI-E-${n}-${run}`, expense_type: 'mill', category: 'utilities', currency: 'PKR',
      expense_date: '2093-04-01', payment_status: 'Paid', ...o,
    });
    await biz('OH', { amount: 25000, amount_pkr: 25000 });
    await biz('LINKED', { amount: 7000, amount_pkr: 7000, batch_id: A.id });
    await biz('REV', { amount: 9999, amount_pkr: 9999, payment_status: 'Reversed' });
    ids.legacyExpense = (await db('mill_expenses').insert({ category: 'rent', amount: 5000, currency: 'PKR', expense_date: '2093-05-01' }).returning('*'))[0].id;
  });

  // Every row this test writes carries a ZZKPI / ZK… tag; clear them (any
  // earlier run's too) in FK order, before and after.
  async function cleanup() {
    const batchIds = (await db('milling_batches').where('batch_no', 'like', 'ZZKPI-%').select('id')).map((r) => r.id);
    const lotIds = (await db('inventory_lots').where('lot_no', 'like', 'ZZKPI-%').select('id')).map((r) => r.id);
    const orderIds = (await db('export_orders').where('order_no', 'like', 'ZZKPI-O%').select('id')).map((r) => r.id);
    await db('payments').where('payment_no', 'like', 'ZZKPI-P%').del();
    await db('payables').where('pay_no', 'like', 'ZZKPI-AP-%').del();
    if (orderIds.length) {
      await db('receivables').whereIn('order_id', orderIds).del();
      await db('export_order_status_history').whereIn('order_id', orderIds).del();
      await db('export_orders').whereIn('id', orderIds).del();
    }
    if (lotIds.length) await db('lot_transactions').whereIn('lot_id', lotIds).del();
    await db('local_sales').where('sale_no', 'like', 'ZZKPI-LS-%').del();
    await db('internal_transfers').where('transfer_no', 'like', 'ZZKPI-IT-%').del();
    await db('business_expenses').where('expense_no', 'like', 'ZZKPI-E-%').del();
    await db('mill_expenses').where('expense_date', '>=', '2093-01-01').where('expense_date', '<=', '2093-12-31').del();
    if (batchIds.length) await db('milling_costs').whereIn('batch_id', batchIds).del();
    if (lotIds.length) await db('inventory_lots').whereIn('id', lotIds).del();
    if (batchIds.length) await db('milling_batches').whereIn('id', batchIds).del();
  }

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    await db.destroy();
  });

  const period = { period: 'custom', from: FROM, to: TO };

  test('mill profit (D-13): the KPI module = profitDefinitions = Finance overview', async () => {
    const k = await kpi.millFinanceKpis(db, period);
    expect(k.profit).toMatchObject({
      contract: 'mill_profit.v1', revenuePkr: 570000, cogsPkr: 460000, grossProfitPkr: 110000,
      overheadsPkr: 30000, netProfitPkr: 80000, uncostedCount: 1, uncostedRevenuePkr: 20000,
    });
    const defs = await pd.profitDefinitions(db, { startDate: FROM, endDate: TO });
    expect(defs.mill.profitPkr).toBe(k.profit.netProfitPkr);
    const ov = await financeService.getOverviewSummary({ startDate: FROM, endDate: TO });
    expect(ov.mill.netProfit).toBe(k.profit.netProfitPkr);
    expect(ov.mill.revenue).toBe(k.profit.revenuePkr);
    expect(k.period).toMatchObject({ key: 'custom', from: FROM, to: TO });
    expect(k.currency).toBe('PKR');
  });

  test('production (secondary) and yield: KPI = yield endpoint = SQL = Reports', async () => {
    const k = await kpi.millFinanceKpis(db, period);
    expect(k.production).toMatchObject({
      batchCount: 1, rawKg: 10000, finishedKg: 7000, sellableFinishedKg: 7000, yieldPct: 70, wastagePct: 3,
      rawCostPkr: 1000000, packagingCostPkr: 20000, otherCostPkr: 30000, batchCostPkr: 1050000, batchCostPerKgPkr: 150,
      // 7,000 × 200 + by-products at what the yield booked (500 × 50)
      finishedValuePkr: 1400000, byproductValuePkr: 25000, valueAtSellingPricePkr: 1425000,
    });
    const y = await kpi.yieldKpi(db, period);
    expect(y.yieldPct).toBe(k.production.yieldPct);
    const { yieldBatches, weightedYieldPctSql } = require('../modules/milling/millingYield');
    const sql = await yieldBatches(db('milling_batches as mb'), 'mb')
      .whereRaw('mb.completed_at::date BETWEEN ?::date AND ?::date', [FROM, TO])
      .select(db.raw(`${weightedYieldPctSql('mb')}::float AS y`)).first();
    expect(sql.y).toBe(k.production.yieldPct);
  });

  test('drill-down rows add up to the figures', async () => {
    const k = await kpi.millFinanceKpis(db, period);
    const sales = await kpi.millFinanceDetail(db, { ...period, part: 'sales', limit: 1000 });
    expect(sales.total).toBe(4); // 3 local sales + 1 transfer
    const rev = sales.rows.reduce((s, r) => s + Number(r.revenue_pkr), 0);
    expect(rev).toBe(k.profit.revenuePkr + k.profit.uncostedRevenuePkr);
    const oh = await kpi.millFinanceDetail(db, { ...period, part: 'overheads', limit: 1000 });
    expect(oh.rows.reduce((s, r) => s + Number(r.amount_pkr || 0), 0)).toBe(k.profit.overheadsPkr);
    const b = await kpi.millFinanceDetail(db, { ...period, part: 'batches' });
    expect(b.rows.map((r) => r.id)).toEqual([ids.A]);
    await expect(kpi.millFinanceDetail(db, { ...period, part: 'nope' })).rejects.toThrow(/Unknown part/);
  });

  test('working capital = the D-14 helper on every surface', async () => {
    const sv = require('../modules/inventory/stockValue');
    const k = await kpi.millFinanceKpis(db, period);
    const acc = await sv.stockValueByAccount(db, { entity: 'mill' });
    const helperTotal = Math.round(acc.reduce((s, a) => s + a.value, 0) * 100) / 100;
    expect(k.workingCapital.totalPkr).toBe(helperTotal);
    const r = await db('inventory_lots as l').where('l.entity', 'mill').where('l.ownership', 'company')
      .select(db.raw(`COALESCE(SUM(${sv.lotValueSql('l')}), 0)::float AS v`)).first();
    expect(k.workingCapital.totalPkr).toBeCloseTo(r.v, 2);
    const stock = await kpi.millFinanceDetail(db, { ...period, part: 'stock', limit: 1000 });
    if (stock.total <= 1000) {
      expect(stock.rows.reduce((s, x) => s + Number(x.value_pkr), 0)).toBeCloseTo(k.workingCapital.totalPkr, 2);
    }
    // Our seeded lots, at landed cost × on hand: 3,900×150 + 300×50 + 4,000×100.
    const mine = stock.rows.filter((x) => [ids.fin, ids.byp, ids.raw].includes(x.id));
    expect(mine.reduce((s, x) => s + Number(x.value_pkr), 0)).toBe(585000 + 15000 + 400000);
  });

  test('Reports ▸ batch profitability: actual sales, no Rs 72,800/MT reference price', async () => {
    const res = await reporting.getBatchProfitability({ supplierId: ids.sup, limit: 50 });
    const row = res.data.find((r) => r.id === ids.A);
    const [fig] = await pd.batchSalesFigures(db, [{ id: ids.A, batch_no: 'x', status: 'Completed' }]);
    expect(row.revenue).toBe(fig.soldRevenuePkr);
    expect(row.costs).toBe(fig.soldCogsPkr);
    expect(row.revenue).toBe(590000); // 200,000 + 20,000 + 10,000 + 360,000 sold, not 7 MT × 72,800
    expect(row.inputCostPkr).toBe(1050000);
    expect(row.basis).toBe('sold_to_date');
  });

  test('migration 409: a batch inserted without a fee gets 0, not 5', async () => {
    const [b] = await db('milling_batches').insert({ batch_no: `ZZKPI-FEE-${run}`, created_by: ids.user, mill_id: ids.mill, status: 'Queued' }).returning('*');
    expect(Number(b.milling_fee_per_kg)).toBe(0);
  });

  describe('overdue and active orders (D-15) agree across surfaces', () => {
    beforeAll(async () => {
      const order = async (n, o) => (await db('export_orders').insert({
        order_no: `ZZKPI-O${n}-${run}`, customer_id: ids.customer, product_id: ids.product, created_by: ids.user,
        currency: 'USD', contract_value: 1000, booked_fx_rate: 280, qty_mt: 1, ...o,
      }).returning('*'))[0];
      const O1 = await order(1, { status: 'Shipped', bl_date: '2020-01-01', balance_term_days: 30 });
      const O2 = await order(2, { status: 'In Milling' });
      const O3 = await order(3, { status: 'Cancelled' });
      await order(4, { status: 'Draft' });
      await order(5, { status: 'Closed' });
      const recv = (tag, o, type, out, due, status = 'Pending') => ({
        recv_no: `ZK${tag}${run}`, type, entity: 'export', order_id: o.id, customer_id: ids.customer, currency: 'USD',
        expected_amount: 1000, received_amount: 1000 - out, outstanding: out, base_amount_pkr: 280000, fx_rate: 280, status, due_date: due,
      });
      await db('receivables').insert([
        recv('B1', O1, 'Balance', 800, '2099-01-01'), // sailed 2020 + 30 → overdue, whatever the placeholder
        recv('B2', O2, 'Balance', 500, '2020-01-01'), // not sailed → not due, never overdue
        recv('A2', O2, 'Advance', 200, '2020-01-01'), // past due, owed → overdue
        recv('A1', O1, 'Advance', 0, '2020-01-01', 'Paid'), // nothing owed
        recv('A3', O3, 'Advance', 100, '2020-01-01'), // cancelled order
      ]);
      Object.assign(ids, { O1: O1.id, O2: O2.id });
    });

    test('Money In rows, the Finance overview, the collection rate and the alert give one overdue figure', async () => {
      const res = mockRes();
      await financeController.getReceivables({ query: { limit: 100000 }, user: superUser, params: {} }, res);
      const rows = res.body.data.receivables;
      const flag = (tag) => rows.find((r) => r.recv_no === `ZK${tag}${run}`);
      expect(flag('B1').is_overdue).toBe(true);
      expect(flag('B1').effective_due_date).toBe('2020-01-31');
      expect(flag('B2').is_overdue).toBe(false);
      expect(flag('B2').effective_due_date).toBeNull();
      expect(flag('A2').is_overdue).toBe(true);
      expect(flag('A3').is_overdue).toBe(false);

      const usdOverdue = Math.round(rows.filter((r) => r.is_overdue && String(r.currency || 'PKR').toUpperCase() === 'USD')
        .reduce((s, r) => s + Number(r.outstanding), 0) * 100) / 100;
      expect(usdOverdue).toBeGreaterThanOrEqual(1000);

      const ov = await financeService.getOverviewSummary({});
      expect(ov.receivables.byCurrency.USD.overdueAmount).toBeCloseTo(usdOverdue, 2);

      const { collectionRate } = require('../modules/finance/collectionRate');
      const cr = await collectionRate(db);
      expect(cr.byCurrency.USD.overdueAmount).toBeCloseTo(usdOverdue, 2);

      const al = mockRes();
      await financeController.getAlerts({ query: {}, user: superUser }, al);
      const alert = al.body.data.alerts.find((a) => a.id === 'overdue_receivables');
      expect(alert.totalsByCurrency.USD).toBeCloseTo(usdOverdue, 2);

      const filtered = mockRes();
      await financeController.getReceivables({ query: { limit: 100000, overdue: 'true' }, user: superUser, params: {} }, filtered);
      expect(filtered.body.data.receivables.every((r) => r.is_overdue)).toBe(true);
      expect(filtered.body.data.receivables.some((r) => r.recv_no === `ZKB2${run}`)).toBe(false);
    });

    test('active orders: one count on every surface', async () => {
      const { whereActiveOrder } = require('../modules/kpi/orderStatus');
      const [{ n }] = await whereActiveOrder(db('export_orders')).count('id as n');
      const ov = await financeService.getOverviewSummary({});
      expect(ov.export.activeOrders).toBe(Number(n));
      const r = mockRes();
      await financeController.getOverview({ query: {}, user: superUser }, r);
      expect(r.body.data.overview.active_orders).toBe(Number(n));
    });
  });

  test('mill cash flow counts settled money only (finance status rule)', async () => {
    const [pa] = await db('payables').insert({
      pay_no: `ZZKPI-AP-${run}`, payable_type: 'vendor', entity: 'mill', category: 'Other', supplier_id: ids.sup,
      original_amount: 2500, paid_amount: 1000, outstanding: 1500, currency: 'PKR', status: 'Partial',
    }).returning('*');
    const pay = (n, o) => ({ payment_no: `ZZKPI-P${n}-${run}`, type: 'payment', currency: 'PKR', payment_date: '2093-05-02', linked_payable_id: pa.id, ...o });
    await db('payments').insert([
      pay(1, { amount: 1000, status: 'Confirmed', cleared: true }),
      pay(2, { amount: 500, status: 'Reversed' }),
      pay(3, { amount: 300, status: 'Confirmed', payment_method: 'cheque', cleared: false }),
      pay(4, { amount: 700, status: 'Bounced', payment_method: 'cheque', cleared: false }),
    ]);
    const res = mockRes();
    await millCtl.cashFlow({ query: { from_date: '2093-05-01', to_date: '2093-05-31' }, user: superUser }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      cashOut: 1000, cashIn: 0, net: -1000, count: 1, pendingChequesOut: 300, pendingChequeCount: 1, notMoneyCount: 2,
    });
    expect(res.body.data.ledger).toHaveLength(4);
    // Running balance only moves on counted rows.
    expect(res.body.data.ledger.filter((r) => r.counted).map((r) => r.amount_pkr)).toEqual([1000]);
    const bad = mockRes();
    await millCtl.cashFlow({ query: { period: 'nope' }, user: superUser }, bad);
    expect(bad.statusCode).toBe(400);
  });
});
