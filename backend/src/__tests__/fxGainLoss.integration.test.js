/**
 * FX gain / loss (G-7), against a real, fully-migrated Postgres.
 *
 *  Realised — a foreign receipt on Export AR (1110) credits AR at the rate the
 *  receivable was BOOKED at; the bank takes what the receipt fetched; the
 *  difference posts to 6210 in the same journal (gain and loss), and a
 *  reversal of the payment nets all three lines.
 *
 *  Month-end revaluation — POST /api/accounting/fx-revaluation: open USD AR +
 *  the USD account's GL restated at the month's closing rate, journal dated
 *  month-end, automatic reversal dated the 1st; a second run is refused, a
 *  rerun nets the old pair by delta; a month with no rate is refused (never
 *  the 280 fallback); preview posts nothing.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('FX gain / loss (DB-gated)', () => {
  let db; let app; let request; let accounting; let engine; let tok; let userId;
  const run = `${Date.now()}`.slice(-7);
  // A month of its own per run, so re-runs on the same DB never collide.
  const YEAR = 2200 + (Number(run) % 700);
  const MONTH = `${YEAR}-03`;
  const acc = {};
  const code = {};
  const ids = {};

  const lines = async (where) => (await db('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.status': 'Posted', ...where })
    .orderBy(['je.id', 'jl.id'])
    .select('c.code', 'jl.debit', 'jl.credit', db.raw("to_char(je.date, 'YYYY-MM-DD') AS date"), 'je.ref_type', 'je.entity'))
    .map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }));
  const net = (ls, c, upTo) => Math.round(ls.filter((l) => l.code === c && (!upTo || l.date <= upTo))
    .reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
  const post = (body) => request(app).post('/api/accounting/fx-revaluation').set({ Authorization: `Bearer ${tok}` }).send(body);

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    engine = require('../modules/finance/paymentEngine');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const { ensureAccountGl } = require('../shared/accountGl');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-fx-${run}@test.local`, full_name: `ZZ FX ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    userId = u.id;
    tok = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    for (const [key, row] of [['usd', { currency: 'USD', entity: 'export', current_balance: 0 }]]) {
      const [a] = await db('bank_accounts').insert({ name: `ZZ FX ${key} ${run}`, type: 'bank', is_active: true, ...row }).returning('*');
      const g = await ensureAccountGl(db, a);
      acc[key] = { ...a, gl_account_id: g.id };
      code[key] = g.code;
    }
    const [cust] = await db('customers').insert({ name: `ZZ FX Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const product = await db('products').first('id');
    Object.assign(ids, { cust: cust.id, product: product.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const receivable = async (tag, usd, booked) => (await db('receivables').insert({
    recv_no: `ZZ-FX-${tag}-${run}`, type: 'Balance', entity: 'export', customer_id: ids.cust, currency: 'USD',
    expected_amount: usd, received_amount: 0, outstanding: usd, base_amount_pkr: usd * booked, fx_rate: booked, status: 'Pending',
  }).returning('*'))[0];
  const receipt = (rcv, usd, rate) => db.transaction((trx) => engine.recordMoneyMovement(trx, {
    type: 'receipt', receivableId: rcv.id, amount: usd, currency: 'USD', fxRate: rate,
    method: 'bank_transfer', bankAccountId: acc.usd.id, paymentDate: '2026-10-09', userId,
  }));

  test('realised GAIN: booked 280, received 285 → Dr USD GL 28,500 / Cr 1110 28,000 / Cr 6210 500', async () => {
    const rcv = await receivable('G', 100, 280);
    const { payment } = await receipt(rcv, 100, 285);
    const ls = await lines({ 'je.ref_no': payment.payment_no });
    expect(ls.map((l) => [l.code, l.debit, l.credit])).toEqual([[code.usd, 28500, 0], ['1110', 0, 28000], ['6210', 0, 500]]);
    // The USD account moved its own currency.
    expect(Number((await db('bank_accounts').where({ id: acc.usd.id }).first()).current_balance)).toBe(100);

    // Reversal by signed delta nets every line, 6210 included.
    const { postDeltaOf } = require('../modules/finance/paymentSettlement');
    await db.transaction((trx) => postDeltaOf(trx, { refNo: payment.payment_no, refType: 'Payment Reversal', cashAccountId: acc.usd.id }));
    const after = await lines({ 'je.ref_no': payment.payment_no });
    expect([net(after, code.usd), net(after, '1110'), net(after, '6210')]).toEqual([0, 0, 0]);
  });

  test('realised LOSS: booked 280, received 275 → Dr USD GL 27,500 + Dr 6210 500 / Cr 1110 28,000', async () => {
    const rcv = await receivable('L', 100, 280);
    const { payment } = await receipt(rcv, 100, 275);
    const ls = await lines({ 'je.ref_no': payment.payment_no });
    expect(ls.map((l) => [l.code, l.debit, l.credit])).toEqual([[code.usd, 27500, 0], ['1110', 0, 28000], ['6210', 500, 0]]);
  });

  test('same rate → no 6210 line; a PKR receipt never gets one', async () => {
    const rcv = await receivable('S', 10, 280);
    const { payment } = await receipt(rcv, 10, 280);
    expect((await lines({ 'je.ref_no': payment.payment_no })).map((l) => l.code)).toEqual([code.usd, '1110']);
  });

  describe('month-end revaluation', () => {
    const monthStart = `${MONTH}-01`;
    const monthEnd = `${MONTH}-31`;
    const nextFirst = `${YEAR}-04-01`;
    const ref = `FXREV-USD-${MONTH}`;

    beforeAll(async () => {
      // A second USD account so the month's bank figures are this test's own.
      const { ensureAccountGl } = require('../shared/accountGl');
      const [a] = await db('bank_accounts').insert({ name: `ZZ FX rev ${run}`, type: 'bank', currency: 'USD', entity: 'general', is_active: true, current_balance: 1000 }).returning('*');
      const g = await ensureAccountGl(db, a);
      acc.rev = { ...a, gl_account_id: g.id };
      code.rev = g.code;
      const [cash3000, ar, rev] = await Promise.all(['3000', '1110', '4010'].map((c) => db('chart_of_accounts').where({ code: c }).first()));
      // The account's PKR book value: 1,000 USD @ 280.
      await db.transaction(async (trx) => {
        const j = await accounting.createJournal(trx, {
          date: monthStart, entity: 'general', refType: 'ZZ Test', refNo: `ZZ-FXOB-${run}`, description: 'usd opening', currency: 'PKR', fxRate: 1, isAuto: true,
          lines: [{ account_id: g.id, account: g.name, debit: 280000, credit: 0 }, { account_id: cash3000.id, account: cash3000.name, debit: 0, credit: 280000 }],
        });
        await accounting.postJournal(trx, j.id);
      });
      // A shipped order: AR of USD 2,000 booked @ 280 on the 1st.
      const orderNo = `ZZFXO-${run}`;
      const [order] = await db('export_orders').insert({
        order_no: orderNo, customer_id: ids.cust, product_id: ids.product, qty_mt: 4, price_per_mt: 500,
        contract_value: 2000, currency: 'USD', advance_pct: 0, advance_expected: 0, balance_expected: 2000,
        status: 'Shipped', booked_fx_rate: 280, created_by: userId,
      }).returning('*');
      await db('receivables').insert({
        recv_no: `ZZ-FXREV-${run}`, type: 'Balance', entity: 'export', order_id: order.id, customer_id: ids.cust, currency: 'USD',
        expected_amount: 2000, received_amount: 0, outstanding: 2000, base_amount_pkr: 560000, status: 'Pending',
      });
      await db.transaction(async (trx) => {
        const j = await accounting.createJournal(trx, {
          date: monthStart, entity: 'export', refType: 'Export Order', refNo: orderNo, description: 'revenue', currency: 'PKR', fxRate: 1, isAuto: true,
          lines: [{ account_id: ar.id, account: ar.name, debit: 560000, credit: 0 }, { account_id: rev.id, account: rev.name, debit: 0, credit: 560000 }],
        });
        await accounting.postJournal(trx, j.id);
      });
    });

    test('no closing rate for the month → 400, nothing posted (no 280 fallback)', async () => {
      const res = await post({ month_end: monthEnd });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/No USD→PKR rate/);
      expect(await lines({ 'je.ref_no': ref })).toHaveLength(0);
    });

    test('preview computes without posting; post books month-end + auto-reversal on the 1st', async () => {
      await db('fx_rates').insert({ from_currency: 'USD', to_currency: 'PKR', rate: 290, effective_date: `${MONTH}-20`, source: 'manual', is_active: true });
      const pv = await post({ month_end: MONTH, preview: true });
      expect(pv.status).toBe(200);
      expect(pv.body.data).toMatchObject({ preview: true, rate: 290, monthEnd });
      // This order's AR: USD 2,000 × (290 − 280). (Earlier runs' open AR on
      // the same DB is revalued too — totals are read from the response.)
      expect(pv.body.data.ar.find((x) => x.recv_no === `ZZ-FXREV-${run}`)).toMatchObject({ open_foreign: 2000, booked_rate: 280, unrealised_pkr: 20000 });
      expect(pv.body.data.banks.find((b) => b.bank_account_id === acc.rev.id)).toMatchObject({ native_balance: 1000, book_pkr: 280000, unrealised_pkr: 10000 });
      expect(await lines({ 'je.ref_no': ref })).toHaveLength(0);

      const res = await post({ month_end: monthEnd });
      expect(res.status).toBe(201);
      const { arUnrealised, total } = res.body.data;
      const ls = await lines({ 'je.ref_no': ref });
      // Month-end: AR up by the AR figure (export), this USD account +10,000
      // (general) — the gains on 6210.
      expect(net(ls, '1110', monthEnd)).toBe(arUnrealised);
      expect(net(ls, code.rev, monthEnd)).toBe(10000);
      expect(net(ls, '6210', monthEnd)).toBe(-total);
      // The 1st of next month: everything back to book.
      expect([net(ls, '1110'), net(ls, code.rev), net(ls, '6210'), net(ls, code.usd)]).toEqual([0, 0, 0, 0]);
      expect(ls.filter((l) => l.ref_type === 'FX Revaluation').every((l) => l.date === monthEnd)).toBe(true);
      expect(ls.filter((l) => l.ref_type === 'FX Revaluation Reversal').every((l) => l.date === nextFirst)).toBe(true);
      const row = await db('fx_revaluations').where({ currency: 'USD', month_end: monthEnd, status: 'posted' }).first();
      expect(row).toMatchObject({ created_by: userId });
      expect(Number(row.rate)).toBe(290);
      const audit = await db('audit_logs').where({ action: 'fx_revaluation', entity_id: String(row.id) }).first().catch(() => null);
      if (audit !== null) expect(audit).toBeTruthy();
    });

    test('second run refused (409); rerun nets the old pair by delta and posts afresh', async () => {
      const again = await post({ month_end: monthEnd });
      expect(again.status).toBe(409);
      // A later closing rate in the month, then an explicit re-run.
      await db('fx_rates').insert({ from_currency: 'USD', to_currency: 'PKR', rate: 285, effective_date: `${MONTH}-28`, source: 'manual', is_active: true });
      const rr = await post({ month_end: monthEnd, rerun: true });
      expect(rr.status).toBe(201);
      expect(rr.body.data.corrections.length).toBeGreaterThan(0);
      expect(rr.body.data.ar.find((x) => x.recv_no === `ZZ-FXREV-${run}`).unrealised_pkr).toBe(10000);
      const ls = await lines({ 'je.ref_no': ref });
      // Only the new figures stand at month-end: account 1,000 × 285 − 280,000.
      expect(net(ls, '1110', monthEnd)).toBe(rr.body.data.arUnrealised);
      expect(net(ls, code.rev, monthEnd)).toBe(5000);
      expect(net(ls, '6210', monthEnd)).toBe(-rr.body.data.total);
      expect([net(ls, '1110'), net(ls, code.rev), net(ls, '6210')]).toEqual([0, 0, 0]);
      const rows = await db('fx_revaluations').where({ currency: 'USD', month_end: monthEnd }).orderBy('id');
      expect(rows.map((r) => r.status)).toEqual(['superseded', 'posted']);
      expect(rows[0].superseded_by).toBe(rows[1].id);
    });

    test('a role without finance.post_journal cannot revalue', async () => {
      const jwt = require('jsonwebtoken');
      const config = require('../config');
      const role = await db('roles').where({ name: 'Mill Operator' }).first();
      const [u] = await db('users').insert({
        email: `zz-fx-op-${run}@test.local`, full_name: `ZZ FX Op ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
      }).returning('*');
      const t = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
      const res = await request(app).post('/api/accounting/fx-revaluation').set({ Authorization: `Bearer ${t}` }).send({ month_end: monthEnd, preview: true });
      expect(res.status).toBe(403);
    });
  });
});
