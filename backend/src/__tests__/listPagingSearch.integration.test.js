/**
 * P4-11 — server-side search and paging (TEC-07, INV-04, INV-48, PAY-10, EXP-23)
 * and P4-10 Batch 360 KG fields, over HTTP against a real, migrated Postgres.
 *
 * Seeds more rows than every old cap and checks the OLDEST record is findable:
 *   - customers / suppliers / products: > 200 rows (the pagination.js clamp);
 *     walking the pages returns every row exactly once, favorites first; the
 *     search reaches the oldest row (and supplier code / product code);
 *   - lots: > 100 lots; the sale picker filter (in_stock + has_available)
 *     finds the oldest lot with stock and drops empty / fully-held lots;
 *   - milling batches / export orders / local sales: stable paging (no row
 *     skipped or repeated across pages) and batch search;
 *   - attendance: > 500 rows for one month, filtered by entity, uncapped; a
 *     request with no month is refused;
 *   - Batch 360 ledger returns KG fields.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('list paging & search (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  const get = (url, query = {}) => request(app).get(url).query(query).set({ Authorization: `Bearer ${tok.admin}` });

  // Walk every page of a list endpoint the way the frontend does.
  async function walk(url, key, query = {}, limit = 200) {
    const first = await get(url, { ...query, page: 1, limit });
    expect(first.status).toBe(200);
    const total = first.body.data.pagination.total;
    const rows = [...first.body.data[key]];
    for (let p = 2; p <= Math.ceil(total / limit); p += 1) {
      const r = await get(url, { ...query, page: p, limit });
      rows.push(...r.body.data[key]);
    }
    return { rows, total };
  }

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-p411-admin-${run}@test.local`, full_name: `ZZ Admin ${run}`,
      password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids.user = u.id;
    tok.admin = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);

    // 205 customers + 205 suppliers + 205 products; the alphabetically-last one
    // of each is the favorite, the alphabetically-first the "oldest".
    const n = 205;
    const pad = (i) => String(i).padStart(4, '0');
    await db.batchInsert('customers', Array.from({ length: n }, (_, i) => ({
      name: `ZZP411 Cust ${run} ${pad(i)}`, customer_type: 'local', currency: 'PKR', is_favorite: i === n - 1,
    })), 100);
    await db.batchInsert('suppliers', Array.from({ length: n }, (_, i) => ({
      name: `ZZP411 Supp ${run} ${pad(i)}`, supplier_code: `ZS${run}${pad(i)}`, is_favorite: i === n - 1,
    })), 100);
    await db.batchInsert('products', Array.from({ length: n }, (_, i) => ({
      name: `ZZP411 Prod ${run} ${pad(i)}`, code: `ZP${run}${pad(i)}`,
    })), 100);
    ids.product = (await db('products').where('code', `ZP${run}0000`).first()).id;
    const [wh] = await db('warehouses').insert({ name: `ZZ P411 WH ${run}`, entity: 'mill', type: 'finished' }).returning('*');
    ids.wh = wh.id;
  });

  afterAll(async () => { if (db) await db.destroy(); });

  it('customers: every page, each row once, favorite first, oldest findable', async () => {
    const { rows, total } = await walk('/api/customers', 'customers', { search: `ZZP411 Cust ${run}` });
    expect(total).toBe(205);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map((r) => r.id)).size).toBe(205);
    expect(rows[0].name).toBe(`ZZP411 Cust ${run} 0204`); // starred, though last by name
    expect(rows.some((r) => r.name === `ZZP411 Cust ${run} 0000`)).toBe(true);
    // A single page is clamped at 200 — the reason the frontend walks pages.
    const one = await get('/api/customers', { search: `ZZP411 Cust ${run}`, limit: 3000 });
    expect(one.body.data.customers).toHaveLength(200);
    expect(one.body.data.pagination.total).toBe(205);
  });

  it('suppliers: favorite first across pages; search by code reaches the oldest', async () => {
    const { rows } = await walk('/api/suppliers', 'suppliers', { search: `ZZP411 Supp ${run}` }, 50);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map((r) => r.id)).size).toBe(205);
    expect(rows[0].name).toBe(`ZZP411 Supp ${run} 0204`);
    const byCode = await get('/api/suppliers', { search: `ZS${run}0000` });
    expect(byCode.body.data.suppliers.map((s) => s.name)).toEqual([`ZZP411 Supp ${run} 0000`]);
  });

  it('products: every page and search by code', async () => {
    const { rows } = await walk('/api/products', 'products', { search: `ZZP411 Prod ${run}` }, 60);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map((r) => r.id)).size).toBe(205);
    const byCode = await get('/api/products', { search: `ZP${run}0000` });
    expect(byCode.body.data.products).toHaveLength(1);
  });

  it('lots: the sale picker filter finds the oldest lot with free stock, not empty or fully-held lots', async () => {
    const base = { product_id: ids.product, warehouse_id: ids.wh, entity: 'mill', type: 'finished', status: 'Available', ownership: 'company' };
    const lot = (i, over = {}) => ({
      ...base, lot_no: `ZZL${run}-${String(i).padStart(3, '0')}`, item_name: `ZZ P411 Rice ${run}`,
      qty: 100, net_weight_kg: 100, available_qty: 100, created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000), ...over,
    });
    // 110 lots: #0 (oldest) has stock; #1 is empty; #2 is fully held for milling.
    await db.batchInsert('inventory_lots', Array.from({ length: 110 }, (_, i) => {
      if (i === 1) return lot(i, { qty: 0, net_weight_kg: 0, available_qty: 0, status: 'Depleted' });
      if (i === 2) return lot(i, { milling_reserved_qty: 100, available_qty: 0 });
      return lot(i);
    }), 50);
    const pick = { status: 'Available', in_stock: 'true', has_available: 'true', search: `ZZ P411 Rice ${run}` };
    const page1 = await get('/api/lot-inventory/lots', { ...pick, limit: 100 });
    expect(page1.status).toBe(200);
    expect(page1.body.data.pagination.total).toBe(108);
    expect(page1.body.data.lots).toHaveLength(100); // the picker shows "100 of 108"
    const oldest = await get('/api/lot-inventory/lots', { ...pick, search: `ZZL${run}-000` });
    expect(oldest.body.data.lots.map((l) => l.lot_no)).toEqual([`ZZL${run}-000`]);
    for (const hidden of ['001', '002']) {
      const r = await get('/api/lot-inventory/lots', { ...pick, search: `ZZL${run}-${hidden}` });
      expect(r.body.data.lots).toHaveLength(0);
    }
    // Stable paging: same created_at on many rows never repeats or skips one.
    await db('inventory_lots').where('lot_no', 'like', `ZZL${run}-%`).update({ created_at: new Date(Date.UTC(2026, 0, 1)) });
    const { rows } = await walk('/api/lot-inventory/lots', 'lots', { search: `ZZ P411 Rice ${run}` }, 30);
    expect(rows).toHaveLength(110);
    expect(new Set(rows.map((r) => r.id)).size).toBe(110);
  });

  it('milling batches: stable paging past 200 and server search', async () => {
    const [mill] = await db('mills').insert({ name: `ZZ P411 Mill ${run}` }).returning('*');
    const at = new Date(Date.UTC(2026, 1, 1));
    await db.batchInsert('milling_batches', Array.from({ length: 205 }, (_, i) => ({
      batch_no: `ZZB${run}-${String(i).padStart(3, '0')}`, mill_id: mill.id, created_by: ids.user, created_at: at, status: 'Queued',
      batch_name: i === 0 ? `ZZ oldest blend ${run}` : null,
    })), 100);
    const ours = (rows) => rows.filter((b) => String(b.batch_no).startsWith(`ZZB${run}-`));
    const { rows } = await walk('/api/milling/batches', 'batches', {}, 50);
    expect(ours(rows)).toHaveLength(205);
    expect(new Set(ours(rows).map((b) => b.id)).size).toBe(205);
    const found = await get('/api/milling/batches', { search: `ZZ oldest blend ${run}` });
    expect(found.body.data.batches.map((b) => b.batch_no)).toEqual([`ZZB${run}-000`]);
  });

  it('export orders: stable paging past 200, oldest findable by search', async () => {
    const cust = await db('customers').where('name', `ZZP411 Cust ${run} 0000`).first();
    const at = new Date(Date.UTC(2026, 2, 1));
    await db.batchInsert('export_orders', Array.from({ length: 205 }, (_, i) => ({
      order_no: `ZZE${run}-${String(i).padStart(3, '0')}`, customer_id: cust.id, product_id: ids.product,
      created_by: ids.user, created_at: at, currency: i === 0 ? 'EUR' : 'USD',
    })), 100);
    const { rows } = await walk('/api/export-orders', 'orders', { search: `ZZE${run}-` }, 40);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map((o) => o.id)).size).toBe(205);
    const oldest = await get('/api/export-orders', { search: `ZZE${run}-000` });
    expect(oldest.body.data.orders[0]).toMatchObject({ order_no: `ZZE${run}-000`, currency: 'EUR' });
  });

  it('local sales: stable paging on one sale date', async () => {
    await db.batchInsert('local_sales', Array.from({ length: 120 }, (_, i) => ({
      sale_no: `ZZS${run}-${String(i).padStart(3, '0')}`, item_name: 'ZZ rice', sale_date: '2026-03-01',
      quantity_input: 1, quantity_kg: 1, rate_input: 1, rate_per_kg: 1, total_amount: 1, created_by: ids.user,
    })), 60);
    const { rows, total } = await walk('/api/local-sales', 'sales', { search: `ZZS${run}-` }, 25);
    expect(total).toBe(120);
    expect(new Set(rows.map((s) => s.id)).size).toBe(120);
  });

  it('attendance: a whole month for one entity, uncapped; month is required', async () => {
    const mk = (entity, k) => Array.from({ length: k }, (_, i) => ({ name: `ZZ W ${entity} ${run} ${i}`, daily_wage: 1000, entity }));
    const mill = await db('mill_workers').insert(mk('mill', 25)).returning('id');
    const ho = await db('mill_workers').insert(mk('general', 2)).returning('id');
    const rows = [];
    for (const w of [...mill, ...ho]) {
      for (let day = 1; day <= 28; day += 1) rows.push({ worker_id: w.id, date: `2031-02-${String(day).padStart(2, '0')}`, status: 'present' });
    }
    await db.batchInsert('mill_attendance', rows, 200);
    // Only this run's workers (the DB may hold an earlier run's rows too).
    const millIds = new Set(mill.map((w) => w.id));
    const hoIds = new Set(ho.map((w) => w.id));
    const r = await get('/api/milling/attendance', { month: '2031-02', entity: 'mill' });
    expect(r.status).toBe(200);
    expect(r.body.data.attendance.length).toBeGreaterThan(500); // past the old cap
    expect(r.body.data.attendance.every((a) => a.worker_entity === 'mill')).toBe(true);
    const ours = r.body.data.attendance.filter((a) => millIds.has(a.worker_id));
    expect(ours).toHaveLength(25 * 28);
    const days = new Set(ours.map((a) => String(a.date).slice(0, 10)));
    expect(days.size).toBe(28); // the oldest day is not blank
    const ho2 = await get('/api/milling/attendance', { month: '2031-02', entity: 'general' });
    expect(ho2.body.data.attendance.filter((a) => hoIds.has(a.worker_id))).toHaveLength(2 * 28);
    expect(ho2.body.data.attendance.some((a) => millIds.has(a.worker_id))).toBe(false);
    const bad = await get('/api/milling/attendance', {});
    expect(bad.status).toBe(400);
  });

  it('Batch 360 ledger reports KG (P4-10)', async () => {
    const batch = await db('milling_batches').where('batch_no', `ZZB${run}-000`).first();
    const srcLot = await db('inventory_lots').where('lot_no', `ZZL${run}-000`).first();
    await db('batch_source_lots').insert({ batch_id: batch.id, lot_id: srcLot.id, qty_kg: 2500, lot_type: 'raw' });
    const r = await get(`/api/reporting/batch-ledger/${batch.id}`);
    expect(r.status).toBe(200);
    const body = r.body.data || r.body;
    expect(body.yieldSummary.inputKg).toBe(2500);
    expect(body.yieldSummary.inputMt).toBe(2.5);
    expect(body.inputs[0].qtyKg).toBe(2500);
  });
});
