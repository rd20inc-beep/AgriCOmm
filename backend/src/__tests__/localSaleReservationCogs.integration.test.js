/**
 * P3-12 (INV-60 / INV-52 / INV-54): local-sale soft reservation, server-side
 * cost check and one locked COGS — end to end over HTTP against a real,
 * migrated Postgres.
 *
 *   - a cost-blind role (Inventory Officer) sees has_cost on the lot list
 *     (cost figures redacted) and can enter a sale;
 *   - a Pending sale holds its kilos: a later entry / edit / auto-confirmed
 *     sale cannot take them; rejecting releases them; the lot list shows them;
 *   - confirmation serves older pending sales first;
 *   - confirmation re-prices at the lot's cost then; the COGS journal, the
 *     sale line and cogs_total_pkr carry the same figure (GL = report);
 *   - the legacy-drift detector / corrector align cogs_total_pkr with the GL.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('local-sale reservation + locked COGS (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who))
    .set('Idempotency-Key', `ls-res-${Math.random()}`).send(body);
  const put = (who, url, body) => request(app).put(url).set(auth(who))
    .set('Idempotency-Key', `ls-res-${Math.random()}`).send(body);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['mm', 'Mill Manager'], ['clerk', 'Inventory Officer']]) {
      const [u] = await db('users').insert({
        email: `zz-p312-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const [wh] = await db('warehouses').insert({ name: `ZZ P312 WH ${run}`, entity: 'mill', type: 'finished' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ P312 Rice ${run}` }).returning('*');
    const [cust] = await db('customers').insert({ name: `ZZ P312 Local ${run}`, customer_type: 'local', currency: 'PKR', phone: `0301${run}` }).returning('*');
    Object.assign(ids, { wh: wh.id, product: p.id, cust: cust.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const newLot = async (over = {}) => (await db('inventory_lots').insert({
    lot_no: `ZZ312-${run}-${Math.random().toString(36).slice(2, 7)}`, item_name: 'ZZ Rice', type: 'finished', entity: 'mill',
    product_id: ids.product, warehouse_id: ids.wh, qty: 10000, available_qty: 10000, net_weight_kg: 10000, unit: 'KG',
    cost_per_unit: 100, landed_cost_per_kg: 100, rate_per_kg: 100, status: 'Available', ...over,
  }).returning('*'))[0];
  // A credit sale to a registered customer — no cash account needed.
  const sale = (who, lot, kg, extra = {}) => post(who, '/api/local-sales', {
    customer_id: ids.cust, payment_mode: 'credit',
    items: [{ lot_id: lot.id, item_name: 'ZZ Rice', quantity_input: kg, quantity_unit: 'kg', rate_input: 150, rate_unit: 'kg' }],
    ...extra,
  });
  const glCogs = async (saleNo) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': saleNo, 'je.ref_type': 'Local Sale COGS', 'je.status': 'Posted', 'c.code': '5000' })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return r.n;
  };

  test('a cost-blind role gets has_cost (no cost figures) and can enter a sale', async () => {
    const lot = await newLot();
    const list = await request(app).get('/api/lot-inventory/lots').query({ search: lot.lot_no }).set(auth('clerk'));
    expect(list.status).toBe(200);
    const row = list.body.data.lots.find((l) => l.id === lot.id);
    expect(row.has_cost).toBe(true);
    expect(row.landed_cost_per_kg).toBeNull(); // redacted for the role
    const r = await sale('clerk', lot, 100);
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('Pending');

    const uncosted = await newLot({ cost_per_unit: 0, landed_cost_per_kg: 0, rate_per_kg: 0 });
    const l2 = await request(app).get('/api/lot-inventory/lots').query({ search: uncosted.lot_no }).set(auth('clerk'));
    expect(l2.body.data.lots.find((l) => l.id === uncosted.id).has_cost).toBe(false);
    const refused = await sale('clerk', uncosted, 100);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/no recorded cost/);
  });

  test('a pending sale holds its kilos against later sales; rejecting releases them', async () => {
    const lot = await newLot();
    const a = await sale('clerk', lot, 6000);
    expect(a.status).toBe(201);
    // 10,000 available − 6,000 held = 4,000 free.
    const over = await sale('clerk', lot, 5000);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/held by sales awaiting confirmation/);
    const b = await sale('clerk', lot, 4000);
    expect(b.status).toBe(201);
    // A Mill Manager's auto-confirmed sale cannot take held kilos either.
    const mm = await sale('mm', lot, 1000);
    expect(mm.status).toBe(400);
    // The lot list shows what is held.
    const list = await request(app).get('/api/lot-inventory/lots').query({ search: lot.lot_no }).set(auth('clerk'));
    expect(Number(list.body.data.lots.find((l) => l.id === lot.id).pending_sale_kg)).toBe(10000);
    // An edit is held to the same rule (its own kilos excluded).
    const edit = await put('clerk', `/api/local-sales/${b.body.data.sale.id}`, { quantity_input: 4500 });
    expect(edit.status).toBe(400);
    expect((await put('clerk', `/api/local-sales/${b.body.data.sale.id}`, { quantity_input: 3500 })).status).toBe(200);
    // Rejecting A frees its 6,000 kg.
    expect((await post('mm', `/api/local-sales/${a.body.data.sale.id}/reject`, { reason: 'test' })).status).toBe(200);
    const mm2 = await sale('mm', lot, 6000);
    expect(mm2.status).toBe(201);
    expect(mm2.body.data.status).toBe('Completed');
  });

  test('confirmation serves older pending sales first', async () => {
    const lot = await newLot();
    const a = await sale('clerk', lot, 6000);
    const b = await sale('clerk', lot, 4000);
    // Stock leaves by another path (milling, a transfer…) — 7,000 left.
    await db('inventory_lots').where({ id: lot.id }).update({ available_qty: 7000, qty: 7000, net_weight_kg: 7000 });
    // B (newer) cannot take what A (older) is waiting on: 7,000 − 6,000 < 4,000.
    const cb = await post('mm', `/api/local-sales/${b.body.data.sale.id}/confirm`, {});
    expect(cb.status).toBe(400);
    expect(cb.body.message).toMatch(/Insufficient/);
    const ca = await post('mm', `/api/local-sales/${a.body.data.sale.id}/confirm`, {});
    expect(ca.status).toBe(200);
    expect(Number((await db('inventory_lots').where({ id: lot.id }).first()).available_qty)).toBe(1000);
  });

  test('confirm after a cost change re-prices; GL COGS = sale line = cogs_total_pkr = report', async () => {
    const lot = await newLot();
    const r = await sale('clerk', lot, 1000);
    const id = r.body.data.sale.id;
    expect(Number(r.body.data.sale.landed_cost_total)).toBe(100000); // estimate at Rs 100/kg
    // The lot is re-costed while the sale waits.
    await db('inventory_lots').where({ id: lot.id }).update({ landed_cost_per_kg: 120, cost_per_unit: 120 });
    const c = await post('mm', `/api/local-sales/${id}/confirm`, {});
    expect(c.status).toBe(200);
    const row = await db('local_sales').where({ id }).first();
    expect(Number(row.cost_per_kg)).toBe(120);
    expect(Number(row.landed_cost_total)).toBe(120000);
    expect(Number(row.cogs_total_pkr)).toBe(120000);
    expect(Number(row.gross_profit_pkr)).toBe(150000 - 120000);
    expect(Number(row.gross_profit)).toBe(150000 - 120000);
    expect(row.cost_locked_at_dispatch).toBe(true);
    expect(await glCogs(row.sale_no)).toBe(120000);
    // The stock movement carries the same unit cost.
    const txn = await db('lot_transactions').where({ lot_id: lot.id }).orderBy('id', 'desc').first();
    expect(Number(txn.rate_per_kg)).toBe(120);
    // A later lot re-cost leaves the confirmed figure alone.
    await db('inventory_lots').where({ id: lot.id }).update({ landed_cost_per_kg: 200 });
    await db.transaction((trx) => require('../services/inventoryService').lockSaleCOGS(trx, id));
    expect(Number((await db('local_sales').where({ id }).first()).cogs_total_pkr)).toBe(120000);
    // The profit definition (P&L / reports) reads the same figure as the GL.
    const { foldMillAndLocal } = require('../modules/finance/profitDefinitions');
    const folded = foldMillAndLocal([{ ...row, lot_type: 'finished', lot_entity: 'mill', ownership: 'company' }]);
    expect(folded.mill.cogsPkr + folded.local.cogsPkr).toBe(await glCogs(row.sale_no));
  });

  test('a lot that loses its cost before confirmation is refused, nothing posted', async () => {
    const lot = await newLot();
    const r = await sale('clerk', lot, 500);
    await db('inventory_lots').where({ id: lot.id }).update({ landed_cost_per_kg: 0, cost_per_unit: 0, rate_per_kg: 0 });
    const c = await post('mm', `/api/local-sales/${r.body.data.sale.id}/confirm`, {});
    expect(c.status).toBe(400);
    const row = await db('local_sales').where({ id: r.body.data.sale.id }).first();
    expect(row.status).toBe('Pending');
    expect(await glCogs(row.sale_no)).toBe(0);
  });

  test('legacy drift: detector finds cogs_total_pkr ≠ GL; corrector aligns it (dry-run writes nothing)', async () => {
    const { detect } = require('../../scripts/detectLocalSaleCogsLock');
    const { correct } = require('../../scripts/correctLocalSaleCogsLock');
    const lot = await newLot();
    const r = await sale('mm', lot, 1000);
    expect(r.body.data.status).toBe('Completed');
    const id = r.body.data.sale.id;
    expect((await detect(db)).mismatch).not.toContain(id);
    // Simulate a pre-P3-12 sale: report figure re-derived differently.
    await db('local_sales').where({ id }).update({ cogs_total_pkr: 90000, gross_profit_pkr: 60000 });
    const found = await detect(db);
    expect(found.mismatch).toContain(id);
    const quiet = () => {};
    await correct(db, { write: false, log: quiet });
    expect(Number((await db('local_sales').where({ id }).first()).cogs_total_pkr)).toBe(90000);
    await correct(db, { write: true, log: quiet });
    const fixed = await db('local_sales').where({ id }).first();
    expect(Number(fixed.cogs_total_pkr)).toBe(100000);
    expect(Number(fixed.gross_profit_pkr)).toBe(50000);
    expect((await detect(db)).mismatch).not.toContain(id);
  });
});
