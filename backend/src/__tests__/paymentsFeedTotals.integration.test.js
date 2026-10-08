/**
 * Money In / Money Out totals (Reports hub) — DB-gated, real SQL.
 *
 * GET /finance/payments summed `totalPkr` over the rows it returned: Reversed
 * payments and uncleared cheques were counted as money, USD was converted and
 * added into the rupee total, and only the first 500 rows were ever summed.
 * Totals now come from SQL over the whole filtered set, per currency, with
 * pending cheques and reversals reported on their own.
 *
 * Local run: see exportShipmentCogs.integration.test.js header (migrate first).
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('payments feed totals (DB-gated)', () => {
  let db; let controller;
  const run = `${Date.now()}`.slice(-7);
  const DAY = '2031-01-15'; // a date no other test writes, so the set is ours

  const list = async (query) => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await controller.listPayments({ query: { from_date: DAY, to_date: DAY, ...query }, user: { _roleName: 'Super Admin' } }, res);
    return res;
  };

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/finance/finance.controller');
    const row = (no, o) => ({
      payment_no: `ZZ-${no}-${run}`, type: 'receipt', amount: 0, currency: 'PKR', fx_rate: 1, base_amount_pkr: 0,
      payment_method: 'cash', payment_date: DAY, status: 'Confirmed', cleared: true, ...o,
    });
    await db('payments').insert([
      row('R1', { amount: 1000, base_amount_pkr: 1000 }),
      row('R2', { amount: 2000, base_amount_pkr: 2000 }),
      row('REV', { amount: 500, base_amount_pkr: 500, status: 'Reversed' }),
      row('CHQ', { amount: 300, base_amount_pkr: 300, payment_method: 'cheque', cleared: false }),
      row('USD', { amount: 100, currency: 'USD', fx_rate: 280, base_amount_pkr: 28000, payment_method: 'bank_transfer' }),
      row('PFC', { amount: 9999, base_amount_pkr: 9999, status: 'Pending Finance Confirmation' }),
      row('OUT', { type: 'payment', amount: 700, base_amount_pkr: 700 }),
    ]);
  });
  afterAll(async () => {
    await db('payments').where('payment_no', 'like', `ZZ-%-${run}`).del();
    await db.destroy();
  });

  test('receipts: settled money only, per currency, never added together', async () => {
    const { body } = await list({ type: 'receipt' });
    expect(body.success).toBe(true);
    expect(body.data.totals).toEqual({ PKR: { amount: 3000, count: 2 }, USD: { amount: 100, count: 1 } });
    expect(body.data.pending_cheques).toEqual({ PKR: { amount: 300, count: 1 } });
    expect(body.data.reversed_count).toBe(1);
    // The old single figure (1000+2000+500+300+28000 = 31,800) is gone.
    expect(body.data.totalPkr).toBeUndefined();
  });

  test('the list still shows reversed / uncleared rows, flagged as not counting', async () => {
    const { body } = await list({ type: 'receipt' });
    const byNo = Object.fromEntries(body.data.payments.map((p) => [p.payment_no.split('-')[1], p]));
    expect(Object.keys(byNo).sort()).toEqual(['CHQ', 'R1', 'R2', 'REV', 'USD']); // never-money PFC excluded
    expect(byNo.REV.counts_in_total).toBe(false);
    expect(byNo.CHQ.counts_in_total).toBe(false);
    expect(byNo.R1.counts_in_total).toBe(true);
  });

  test('a capped page still totals the whole set and says how many rows match', async () => {
    const { body } = await list({ type: 'receipt', limit: 2 });
    expect(body.data.payments).toHaveLength(2);
    expect(body.data.count).toBe(2);
    expect(body.data.total_count).toBe(5);
    expect(body.data.truncated).toBe(true);
    expect(body.data.totals.PKR.amount).toBe(3000);
  });

  test('source breakdown is server-side and per currency', async () => {
    const { body } = await list({ type: 'receipt' });
    expect(body.data.by_source).toEqual([
      { name: 'Other Receipt', currency: 'PKR', amount: 3000, count: 2 },
      { name: 'Other Receipt', currency: 'USD', amount: 100, count: 1 },
    ]);
  });

  test('payments are totalled on their own', async () => {
    const { body } = await list({ type: 'payment' });
    expect(body.data.totals).toEqual({ PKR: { amount: 700, count: 1 } });
    expect(body.data.by_source).toEqual([{ name: 'Other Payment', currency: 'PKR', amount: 700, count: 1 }]);
  });
});

describe('payments feed totals — the rules (no DB)', () => {
  const { SETTLED, PENDING_CHEQUE, NEVER_MONEY } = require('../modules/finance/paymentsFeedTotals');
  test('a total counts neither reversed payments nor uncleared cheques', () => {
    expect(SETTLED).toMatch(/p\.status <> 'Reversed'/);
    expect(SETTLED).toMatch(/p\.cleared IS NOT FALSE/);
    expect(PENDING_CHEQUE).toMatch(/p\.cleared IS FALSE/);
    expect(NEVER_MONEY).toEqual(['Pending Finance Confirmation', 'Rejected']);
  });
  test('the controller no longer sums a page of rows into one PKR figure', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../modules/finance/finance.controller.js'), 'utf8');
    const body = src.slice(src.indexOf('async listPayments('), src.indexOf('async recordPayment('));
    expect(body).toMatch(/feedTotals\(db, filters\)/);
    expect(body).not.toMatch(/totalPkr/);
  });
});
