/**
 * P2-28 / owner decision D-9 — an Owner personal expense is drawings (equity),
 * not operating expense.
 *
 *   - a "Personal / Owner" expense (subcategory 'personal') posts Dr 3030
 *     Owner's Drawings / Cr 2010; the P&L does not move, equity falls
 *   - it cannot be charged to a batch or an order
 *   - scripts/reclassOwnerDrawings.js moves a pre-D-9 one (Dr 6000) with one
 *     signed-delta journal, once
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('owner drawings (DB-gated)', () => {
  let db; let expenses; let accounting; let userId;
  const run = `${Date.now()}`.slice(-7);
  const today = new Date().toISOString().slice(0, 10);
  const linesOf = (refNo) => db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted' }).orderBy('jl.id')
    .select('je.ref_type', 'c.code', db.raw('jl.debit::float AS dr'), db.raw('jl.credit::float AS cr'));

  beforeAll(async () => {
    db = require('../config/database');
    expenses = require('../modules/expenses/expenses.service');
    accounting = require('../modules/accounting/accounting.service');
    const [u] = await db('users').insert({
      email: `zz-draw-${run}@test.local`, password_hash: 'x', full_name: `ZZ draw ${run}`, is_active: true,
    }).returning('id');
    userId = u.id || u;
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('3030 Owner\'s Drawings exists as a debit-normal Equity account under 3000', async () => {
    const a = await db('chart_of_accounts').where({ code: '3030' }).first();
    const p = await db('chart_of_accounts').where({ code: '3000' }).first();
    expect([a.type, a.normal_balance, a.parent_id]).toEqual(['Equity', 'debit', p.id]);
  });

  test('a personal expense hits equity, not the P&L', async () => {
    const pnlBefore = await accounting.getProfitAndLoss({ periodStart: today, periodEnd: today });
    const exp = await expenses.create({
      expense_type: 'general', subcategory: 'personal', category: 'medical', amount: 8000, currency: 'PKR',
      vendor_name: `ZZ clinic ${run}`, expense_date: today,
    }, userId);
    expect((await linesOf(exp.expense_no)).map((l) => [l.code, l.dr, l.cr])).toEqual([['3030', 8000, 0], ['2010', 0, 8000]]);
    const pnlAfter = await accounting.getProfitAndLoss({ periodStart: today, periodEnd: today });
    expect(pnlAfter.expenses.total).toBe(pnlBefore.expenses.total);
    const bs = await accounting.getBalanceSheet({});
    const drawings = bs.equity.accounts.find((a) => a.code === '3030');
    expect(drawings.balance).toBeLessThanOrEqual(-8000); // reduces equity
    expect(bs.is_balanced).toBe(true);
  });

  test('a business expense still posts to 6000', async () => {
    const exp = await expenses.create({
      expense_type: 'general', category: 'office_supplies', amount: 300, currency: 'PKR', expense_date: today,
    }, userId);
    expect((await linesOf(exp.expense_no)).map((l) => l.code)).toEqual(['6000', '2010']);
  });

  test('a personal expense cannot be charged to a batch or an order', async () => {
    const err = await expenses.create({
      expense_type: 'general', subcategory: 'personal', category: 'travel', amount: 10, currency: 'PKR',
      expense_date: today, order_id: 1,
    }, userId).catch((e) => e);
    expect(err.statusCode).toBe(400);
  });

  test('the reclass script moves a pre-D-9 personal expense once (Dr 3030 / Cr 6000)', async () => {
    const { scan, reclass } = require('../../scripts/reclassOwnerDrawings');
    // As recorded before D-9: Dr 6000 / Cr 2010.
    const legacy = await expenses.create({
      expense_type: 'general', category: 'personal_expense', amount: 2500, currency: 'PKR', expense_date: today,
    }, userId);
    await db('business_expenses').where({ id: legacy.id }).update({ subcategory: 'personal' });
    const only = (id) => id === legacy.id;

    expect((await scan(db)).map((f) => f.id)).toContain(legacy.id);
    const dry = await reclass(db, { write: false, only });
    expect(dry.found).toEqual([legacy.id]);
    expect((await linesOf(legacy.expense_no)).filter((l) => l.ref_type === 'Drawings Reclass')).toHaveLength(0);

    await reclass(db, { write: true, only });
    const rc = (await linesOf(legacy.expense_no)).filter((l) => l.ref_type === 'Drawings Reclass');
    expect(rc.map((l) => [l.code, l.dr, l.cr])).toEqual([['3030', 2500, 0], ['6000', 0, 2500]]);

    const again = await reclass(db, { write: true, only });
    expect(again.found).toEqual([]);
    // Still the one journal (its two lines).
    expect((await linesOf(legacy.expense_no)).filter((l) => l.ref_type === 'Drawings Reclass')).toHaveLength(2);
  });
});
