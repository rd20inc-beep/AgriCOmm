/**
 * Contra transfers — money between the company's OWN accounts (owner decision
 * 2026-10-08), end to end over HTTP against a real, fully-migrated Postgres.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway container):
 *   docker run -d --name rf_contra_pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=riceflow_erp \
 *     -p 55439:5432 postgres:16-alpine
 *   export DB_HOST=127.0.0.1 DB_PORT=55439 DB_NAME=riceflow_erp DB_USER=postgres DB_PASSWORD=postgres
 *   NODE_ENV=development npx knex migrate:latest
 *   npx jest contraTransfer.integration
 *
 * Every row it creates is named with a per-run suffix, so it can be re-run on
 * the same database; assertions are on deltas, never on absolute totals.
 */
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('contra transfers (DB-gated)', () => {
  let db; let app; let request; let accounting;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const acc = {};
  const glCode = {};
  const { ensureAccountGl } = require('../shared/accountGl');
  const linesOf = (journalId) => db('journal_lines as jl').join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where('jl.journal_id', journalId).orderBy('jl.id').select('c.code', 'jl.debit', 'jl.credit')
    .then((ls) => ls.map((l) => [l.code, Number(l.debit), Number(l.credit)]));
  const TODAY = new Date().toISOString().slice(0, 10);
  const uuid = () => require('crypto').randomUUID();

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);
  const get = (who, url) => request(app).get(url).set(auth(who));
  const bal = async (id) => Number((await db('bank_accounts').where({ id }).first()).current_balance);
  const balances = async () => Object.fromEntries(await Promise.all(Object.entries(acc).map(async ([k, a]) => [k, await bal(a.id)])));
  const btFor = (transferId) => db('bank_transactions').where({ fund_transfer_id: transferId }).orderBy('id');
  const journalsFor = (transferNo) => db('journal_entries').where({ ref_no: transferNo }).orderBy('id');
  const paymentsCount = async () => Number((await db('payments').count('* as n').first()).n);
  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  const fee6200 = (pnl) => Number((pnl.expenses.accounts.find((a) => a.code === '6200') || {}).amount || 0);
  const contra = (who, body) => post(who, '/api/finance/contra-transfers', {
    reference: `ZZ-REF-${run}`, client_ref: uuid(), ...body,
  });

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');

    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['owner', 'Owner'], ['fm', 'Finance Manager'], ['op', 'Mill Operator'], ['sa', 'Super Admin']]) {
      const [u] = await db('users').insert({
        email: `zz-contra-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }

    const mk = async (key, row) => {
      const [a] = await db('bank_accounts').insert({ name: `ZZ ${key} ${run}`, is_active: true, ...row }).returning('*');
      // Each account its own GL account under 1000 (G-8), as createBankAccount does.
      const gl = await ensureAccountGl(db, a);
      acc[key] = { ...a, gl_account_id: gl.id };
      glCode[key] = gl.code;
    };
    await mk('hoCash', { type: 'cash', entity: 'general', currency: 'PKR', current_balance: 2000000 });
    await mk('hoBank', { type: 'bank', entity: 'general', currency: 'PKR', current_balance: 1000000 });
    await mk('usdA', { type: 'bank', entity: 'general', currency: 'USD', current_balance: 50000 });
    await mk('usdB', { type: 'bank', entity: 'general', currency: 'USD', current_balance: 0 });
    await mk('millCash', { type: 'cash', entity: 'mill', currency: 'PKR', current_balance: 300000 });
    await mk('millBank', { type: 'bank', entity: 'mill', currency: 'PKR', current_balance: 0 });
  });

  afterAll(async () => { if (db) await db.destroy(); });

  // ── T1 ──
  test('T1 Cash → Bank PKR 500,000 (same entity): both balances move, two linked BT rows, Dr bank GL / Cr cash GL, no payment', async () => {
    const before = await balances();
    const pays = await paymentsCount();
    const res = await contra('fm', { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 500000, currency: 'PKR', transfer_date: TODAY, notes: 'float to bank' });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    expect(t).toMatchObject({ direction: 'internal', status: 'completed', currency: 'PKR', to_currency: 'PKR', fx_unbooked: false });
    expect(Number(t.amount)).toBe(500000);
    expect(Number(t.to_amount)).toBe(500000);
    expect(Number(t.amount_pkr)).toBe(500000);

    const after = await balances();
    expect(after.hoCash - before.hoCash).toBe(-500000);
    expect(after.hoBank - before.hoBank).toBe(500000);

    const bts = await btFor(t.id);
    expect(bts.map((b) => [b.bank_account_id, b.type, Number(b.amount), b.currency, b.category, b.source, b.reference, b.status]))
      .toEqual([
        [acc.hoCash.id, 'debit', 500000, 'PKR', 'Contra Transfer', 'fund_transfer', t.transfer_no, 'posted'],
        [acc.hoBank.id, 'credit', 500000, 'PKR', 'Contra Transfer', 'fund_transfer', t.transfer_no, 'posted'],
      ]);
    // One journal between the two accounts' own GL accounts (G-8).
    const js = await journalsFor(t.transfer_no);
    expect(js.map((j) => [j.ref_type, j.status, j.entity])).toEqual([['Fund Transfer', 'Posted', 'general']]);
    expect(await linesOf(js[0].id)).toEqual([[glCode.hoBank, 500000, 0], [glCode.hoCash, 0, 500000]]);
    expect(t.je_ref_no).toBe(t.transfer_no);
    expect(await paymentsCount()).toBe(pays);
  });

  // ── T2 ──
  test('T2 Bank → Cash PKR 100,000', async () => {
    const before = await balances();
    const res = await contra('fm', { from_account_id: acc.hoBank.id, to_account_id: acc.hoCash.id, amount: 100000 });
    expect(res.status).toBe(200);
    const after = await balances();
    expect(after.hoBank - before.hoBank).toBe(-100000);
    expect(after.hoCash - before.hoCash).toBe(100000);
    const js = await journalsFor(res.body.data.transfer.transfer_no);
    expect(js).toHaveLength(1);
    expect(await linesOf(js[0].id)).toEqual([[glCode.hoCash, 100000, 0], [glCode.hoBank, 0, 100000]]);
  });

  // ── T3 ──
  test('T3 USD Bank A → USD Bank B 10,000: both move in USD, journal between the two USD accounts at the PKR value', async () => {
    const before = await balances();
    const res = await contra('fm', { from_account_id: acc.usdA.id, to_account_id: acc.usdB.id, amount: 10000, currency: 'USD' });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    expect(t).toMatchObject({ currency: 'USD', to_currency: 'USD', fx_unbooked: false });
    const after = await balances();
    expect(after.usdA - before.usdA).toBe(-10000);
    expect(after.usdB - before.usdB).toBe(10000);
    const bts = await btFor(t.id);
    expect(bts.every((b) => b.currency === 'USD' && Number(b.amount) === 10000)).toBe(true);
    const js = await journalsFor(t.transfer_no);
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ orig_currency: 'USD' });
    const pkr = Number(t.amount_pkr);
    expect(pkr).toBeGreaterThan(0);
    expect(await linesOf(js[0].id)).toEqual([[glCode.usdB, pkr, 0], [glCode.usdA, 0, pkr]]);
  });

  // ── T4 ──
  test('T4 USD Bank → PKR Cash 10,000 @ 280 = 2,800,000: native moves, rate stored, FX unbooked, Dr cash GL / Cr USD GL, no FX line', async () => {
    const before = await balances();
    const res = await contra('fm', {
      from_account_id: acc.usdA.id, to_account_id: acc.hoCash.id, amount: 10000, currency: 'USD',
      to_amount: 2800000, to_currency: 'PKR', fx_rate: 280, rate_date: TODAY,
    });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    expect(t).toMatchObject({ currency: 'USD', to_currency: 'PKR', fx_unbooked: true });
    expect(Number(t.to_amount)).toBe(2800000);
    expect(Number(t.fx_rate)).toBe(280);
    expect(Number(t.amount_pkr)).toBe(2800000);
    expect(t.rate_basis).toMatch(new RegExp(`^USD→PKR @ 280 on ${TODAY}`));
    const after = await balances();
    expect(after.usdA - before.usdA).toBe(-10000);
    expect(after.hoCash - before.hoCash).toBe(2800000);
    const bts = await btFor(t.id);
    expect(bts.map((b) => [b.type, Number(b.amount), b.currency])).toEqual([['debit', 10000, 'USD'], ['credit', 2800000, 'PKR']]);
    // The PKR received moves between the two GL accounts; no FX gain/loss (6210).
    const js = await journalsFor(t.transfer_no);
    expect(js).toHaveLength(1);
    expect(await linesOf(js[0].id)).toEqual([[glCode.hoCash, 2800000, 0], [glCode.usdA, 0, 2800000]]);
  });

  test('T4b USD → PKR with USD 5.36 bank charges: extra source debit + Dr 6200 / Cr source GL at the transfer rate', async () => {
    const before = await balances();
    const pnlBefore = await accounting.getProfitAndLoss({});
    const res = await contra('fm', {
      from_account_id: acc.usdA.id, to_account_id: acc.hoCash.id, amount: 1000, currency: 'USD',
      fx_rate: 280, bank_charges: 5.36,
    });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    expect(Number(t.bank_charges)).toBe(5.36);
    const after = await balances();
    expect(Math.round((after.usdA - before.usdA) * 100) / 100).toBe(-1005.36);
    expect(after.hoCash - before.hoCash).toBe(280000);

    const bts = await btFor(t.id);
    expect(bts.map((b) => [b.type, Number(b.amount), b.currency, b.category])).toEqual([
      ['debit', 1000, 'USD', 'Contra Transfer'],
      ['credit', 280000, 'PKR', 'Contra Transfer'],
      ['debit', 5.36, 'USD', 'Bank Charges'],
    ]);
    const js = await journalsFor(t.transfer_no);
    expect(js).toHaveLength(2);
    expect(await linesOf(js[0].id)).toEqual([[glCode.hoCash, 280000, 0], [glCode.usdA, 0, 280000]]);
    expect(js[1]).toMatchObject({ status: 'Posted', orig_currency: 'USD' });
    expect(Number(js[1].orig_fx_rate)).toBe(280);
    expect(await linesOf(js[1].id)).toEqual([['6200', 1500.8, 0], [glCode.usdA, 0, 1500.8]]);

    // The fee is a real expense on the GL P&L.
    const pnlAfter = await accounting.getProfitAndLoss({});
    expect(round2(pnlAfter.expenses.total - pnlBefore.expenses.total)).toBe(1500.8);
    expect(round2(fee6200(pnlAfter) - fee6200(pnlBefore))).toBe(1500.8);
    expect(round2(pnlAfter.net_profit - pnlBefore.net_profit)).toBe(-1500.8);
  });

  // ── T5 ──
  test('T5 same account → 400, nothing written', async () => {
    const n = Number((await db('fund_transfers').count('* as n').first()).n);
    const before = await balances();
    const res = await contra('fm', { from_account_id: acc.hoCash.id, to_account_id: acc.hoCash.id, amount: 10 });
    expect(res.status).toBe(400);
    expect(Number((await db('fund_transfers').count('* as n').first()).n)).toBe(n);
    expect(await balances()).toEqual(before);
  });

  test('validation: amount ≤ 0, missing account, missing reference, wrong currency, missing rate, rate/dest mismatch', async () => {
    const before = await balances();
    const base = { from_account_id: acc.usdA.id, to_account_id: acc.hoCash.id, currency: 'USD' };
    const cases = [
      { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 0 },
      { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: -5 },
      { to_account_id: acc.hoBank.id, amount: 5 },
      { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 5, reference: '' },
      { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 5, currency: 'USD' }, // source is PKR
      { ...base, amount: 100, to_currency: 'USD' }, // destination is PKR
      { ...base, amount: 100 }, // missing rate
      { ...base, amount: 100, fx_rate: 280, to_amount: 29000 }, // 100 × 280 = 28,000
    ];
    for (const body of cases) {
      const res = await contra('fm', body);
      expect([res.status, body]).toEqual([400, body]);
    }
    expect(await balances()).toEqual(before);
  });

  test('insufficient source balance → 409, nothing moves', async () => {
    const before = await balances();
    const res = await contra('fm', { from_account_id: acc.millBank.id, to_account_id: acc.millCash.id, amount: before.millBank + 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Insufficient balance/);
    expect(await balances()).toEqual(before);
  });

  // ── T6 ──
  test('T6 duplicate client_ref → 409 returning the existing transfer; only one recorded', async () => {
    const ref = uuid();
    const body = { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 1234, client_ref: ref };
    const first = await contra('fm', body);
    expect(first.status).toBe(200);
    const before = await balances();
    const second = await contra('fm', body);
    expect(second.status).toBe(409);
    expect(second.body.data.transfer.id).toBe(first.body.data.transfer.id);
    expect(await db('fund_transfers').where({ client_ref: ref })).toHaveLength(1);
    expect(await balances()).toEqual(before);
  });

  test('T6b two identical submissions at the same moment: one 200, one 409, one transfer', async () => {
    const ref = uuid();
    const body = { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 4321, client_ref: ref };
    const before = await balances();
    const [a, b] = await Promise.all([contra('fm', body), contra('fm', body)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await db('fund_transfers').where({ client_ref: ref })).toHaveLength(1);
    const after = await balances();
    expect(after.hoCash - before.hoCash).toBe(-4321);
  });

  // ── T7 ──
  test('T7 reverse: both sides back, charges journal mirrored by delta, status reversed, 2nd reverse 409', async () => {
    const start = await balances();
    const res = await contra('fm', { from_account_id: acc.hoBank.id, to_account_id: acc.hoCash.id, amount: 50000, bank_charges: 1500 });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    let mid = await balances();
    expect(mid.hoBank - start.hoBank).toBe(-51500);
    expect(mid.hoCash - start.hoCash).toBe(50000);

    // Reason is required; Finance Manager may not reverse.
    expect((await post('owner', `/api/finance/fund-transfers/${t.id}/reverse`, {})).status).toBe(400);
    expect((await post('fm', `/api/finance/fund-transfers/${t.id}/reverse`, { reason: 'x' })).status).toBe(403);

    const rev = await post('owner', `/api/finance/fund-transfers/${t.id}/reverse`, { reason: 'wrong bank' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.transfer).toMatchObject({ status: 'reversed', reversal_reason: 'wrong bank' });
    expect(rev.body.data.transfer.reversed_by).toBeTruthy();
    expect(rev.body.data.transfer.reversed_at).toBeTruthy();
    expect(await balances()).toEqual(start);

    const bts = await btFor(t.id);
    expect(bts.map((b) => [b.bank_account_id, b.type, Number(b.amount), b.category])).toEqual([
      [acc.hoBank.id, 'debit', 50000, 'Contra Transfer'],
      [acc.hoCash.id, 'credit', 50000, 'Contra Transfer'],
      [acc.hoBank.id, 'debit', 1500, 'Bank Charges'],
      [acc.hoBank.id, 'credit', 50000, 'Contra Transfer Reversal'],
      [acc.hoBank.id, 'credit', 1500, 'Bank Charges Reversal'],
      [acc.hoCash.id, 'debit', 50000, 'Contra Transfer Reversal'],
    ]);
    const js = await journalsFor(t.transfer_no);
    expect(js.map((j) => [j.ref_type, j.status])).toEqual([
      ['Fund Transfer', 'Posted'], ['Fund Transfer', 'Posted'],
      ['Fund Transfer Reversal', 'Posted'], ['Fund Transfer Reversal', 'Posted'],
    ]);
    // Original + delta net to zero on 6200 and both accounts' GL.
    const net = await db('journal_lines').whereIn('journal_id', js.map((j) => j.id))
      .select(db.raw('SUM(debit) - SUM(credit) AS n')).first();
    expect(Number(net.n)).toBe(0);
    const perAcct = await db('journal_lines').whereIn('journal_id', js.map((j) => j.id))
      .groupBy('account_id').select('account_id', db.raw('SUM(debit) - SUM(credit) AS n'));
    expect(perAcct.every((r) => Number(r.n) === 0)).toBe(true);

    const again = await post('owner', `/api/finance/fund-transfers/${t.id}/reverse`, { reason: 'again' });
    expect(again.status).toBe(409);
    mid = await balances();
    expect(mid).toEqual(start);
  });

  test('T7b edit = reverse + replace: original reversed, new linked transfer, net balances = new amounts', async () => {
    const start = await balances();
    const res = await contra('fm', { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 70000 });
    const t = res.body.data.transfer;

    const edit = { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 75000, reference: `ZZ-EDIT-${run}`, client_ref: uuid() };
    expect((await post('fm', `/api/finance/fund-transfers/${t.id}/replace`, { ...edit, reason: 'typo' })).status).toBe(403);
    expect((await post('owner', `/api/finance/fund-transfers/${t.id}/replace`, edit)).status).toBe(400); // no reason

    const out = await post('owner', `/api/finance/fund-transfers/${t.id}/replace`, { ...edit, reason: 'typo in amount' });
    expect(out.status).toBe(200);
    const { original, transfer } = out.body.data;
    expect(original).toMatchObject({ id: t.id, status: 'reversed', replaced_by_id: transfer.id });
    expect(original.reversal_reason).toMatch(/typo in amount/);
    expect(transfer).toMatchObject({ status: 'completed', replaces_id: t.id, reference: `ZZ-EDIT-${run}` });
    expect(Number(transfer.amount)).toBe(75000);

    const end = await balances();
    expect(end.hoCash - start.hoCash).toBe(-75000);
    expect(end.hoBank - start.hoBank).toBe(75000);

    // A reversed transfer cannot be edited again; the detail shows both links.
    expect((await post('owner', `/api/finance/fund-transfers/${t.id}/replace`, { ...edit, client_ref: uuid(), reason: 'x' })).status).toBe(409);
    const detail = await get('owner', `/api/finance/fund-transfers/${transfer.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.transfer).toMatchObject({ replaces_transfer_no: t.transfer_no });
    expect(detail.body.data.transfer.bank_transactions).toHaveLength(2);
    const origDetail = await get('fm', `/api/finance/fund-transfers/${t.id}`);
    expect(origDetail.body.data.transfer).toMatchObject({ replaced_by_transfer_no: transfer.transfer_no, status: 'reversed' });
    expect(origDetail.body.data.transfer.reversed_by_name).toMatch(/ZZ Owner/);
  });

  test('edit failure rolls everything back (replacement invalid → original untouched)', async () => {
    const res = await contra('fm', { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 1000 });
    const t = res.body.data.transfer;
    const before = await balances();
    const bad = await post('owner', `/api/finance/fund-transfers/${t.id}/replace`, {
      from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 99999999999, reference: 'x', reason: 'too much',
    });
    expect(bad.status).toBe(409);
    expect((await db('fund_transfers').where({ id: t.id }).first()).status).toBe('completed');
    expect(await balances()).toEqual(before);
  });

  // ── Cross-entity routing ──
  test('Head Office → Mill picked in the contra drawer becomes a pending ho_to_mill transfer (awaits the mill)', async () => {
    const before = await balances();
    const res = await contra('fm', { from_account_id: acc.hoBank.id, to_account_id: acc.millCash.id, amount: 20000 });
    expect(res.status).toBe(200);
    const t = res.body.data.transfer;
    expect(t).toMatchObject({ direction: 'ho_to_mill', status: 'pending' });
    const after = await balances();
    expect(after.hoBank - before.hoBank).toBe(-20000);
    expect(after.millCash - before.millCash).toBe(0);
    const hoJs = await journalsFor(t.transfer_no);
    expect(hoJs.map((j) => j.entity)).toEqual(['general']);
    // The sender's half credits the sending account's own GL.
    expect(await linesOf(hoJs[0].id)).toEqual([['1130', 20000, 0], [glCode.hoBank, 0, 20000]]);
    // USD across entities is refused (the two-phase flow is PKR-only).
    const usd = await contra('fm', { from_account_id: acc.usdA.id, to_account_id: acc.millCash.id, amount: 1, fx_rate: 280 });
    expect(usd.status).toBe(400);
  });

  // ── Permissions ──
  test('permission matrix: Mill Operator limited to mill accounts; Finance Manager creates; Owner reverses', async () => {
    // Mill-only payer: HO account → 403, mill → mill OK.
    const ho = await contra('op', { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 10 });
    expect(ho.status).toBe(403);
    expect(ho.body.message).toMatch(/mill's own accounts/);
    const mixed = await contra('op', { from_account_id: acc.millCash.id, to_account_id: acc.hoBank.id, amount: 10 });
    expect(mixed.status).toBe(403);
    const ok = await contra('op', { from_account_id: acc.millCash.id, to_account_id: acc.millBank.id, amount: 10 });
    expect(ok.status).toBe(200);
    // Mill Operator cannot reverse or edit.
    expect((await post('op', `/api/finance/fund-transfers/${ok.body.data.transfer.id}/reverse`, { reason: 'x' })).status).toBe(403);
    // Super Admin can.
    expect((await post('sa', `/api/finance/fund-transfers/${ok.body.data.transfer.id}/reverse`, { reason: 'test' })).status).toBe(200);
  });

  // ── T8 dashboards ──
  test('T8 dashboards: Money Out / Money In / printable cash flow / P&L / mill cash flow unchanged; Cash totals right', async () => {
    const range = `from=2000-01-01&to=2100-12-31`;
    const snap = async () => {
      const [out, inn, cf, pnl, mill, accts] = await Promise.all([
        get('owner', '/api/finance/payables'),
        get('owner', '/api/finance/receivables'),
        get('owner', `/api/reporting/printable/cashflow?${range}`),
        get('owner', `/api/reporting/printable/pnl?${range}`),
        get('owner', '/api/milling/cash-flow'),
        get('owner', '/api/finance/bank-accounts'),
      ]);
      for (const r of [out, inn, cf, pnl, mill, accts]) expect(r.status).toBe(200);
      const totals = {};
      for (const a of accts.body.data.accounts) totals[a.currency || 'PKR'] = (totals[a.currency || 'PKR'] || 0) + Number(a.current_balance);
      const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/generated|timestamp|^now$/i.test(k) ? undefined : v)));
      return {
        moneyOut: strip(out.body), moneyIn: strip(inn.body), cashflow: strip(cf.body), pnl: strip(pnl.body),
        glPnl: await accounting.getProfitAndLoss({}),
        mill: { ledger: mill.body.data.ledger, summary: mill.body.data.summary },
        payments: await paymentsCount(), totals,
      };
    };

    // Real activity first, so every feed has something in it: a paid Head
    // Office expense (payable + payment + journals) and a Mill → HO transfer
    // (a mill cash-flow row).
    await require('../modules/expenses/expenses.service').create({
      expense_type: 'general', category: 'utilities', amount: 4321, currency: 'PKR', expense_date: TODAY,
      vendor_name: `ZZ Vendor ${run}`, pay_now: true, bank_account_id: acc.hoBank.id, payment_method: 'bank_transfer',
    }, null);
    expect((await post('fm', '/api/finance/fund-transfers', { direction: 'mill_to_ho', from_account_id: acc.millCash.id, to_account_id: acc.hoBank.id, amount: 333 })).status).toBe(200);

    const s0 = await snap();
    expect(JSON.stringify(s0.moneyOut)).toMatch(new RegExp(`ZZ Vendor ${run}|PAY-EXP`));
    expect(s0.cashflow.data.summary.outCount).toBeGreaterThan(0);
    expect(s0.mill.ledger.length).toBeGreaterThan(0);
    expect(s0.glPnl.expenses.total).toBeGreaterThan(0);
    // A Head Office contra, a USD → PKR contra and a mill-internal contra.
    expect((await contra('fm', { from_account_id: acc.hoBank.id, to_account_id: acc.hoCash.id, amount: 11111 })).status).toBe(200);
    expect((await contra('fm', { from_account_id: acc.usdA.id, to_account_id: acc.hoBank.id, amount: 100, fx_rate: 280 })).status).toBe(200);
    expect((await contra('fm', { from_account_id: acc.millCash.id, to_account_id: acc.millBank.id, amount: 2222 })).status).toBe(200);
    const s1 = await snap();

    expect(s1.moneyOut).toEqual(s0.moneyOut);
    expect(s1.moneyIn).toEqual(s0.moneyIn);
    expect(s1.cashflow).toEqual(s0.cashflow);
    expect(s1.pnl).toEqual(s0.pnl);
    expect(s1.glPnl).toEqual(s0.glPnl);
    expect(s1.mill).toEqual(s0.mill); // internal mill contra is not cash flow
    expect(s1.payments).toBe(s0.payments);
    // Cash page: PKR total moves only by the FX leg's PKR side (+28,000); USD by −100.
    expect(Math.round((s1.totals.PKR - s0.totals.PKR) * 100) / 100).toBe(28000);
    expect(Math.round((s1.totals.USD - s0.totals.USD) * 100) / 100).toBe(-100);

    // A bank charge is the one thing that does reach the GL P&L.
    expect((await contra('fm', { from_account_id: acc.hoBank.id, to_account_id: acc.hoCash.id, amount: 100, bank_charges: 250 })).status).toBe(200);
    const s2 = await snap();
    expect(s2.moneyOut).toEqual(s0.moneyOut);
    expect(s2.moneyIn).toEqual(s0.moneyIn);
    expect(s2.cashflow).toEqual(s0.cashflow);
    expect(s2.payments).toBe(s0.payments);
    expect(round2(fee6200(s2.glPnl) - fee6200(s1.glPnl))).toBe(250);
    expect(round2(s2.glPnl.net_profit - s1.glPnl.net_profit)).toBe(-250);
    // Operational P&L reads business_expenses: the fee is GL-only (see the
    // service header), so it does not move there.
    expect(s2.pnl).toEqual(s0.pnl);
  });

  test('bank-transactions feed labels contra rows with the transfer', async () => {
    const res = await contra('fm', { from_account_id: acc.hoCash.id, to_account_id: acc.hoBank.id, amount: 77 });
    const t = res.body.data.transfer;
    const feed = await get('fm', `/api/finance/bank-transactions?bank_account_id=${acc.hoBank.id}&limit=5`);
    const row = feed.body.data.transactions.find((r) => r.fund_transfer_id === t.id);
    expect(row).toMatchObject({ ft_direction: 'internal', ft_transfer_no: t.transfer_no, ft_from_account_name: acc.hoCash.name, ft_to_account_name: acc.hoBank.name, category: 'Contra Transfer' });
  });
});
