/**
 * Reports hub contract (P4-05 / P4-12 / P4-14) — DB-gated, through the real
 * /api/reporting and /api/accounting routers (Joi contract middleware, RBAC,
 * redaction), against a fully migrated Postgres.
 *
 * Every row is dated in 2096 so nothing else in the database reaches the
 * figures asserted here. Skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

const IN = '2096-03-15';
const OUT = '2096-07-15';

d('reports hub contract (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const N_SALES = 130; // more than one page (100) of confirmed sales in March

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    const express = require('express');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-hub-${run}@test.local`, full_name: `ZZ Hub ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids.user = u.id;
    app = express();
    app.use((req, res, next) => { req.user = { id: u.id, role_id: role.id, _roleName: 'Super Admin' }; next(); });
    app.use('/api/reporting', require('../modules/analytics/reporting.routes'));
    app.use('/api/accounting', require('../modules/accounting/accounting.routes'));

    const [p] = await db('products').insert({ name: `ZZ Hub Rice ${run}` }).returning('*');
    const [c1] = await db('customers').insert({ name: `ZZ Hub Buyer A ${run}`, country: 'UAE' }).returning('*');
    const [c2] = await db('customers').insert({ name: `ZZ Hub Buyer B ${run}`, country: 'Kenya' }).returning('*');
    Object.assign(ids, { product: p.id, c1: c1.id, c2: c2.id });

    const order = async (suffix, fields) => (await db('export_orders').insert({
      order_no: `ZH-${suffix}-${run}`, created_by: u.id, product_id: p.id, status: 'Shipped',
      cost_locked_at_dispatch: true, ...fields,
    }).returning('*'))[0];
    // In March: A (USD, buyer A, UAE) and B (PKR, buyer B, Kenya), both costed.
    ids.A = (await order('A', { customer_id: c1.id, country: 'UAE', currency: 'USD', booked_fx_rate: 280, qty_mt: 10, contract_value: 10000, contract_value_pkr_locked: 2800000, inventory_cogs_total_pkr: 2000000, created_at: `${IN} 10:00` })).id;
    ids.B = (await order('B', { customer_id: c2.id, country: 'Kenya', currency: 'PKR', qty_mt: 5, contract_value: 1500000, contract_value_pkr_locked: 1500000, inventory_cogs_total_pkr: 1000000, created_at: `${IN} 11:00` })).id;
    // In July (outside the period) and a Draft in March (never business).
    ids.C = (await order('C', { customer_id: c1.id, country: 'UAE', currency: 'USD', booked_fx_rate: 280, qty_mt: 1, contract_value: 999, contract_value_pkr_locked: 279720, inventory_cogs_total_pkr: 100000, created_at: `${OUT} 10:00` })).id;
    ids.D = (await order('D', { customer_id: c1.id, country: 'UAE', currency: 'USD', status: 'Draft', cost_locked_at_dispatch: false, booked_fx_rate: 280, qty_mt: 1, contract_value: 777, contract_value_pkr_locked: 217560, inventory_cogs_total_pkr: 0, created_at: `${IN} 12:00` })).id;

    // Local sales: N confirmed lines in March (1,000 each, COGS 600), one
    // Pending and one Cancelled (never revenue), one uncosted lot line.
    const [w] = await db('warehouses').insert({ name: `ZZ Hub WH ${run}`, type: 'finished' }).returning('*');
    const [lot] = await db('inventory_lots').insert({ lot_no: `ZH-LOT-${run}`, item_name: 'ZZ', type: 'finished', entity: 'mill', product_id: p.id, warehouse_id: w.id, unit: 'kg', qty: 0, landed_cost_per_kg: 0, created_at: `${IN} 08:00` }).returning('*');
    const sale = (i, o) => ({
      sale_no: `ZH-${run}-${String(i).padStart(4, '0')}`, sale_date: IN, entity: 'mill', item_name: 'ZZ Hub rice',
      quantity_input: 10, quantity_kg: 10, rate_input: 100, rate_per_kg: 100, total_amount: 1000,
      paid_amount: 1000, due_amount: 0, status: 'Completed', cogs_total_pkr: 600, buyer_name: `ZZ walk-in ${run}`, ...o,
    });
    const rows = [];
    for (let i = 0; i < N_SALES; i += 1) rows.push(sale(i));
    rows.push(sale(9001, { status: 'Pending', total_amount: 50000 }));
    rows.push(sale(9002, { status: 'Cancelled', total_amount: 70000 }));
    rows.push(sale(9003, { lot_id: lot.id, lot_no: lot.lot_no, cogs_total_pkr: null, landed_cost_total: 0, total_amount: 4000, paid_amount: 0, due_amount: 4000 }));
    rows.push(sale(9004, { sale_date: '2096-07-01', total_amount: 88888 }));
    for (let i = 0; i < rows.length; i += 50) await db('local_sales').insert(rows.slice(i, i + 50));

    // Production: one mill, two completed batches in March (weighted yield).
    const [mill] = await db('mills').insert({ name: `ZZ Hub Mill ${run}`, capacity_mt_per_day: 10 }).returning('*');
    ids.mill = mill.id;
    const batch = (no, raw, fin, at) => ({ batch_no: `ZH${no}${run}`.slice(0, 20), mill_id: mill.id, created_by: u.id, status: 'Completed', raw_qty_kg: raw, actual_finished_kg: fin, yield_pct: Math.round((fin / raw) * 1000) / 10, created_at: at });
    await db('milling_batches').insert([batch('1', 1000, 500, `${IN} 09:00`), batch('2', 9000, 6300, `${IN} 09:30`)]);

    // Exceptions: one open warning (USD), one resolved today.
    await db('exception_inbox').insert([
      { exception_type: 'zz_hub', severity: 'warning', title: `ZZ ${run} open`, status: 'Open', amount_at_risk: 100, currency: 'USD' },
      { exception_type: 'zz_hub', severity: 'critical', title: `ZZ ${run} done`, status: 'Resolved', resolved_at: new Date() },
    ]);
  });

  afterAll(async () => {
    // Best-effort cleanup (a throwaway DB; rows are 2096-dated and ZZ-tagged).
    const steps = [
      () => db('exception_inbox').where('title', 'like', `ZZ ${run}%`).del(),
      () => db('milling_batches').where('mill_id', ids.mill || 0).del(),
      () => db('mills').where('id', ids.mill || 0).del(),
      () => db('local_sales').where('sale_no', 'like', `ZH-${run}-%`).del(),
      () => db('inventory_lots').where('lot_no', `ZH-LOT-${run}`).del(),
      () => db('warehouses').where('name', `ZZ Hub WH ${run}`).del(),
      () => db('export_order_status_history').whereIn('order_id', db('export_orders').select('id').where('order_no', 'like', `ZH-%-${run}`)).del(),
      () => db('export_orders').where('order_no', 'like', `ZH-%-${run}`).del(),
      () => db('customers').whereIn('id', [ids.c1 || 0, ids.c2 || 0]).del(),
      () => db('products').where('id', ids.product || 0).del(),
    ];
    for (const s of steps) { try { await s(); } catch (e) { /* leave it in the throwaway DB */ } }
    await db.destroy();
  });

  const MARCH = { from_date: '2096-03-01', to_date: '2096-03-31' };
  const get = (path, query) => request(app).get(path).query(query || {});

  test('Joi contract: a bad date is a 400, not a silent all-time report', async () => {
    const res = await get('/api/reporting/profitability/customers', { from_date: '2096-13-01' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('from_date');
  });

  test('customers: period honoured, real field names, PKR and USD never added (RPT-02/03)', async () => {
    const res = await get('/api/reporting/profitability/customers', MARCH);
    expect(res.status).toBe(200);
    const mine = res.body.data.filter((r) => [ids.c1, ids.c2].includes(r.customerId));
    const a = mine.find((r) => r.customerId === ids.c1);
    const b = mine.find((r) => r.customerId === ids.c2);
    // Buyer A: only order A (C is July, D is Draft).
    expect(a).toMatchObject({ orderCount: 1, revenuePkr: 2800000, bookedProfitPkr: 800000, contractByCurrency: { USD: 10000 } });
    expect(a.marginPct).toBeCloseTo(28.57, 2);
    expect(b).toMatchObject({ orderCount: 1, revenuePkr: 1500000, bookedProfitPkr: 500000, contractByCurrency: { PKR: 1500000 } });
    expect(res.body.totals).toBeDefined();
    expect(res.body.pagination.truncated).toBe(false);
    expect(res.body.meta).toMatchObject({ from: '2096-03-01', to: '2096-03-31', currency: expect.stringContaining('PKR') });

    // Same endpoint, the old alias names: same answer.
    const alias = await get('/api/reporting/profitability/customers', { dateFrom: '2096-03-01', dateTo: '2096-03-31' });
    expect(alias.body.data.find((r) => r.customerId === ids.c1).orderCount).toBe(1);
    // July only: buyer A has order C, buyer B nothing.
    const july = await get('/api/reporting/profitability/customers', { from_date: '2096-07-01', to_date: '2096-07-31' });
    expect(july.body.data.find((r) => r.customerId === ids.c1).orderCount).toBe(1);
    expect(july.body.data.find((r) => r.customerId === ids.c2)).toBeUndefined();
  });

  test('countries: non-zero, per-currency average price (no NaN)', async () => {
    const res = await get('/api/reporting/profitability/countries', MARCH);
    const uae = res.body.data.find((r) => r.country === 'UAE');
    const ken = res.body.data.find((r) => r.country === 'Kenya');
    expect(uae.orderCount).toBeGreaterThanOrEqual(1);
    expect(uae.avgPricePerMtByCurrency.USD).toBe(1000);
    expect(ken.avgPricePerMtByCurrency.PKR).toBe(300000);
    expect(ken.revenuePkr).toBeGreaterThanOrEqual(1500000);
  });

  test('orders: period honoured, Draft excluded, pagination flag', async () => {
    const res = await get('/api/reporting/profitability/orders', { ...MARCH, limit: 1 });
    const nos = res.body.data.map((o) => o.orderNo);
    expect(nos.some((n) => n === `ZH-D-${run}`)).toBe(false);
    expect(res.body.pagination.returned).toBe(1);
    expect(res.body.pagination.truncated).toBe(res.body.pagination.total > 1);
    const all = await get('/api/reporting/profitability/orders', { ...MARCH, limit: 500 });
    const mine = all.body.data.filter((o) => o.orderNo.endsWith(`-${run}`)).map((o) => o.orderNo).sort();
    expect(mine).toEqual([`ZH-A-${run}`, `ZH-B-${run}`]);
  });

  test('local sales: Completed + period only, totals = SQL sum over all rows, truncated page (P4-12)', async () => {
    const q = { ...MARCH, q: `ZZ walk-in ${run}` };
    const res = await get('/api/reporting/local-sales', q);
    expect(res.status).toBe(200);
    const { rows, totals, pagination } = res.body.data;
    expect(rows).toHaveLength(100);
    expect(pagination).toMatchObject({ total: N_SALES + 1, returned: 100, truncated: true });
    const sql = await db('local_sales').where('sale_no', 'like', `ZH-${run}-%`).where('status', 'Completed')
      .whereBetween('sale_date', ['2096-03-01', '2096-03-31']).sum('total_amount as s').first();
    expect(totals.revenue).toBe(parseFloat(sql.s));
    expect(totals.revenue).toBe(N_SALES * 1000 + 4000);
    // The uncosted lot line is in revenue, NOT in profit / margin.
    expect(totals).toMatchObject({ uncostedCount: 1, uncostedRevenue: 4000, costedRevenue: N_SALES * 1000, cogs: N_SALES * 600, grossProfit: N_SALES * 400, marginPct: 40, outstanding: 4000 });
    // Page 2 holds the rest.
    const p2 = await get('/api/reporting/local-sales', { ...q, page: 2 });
    expect(p2.body.data.rows).toHaveLength(N_SALES + 1 - 100);
  });

  test('local sales CSV export = every matching row, not one page (P4-14)', async () => {
    const res = await get('/api/reporting/local-sales', { ...MARCH, q: `ZZ walk-in ${run}`, format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['x-row-count']).toBe(String(N_SALES + 1));
    const text = res.text.replace(/^﻿/, '');
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(N_SALES + 2); // header + rows
    expect(lines[0]).toMatch(/^Sale No,Date,Buyer/);
  });

  test('production: KG fields, weighted yield, utilisation is a single percentage (RPT-24)', async () => {
    const res = await get('/api/reporting/production/mill-efficiency', MARCH);
    const m = res.body.data.find((r) => r.millId === ids.mill);
    expect(m.totalInputKg).toBe(10000);
    expect(m.totalOutputKg).toBe(6800);
    expect(m.avgYield).toBe(68); // Σ out ÷ Σ in, not the mean of 50% and 70%
    // 10 MT over 31 days at 10 MT/day capacity = 3.2%.
    expect(m.utilizationDays).toBe(31);
    expect(m.utilizationPct).toBeCloseTo(3.2, 1);
    const lb = await get('/api/reporting/quality/recovery-leaderboard', MARCH);
    const b = lb.body.data.find((r) => r.batchNo === `ZH2${run}`.slice(0, 20));
    expect(b.rawQtyKg).toBe(9000);
    expect(b.rawQtyMT).toBe(9);
  });

  test('exceptions stats carry the tile contract (RPT-18)', async () => {
    const svc = require('../modules/analytics/intelligence.service');
    const s = await svc.getExceptionStats();
    expect(s.open).toBeGreaterThanOrEqual(1);
    expect(s.warning).toBeGreaterThanOrEqual(1);
    expect(s.resolvedToday).toBeGreaterThanOrEqual(1);
    expect(s.amountAtRiskByCurrency.USD.amount).toBeGreaterThanOrEqual(100);
    expect(s.severities).toEqual(['critical', 'warning', 'info']);
  });

  test('trial balance / P&L / balance sheet export as CSV', async () => {
    for (const [path, q] of [
      ['/api/accounting/statements/trial-balance', { as_of_date: '2096-12-31' }],
      ['/api/accounting/statements/profit-loss', { period_start: '2096-01-01', period_end: '2096-12-31' }],
      ['/api/accounting/statements/balance-sheet', { as_of_date: '2096-12-31' }],
    ]) {
      const res = await get(path, { ...q, format: 'csv' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text.charCodeAt(0)).toBe(0xFEFF);
      expect(res.text).toMatch(/Section,Code,Account,Type,Debit \(PKR\),Credit \(PKR\),Amount \(PKR\)/);
    }
  });
});
