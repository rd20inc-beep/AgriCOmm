/**
 * P2-24 local-sale money integrity, end to end over HTTP against a real,
 * migrated Postgres:
 *   - a walk-in CASH sale at a fractional rate is fully paid (no phone asked,
 *     no paisa receivable) — the server rounds lines to whole rupees like the
 *     form, and a tender within Re 1 settles the sale;
 *   - paid > total is refused; an unknown payment_mode is refused;
 *   - reject and confirm of the same pending sale cannot both win;
 *   - a duplicate gate pass is refused (409), including two saves racing;
 *   - the revenue journal is stamped with the customer; COGS posts under the
 *     lot's entity; the receiving cash account still ties out (P2-17).
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('local-sale money integrity (DB-gated)', () => {
  let db; let app; let request; let bankTieOut;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  let cashAcct;

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who))
    .set('Idempotency-Key', `ls-money-${Math.random()}`).send(body);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    ({ bankTieOut } = require('../modules/finance/bankTieOut'));
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['mm', 'Mill Manager'], ['clerk', 'Inventory Officer']]) {
      const [u] = await db('users').insert({
        email: `zz-p224-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    // The mill's cash float, made the real way so it ties out from the start.
    // Every other active mill cash account is parked so the sale lands here.
    await db('bank_accounts').where({ type: 'cash', entity: 'mill' }).update({ is_active: false });
    const { createBankAccount } = require('../modules/admin/bankAccounts.service');
    cashAcct = (await db.transaction((trx) => createBankAccount(trx, {
      name: `ZZ Mill Cash ${run}`, type: 'cash', entity: 'mill', currency: 'PKR', is_active: true, opening_balance: 0,
    }, ids.mm))).bank_account;

    const [wh] = await db('warehouses').insert({ name: `ZZ WH ${run}`, entity: 'export', type: 'finished' }).returning('*');
    const product = await db('products').first('id');
    const [cust] = await db('customers').insert({ name: `ZZ Local ${run}`, customer_type: 'local', currency: 'PKR', phone: `0300${run}` }).returning('*');
    Object.assign(ids, { wh: wh.id, product: product.id, cust: cust.id });
  });

  afterAll(async () => {
    if (db) {
      await db('bank_accounts').where({ id: cashAcct.id }).update({ is_active: false });
      await db.destroy();
    }
  });

  const newLot = async (entity = 'export') => (await db('inventory_lots').insert({
    lot_no: `ZZLS-${run}-${Math.random().toString(36).slice(2, 7)}`, item_name: 'ZZ Rice', type: 'finished', entity,
    product_id: ids.product, warehouse_id: ids.wh, qty: 10000, available_qty: 10000, unit: 'kg',
    cost_per_unit: 100, landed_cost_per_kg: 100, status: 'Available',
  }).returning('*'))[0];
  const sale = (who, lot, extra = {}) => post(who, '/api/local-sales', {
    buyer_name: 'Walk-in', payment_mode: 'cash',
    items: [{ lot_id: lot.id, item_name: 'ZZ Rice', quantity_input: 333, quantity_unit: 'kg', rate_input: 147.33, rate_unit: 'kg' }],
    ...extra,
  });

  test('a walk-in cash sale at a fractional rate is fully paid: whole-rupee total, no phone, no receivable', async () => {
    const lot = await newLot();
    const r = await sale('mm', lot);
    expect(r.status).toBe(201);
    const s = r.body.data.sale;
    // 333 × 147.33 = 49060.89 → Rs 49,061 (the form shows the same figure).
    expect(Number(s.total_amount)).toBe(49061);
    expect(Number(s.paid_amount)).toBe(49061);
    expect(Number(s.due_amount)).toBe(0);
    expect(s.payment_status).toBe('Paid');
    expect(await db('receivables').where({ local_sale_id: s.id })).toHaveLength(0);
    // A tender within Re 1 below the total settles it too.
    const r2 = await sale('mm', lot, { paid_amount: 49060.5 });
    expect(r2.status).toBe(201);
    expect(r2.body.data.sale).toMatchObject({ payment_status: 'Paid' });
    expect(Number(r2.body.data.sale.due_amount)).toBe(0);
    // The cash float still ties out: balance = Σ bank rows = GL.
    const t = (await bankTieOut(db)).accounts.find((a) => a.account_id === cashAcct.id);
    expect(t).toMatchObject({ balance: 98122, sub_ledger: 98122, gl_balance_pkr: 98122, ok: true });
  });

  test('the revenue journal carries the customer; COGS posts under the lot\'s entity', async () => {
    const lot = await newLot('export');
    const r = await sale('mm', lot, { customer_id: ids.cust, buyer_name: null });
    expect(r.status).toBe(201);
    const no = r.body.data.sale.sale_no;
    const rev = await db('journal_entries').where({ ref_no: no, ref_type: 'Local Sale', status: 'Posted' }).first();
    expect(rev).toMatchObject({ party_type: 'customer', party_id: ids.cust });
    const cogs = await db('journal_entries').where({ ref_no: no, ref_type: 'Local Sale COGS', status: 'Posted' }).first();
    expect(cogs.entity).toBe('export');
  });

  test('paid above the total and an unknown payment_mode are refused; nothing is written', async () => {
    const lot = await newLot();
    const before = await db('local_sales').count('id as n').first();
    const over = await sale('mm', lot, { paid_amount: 50000 });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/cannot be more than the sale total/);
    const bad = await sale('mm', lot, { payment_mode: 'barter' });
    expect(bad.status).toBe(400);
    const after = await db('local_sales').count('id as n').first();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  test('reject and confirm racing on one pending sale: exactly one wins', async () => {
    const lot = await newLot();
    const r = await sale('clerk', lot, { customer_id: ids.cust, buyer_name: null });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('Pending');
    const id = r.body.data.sale.id;
    const [a, b] = await Promise.all([
      post('mm', `/api/local-sales/${id}/confirm`, {}),
      post('mm', `/api/local-sales/${id}/reject`, { reason: 'race' }),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    const row = await db('local_sales').where({ id }).first();
    const posted = await db('journal_entries').where({ ref_no: row.sale_no, ref_type: 'Local Sale', status: 'Posted' });
    // Never both: a cancelled sale has no posted revenue, a completed one has it.
    if (row.status === 'Cancelled') {
      expect(posted).toHaveLength(0);
    } else {
      expect(row.status).toBe('Completed');
      expect(posted).toHaveLength(1);
    }
  });

  test('a duplicate gate pass is refused, also when two saves race', async () => {
    const lot = await newLot();
    const gp = `ZZGP-${run}`;
    expect((await sale('mm', lot, { gate_pass_no: gp })).status).toBe(201);
    const dup = await sale('mm', lot, { gate_pass_no: gp });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('GATE_PASS_DUPLICATE');

    // Two saves racing past the in-transaction check: the unique index is the
    // final word (concurrent HTTP saves would also race on sale_no, so the
    // index is exercised directly with a second live head line).
    const first = await db('local_sales').where({ gate_pass_no: gp }).first();
    const { id: _id, uuid: _u, sale_no: _n, sale_group_no: _g, ...copy } = first;
    await expect(db('local_sales').insert({ ...copy, sale_no: `ZZX-${run}`, sale_group_no: `ZZX-${run}` }))
      .rejects.toMatchObject({ code: '23505', constraint: 'uq_local_sales_gate_pass_head' });
    // A second line of the SAME sale (not its head) and a rejected sale may carry it.
    await db('local_sales').insert({ ...copy, sale_no: `ZZY-${run}`, sale_group_no: first.sale_group_no });
    await db('local_sales').insert({ ...copy, sale_no: `ZZZ-${run}`, sale_group_no: `ZZZ-${run}`, status: 'Cancelled' });
  });
});
