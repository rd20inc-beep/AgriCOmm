/**
 * P2-21 — an expense booked against an order or a batch is ONE bill.
 *
 * The expense raised its own payable (PAY-EXP…) and a cost row so the order /
 * batch costing saw it. The payables feed re-derived that cost row as a second
 * bill (EC-… / MC-…) and Purchases listed the export cost as payable on its
 * own — paying one left the other outstanding, or the bill was paid twice.
 *
 * Now the cost row is stamped with its expense: it still counts in the
 * costing, is never re-derived, cannot be paid as an export cost, and other
 * cost-sheet writes never merge into it.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('expense with order / batch: no payable twin (DB-gated)', () => {
  let db; let expenses; let finance; let consumption;
  let user; let order; let batch; let bank; let item;
  const run = `${Date.now()}`.slice(-7);
  const today = new Date().toISOString().slice(0, 10);

  const call = async (fn, req) => {
    const out = {};
    const res = {
      status(c) { out.status = c; return this; },
      json(b) { out.status = out.status || 200; out.body = b; return this; },
    };
    await fn({ query: {}, body: {}, params: {}, ...req, user: { id: user.id, role_id: user.role_id } }, res);
    return out;
  };
  const feed = async () => (await call(finance.getPayables, { query: { limit: 100000 } })).body.data.payables;

  beforeAll(async () => {
    db = require('../config/database');
    expenses = require('../modules/expenses/expenses.service');
    finance = require('../modules/finance/finance.controller');
    consumption = require('../modules/millStore/consumption.service');
    const { ensureAccountGl } = require('../shared/accountGl');

    const owner = await db('roles').where({ name: 'Owner' }).first();
    [user] = await db('users').insert({
      email: `zz-twin-${run}@test.local`, password_hash: 'x', full_name: `ZZ twin ${run}`, role_id: owner.id, is_active: true,
    }).returning('*');
    const [cust] = await db('customers').insert({ name: `ZZ twin cust ${run}` }).returning('id');
    const [prod] = await db('products').insert({ name: `ZZ twin rice ${run}` }).returning('id');
    [order] = await db('export_orders').insert({
      order_no: `ZZT-${run}`, customer_id: cust.id || cust, product_id: prod.id || prod, created_by: user.id,
    }).returning('*');
    const mill = await db('mills').first('id') || (await db('mills').insert({ name: `ZZ twin mill ${run}` }).returning('id'))[0];
    [batch] = await db('milling_batches').insert({
      batch_no: `ZZT-B-${run}`, created_by: user.id, mill_id: mill.id, status: 'In Progress',
    }).returning('*');
    [bank] = await db('bank_accounts').insert({
      name: `ZZ twin cash ${run}`, type: 'cash', currency: 'PKR', entity: 'general', current_balance: 1000000,
    }).returning('*');
    await ensureAccountGl(db, bank);
    [item] = await db('mill_items').insert({
      code: `ZZT-${run}`, name: `ZZ twin diesel ${run}`, category: 'fuel', unit: 'ltr', avg_cost_per_unit: 100,
    }).returning('*');
    await db('mill_stock').insert({ item_id: item.id, warehouse_id: null, quantity_available: 50, quantity_reserved: 0 });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  let exportExp; let millExp;
  test('an export expense against an order: one payable, its cost row stamped, no EC- twin', async () => {
    exportExp = await expenses.create({
      expense_type: 'export', category: 'clearing', amount: 25000, currency: 'PKR',
      vendor_name: `ZZ twin agent ${run}`, expense_date: today, order_id: order.id,
    }, user.id);
    const eoc = await db('export_order_costs').where({ order_id: order.id });
    expect(eoc).toHaveLength(1);
    expect(eoc[0].business_expense_id).toBe(exportExp.id);
    expect(Number(eoc[0].base_amount_pkr)).toBe(25000);

    const rows = (await feed()).filter((p) => p.linked_ref === order.order_no || p.linked_ref === `ZZ twin agent ${run}`);
    expect(rows.map((p) => String(p.id).replace(/\d+$/, '#'))).toEqual(['#']); // the stored PAY-EXP only
    expect(Number(rows[0].outstanding)).toBe(25000);
  });

  test('Purchases does not list it as an export cost, and refuses to pay it as one', async () => {
    const list = await call(finance.listPurchases, { query: {} });
    const purchases = list.body.data.purchases;
    expect(purchases.filter((p) => p.source === 'export_cost' && p.ref === order.order_no)).toHaveLength(0);
    // ...it is listed once, as the expense.
    expect(purchases.filter((p) => p.source === 'expense' && Number(p.ref_id) === exportExp.id)).toHaveLength(1);

    const eoc = await db('export_order_costs').where({ order_id: order.id }).first();
    const r = await call(finance.payPurchase, { body: { source: 'export_cost', source_id: eoc.id, payment_method: 'cash', bank_account_id: bank.id } });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain(exportExp.expense_no);
    expect(await db('payments').where({ source_table: 'export_order_costs', source_id: eoc.id })).toHaveLength(0);
  });

  test('paying the expense leaves zero outstanding everywhere', async () => {
    await expenses.markPaid(exportExp.id, { payment_method: 'cash', bank_account_id: bank.id }, user.id);
    const rows = (await feed()).filter((p) => p.linked_ref === order.order_no || p.linked_ref === `ZZ twin agent ${run}`);
    expect(rows.reduce((s, p) => s + Number(p.outstanding || 0), 0)).toBe(0);
  });

  test('a mill expense against a batch gets its OWN stamped cost row and no MC- twin', async () => {
    // A cost the batch already carries for the same category stays separate.
    await db('milling_costs').insert({ batch_id: batch.id, category: 'diesel', amount: 700, currency: 'PKR' });
    millExp = await expenses.create({
      expense_type: 'mill', category: 'diesel', amount: 4000, currency: 'PKR',
      vendor_name: `ZZ twin pump ${run}`, expense_date: today, batch_id: batch.id,
    }, user.id);
    const mcs = await db('milling_costs').where({ batch_id: batch.id, category: 'diesel' }).orderBy('id');
    expect(mcs.map((r) => [Number(r.amount), r.business_expense_id])).toEqual([[700, null], [4000, millExp.id]]);
    const twins = (await feed()).filter((p) => String(p.id).startsWith('MC-') && p.linked_ref === batch.batch_no);
    expect(twins.map((p) => Number(p.original_amount))).toEqual([700]);
  });

  test('store consumption merges into the batch\'s own row, never the expense\'s', async () => {
    await consumption.confirm(batch.id, [{ item_id: item.id, quantity: 2 }], user.id);
    const mcs = await db('milling_costs').where({ batch_id: batch.id, category: 'diesel' }).orderBy('id');
    expect(mcs.map((r) => [Number(r.amount), r.business_expense_id])).toEqual([[900, null], [4000, millExp.id]]);
  });

  test('scripts/linkExpenseCostRows: a legacy row is found and stamped; a merged one is only listed', async () => {
    const { scan, link } = require('../../scripts/linkExpenseCostRows');
    // As written before migration 349: unstamped.
    const eoc = await db('export_order_costs').where({ business_expense_id: exportExp.id }).first();
    await db('export_order_costs').where({ id: eoc.id }).update({ business_expense_id: null });
    const [merged] = await db('milling_costs').insert({
      batch_id: batch.id, category: 'electricity', amount: 1500, currency: 'PKR',
      notes: `Updated via business expense ${millExp.expense_no}`,
    }).returning('*');
    await db('business_expenses').where({ id: millExp.id }).update({ category: 'electricity' });
    try {
      const dry = await scan(db);
      expect(dry.linkable).toEqual(expect.arrayContaining([{ table: 'export_order_costs', id: eoc.id, expenseId: exportExp.id }]));
      expect(dry.review).toEqual(expect.arrayContaining([{ table: 'milling_costs', id: merged.id, expenseId: millExp.id }]));
      expect((await db('export_order_costs').where({ id: eoc.id }).first()).business_expense_id).toBeNull();

      const r = await link(db, { write: true });
      expect(r.linked).toBeGreaterThanOrEqual(1);
      expect((await db('export_order_costs').where({ id: eoc.id }).first()).business_expense_id).toBe(exportExp.id);
      const after = await db('milling_costs').where({ id: merged.id }).first();
      expect([Number(after.amount), after.business_expense_id]).toEqual([1500, null]);
    } finally {
      await db('business_expenses').where({ id: millExp.id }).update({ category: 'diesel' });
    }
  });
});
