/**
 * P4-04 / FIN-09 / RPT-06 / RPT-10 — receivables AS AT a date, golden numbers
 * against Postgres:
 *
 *   aging total = AR sub-ledger = GL control (1110 Export AR) at a date.
 *
 * One USD balance of 1,000 booked at 280 (Rs 280,000), due 31 Aug 2028;
 * USD 400 received on 10 Sep 2028 at the booked rate. GL: Dr 1110 / Cr 4010
 * Rs 280,000 on 1 Aug; Dr bank / Cr 1110 Rs 112,000 on 10 Sep (party-stamped).
 *
 *   as at 31 Aug: USD 1,000 open, due that day → not yet overdue ('current');
 *                 ≈ Rs 280,000 = GL 1110 for the customer.
 *   as at 30 Sep: USD 600 open, 30 days past due ('1-30'); ≈ Rs 168,000
 *                 (base × outstanding / expected — never the full booked
 *                 figure) = GL 1110 for the customer.
 *   as at 31 Jul: nothing — the receivable did not exist yet.
 *
 * Plus: a written-off and a paid receivable are not open today (RECEIVABLE_
 * CLOSED), yet the paid one WAS open before its receipt; a receivable on a
 * Draft / Cancelled order never counts; a PKR row stays its own currency; the
 * printable AR aging and Money In's summary say the same, per currency.
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rbac', () => () => (req, res, next) => next());

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('receivables as at a date (DB-gated)', () => {
  let db; let asAt; let accounting;
  const run = `${Date.now()}`.slice(-7);
  const made = { receivables: [], payments: [], journals: [], orders: [] };
  let customer; let user; let acc = {};

  const mine = (rows) => rows.filter((r) => r.customerId === customer.id);
  const gl1110 = async (asOf) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted').where('jl.account_id', acc['1110'].id)
      .where('je.party_type', 'customer').where('je.party_id', customer.id)
      .where('je.date', '<=', asOf)
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS bal')).first();
    return r.bal;
  };
  const journal = async (date, debitCode, creditCode, amount) => {
    const j = await accounting.createJournal(null, {
      date, entity: 'export', refType: 'test', refNo: `ZZ-AR-${run}`, description: `ZZ AR ${run}`,
      partyType: 'customer', partyId: customer.id,
      lines: [{ account_id: acc[debitCode].id, debit: amount, credit: 0 }, { account_id: acc[creditCode].id, debit: 0, credit: amount }],
    });
    await accounting.postJournal(null, j.id);
    made.journals.push(j.id);
  };
  const order = async (status, extra = {}) => {
    const product = await db('products').first();
    const [o] = await db('export_orders').insert({
      order_no: `ZZAR${status.slice(0, 2)}${run}`, customer_id: customer.id, product_id: product.id, created_by: user.id, status, ...extra,
    }).returning('*');
    made.orders.push(o.id);
    return o;
  };
  const receivable = async (fields) => {
    const [r] = await db('receivables').insert({
      recv_no: `ZZ-AR-${run}-${made.receivables.length}`, customer_id: customer.id, entity: 'export', ...fields,
    }).returning('*');
    made.receivables.push(r.id);
    return r;
  };

  beforeAll(async () => {
    db = require('../config/database');
    asAt = require('../modules/finance/receivablesAsAt');
    accounting = require('../modules/accounting/accounting.service');
    const bcrypt = require('bcryptjs');
    const role = await db('roles').where({ name: 'Finance Manager' }).first();
    [user] = await db('users').insert({
      email: `zz-ar-${run}@test.local`, full_name: `ZZ AR ${run}`,
      password_hash: await bcrypt.hash('pw', 4), role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    [customer] = await db('customers').insert({ name: `ZZ AR customer ${run}`, customer_type: 'export' }).returning('*');
    for (const code of ['1000', '1110', '4010']) acc[code] = await db('chart_of_accounts').where({ code }).first();

    // The golden receivable: USD 1,000 at 280, 400 received on 10 Sep 2028.
    // Sailed 16 Jul 2028 on 30-day terms: its BALANCE is due 15 Aug (D-15).
    const shipped = await order('Shipped', { bl_date: '2028-07-16', balance_term_days: 30 });
    const r = await receivable({
      order_id: shipped.id, type: 'Advance', currency: 'USD', fx_rate: 280, base_amount_pkr: 280000,
      expected_amount: 1000, received_amount: 400, outstanding: 600, status: 'Partial',
      due_date: '2028-08-31', created_at: '2028-08-01T10:00:00+05:00',
    });
    const [p] = await db('payments').insert({
      payment_no: `ZZ-AR-PAY-${run}`, type: 'receipt', amount: 400, currency: 'USD', fx_rate: 280, base_amount_pkr: 112000,
      payment_method: 'bank_transfer', payment_date: '2028-09-10', linked_receivable_id: r.id, status: 'Confirmed',
    }).returning('*');
    made.payments.push(p.id);
    await journal('2028-08-01', '1110', '4010', 280000);
    await journal('2028-09-10', '1000', '1110', 112000);

    // Closed today, open before: paid in full on 20 Sep 2028. Its own due_date
    // is a placeholder — a balance is due at sailing + term (15 Aug).
    const paid = await receivable({
      order_id: shipped.id, type: 'Balance', currency: 'USD', fx_rate: 280, base_amount_pkr: 28000,
      expected_amount: 100, received_amount: 100, outstanding: 0, status: 'Paid',
      due_date: '2028-12-31', created_at: '2028-08-01T10:00:00+05:00', updated_at: '2028-09-20T10:00:00+05:00',
    });
    const [p2] = await db('payments').insert({
      payment_no: `ZZ-AR-PAY2-${run}`, type: 'receipt', amount: 100, currency: 'USD', fx_rate: 280, base_amount_pkr: 28000,
      payment_method: 'bank_transfer', payment_date: '2028-09-20', linked_receivable_id: paid.id, status: 'Confirmed',
    }).returning('*');
    made.payments.push(p2.id);
    // Written off: never open after its write-off; on a cancelled / draft order: never.
    await receivable({ entity: 'mill', type: 'Balance', currency: 'PKR', base_amount_pkr: 5000, expected_amount: 5000, received_amount: 0, outstanding: 0, status: 'Written Off', due_date: '2028-08-01', created_at: '2028-07-01T10:00:00+05:00' });
    const cancelled = await order('Cancelled');
    await receivable({ order_id: cancelled.id, type: 'Advance', currency: 'USD', fx_rate: 280, base_amount_pkr: 2800, expected_amount: 10, received_amount: 0, outstanding: 10, status: 'Pending', due_date: '2028-08-01', created_at: '2028-07-01T10:00:00+05:00' });
    const draft = await order('Draft');
    await receivable({ order_id: draft.id, type: 'Advance', currency: 'USD', fx_rate: 280, base_amount_pkr: 2800, expected_amount: 10, received_amount: 0, outstanding: 10, status: 'Pending', due_date: '2028-08-01', created_at: '2028-07-01T10:00:00+05:00' });
    // A PKR opening receivable: its own currency, never added to dollars.
    await receivable({ entity: 'mill', type: 'Balance', currency: 'PKR', base_amount_pkr: 50000, expected_amount: 50000, received_amount: 0, outstanding: 50000, status: 'Pending', due_date: '2028-06-01', created_at: '2028-05-01T10:00:00+05:00' });
  });

  afterAll(async () => {
    if (!db) return;
    await db('journal_lines').whereIn('journal_id', made.journals).del();
    await db('journal_entries').whereIn('id', made.journals).del();
    await db('payments').whereIn('id', made.payments).del();
    await db('receivables').whereIn('id', made.receivables).del();
    await db('export_orders').whereIn('id', made.orders).del();
    await db('customers').where({ id: customer.id }).del();
    await db('users').where({ id: user.id }).del();
    await db.destroy();
  });

  test('as at 31 Aug: aging total = sub-ledger = GL 1110, due that day so not overdue', async () => {
    const { rows } = await asAt.receivablesAsAt(db, { asOf: '2028-08-31', customerId: customer.id });
    const usd = mine(rows).filter((r) => r.currency === 'USD');
    // The golden row (1,000) and the not-yet-paid balance (100, due 15 Aug).
    const golden = usd.find((r) => r.expectedAmount === 1000);
    expect(golden).toMatchObject({ outstanding: 1000, outstandingPkr: 280000, bucket: 'current', overdue: false, daysPastDue: 0 });
    expect(usd.find((r) => r.expectedAmount === 100)).toMatchObject({ outstanding: 100, bucket: '1-30', overdue: true });
    const s = asAt.summarizeReceivables([golden], { asOf: '2028-08-31' });
    const agingTotal = Object.values(s.byCurrency.USD.buckets).reduce((a, b) => a + b, 0);
    expect(agingTotal).toBe(1000);
    expect(s.pkrEquiv.outstanding.pkr).toBe(await gl1110('2028-08-31'));
  });

  test('as at 30 Sep: USD 600 open, 30 days past due, ≈ Rs 168,000 = GL 1110 (outstanding share, not the booked total)', async () => {
    const { rows } = await asAt.receivablesAsAt(db, { asOf: '2028-09-30', customerId: customer.id });
    const usd = mine(rows).filter((r) => r.currency === 'USD');
    expect(usd).toHaveLength(1); // the 100 balance was paid on 20 Sep
    expect(usd[0]).toMatchObject({ outstanding: 600, outstandingPkr: 168000, bucket: '1-30', daysPastDue: 30, overdue: true });
    const s = asAt.summarizeReceivables(usd, { asOf: '2028-09-30' });
    expect(Object.values(s.byCurrency.USD.buckets).reduce((a, b) => a + b, 0)).toBe(600);
    expect(s.byCurrency.USD.overdueAmount).toBe(600);
    expect(s.pkrEquiv.outstanding.pkr).toBe(168000);
    expect(await gl1110('2028-09-30')).toBe(168000);
  });

  test('before it was raised there is nothing; closed / inactive-order rows never count; PKR stays PKR', async () => {
    const jul = await asAt.receivablesAsAt(db, { asOf: '2028-07-31', customerId: customer.id });
    expect(mine(jul.rows).filter((r) => r.currency === 'USD')).toHaveLength(0);
    const later = await asAt.receivablesAsAt(db, { asOf: '2028-12-31', customerId: customer.id });
    const s = asAt.summarizeReceivables(mine(later.rows), { asOf: later.asOf });
    expect(s.byCurrency.USD).toMatchObject({ count: 1, outstanding: 600 }); // not the paid, cancelled or draft rows
    expect(s.byCurrency.PKR).toMatchObject({ count: 1, outstanding: 50000 }); // not the written-off one
    expect(s.byCurrency.PKR.buckets['90+']).toBe(50000);
  });

  test('Money In summary and the printable AR aging read the same rows, per currency', async () => {
    const summary = await asAt.moneyInSummary(db, { asOf: '2028-09-30', from: '2028-09-01' });
    expect(summary.asOf).toBe('2028-09-30');
    // Collected in September: this suite's two USD receipts (other suites may add their own).
    expect(summary.collected.USD.amount).toBeGreaterThanOrEqual(500);
    expect(summary.byCurrency.USD.outstanding).toBeGreaterThanOrEqual(600);
    expect(summary).not.toHaveProperty('total');

    const reporting = require('../modules/analytics/reporting.controller');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await reporting.printableArAging({ query: { as_of: '2028-09-30' } }, res);
    expect(res.statusCode).toBe(200);
    const data = res.body.data;
    expect(data.asOf).toBe('2028-09-30');
    const row = data.rows.find((r) => r.recvNo === `ZZ-AR-${run}-0`);
    expect(row).toMatchObject({ currency: 'USD', outstanding: 600, outstandingPkr: 168000, bucket: '1-30' });
    for (const [cur, c] of Object.entries(data.byCurrency)) {
      const sum = Object.values(c.buckets).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(c.outstanding, 2);
      expect(data.rows.filter((r) => r.currency === cur).reduce((a, r) => a + r.outstanding, 0)).toBeCloseTo(c.outstanding, 2);
    }
  });
});
