/**
 * P3-11 / INV-55 — local-sale returns and credit notes (owner decision D-22),
 * end to end over HTTP against a real, migrated Postgres:
 *
 *   - a return is a NEW document (LSR-…); the sale row and every journal it
 *     posted stay as they were (history retained, nothing marked Reversed);
 *   - the rice goes back to the ORIGINAL lot at the ORIGINAL cost and the
 *     COGS / revenue come back out by signed deltas — the trial balance stays
 *     balanced and the lot's value = qty × cost;
 *   - what was owed comes off first; a later receipt cannot put it back;
 *   - the paid part is refunded (money out, bank ties out) or held as credit
 *     in 1310 (a walk-in can only be refunded);
 *   - refusals: over-return, not confirmed, lot re-costed since, no Owner
 *     authorisation.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

d('local-sale returns (DB-gated)', () => {
  let db; let app; let request; let bankTieOut;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  let cashAcct;

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who))
    .set('Idempotency-Key', `ls-ret-${Math.random()}`).send(body);

  // Σ(debit − credit) of Posted lines on an account code over the given refs.
  const net = async (refNos, code) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .whereIn('je.ref_no', refNos).where({ 'je.status': 'Posted', 'c.code': code })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };
  const trialBalance = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted').select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    ({ bankTieOut } = require('../modules/finance/bankTieOut'));
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['owner', 'Owner'], ['mm', 'Mill Manager'], ['clerk', 'Inventory Officer']]) {
      const [u] = await db('users').insert({
        email: `zz-p311-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    await db('bank_accounts').where({ type: 'cash', entity: 'mill' }).update({ is_active: false });
    const { createBankAccount } = require('../modules/admin/bankAccounts.service');
    cashAcct = (await db.transaction((trx) => createBankAccount(trx, {
      name: `ZZ Ret Cash ${run}`, type: 'cash', entity: 'mill', currency: 'PKR', is_active: true, opening_balance: 500000,
    }, ids.owner))).bank_account;
    const [wh] = await db('warehouses').insert({ name: `ZZ RWH ${run}`, entity: 'mill', type: 'finished' }).returning('*');
    const product = await db('products').first('id');
    const [cust] = await db('customers').insert({ name: `ZZ Ret Cust ${run}`, customer_type: 'local', currency: 'PKR', phone: `0301${run}` }).returning('*');
    Object.assign(ids, { wh: wh.id, product: product.id, cust: cust.id });
  });

  afterAll(async () => {
    if (db) {
      await db('bank_accounts').where({ id: cashAcct.id }).update({ is_active: false });
      await db.destroy();
    }
  });

  const newLot = async () => (await db('inventory_lots').insert({
    lot_no: `ZZLR-${run}-${Math.random().toString(36).slice(2, 7)}`, item_name: 'ZZ Rice', type: 'finished', entity: 'mill',
    product_id: ids.product, warehouse_id: ids.wh, qty: 10000, available_qty: 10000, net_weight_kg: 10000, received_net_weight_kg: 10000, unit: 'kg',
    cost_per_unit: 100, landed_cost_per_kg: 100, total_value: 1000000, status: 'Available',
  }).returning('*'))[0];
  const sell = async (lot, extra = {}) => {
    const r = await post('mm', '/api/local-sales', {
      buyer_name: 'Walk-in', payment_mode: 'cash',
      items: [{ lot_id: lot.id, item_name: 'ZZ Rice', quantity_input: 1000, quantity_unit: 'kg', rate_input: 150, rate_unit: 'kg' }],
      ...extra,
    });
    expect(r.status).toBe(201);
    return r.body.data.sale;
  };
  const giveBack = (saleId, body, who = 'owner') => post(who, `/api/local-sales/${saleId}/returns`, body);
  const refsOf = async (sale) => [sale.sale_no, ...(await db('local_sale_returns').where({ local_sale_id: sale.id }).pluck('return_no'))];

  test('credit sale: partial return comes off the receivable, a later receipt cannot put it back; the rest is refunded', async () => {
    const tb0 = await trialBalance();
    const lot = await newLot();
    const sale = await sell(lot, { customer_id: ids.cust, buyer_name: null, payment_mode: 'credit', paid_amount: 0 });
    expect(Number(sale.total_amount)).toBe(150000);

    const r1 = await giveBack(sale.id, { quantity: 400, reason: 'Wet bags returned' });
    expect(r1.status).toBe(201);
    const ret1 = r1.body.data.return;
    expect(ret1.return_no).toMatch(/^LSR-/);
    expect(ret1).toMatchObject({ settlement: 'none', authorized_by_owner_id: ids.owner });
    expect(Number(ret1.return_value)).toBe(60000);
    expect(Number(ret1.cogs_reversed)).toBe(40000);
    expect(Number(ret1.applied_to_receivable)).toBe(60000);

    // Stock back on the original lot at the original cost.
    let l = await db('inventory_lots').where({ id: lot.id }).first();
    expect(Number(l.qty)).toBe(9400);
    expect(Number(l.cost_per_unit)).toBe(100);
    expect(Number(l.total_value)).toBe(940000);
    expect(Number(l.sold_weight_kg)).toBe(600);
    const txn = await db('lot_transactions').where({ lot_id: lot.id, reference_no: ret1.return_no }).first();
    expect(txn).toMatchObject({ transaction_type: 'return_in' });
    expect(Number(txn.quantity_kg)).toBe(400);

    // The sale document is untouched apart from what is still owed.
    let s = await db('local_sales').where({ id: sale.id }).first();
    expect(Number(s.total_amount)).toBe(150000);
    expect(Number(s.due_amount)).toBe(90000);
    const rec = await db('receivables').where({ local_sale_id: sale.id }).first();
    expect(Number(rec.outstanding)).toBe(90000);

    // A receipt for what is left settles it — the return's credit stays off.
    const pay = await post('mm', `/api/local-sales/${sale.id}/payments`, { amount: 90000, payment_method: 'cash' });
    expect(pay.status).toBe(200);
    s = await db('local_sales').where({ id: sale.id }).first();
    expect(Number(s.due_amount)).toBe(0);
    expect(s.payment_status).toBe('Paid');

    // The rest was paid — a settlement must be chosen.
    const r2 = await giveBack(sale.id, { quantity: 600, reason: 'Customer cancelled the rest' });
    expect(r2.status).toBe(400);
    const r3 = await giveBack(sale.id, { quantity: 600, reason: 'Customer cancelled the rest', settlement: 'refund', refund_method: 'cash' });
    expect(r3.status).toBe(201);
    const ret2 = r3.body.data.return;
    expect(Number(ret2.refund_amount)).toBe(90000);
    expect(ret2.refund_payment_no).toBeTruthy();
    const refund = await db('payments').where({ id: ret2.refund_payment_id }).first();
    expect(refund).toMatchObject({ type: 'payment', local_sale_id: null });

    // Nothing left to return.
    expect((await giveBack(sale.id, { quantity: 1, reason: 'again' })).status).toBe(400);

    // Fully unwound: lot back to where it started, sale's accounts net to zero
    // for the customer, every journal still Posted, TB balanced.
    l = await db('inventory_lots').where({ id: lot.id }).first();
    expect(Number(l.qty)).toBe(10000);
    expect(Number(l.total_value)).toBe(1000000);
    expect(Number(l.received_net_weight_kg)).toBe(10000); // a return is not intake
    const refs = await refsOf(sale);
    expect(await net(refs, '5000')).toBe(0);
    expect(await net(refs, '4020')).toBe(0);
    expect(await net(refs, '1220')).toBe(0);
    const payNos = await db('payments').where({ local_sale_id: sale.id }).pluck('payment_no');
    expect(await net([...refs, ...payNos], '1120')).toBe(0);
    expect(await db('journal_entries').whereIn('ref_no', refs).where({ status: 'Reversed' })).toHaveLength(0);
    expect(await db('local_sales').where({ id: sale.id }).first()).toBeTruthy();
    expect(await trialBalance()).toBe(tb0);
    const t = (await bankTieOut(db)).accounts.find((a) => a.account_id === cashAcct.id);
    expect(t.ok).toBe(true);
  });

  test('paid sale: credit is held in 1310 for a customer; a walk-in can only be refunded', async () => {
    const lot = await newLot();
    const sale = await sell(lot, { customer_id: ids.cust, buyer_name: null });
    const r = await giveBack(sale.id, { quantity: 100, reason: 'Short grain complaint', settlement: 'credit' });
    expect(r.status).toBe(201);
    expect(r.body.data.return).toMatchObject({ settlement: 'credit', credit_status: 'Open' });
    expect(Number(r.body.data.return.credit_amount)).toBe(15000);
    const no = r.body.data.return.return_no;
    expect(await net([no], '1310')).toBe(-15000);
    const credit = await db('journal_entries').where({ ref_no: no, ref_type: 'Local Sale Return' }).whereNot({ party_id: null });
    expect(credit.length).toBeGreaterThan(0);
    credit.forEach((j) => expect(j).toMatchObject({ party_type: 'customer', party_id: ids.cust }));

    const walkIn = await sell(await newLot());
    const w1 = await giveBack(walkIn.id, { quantity: 100, reason: 'Wrong item', settlement: 'credit' });
    expect(w1.status).toBe(400);
    const w2 = await giveBack(walkIn.id, { quantity: 100, reason: 'Wrong item', settlement: 'refund', refund_method: 'cash' });
    expect(w2.status).toBe(201);
    const t = (await bankTieOut(db)).accounts.find((a) => a.account_id === cashAcct.id);
    expect(t.ok).toBe(true);
  });

  test('refused: no Owner authorisation, over-return, pending sale, lot re-costed since the sale', async () => {
    const lot = await newLot();
    const sale = await sell(lot);
    const noOwner = await giveBack(sale.id, { quantity: 10, reason: 'x return', settlement: 'refund' }, 'mm');
    expect(noOwner.status).toBe(403);
    expect((await giveBack(sale.id, { quantity: 1001, reason: 'too much', settlement: 'refund' })).status).toBe(400);

    await db('inventory_lots').where({ id: lot.id }).update({ cost_per_unit: 120 });
    const recosted = await giveBack(sale.id, { quantity: 10, reason: 'recosted', settlement: 'refund' });
    expect(recosted.status).toBe(409);
    expect(await db('local_sale_returns').where({ local_sale_id: sale.id })).toHaveLength(0);

    const p = await post('clerk', '/api/local-sales', {
      buyer_name: 'Walk-in', payment_mode: 'cash',
      items: [{ lot_id: (await newLot()).id, item_name: 'ZZ Rice', quantity_input: 10, quantity_unit: 'kg', rate_input: 150, rate_unit: 'kg' }],
    });
    expect(p.body.data.status).toBe('Pending');
    const pending = p.body.data.sale;
    expect((await giveBack(pending.id, { quantity: 5, reason: 'pending', settlement: 'refund' })).status).toBe(409);
  });
});
