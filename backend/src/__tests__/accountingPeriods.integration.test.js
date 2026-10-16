/**
 * P4-13 / FIN-05 / FIN-06 — accounting periods on the Pakistani fiscal year
 * (owner decision D-1, 2026-10-16), against Postgres:
 *
 *   - migrations 411/412: every month of FY 2025-26 … FY 2027-28 exists, Open,
 *     on its calendar month, with its fiscal-year label;
 *   - a journal dated in a month with no period gets one (Open) — 1 Jan 2027
 *     and a far-future date alike;
 *   - the Finance Manager creates a fiscal year ahead (POST
 *     /periods/fiscal-years, idempotent, audited) and closes a month;
 *   - a closed month refuses journals, posting a draft and bank / cash
 *     movements; closing changes no posted journal; a month with a draft
 *     cannot close; only the Owner reopens it, with a reason;
 *   - the trial balance as at a month-end holds exactly what was posted by
 *     then, and says whether that month is closed (final) or open.
 *
 * Real router, controller, service, ownerApproval and Postgres; only rbac is
 * stood in for. Dates are in 2028 and later so no other suite's journals land
 * in the months it closes. DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rbac', () => () => (req, res, next) => next());

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('accounting periods (DB-gated)', () => {
  let db; let request; let app; let accounting; let periods; let postBankTransaction;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const acc = {};
  const journalIds = [];
  let bank;

  const as = (who) => (r) => r.set('x-test-user', String(ids[who]));
  const put = (who, url, body) => as(who)(request(app).put(url)).send(body || {});
  const post = (who, url, body) => as(who)(request(app).post(url)).send(body || {});
  const get = (who, url) => as(who)(request(app).get(url));
  const periodOf = (date) => db('accounting_periods').where('period_start', '<=', date).where('period_end', '>=', date).first();
  const journal = async (date, amount, { post: doPost = true } = {}) => {
    const j = await accounting.createJournal(null, {
      date, entity: 'general', refType: 'test', refNo: `ZZ-PER-${run}`, description: `ZZ period ${run}`,
      lines: [{ account_id: acc['6000'].id, debit: amount, credit: 0 }, { account_id: acc['3000'].id, debit: 0, credit: amount }],
      userId: ids.fm,
    });
    journalIds.push(j.id);
    if (doPost) await accounting.postJournal(null, j.id);
    return j;
  };
  const tbDebit = async (asOf, code) => {
    const r = await get('fm', `/api/accounting/statements/trial-balance?as_of_date=${asOf}`);
    expect(r.status).toBe(200);
    return { body: r.body.data, debit: (r.body.data.accounts.find((a) => a.code === code) || { debit_total: 0 }).debit_total };
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    accounting = require('../modules/accounting/accounting.service');
    periods = require('../modules/accounting/periods');
    ({ postBankTransaction } = require('../shared/bankBalance'));
    const express = require('express');
    const bcrypt = require('bcryptjs');

    const ownerRole = await db('roles').where({ name: 'Owner' }).first();
    const fmRole = await db('roles').where({ name: 'Finance Manager' }).first();
    const user = async (tag, roleId) => (await db('users').insert({
      email: `zz-per-${tag}-${run}@test.local`, full_name: `ZZ ${tag} ${run}`,
      password_hash: await bcrypt.hash('pw', 4), role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0];
    ids.owner = (await user('owner', ownerRole.id)).id;
    ids.fm = (await user('fm', fmRole.id)).id;
    const roleOf = { [ids.owner]: ownerRole.id, [ids.fm]: fmRole.id };
    for (const code of ['3000', '6000']) acc[code] = await db('chart_of_accounts').where({ code }).first();
    [bank] = await db('bank_accounts').insert({ name: `ZZ per bank ${run}`, currency: 'PKR', current_balance: 0, type: 'bank' }).returning('*');

    // A previous run's months in the years this suite creates (none hold a journal).
    await db('accounting_periods').where('period_start', '>=', '2031-03-01').where('period_end', '<=', '2033-06-30')
      .whereNotExists(db('journal_entries').whereRaw('journal_entries.period_id = accounting_periods.id')).del();

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      req.user = { id, role_id: roleOf[id] };
      next();
    });
    app.use('/api/accounting', require('../modules/accounting/accounting.routes'));
  });

  afterAll(async () => {
    if (!db) return;
    await db('journal_lines').whereIn('journal_id', journalIds).del();
    await db('journal_entries').whereIn('id', journalIds).del();
    await db('bank_transactions').where({ bank_account_id: bank.id }).del();
    await db('bank_accounts').where({ id: bank.id }).del();
    await db('accounting_periods').where('period_start', '>=', '2028-01-01').where('period_end', '<=', '2028-12-31').update({ status: 'Open', closed_by: null, closed_at: null });
    // Months this suite created (other suites may have posted into far-future months too).
    await db('accounting_periods').where('period_start', '>=', '2030-07-01')
      .whereNotExists(db('journal_entries').whereRaw('journal_entries.period_id = accounting_periods.id')).del();
    await db('audit_logs').whereIn('user_id', [ids.owner, ids.fm]).del();
    await db('approval_authorizations').whereIn('requested_by', [ids.owner, ids.fm]).del().catch(() => {});
    await db('users').whereIn('id', [ids.owner, ids.fm]).del();
    await db.destroy();
  });

  test('FY 2025-26 … FY 2027-28 exist month by month, Open, on calendar months', async () => {
    const rows = await db('accounting_periods').where('period_start', '>=', '2025-07-01').where('period_end', '<=', '2028-06-30').orderBy('period_start');
    expect(rows).toHaveLength(36);
    const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));
    for (const p of rows) {
      expect(day(p.period_start).slice(8)).toBe('01');
      const start = new Date(`${day(p.period_start)}T00:00:00Z`);
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      expect(day(p.period_end)).toBe(last);
    }
    expect(rows.find((p) => p.name === 'Jan 2026').fy_label).toBe('2025-26');
    expect(rows.find((p) => p.name === 'Jul 2026').fy_label).toBe('2026-27');
    expect(rows.find((p) => p.name === 'Dec 2026').period_end).toBeTruthy();
    // 31 Dec 2026 used to fall in no period (seed off by a day east of UTC).
    expect((await periodOf('2026-12-31')).name).toBe('Dec 2026');
  });

  test('a journal on 1 Jan 2027 has a period; one in a month with none creates it, Open', async () => {
    const jan = await journal('2027-01-01', 1);
    expect(jan.period_id).toBe((await periodOf('2027-01-01')).id);
    expect(await periodOf('2031-03-15')).toBeUndefined();
    const far = await journal('2031-03-15', 1);
    const p = await periodOf('2031-03-15');
    expect(p).toMatchObject({ name: 'Mar 2031', status: 'Open', fy_label: '2030-31' });
    expect(far.period_id).toBe(p.id);
  });

  test('the Finance Manager creates a fiscal year ahead — twelve Open months, idempotent, audited', async () => {
    const r1 = await post('fm', '/api/accounting/periods/fiscal-years', { start_year: 2032 });
    expect(r1.status).toBe(201);
    expect(r1.body.data.created).toBe(12);
    expect(r1.body.data.periods.map((p) => p.name)[0]).toBe('Jul 2032');
    expect(r1.body.data.periods.every((p) => p.status === 'Open' && p.fy_label === '2032-33')).toBe(true);
    const r2 = await post('fm', '/api/accounting/periods/fiscal-years', { start_year: 2032 });
    expect(r2.status).toBe(200);
    expect(r2.body.data.created).toBe(0);
    expect(await db('audit_logs').where({ action: 'create_fiscal_year', user_id: ids.fm })).toHaveLength(2);
    const bad = await post('fm', '/api/accounting/periods/fiscal-years', { start_year: 'next' });
    expect(bad.status).toBe(400);
    const list = await get('fm', '/api/accounting/periods?fy=2032-33');
    expect(list.body.data.periods).toHaveLength(12);
    expect(list.body.data.current_fiscal_year.label).toMatch(/^FY \d{4}-\d{2}$/);
  });

  test('a closed month refuses journals, drafts and money; closing changes no posted journal', async () => {
    const posted = await journal('2028-03-05', 70);
    const before = await db('journal_entries').where({ id: posted.id }).first();
    const linesBefore = await db('journal_lines').where({ journal_id: posted.id }).orderBy('id');
    const draft = await journal('2028-03-20', 5, { post: false });
    const mar = await periodOf('2028-03-10');

    // A month holding a draft cannot close.
    const blocked = await put('fm', `/api/accounting/periods/${mar.id}/close`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/not yet posted/);
    await accounting.postJournal(null, draft.id);

    const closed = await put('fm', `/api/accounting/periods/${mar.id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.period.status).toBe('Closed');

    // Nothing posted before the close moved.
    expect(await db('journal_entries').where({ id: posted.id }).first()).toEqual(before);
    expect(await db('journal_lines').where({ journal_id: posted.id }).orderBy('id')).toEqual(linesBefore);

    const err = await journal('2028-03-31', 1).catch((e) => e);
    expect(err.reason).toBe('period_closed');

    const moneyErr = await db.transaction((trx) => postBankTransaction(trx, {
      accountId: bank.id, type: 'credit', amount: 100, transaction_date: '2028-03-15',
    })).catch((e) => e);
    expect(moneyErr.reason).toBe('period_closed');
    expect(Number((await db('bank_accounts').where({ id: bank.id }).first()).current_balance)).toBe(0);
    expect(await db('bank_transactions').where({ bank_account_id: bank.id })).toHaveLength(0);

    // The month next door is untouched.
    await db.transaction((trx) => postBankTransaction(trx, { accountId: bank.id, type: 'credit', amount: 100, transaction_date: '2028-04-01' }));
    expect(Number((await db('bank_accounts').where({ id: bank.id }).first()).current_balance)).toBe(100);
  });

  test('only the Owner reopens, with a reason; then the month takes postings again', async () => {
    const mar = await periodOf('2028-03-10');
    expect(mar.status).toBe('Closed');
    const noReason = await put('owner', `/api/accounting/periods/${mar.id}/reopen`, {});
    expect(noReason.status).toBe(400);
    const fm = await put('fm', `/api/accounting/periods/${mar.id}/reopen`, { reason: 'late supplier bill' });
    expect([400, 403]).toContain(fm.status);
    expect((await periodOf('2028-03-10')).status).toBe('Closed');
    const ok = await put('owner', `/api/accounting/periods/${mar.id}/reopen`, { reason: 'late supplier bill' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.period.status).toBe('Open');
    await expect(journal('2028-03-31', 1)).resolves.toBeTruthy();
  });

  test('the trial balance as at a month-end holds exactly what was posted by then, and says if it is final', async () => {
    await journal('2028-05-10', 100);
    await journal('2028-06-10', 200);
    const apr = await tbDebit('2028-04-30', '6000');
    const may = await tbDebit('2028-05-31', '6000');
    const jun = await tbDebit('2028-06-30', '6000');
    expect(may.debit - apr.debit).toBeCloseTo(100, 2);
    expect(jun.debit - may.debit).toBeCloseTo(200, 2);
    expect(may.body.is_balanced).toBe(true);
    expect(may.body.period_status).toMatchObject({ status: 'Open', final: false, fiscalYear: 'FY 2027-28', period: { name: 'May 2028' } });

    const mayP = await periodOf('2028-05-15');
    await put('fm', `/api/accounting/periods/${mayP.id}/close`);
    const closedMay = await tbDebit('2028-05-31', '6000');
    expect(closedMay.debit).toBeCloseTo(may.debit, 2);
    expect(closedMay.body.period_status).toMatchObject({ status: 'Closed', final: true });

    // The period's own activity, by journal date.
    const r = await get('fm', `/api/accounting/statements/trial-balance?period_id=${mayP.id}`);
    expect(r.body.data.accounts.find((a) => a.code === '6000').debit_total).toBeCloseTo(100, 2);
  });

  test('the read-only detection lists what a closed month holds, and finds no misaligned or missing months', async () => {
    const { detect, report } = require('../../scripts/detectPeriodIntegrity');
    const res = await detect(db);
    const may = res.journalsInClosed.find((p) => p.name === 'May 2028');
    expect(may).toMatchObject({ status: 'Closed', n: 1 });
    expect(res.misaligned).toEqual([]);
    expect(res.overlaps).toEqual([]);
    expect(res.missingMonths).toEqual([]);
    const lines = [];
    report(res, (l) => lines.push(l));
    expect(lines.join('\n')).not.toMatch(/ZZ /); // ids and counts only
  });
});
