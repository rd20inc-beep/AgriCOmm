/**
 * P4-03 / P4-09 against a real, fully-migrated Postgres.
 *
 *  - One export profit definition (profitDefinitions) behind the order page,
 *    the order list and Reports ▸ Orders — golden numbers, the same on each.
 *  - EXP-09: separately charged freight + Issued debit notes are revenue,
 *    printed bags are cost; a Cancelled debit note is not.
 *  - D-16: export revenue is dated by the BL date (else the Shipped transition).
 *  - P4-09: PKR and USD are never summed — order book, receivables, cash flow
 *    (settled only), alerts, exceptions, payables.
 *
 * Every row this test writes is dated in 2092 (or is read as a before/after
 * delta), so whatever else is in the database never reaches the assertions.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

d('export profit + currency rules (DB-gated)', () => {
  let db; let pd; let orderBook; let reportingService; let reportingController; let financeController;
  let financeService; let intelligenceService;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const before = {};
  const AS_OF = '2093-01-01';

  beforeAll(async () => {
    db = require('../config/database');
    pd = require('../modules/finance/profitDefinitions');
    orderBook = require('../modules/exportOrders/orderBook');
    reportingService = require('../modules/analytics/reporting.service');
    reportingController = require('../modules/analytics/reporting.controller');
    financeController = require('../modules/finance/finance.controller');
    financeService = require('../modules/finance/finance.service');
    intelligenceService = require('../modules/analytics/intelligence.service');

    before.book = await orderBook.exportOrderBook(db, { asOf: AS_OF });
    before.summary = await financeService.getOverviewSummary({});
    before.exc = await intelligenceService.getExceptionStats();

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-p4x-${run}@test.local`, full_name: `ZZ P4X ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [w] = await db('warehouses').insert({ name: `ZZ P4X WH ${run}`, type: 'finished' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ P4X Rice ${run}` }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ P4X Buyer ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, customer: c.id, product: p.id });

    const order = async (suffix, fields) => (await db('export_orders').insert({
      order_no: `ZZX-${suffix}-${run}`, customer_id: c.id, created_by: u.id, product_id: p.id,
      created_at: '2092-01-10 09:00', ...fields,
    }).returning('*'))[0];

    // U — USD, shipped, COGS locked 1,500,000; freight charged separately
    // (20 USD/MT × 10 MT = 200 USD → 56,000 at 280); a 100 USD debit note
    // (28,000) Issued and a 50 USD one Cancelled; Rs 30,000 freight cost and a
    // Rs 12,000 printed-bag order. Moved to Shipped 2092-02-25, BL 2092-03-05.
    const U = await order('U', {
      status: 'Shipped', currency: 'USD', booked_fx_rate: 280, qty_mt: 10, contract_value: 10000,
      contract_value_pkr_locked: 2800000, inventory_cogs_total_pkr: 1500000, cost_locked_at_dispatch: true,
      freight_display: 'separate', freight_per_mt: 20, bl_date: '2092-03-05',
      advance_expected: 2000, advance_received: 2000, balance_expected: 8300, balance_received: 0,
    });
    await db('export_order_status_history').insert({ order_id: U.id, from_status: 'Ready to Ship', to_status: 'Shipped', created_at: '2092-02-25 10:00' });
    await db('export_order_costs').insert({ order_id: U.id, category: 'freight', amount: 30000, currency: 'PKR', base_amount_pkr: 30000 });
    await db('export_debit_notes').insert([
      { debit_note_no: `ZZDN-1-${run}`, order_id: U.id, issue_date: '2092-03-10', currency: 'USD', amount: 100, fx_rate: 280, amount_pkr: 28000, status: 'Issued' },
      { debit_note_no: `ZZDN-2-${run}`, order_id: U.id, issue_date: '2092-03-11', currency: 'USD', amount: 50, fx_rate: 280, amount_pkr: 14000, status: 'Cancelled' },
    ]);
    await db('printed_bag_orders').insert({ pbo_no: `ZZPB-${run}`, order_id: U.id, quantity: 1000, unit_cost: 12, total_amount: 12000, currency: 'PKR' });

    // K — PKR order, 10,000 kg reserved at Rs 300/kg = 3,000,000 rice cost.
    const K = await order('K', { status: 'Advance Received', currency: 'PKR', qty_mt: 10, contract_value: 5000000, created_at: '2092-01-12 09:00' });
    const [lot] = await db('inventory_lots').insert({
      lot_no: `ZZX-L-${run}`, item_name: 'ZZ', type: 'finished', entity: 'export', warehouse_id: w.id, unit: 'kg',
      product_id: p.id, qty: 10000, available_qty: 0, reserved_qty: 10000, landed_cost_per_kg: 300, cost_per_unit: 300,
    }).returning('*');
    await db('inventory_reservations').insert({ order_id: K.id, lot_id: lot.id, reserved_qty: 10000, status: 'Active' });

    // N — USD with no booked rate: in the order book, but UNPRICED (never read as rupees).
    const N = await order('N', { status: 'Awaiting Advance', currency: 'USD', qty_mt: 1, contract_value: 1000, created_at: '2092-01-15 09:00' });
    // Draft and Cancelled — never in a booked figure.
    const D = await order('D', { status: 'Draft', currency: 'USD', qty_mt: 1, contract_value: 9999 });
    const X = await order('X', { status: 'Cancelled', currency: 'USD', qty_mt: 1, contract_value: 7777 });
    Object.assign(ids, { U: U.id, K: K.id, N: N.id, D: D.id, X: X.id });

    // Receivables (the source of truth for received / outstanding).
    const recv = (suffix, f) => db('receivables').insert({ recv_no: `ZZXR-${suffix}-${run}`, customer_id: c.id, entity: 'export', ...f });
    await recv('UA', { order_id: U.id, type: 'Advance', currency: 'USD', expected_amount: 2000, received_amount: 2000, outstanding: 0, status: 'Paid', due_date: '2092-01-20' });
    await recv('UB', { order_id: U.id, type: 'Balance', currency: 'USD', expected_amount: 8300, received_amount: 0, outstanding: 8300, status: 'Pending', due_date: '2092-04-04', fx_rate: 280 });
    await recv('KA', { order_id: K.id, type: 'Advance', currency: 'PKR', expected_amount: 1000000, received_amount: 1000000, outstanding: 0, status: 'Paid', due_date: '2092-01-20' });
    await recv('DA', { order_id: D.id, type: 'Advance', currency: 'USD', expected_amount: 500, received_amount: 500, outstanding: 0, status: 'Paid', due_date: '2092-01-20' });
    // Overdue today, one per currency (for the alerts).
    await recv('OU', { order_id: N.id, type: 'Advance', currency: 'USD', expected_amount: 700, received_amount: 0, outstanding: 700, status: 'Pending', due_date: '2020-01-01' });
    await recv('OP', { order_id: K.id, type: 'Balance', currency: 'PKR', expected_amount: 90000, received_amount: 0, outstanding: 90000, status: 'Pending', due_date: '2020-01-01' });

    // Payments in April 2092: settled USD + PKR receipts; a reversed payment,
    // an uncleared cheque and an unconfirmed receipt that are NOT cash flow.
    const pay = (suffix, f) => db('payments').insert({ payment_no: `ZZXP-${suffix}-${run}`, payment_date: '2092-04-10', ...f });
    await pay('1', { type: 'receipt', amount: 2000, currency: 'USD', base_amount_pkr: 560000, status: 'Confirmed', payment_method: 'bank_transfer' });
    await pay('2', { type: 'receipt', amount: 1000000, currency: 'PKR', base_amount_pkr: 1000000, status: 'Confirmed', payment_method: 'bank_transfer' });
    await pay('3', { type: 'payment', amount: 50000, currency: 'PKR', base_amount_pkr: 50000, status: 'Reversed', payment_method: 'cash' });
    await pay('4', { type: 'receipt', amount: 70000, currency: 'PKR', base_amount_pkr: 70000, status: 'Confirmed', payment_method: 'cheque', cleared: false });
    await pay('5', { type: 'receipt', amount: 500, currency: 'USD', base_amount_pkr: 140000, status: 'Pending Finance Confirmation', payment_method: 'bank_transfer' });

    // A USD vendor payable beside the rupee ones.
    await db('payables').insert({ pay_no: `ZZXPY-${run}`, payable_type: 'vendor', currency: 'USD', original_amount: 300, paid_amount: 0, outstanding: 300, status: 'Pending', entity: 'export' });

    // Exceptions in both currencies.
    await db('exception_inbox').insert([
      { exception_type: 'zz_test', title: `ZZ ${run} usd`, severity: 'low', status: 'Open', amount_at_risk: 100, currency: 'USD' },
      { exception_type: 'zz_test', title: `ZZ ${run} pkr`, severity: 'low', status: 'Open', amount_at_risk: 5000, currency: 'PKR' },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    // Remove what this run wrote, children first, so a re-run starts clean.
    const orderIds = (await db('export_orders').where('order_no', 'like', `ZZX-%-${run}`).select('id')).map((r) => r.id);
    if (orderIds.length) {
      for (const t of ['inventory_reservations', 'export_order_costs', 'export_debit_notes', 'printed_bag_orders', 'export_order_status_history']) {
        await db(t).whereIn('order_id', orderIds).del();
      }
    }
    await db('receivables').where('recv_no', 'like', `ZZXR-%-${run}`).del();
    await db('payments').where('payment_no', 'like', `ZZXP-%-${run}`).del();
    await db('payables').where('pay_no', `ZZXPY-${run}`).del();
    await db('exception_inbox').where('title', 'like', `ZZ ${run} %`).del();
    await db('inventory_lots').where('lot_no', `ZZX-L-${run}`).del();
    if (orderIds.length) await db('export_orders').whereIn('id', orderIds).del();
    await db.destroy();
  });

  test('EXP-09: freight + Issued debit notes are revenue, printed bags are cost (golden row)', async () => {
    const rows = await pd.exportOrderProfit(db, [ids.U, ids.K, ids.N, ids.D]);
    const U = rows.get(ids.U);
    expect(U.goodsRevenuePkr).toBe(2800000);
    expect(U.freightRevenuePkr).toBe(56000);
    expect(U.debitNoteRevenuePkr).toBe(28000);
    expect(U.debitNoteCount).toBe(1);
    expect(U.revenuePkr).toBe(2884000);
    expect(U.printedBagsCostPkr).toBe(12000);
    expect(U.opCostsPkr).toBe(42000);
    expect(U.riceCostBasis).toBe('locked');
    expect(U.bookedProfitPkr).toBe(1342000);
    expect(U.realisedProfitPkr).toBe(1342000);
    expect(U.marginPct).toBe(46.5);
    expect(U.revenueDate).toBe('2092-03-05'); // D-16: the BL date, not the Shipped day

    const K = rows.get(ids.K);
    expect(K.currency).toBe('PKR');
    expect(K.revenuePkr).toBe(5000000);
    expect(K.riceCostBasis).toBe('reserved');
    expect(K.bookedProfitPkr).toBe(2000000);
    expect(K.marginPct).toBe(40);

    const N = rows.get(ids.N);
    expect(N.priced).toBe(false);
    expect(N.revenuePkr).toBeNull(); // a USD contract with no rate is never read as rupees
    expect(rows.get(ids.D).inBookedPeriod).toBe(false);
  });

  test('the order page, the order list and Reports ▸ Orders show the same numbers', async () => {
    const page = (await pd.exportOrderProfit(db, [ids.U])).get(ids.U);
    const list = (await pd.exportOrderProfit(db, [ids.U, ids.K, ids.N])).get(ids.U);
    const { data } = await reportingService.getOrderProfitability({ dateFrom: '2092-01-01', dateTo: '2092-01-31 23:59:59', customerId: ids.customer });
    const rep = Object.fromEntries(data.map((r) => [r.id, r]));
    for (const r of [page, list]) {
      expect(r.bookedProfitPkr).toBe(rep[ids.U].grossProfit);
      expect(r.marginPct).toBe(rep[ids.U].margin);
      expect(r.revenuePkr).toBe(rep[ids.U].revenuePkr);
    }
    expect(rep[ids.K].grossProfit).toBe(2000000);
    expect(rep[ids.N].revenuePkr).toBeNull();
    expect(rep[ids.N].grossProfit).toBeNull();
    // Period totals agree with the per-order rows.
    const { rows } = await pd.exportProfit(db, { startDate: '2092-01-01', endDate: '2092-01-31' });
    expect(rows.find((r) => r.id === ids.U).bookedProfitPkr).toBe(1342000);
  });

  test('D-16: Realised and the printable P&L date export revenue by the BL date', async () => {
    const feb = await pd.exportProfit(db, { startDate: '2092-02-01', endDate: '2092-02-28' });
    const mar = await pd.exportProfit(db, { startDate: '2092-03-01', endDate: '2092-03-31' });
    expect(feb.rows.find((r) => r.id === ids.U)?.inRealisedPeriod || false).toBe(false);
    expect(mar.rows.find((r) => r.id === ids.U).inRealisedPeriod).toBe(true);
    expect(mar.totals.realisedPkr).toBe(1342000);

    const res = mockRes();
    await reportingController.printablePnl({ query: { from: '2092-03-01', to: '2092-03-31' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.revenue.exportPkr).toBe(2884000);
    expect(res.body.data.revenue.exportCount).toBe(1);
    expect(res.body.data.detail.export[0].amountPkr).toBe(2884000);
    const feb2 = mockRes();
    await reportingController.printablePnl({ query: { from: '2092-02-01', to: '2092-02-28' } }, feb2);
    expect(feb2.body.data.revenue.exportPkr).toBe(0);

    const accrual = mockRes();
    await reportingController.printablePnlAccrual({ query: { from: '2092-03-01', to: '2092-03-31' } }, accrual);
    expect(accrual.statusCode).toBe(200);
    expect(accrual.body.data.revenue.exportPkr).toBe(2884000);
  });

  test('P4-09: the order book is per currency, Draft / Cancelled excluded', async () => {
    const after = await orderBook.exportOrderBook(db, { asOf: AS_OF });
    const delta = (a, b, cur) => Math.round(((a?.[cur] || 0) - (b?.[cur] || 0)) * 100) / 100;
    expect(delta(after.orderBook.byCurrency, before.book.orderBook.byCurrency, 'USD')).toBe(11000); // U + N
    expect(delta(after.orderBook.byCurrency, before.book.orderBook.byCurrency, 'PKR')).toBe(5000000); // K
    expect(after.orderBook.count - before.book.orderBook.count).toBe(3);
    expect(after.orderBook.pkrEquiv.missingCount - before.book.orderBook.pkrEquiv.missingCount).toBe(1); // N
    // Received / outstanding from the receivables of booked orders (the Draft's is left out).
    expect(delta(after.received.byCurrency, before.book.received.byCurrency, 'USD')).toBe(2000);
    expect(delta(after.received.byCurrency, before.book.received.byCurrency, 'PKR')).toBe(1000000);
    expect(delta(after.outstanding.byCurrency, before.book.outstanding.byCurrency, 'USD')).toBe(9000); // U balance 8,300 + N advance 700
    expect(delta(after.outstanding.byCurrency, before.book.outstanding.byCurrency, 'PKR')).toBe(90000);
    // A Draft is counted in the pipeline, never valued.
    const newB = before.book.phases.find((x) => x.key === 'new');
    const newA = after.phases.find((x) => x.key === 'new');
    expect(newA.count - newB.count).toBe(2); // N + D
    expect(delta(newA.byCurrency, newB.byCurrency, 'USD')).toBe(1000);
    // The balance is overdue a term after sailing (C6), not on ETD.
    expect(after.balanceOverdue.count - before.book.balanceOverdue.count).toBe(1);
    expect(delta(after.balanceOverdue.byCurrency, before.book.balanceOverdue.byCurrency, 'USD')).toBe(8300);
  });

  test('RPT-05: the printable cash flow is settled-only, per currency', async () => {
    const res = mockRes();
    await reportingController.printableCashflow({ query: { from: '2092-04-01', to: '2092-04-30' } }, res);
    expect(res.statusCode).toBe(200);
    const s = res.body.data.summary;
    expect(s.byCurrency.USD).toMatchObject({ in: 2000, out: 0, inCount: 1 });
    expect(s.byCurrency.PKR).toMatchObject({ in: 1000000, out: 0, inCount: 1 });
    expect(s.inPkr).toBe(1000000); // rupees only — the USD receipt is not folded in
    expect(s.pendingCheques.PKR).toMatchObject({ in: 70000, count: 1 });
    const usdLine = res.body.data.topReceipts.find((r) => r.currency === 'USD');
    expect(usdLine.amount).toBe(2000);
    expect(usdLine.amountPkr).toBeNull();
  });

  test('PLT-12: finance alerts give each currency its own amount', async () => {
    const res = mockRes();
    await financeController.getAlerts({ query: {} }, res);
    const a = res.body.data.alerts.find((x) => x.id === 'overdue_receivables');
    expect(a.totals.USD).toBeGreaterThanOrEqual(700);
    expect(a.totals.PKR).toBeGreaterThanOrEqual(90000);
    expect(a.total).toBeNull();
    expect(a.message).toMatch(/USD [\d,]+\.\d\d/);
    expect(a.message).toMatch(/Rs [\d,]+\.\d\d/);
  });

  test('RPT-08 / RPT-09: exceptions and payables are per currency', async () => {
    const exc = await intelligenceService.getExceptionStats();
    expect((exc.amountAtRiskByCurrency.USD || 0) - (before.exc.amountAtRiskByCurrency?.USD || 0)).toBe(100);
    expect((exc.amountAtRiskByCurrency.PKR || 0) - (before.exc.amountAtRiskByCurrency?.PKR || 0)).toBe(5000);
    expect(exc.totalAmountAtRisk).toBeNull();

    const summary = await financeService.getOverviewSummary({});
    const usdBefore = before.summary.payables.byCurrency?.USD?.outstanding || 0;
    expect(summary.payables.byCurrency.USD.outstanding - usdBefore).toBe(300);
    expect(summary.payables.totalOutstandingPkr).toBe(before.summary.payables.totalOutstandingPkr);
    expect(summary.export.revenueByCurrency).toBeDefined();
  });

  test('profit and receivable money stay hidden from a role without the profit permission', async () => {
    const exportCtl = require('../modules/exportOrders/exportOrders.controller');
    const docRole = await db('roles').where({ name: 'Documentation Officer' }).first();
    const admin = await db('roles').where({ name: 'Super Admin' }).first();
    const asRole = (roleId) => ({ user: { id: ids.user, role_id: roleId }, query: { search: `ZZX-U-${run}` }, params: { id: String(ids.U) } });

    const blind = mockRes();
    await orderBook.orderBookHandler(asRole(docRole.id), blind);
    expect(blind.body.data.orderBook).toBeTruthy(); // contract values, as on the order list
    expect(blind.body.data.received).toBeNull();
    expect(blind.body.data.outstanding).toBeNull();
    const seen = mockRes();
    await orderBook.orderBookHandler(asRole(admin.id), seen);
    expect(seen.body.data.received.byCurrency).toBeTruthy();

    const listBlind = mockRes();
    await exportCtl.list(asRole(docRole.id), listBlind);
    expect(listBlind.body.data.orders[0].profit).toBeNull();
    const listSeen = mockRes();
    await exportCtl.list(asRole(admin.id), listSeen);
    expect(listSeen.body.data.orders[0].profit.bookedProfitPkr).toBe(1342000);
    const page = mockRes();
    await exportCtl.getById(asRole(admin.id), page);
    expect(page.body.data.profit.marginPct).toBe(listSeen.body.data.orders[0].profit.marginPct);
  });

  test('the create-form preview runs the same definition', async () => {
    const row = await pd.previewExportProfit(db, {
      currency: 'USD', booked_fx_rate: 280, contract_value: 10000,
      items: [{ product_id: ids.product, qty_mt: 10 }],
      freight_display: 'separate', freight_per_mt: 20, printed_bags_pkr: 12000,
    });
    expect(row.revenuePkr).toBe(2856000); // goods 2,800,000 + freight 56,000
    expect(row.printedBagsCostPkr).toBe(12000);
    expect(row.inBookedPeriod).toBe(false);
  });
});
