/**
 * Package C (profit & reporting rules, owner decisions C1–C6, 2026-10-09)
 * against a real, fully-migrated Postgres.
 *
 * Period figures use 2092 only, so nothing else in the database reaches them.
 * The collection rate is point-in-time over every receivable, so it is checked
 * on AED rows (no other test writes AED) and as deltas.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_test_C -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55461:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55461 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest profitReportingRules.integration
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

const PERIOD = { startDate: '2092-01-01', endDate: '2092-12-31 23:59:59.999' };

d('package C rules (DB-gated)', () => {
  let db; let pd; let financeService; let accountingService; let coll; let due;
  const run = `${Date.now()}`.slice(-7);
  const ids = { orders: [], journals: [], recv: [], rates: [], biz: [], legacy: [] };

  beforeAll(async () => {
    db = require('../config/database');
    pd = require('../modules/finance/profitDefinitions');
    financeService = require('../modules/finance/finance.service');
    accountingService = require('../modules/accounting/accounting.service');
    coll = require('../modules/finance/collectionRate');
    due = require('../modules/exportOrders/balanceDueDate');

    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-pkgc-${run}@test.local`, full_name: `ZZ PkgC ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ PkgC Buyer ${run}` }).returning('*');
    const product = async (n) => (await db('products').insert({ name: `ZZ C ${n} ${run}` }).returning('*'))[0].id;
    Object.assign(ids, { user: u.id, customer: c.id, pMT: await product('PerMT'), pKG: await product('PerKG'), pNone: await product('NoRate'), pShip: await product('Ship') });

    // C2 — rate master: per MT (and a newer, future-dated one that must be
    // ignored), per KG, and the order's own currency (USD per MT).
    const rate = async (fields) => ids.rates.push((await db('commodity_rate_master').insert({
      rate_type: 'finished_rice', rate_currency: 'PKR', is_locked: false, effective_date: '2026-01-01', ...fields,
    }).returning('*'))[0].id);
    await rate({ product_id: ids.pMT, unit: 'per_mt', rate_value: 120000 });
    await rate({ product_id: ids.pMT, unit: 'per_mt', rate_value: 999999, effective_date: '2999-01-01' });
    await rate({ product_id: ids.pKG, unit: 'per_kg', rate_value: 150 });

    const order = async (suffix, fields) => {
      const [o] = await db('export_orders').insert({
        order_no: `ZZC-${suffix}-${run}`, customer_id: c.id, created_by: u.id, currency: 'USD',
        booked_fx_rate: 280, created_at: '2092-03-01 09:00', status: 'Advance Received', ...fields,
      }).returning('*');
      ids.orders.push(o.id);
      return o;
    };
    // R1: 10 MT of pMT, no stock / reservation → 10,000 kg × 120 = 1,200,000.
    ids.R1 = (await order('R1', { product_id: ids.pMT, qty_mt: 10, contract_value: 10000, contract_value_pkr_locked: 2800000 })).id;
    // R2: 2 MT of pKG → 2,000 × 150 = 300,000.
    ids.R2 = (await order('R2', { product_id: ids.pKG, qty_mt: 2, contract_value: 2000, contract_value_pkr_locked: 560000 })).id;
    // R3: no rate anywhere → unpriced, excluded, counted.
    ids.R3 = (await order('R3', { product_id: ids.pNone, qty_mt: 1, contract_value: 1000, contract_value_pkr_locked: 280000 })).id;

    // C4 — S1: ordered 2091, SHIPPED 2092-01-10 (status history) → realised in
    // 2092, not booked in 2092. COGS locked 1,000,000 → 2,800,000 − 1,000,000.
    const S1 = await order('S1', {
      status: 'Shipped', created_at: '2091-12-20 09:00', product_id: ids.pShip, qty_mt: 10, contract_value: 10000,
      contract_value_pkr_locked: 2800000, inventory_cogs_total_pkr: 1000000, cost_locked_at_dispatch: true, atd: '2091-12-28',
    });
    await db('export_order_status_history').insert({ order_id: S1.id, from_status: 'Ready to Ship', to_status: 'Shipped', created_at: '2092-01-10 12:00' });
    ids.S1 = S1.id;
    // S2: ordered 2092, shipped 2093 (atd) → booked in 2092, realised in 2093,
    // and not in 2092's pipeline (it is realised).
    ids.S2 = (await order('S2', {
      status: 'Shipped', product_id: ids.pShip, qty_mt: 1, contract_value: 1000, contract_value_pkr_locked: 280000,
      inventory_cogs_total_pkr: 100000, cost_locked_at_dispatch: true, atd: '2093-01-05',
    })).id;

    // C3 — overheads in 2092: a mill expense with no batch (deducted), one tied
    // to a batch (already in that batch's cost — not deducted), a legacy one.
    const [mill] = await db('mills').insert({ name: `ZZ C Mill ${run}` }).returning('*').catch(async () => [await db('mills').first()]);
    const [batch] = await db('milling_batches').insert({
      batch_no: `ZZC-B-${run}`, status: 'Completed', created_by: u.id, mill_id: mill ? mill.id : null, raw_qty_kg: 1, completed_at: '2091-01-01',
    }).returning('*');
    ids.batch = batch.id;
    const biz = async (suffix, fields) => ids.biz.push((await db('business_expenses').insert({
      expense_no: `ZZC-E-${suffix}-${run}`, expense_type: 'mill', category: 'utilities', currency: 'PKR',
      expense_date: '2092-04-01', payment_status: 'Paid', ...fields,
    }).returning('*'))[0].id);
    await biz('OH', { amount: 25000, amount_pkr: 25000 });
    await biz('BATCH', { amount: 7000, amount_pkr: 7000, batch_id: batch.id });
    ids.legacy.push((await db('mill_expenses').insert({ category: 'rent', amount: 5000, currency: 'PKR', expense_date: '2092-05-01' }).returning('*'))[0].id);

    // C1 — the books in 2092: Rs 50,000 revenue, Rs 10,000 expense (Posted),
    // and a Draft that must not count.
    const acct = async (code) => (await db('chart_of_accounts').where({ code }).first()).id;
    const [cash, rev, exp] = [await acct('1000'), await acct('4000'), await acct('6000')];
    const journal = async (suffix, status, lines) => {
      const total = lines.reduce((s, l) => s + (l.debit || 0), 0);
      const [je] = await db('journal_entries').insert({
        journal_no: `ZZC-J-${suffix}-${run}`, date: '2092-06-01', status, currency: 'PKR', total_debit: total, total_credit: total,
      }).returning('*');
      ids.journals.push(je.id);
      await db('journal_lines').insert(lines.map((l) => ({ journal_id: je.id, account: String(l.account_id), debit: 0, credit: 0, ...l })));
    };
    await journal('REV', 'Posted', [{ account_id: cash, debit: 50000 }, { account_id: rev, credit: 50000 }]);
    await journal('EXP', 'Posted', [{ account_id: exp, debit: 10000 }, { account_id: cash, credit: 10000 }]);
    await journal('DRAFT', 'Draft', [{ account_id: exp, debit: 99999 }, { account_id: cash, credit: 99999 }]);
  });

  afterAll(async () => {
    if (!db) return;
    try { await cleanup(); } finally { await db.destroy(); }
  });

  async function cleanup() {
    await db('receivables').whereIn('id', ids.recv).del();
    await db('journal_lines').whereIn('journal_id', ids.journals).del();
    await db('journal_entries').whereIn('id', ids.journals).del();
    await db('business_expenses').whereIn('id', ids.biz).del();
    await db('mill_expenses').whereIn('id', ids.legacy).del();
    await db('export_order_status_history').whereIn('order_id', ids.orders).del();
    await db('receivables').whereIn('order_id', ids.orders).del();
    await db('export_orders').whereIn('id', ids.orders).del();
    if (ids.batch) await db('milling_batches').where({ id: ids.batch }).del();
    await db('commodity_rate_master').whereIn('id', ids.rates).del();
  }

  test('C2: unpriced orders take the commodity rate master (per MT ÷ 1000, per KG as is), flagged', async () => {
    const { rows, totals } = await pd.exportProfit(db, PERIOD);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[ids.R1]).toMatchObject({ riceCostBasis: 'rate_master', estimated: true, riceCostPkr: 1200000, bookedProfitPkr: 1600000 });
    expect(byId[ids.R2]).toMatchObject({ riceCostBasis: 'rate_master', estimated: true, riceCostPkr: 300000, bookedProfitPkr: 260000 });
    expect(byId[ids.R3]).toMatchObject({ riceCostBasis: 'unpriced', priced: false });
    expect(totals).toMatchObject({ rateMasterCount: 2, unpricedCount: 1, unpricedRevenuePkr: 280000 });
  });

  test('C4: Realised by shipment date, Booked by order date, Pipeline per order', async () => {
    const { rows, totals } = await pd.exportProfit(db, PERIOD);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // S1 is in 2092 only as a shipment (status history beats atd).
    expect(byId[ids.S1]).toMatchObject({ shippedOn: '2092-01-10', inBookedPeriod: false, inRealisedPeriod: true, realisedProfitPkr: 1800000 });
    // S2 is booked in 2092 and ships in 2093.
    expect(byId[ids.S2]).toMatchObject({ shippedOn: '2093-01-05', inBookedPeriod: true, inRealisedPeriod: false });

    expect(totals.bookedPkr).toBe(1600000 + 260000 + 180000);
    expect(totals.realisedPkr).toBe(1800000);
    expect(totals.realisedCount).toBe(1);
    // Booked orders not yet realised: R1 + R2 (S2 has shipped).
    expect(totals.pipelinePkr).toBe(1600000 + 260000);
    expect(totals.pipelineCount).toBe(2);
    expect(totals.orderCount).toBe(4); // R1 R2 R3 S2

    const next = await pd.exportProfit(db, { startDate: '2093-01-01', endDate: '2093-12-31' });
    expect(next.totals.realisedPkr).toBe(180000);
    expect(next.totals.bookedPkr).toBe(0);
  });

  test('C3: mill profit is net of the period overheads not tied to a batch', async () => {
    const { mill } = await pd.millAndLocalProfit(db, PERIOD);
    expect(mill).toMatchObject({
      grossProfitPkr: 0, overheadsPkr: 25000 + 5000, profitPkr: -30000, netProfitPkr: -30000,
      overheadCount: 2, overheadsBatchLinkedPkr: 7000, overheadsDeducted: true,
    });
    const overview = await financeService.getOverviewSummary(PERIOD);
    expect(overview.mill).toMatchObject({ grossProfit: 0, overheads: 30000, netProfit: -30000, overheadsDeducted: true });
  });

  test('C1: the headline is the GL P&L net profit (Posted only), operational figures beside it', async () => {
    const pl = await accountingService.getProfitAndLoss({ periodStart: '2092-01-01', periodEnd: '2092-12-31' });
    const books = await pd.booksProfit(PERIOD);
    expect(books).toMatchObject({ basis: 'gl_posted', netProfitPkr: 40000, revenuePkr: 50000, expensesPkr: 10000 });
    expect(books.netProfitPkr).toBe(pl.net_profit);
    const overview = await financeService.getOverviewSummary(PERIOD);
    expect(overview.books.netProfitPkr).toBe(40000);
    // Operational stays separate and unchanged by the books.
    expect(overview.consolidated.bookedPkr).toBe(overview.export.bookedProfitPkr + overview.mill.netProfit + overview.local.grossProfit);
  });

  test('C6: balance due = BL date + term; collection = received ÷ due, target from settings', async () => {
    // Settings seeded by migration 323.
    const settings = Object.fromEntries((await db('system_settings').whereIn('key', ['collection_target_pct', 'export_balance_term_days'])).map((r) => [r.key, r.value]));
    expect(settings).toEqual({ collection_target_pct: '95', export_balance_term_days: '30' });

    // B1 sailed (bl_date 2020-01-01, 45-day term) → due 2020-02-15, past.
    const B1 = (await db('export_orders').insert({
      order_no: `ZZC-B1-${run}`, customer_id: ids.customer, created_by: ids.user, currency: 'USD', status: 'Shipped',
      booked_fx_rate: 280, created_at: '2019-12-01', bl_date: '2020-01-01', balance_term_days: 45, product_id: ids.pShip,
    }).returning('*'))[0];
    // B2 has not sailed: its placeholder due_date is in the past but it is NOT due.
    const B2 = (await db('export_orders').insert({
      order_no: `ZZC-B2-${run}`, customer_id: ids.customer, created_by: ids.user, currency: 'USD', status: 'Advance Received',
      booked_fx_rate: 280, created_at: '2019-12-01', product_id: ids.pShip,
    }).returning('*'))[0];
    ids.orders.push(B1.id, B2.id);

    const before = await coll.collectionRate(db);
    expect(before.byCurrency.AED).toBeUndefined();

    const recv = async (fields) => ids.recv.push((await db('receivables').insert({
      recv_no: `ZZC-R-${Math.random().toString(36).slice(2, 8)}-${run}`, entity: 'export', customer_id: ids.customer,
      currency: 'AED', status: 'Pending', aging: 0, base_amount_pkr: 0, ...fields,
    }).returning('*'))[0].id);
    await recv({ order_id: B1.id, type: 'Balance', expected_amount: 1000, received_amount: 400, outstanding: 600, due_date: '2099-01-01' });
    await recv({ order_id: B2.id, type: 'Balance', expected_amount: 5000, received_amount: 0, outstanding: 5000, due_date: '2020-01-01' });
    await recv({ order_id: B2.id, type: 'Advance', expected_amount: 1000, received_amount: 1000, outstanding: 0, due_date: '2020-01-01', status: 'Paid' });
    await recv({ order_id: B2.id, type: 'Advance', expected_amount: 3000, received_amount: 0, outstanding: 3000, due_date: '2099-01-01' });

    const after = await coll.collectionRate(db);
    // Due: B1 balance (1,000, 400 received) + the paid advance (1,000) → 1,400 / 2,000.
    expect(after.byCurrency.AED).toMatchObject({
      dueAmount: 2000, receivedAmount: 1400, ratePct: 70, targetPct: 95, onTarget: false, overdueAmount: 600, overdueCount: 1,
    });
    expect(after.notYetDue.AED).toBe(5000 + 3000);

    // The stored due date follows the BL date + term once synced.
    expect(await due.syncBalanceDueDate(db, B1.id)).toBe('2020-02-15');
    const row = await db('receivables').where({ order_id: B1.id, type: 'Balance' }).first();
    expect(due.dayOf(row.due_date)).toBe('2020-02-15');
    expect(await due.syncBalanceDueDate(db, B2.id)).toBeNull();

    // Editing the order's BL date / term re-dates the balance (controller wiring).
    const controller = require('../modules/exportOrders/exportOrders.controller');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await controller.update({ params: { id: String(B1.id) }, body: { bl_date: '2020-03-01', balance_term_days: 10 }, user: { id: ids.user } }, res);
    expect(res.statusCode).toBe(200);
    const redated = await db('receivables').where({ order_id: B1.id, type: 'Balance' }).first();
    expect(due.dayOf(redated.due_date)).toBe('2020-03-11');

    // A per-currency target overrides the default.
    await db('system_settings').insert({ key: 'collection_target_pct_AED', value: '60', category: 'finance' });
    try {
      const tuned = await coll.collectionRate(db);
      expect(tuned.byCurrency.AED).toMatchObject({ targetPct: 60, onTarget: true });
    } finally {
      await db('system_settings').where({ key: 'collection_target_pct_AED' }).del();
    }

    // Overview carries the same figures.
    const overview = await financeService.getOverviewSummary(PERIOD);
    expect(overview.collectionRateByCurrency.AED).toBe(70);
    expect(overview.collection.byCurrency.AED.overdueAmount).toBe(600);
  });

  test('C5: receivables carry a PKR equivalent at each row\'s booked rate, apart from the native figures', async () => {
    const before = await financeService.getOverviewSummary(PERIOD);
    const [r] = await db('receivables').insert({
      recv_no: `ZZC-EQ-${run}`, entity: 'export', customer_id: ids.customer, type: 'Balance', currency: 'GBP', status: 'Partial',
      expected_amount: 1000, received_amount: 250, outstanding: 750, base_amount_pkr: 360000, fx_rate: 360, aging: 0, due_date: '2099-01-01',
    }).returning('*');
    ids.recv.push(r.id);
    const after = await financeService.getOverviewSummary(PERIOD);
    // 360,000 booked × 750 / 1,000 outstanding share.
    expect(Math.round((after.receivables.pkrEquiv.pkr - before.receivables.pkrEquiv.pkr) * 100) / 100).toBe(270000);
    expect(after.receivables.pkrEquiv.basis).toBe('booked');
    // The native figure stays in its own currency.
    expect(after.receivables.byCurrency.GBP.outstanding - ((before.receivables.byCurrency.GBP || {}).outstanding || 0)).toBe(750);
    expect(after.cashPosition.pkrEquiv.basis).toBe('today');
  });
});
