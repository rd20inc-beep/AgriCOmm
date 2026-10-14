/**
 * P2-30 — the audit row is written inside the business transaction.
 *
 * The auditAction middleware writes AFTER the response, fire-and-forget: a
 * change could commit with no audit row (the insert failed later), and the
 * expense supplier link swallowed its own audit insert inside the transaction
 * (a failed insert aborts the transaction → COMMIT silently rolled the link
 * back). Money writes now audit in their own transaction:
 *   rollback → no audit row; commit → exactly one (the middleware does not
 *   add a second).
 * And reversing a statutory remittance keeps the row, status 'Reversed'.
 *
 * Real routers, services and Postgres; only authenticate / rbac are stood in
 * for. DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rbac', () => {
  const pass = () => (req, res, next) => next();
  const fn = pass;
  fn.authorize = pass;
  fn.authorizeAny = pass;
  fn.authorizeRole = pass;
  fn.denyRoles = pass;
  return fn;
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('audit inside the transaction (DB-gated)', () => {
  let db; let request; let app; let user; let cash;
  const run = `${Date.now()}`.slice(-7);
  const today = new Date().toISOString().slice(0, 10);
  const settle = () => new Promise((r) => setTimeout(r, 150)); // let any after-response audit land
  const audits = (where) => db('audit_logs').where(where);

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    const express = require('express');
    const { ensureAccountGl } = require('../shared/accountGl');
    const owner = await db('roles').where({ name: 'Owner' }).first();
    [user] = await db('users').insert({
      email: `zz-aud-${run}@test.local`, password_hash: 'x', full_name: `ZZ aud ${run}`, role_id: owner.id, is_active: true,
    }).returning('*');
    [cash] = await db('bank_accounts').insert({
      name: `ZZ aud mill cash ${run}`, type: 'cash', currency: 'PKR', entity: 'mill', current_balance: 500000,
    }).returning('*');
    await ensureAccountGl(db, cash);

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: user.id, role_id: user.role_id }; next(); });
    app.use('/api/expenses', require('../modules/expenses/expenses.routes'));
    app.use('/api/milling', require('../modules/milling/milling.routes'));
    app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const expenseBody = (tag) => ({
    expense_type: 'general', category: 'office_supplies', amount: 1500, currency: 'PKR',
    vendor_name: `ZZ aud ${tag} ${run}`, expense_date: today,
  });

  test('a committed expense leaves exactly one audit row', async () => {
    const res = await request(app).post('/api/expenses').send(expenseBody('ok'));
    expect(res.status).toBe(201);
    await settle();
    const rows = await audits({ entity_type: 'business_expense', entity_id: String(res.body.data.expense.id), action: 'create' });
    expect(rows).toHaveLength(1);
  });

  test('a rolled-back expense leaves no audit row (and no expense)', async () => {
    const ids = await db('posting_rules').where({ trigger_event: 'expense_recorded', is_active: true }).pluck('id');
    await db('posting_rules').whereIn('id', ids).update({ is_active: false });
    const before = Number((await db('audit_logs').count({ c: '*' }).first()).c);
    try {
      const res = await request(app).post('/api/expenses').send(expenseBody('fail'));
      expect(res.status).toBe(400);
    } finally {
      await db('posting_rules').whereIn('id', ids).update({ is_active: true });
    }
    await settle();
    expect(Number((await db('audit_logs').count({ c: '*' }).first()).c)).toBe(before);
    expect(await db('business_expenses').where({ vendor_name: `ZZ aud fail ${run}` })).toHaveLength(0);
  });

  test('paying it: one audit row for the payment', async () => {
    const created = await request(app).post('/api/expenses').send(expenseBody('pay'));
    const id = created.body.data.expense.id;
    const res = await request(app).put(`/api/expenses/${id}/pay`).send({ payment_method: 'cash', bank_account_id: cash.id });
    expect(res.status).toBe(200);
    await settle();
    expect(await audits({ entity_type: 'business_expense', entity_id: String(id), action: 'pay' })).toHaveLength(1);
  });

  test('linking a supplier: one audit row, written with the link', async () => {
    const created = await request(app).post('/api/expenses').send(expenseBody('link'));
    const id = created.body.data.expense.id;
    const [s] = await db('suppliers').insert({ name: `ZZ aud sup ${run}`, is_active: true }).returning('id');
    const res = await request(app).put(`/api/expenses/${id}/supplier`).send({ supplier_id: s.id || s });
    expect(res.status).toBe(200);
    await settle();
    expect(await audits({ entity_type: 'business_expense', entity_id: String(id), action: 'link_supplier' })).toHaveLength(1);
  });

  test('reversing a statutory remittance keeps the row as Reversed, audited once; a second reversal is refused', async () => {
    // A 2050 liability for the mill to remit.
    const accounting = require('../modules/accounting/accounting.service');
    const [l2050, l6135] = await Promise.all(['2050', '6135'].map((c) => db('chart_of_accounts').where({ code: c }).first()));
    const j = await accounting.createJournal(null, {
      date: today, entity: 'mill', refType: 'Test', refNo: `ZZAUD-${run}`, description: 'ZZ tax withheld', isAuto: true,
      lines: [
        { account_id: l6135.id, debit: 900, credit: 0 },
        { account_id: l2050.id, debit: 0, credit: 900 },
      ],
    });
    await accounting.postJournal(null, j.id);

    const made = await request(app).post('/api/milling/payroll/statutory-remittances').send({
      entity: 'mill', liability_account_code: '2050', amount: 900, pay_method: 'cash', authority: 'FBR',
    });
    expect(made.status).toBe(201);
    const remId = made.body.data.id;

    const rev = await request(app).delete(`/api/milling/payroll/statutory-remittances/${remId}`).send({ reason: 'wrong period' });
    expect(rev.status).toBe(200);
    const row = await db('mill_statutory_remittances').where({ id: remId }).first();
    expect(row).toBeTruthy();
    expect([row.status, row.reversed_by, row.reversal_reason]).toEqual(['Reversed', user.id, 'wrong period']);
    await settle();
    expect(await audits({ entity_type: 'statutory_remittance', entity_id: String(remId), action: 'void' })).toHaveLength(1);

    const again = await request(app).delete(`/api/milling/payroll/statutory-remittances/${remId}`).send({});
    expect(again.status).toBe(409);
    // The GL nets to zero for the remittance (its delta is kept, nothing re-posted).
    const net = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.ref_no', row.remittance_no).where('je.status', 'Posted')
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    expect(Math.abs(net.n)).toBeLessThan(0.01);
  });
});
