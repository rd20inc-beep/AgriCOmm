/**
 * Owner decision B1: an uncleared cheque can be marked BOUNCED. Run on the
 * in-memory knex so the real controller, engine and settlement code executes.
 *
 *  - An uncleared cheque settled nothing, moved nothing and posted nothing, so
 *    a bounce un-settles nothing either: the document is reopened because the
 *    bounced cheque no longer counts against its outstanding.
 *  - The optional bank return charge posts Dr 6200 / Cr the charged account's
 *    OWN GL (glAccountFor) and writes a 'debit' bank row.
 *  - A cleared, reversed or already-bounced cheque is refused (409); a
 *    bounced cheque can be neither cleared nor reversed afterwards.
 *  - Joi: reason required; every field the handler reads is declared.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
let mockDocSeq = 0;
jest.mock('../utils/docNumber', () => ({
  nextDocNo: jest.fn(async (_trx, { prefix }) => `${prefix}${++mockDocSeq}`),
}));
jest.mock('../modules/accounting/accounting.service', () => {
  const journals = [];
  return {
    journals,
    createJournal: jest.fn(async (_trx, j) => { journals.push(j); return { id: 500 + journals.length }; }),
    postJournal: jest.fn(async () => ({})),
    autoPost: jest.fn(async () => null),
  };
});

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const financeController = require('../modules/finance/finance.controller');
const schemas = require('../middleware/schemas');
const { bounceBlockedReason } = require('../modules/finance/chequeBounce');

// ids: 1000→10, 2010→14, 6200→20; account 8's own GL is 1011 → 30.
const COA = [
  { id: 10, code: '1000', name: 'Cash & Bank' }, { id: 12, code: '1120', name: 'Local AR' },
  { id: 14, code: '2010', name: 'Supplier Payable' }, { id: 20, code: '6200', name: 'Bank Charges' },
  { id: 30, code: '1011', name: 'Meezan Bank' },
];
const TODAY = new Date().toISOString().slice(0, 10);

function seed(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries({ chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [], payments: [], ...tables })) {
    db.tables[k] = rows.map((r) => ({ ...r }));
  }
  db.locks.length = 0;
  accounting.journals.length = 0;
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const row = (table, id) => db.tables[table].find((r) => String(r.id) === String(id));
const lines = (j) => j.lines.map((l) => [l.account_id, l.debit, l.credit]);
const lastPayment = () => db.tables.payments[db.tables.payments.length - 1];
async function call(handler, id, body = {}) {
  const r = res();
  await financeController[handler]({ params: { id: String(id) }, body, user: { id: 1 } }, r);
  return r;
}

const tables = () => ({
  payables: [{ id: 21, entity: 'mill', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', supplier_id: 3 }],
  bank_accounts: [{ id: 8, name: 'Meezan', currency: 'PKR', current_balance: 5000, type: 'bank', entity: 'mill', gl_account_id: 30 }],
});
const chequeBody = { type: 'payment', linked_payable_id: 21, amount: 1000, currency: 'PKR', payment_method: 'cheque', bank_account_id: 8, payment_date: TODAY, due_date: TODAY };

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('bouncing an uncleared cheque', () => {
  test('marks it Bounced, settles nothing back, posts nothing, and reopens the payable', async () => {
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    const p = lastPayment();
    // While the cheque is in the post, a second payment of the same bill is refused.
    const blocked = res();
    await financeController.recordPayment({ body: { ...chequeBody, payment_method: 'bank_transfer' }, user: { id: 1 } }, blocked);
    expect(blocked.statusCode).toBe(400);

    const r = await call('bounceCheque', p.id, { reason: 'Insufficient funds' });
    expect(r.statusCode).toBe(200);
    expect(row('payments', p.id)).toMatchObject({ status: 'Bounced', bounce_reason: 'Insufficient funds', bounced_by: 1, cleared: false });
    // Nothing was settled by the cheque, so nothing is un-settled.
    expect(row('payables', 21)).toMatchObject({ paid_amount: 0, outstanding: 1000, status: 'Pending' });
    expect(row('bank_accounts', 8).current_balance).toBe(5000);
    expect(db.tables.bank_transactions).toEqual([]);
    expect(accounting.journals).toEqual([]);
    expect(r.body.data.charge).toBeNull();

    // Reopened: the full amount can be paid again.
    const again = res();
    await financeController.recordPayment({ body: { ...chequeBody, payment_method: 'bank_transfer' }, user: { id: 1 } }, again);
    expect(again.statusCode).toBe(201);
    expect(row('payables', 21)).toMatchObject({ paid_amount: 1000, status: 'Paid' });
  });

  test('the bank return charge posts Dr 6200 / Cr the account\'s own GL and a debit bank row', async () => {
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    const p = lastPayment();
    const r = await call('bounceCheque', p.id, { reason: 'Signature mismatch', bank_charge: 350, charge_date: '2026-10-08' });
    expect(r.statusCode).toBe(200);
    expect(r.body.data.charge).toMatchObject({ amount: 350, currency: 'PKR', amountPkr: 350, accountId: 8 });
    expect(row('bank_accounts', 8).current_balance).toBe(4650);
    expect(db.tables.bank_transactions).toHaveLength(1);
    expect(db.tables.bank_transactions[0]).toMatchObject({
      bank_account_id: 8, type: 'debit', amount: 350, currency: 'PKR', status: 'posted', source: 'cheque_bounce',
      category: 'Bank Charges', linked_payment_id: p.id, transaction_date: '2026-10-08',
    });
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Cheque Bounce Charge', refNo: p.payment_no, entity: 'mill', currency: 'PKR', date: '2026-10-08' });
    // 6200 debit; the credit is the account's own GL (1011 → id 30), never 1000.
    expect(lines(accounting.journals[0])).toEqual([[20, 350, 0], [30, 0, 350]]);
    // The payable is still untouched.
    expect(row('payables', 21).paid_amount).toBe(0);
  });

  test('a charge needs an account when the cheque named none', async () => {
    seed(tables());
    await financeController.recordPayment({ body: { ...chequeBody, bank_account_id: null }, user: { id: 1 } }, res());
    const p = lastPayment();
    const r = await call('bounceCheque', p.id, { reason: 'x', bank_charge: 100 });
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Choose the account the bank charged/);
    const ok = await call('bounceCheque', p.id, { reason: 'x', bank_charge: 100, charge_account_id: 8 });
    expect(ok.statusCode).toBe(200);
    expect(row('bank_accounts', 8).current_balance).toBe(4900);
  });

  test('a cleared cheque is refused (409) — reverse it instead', async () => {
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    const p = lastPayment();
    expect((await call('clearCheque', p.id)).statusCode).toBe(200);
    const journals = accounting.journals.length;
    const r = await call('bounceCheque', p.id, { reason: 'late', bank_charge: 100 });
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/cleared/);
    expect(row('payments', p.id).status).not.toBe('Bounced');
    expect(accounting.journals).toHaveLength(journals);
    expect(row('bank_accounts', 8).current_balance).toBe(4000);
  });

  test('a reversed cheque is refused (409)', async () => {
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    const p = lastPayment();
    expect((await call('reversePayment', p.id, { reason: 'typo' })).statusCode).toBe(200);
    const r = await call('bounceCheque', p.id, { reason: 'x' });
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/reversed/);
  });

  test('bouncing twice is refused, and a bounced cheque can be neither cleared nor reversed', async () => {
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    const p = lastPayment();
    expect((await call('bounceCheque', p.id, { reason: 'x' })).statusCode).toBe(200);
    expect((await call('bounceCheque', p.id, { reason: 'x' })).statusCode).toBe(409);
    expect((await call('clearCheque', p.id)).statusCode).toBe(409);
    expect((await call('reversePayment', p.id, { reason: 'x' })).statusCode).toBe(409);
    expect(row('payables', 21).paid_amount).toBe(0);
    expect(accounting.journals).toEqual([]);
  });

  test('a non-cheque payment is refused (400); a missing one is 404; a reason is required', async () => {
    seed(tables());
    await financeController.recordPayment({ body: { ...chequeBody, payment_method: 'bank_transfer' }, user: { id: 1 } }, res());
    const p = lastPayment();
    expect((await call('bounceCheque', p.id, { reason: 'x' })).statusCode).toBe(400);
    expect((await call('bounceCheque', 999, { reason: 'x' })).statusCode).toBe(404);
    seed(tables());
    await financeController.recordPayment({ body: chequeBody, user: { id: 1 } }, res());
    expect((await call('bounceCheque', lastPayment().id, { reason: '  ' })).statusCode).toBe(400);
  });

  test('a legacy cheque journalled at recording gets the signed delta of that journal', async () => {
    seed({
      ...tables(),
      payments: [{ id: 70, payment_no: 'PAY-070', type: 'payment', payment_method: 'cheque', cleared: false, status: 'Confirmed', amount: 1000, currency: 'PKR', bank_account_id: 8, linked_payable_id: 21 }],
      journal_entries: [{ id: 900, ref_no: 'PAY-070', ref_type: 'Payment', status: 'Posted', entity: 'mill', journal_no: 'JE-900' }],
      journal_lines: [
        { id: 1, journal_id: 900, account_id: 14, debit: 1000, credit: 0, narration: 'DR 2010' },
        { id: 2, journal_id: 900, account_id: 30, debit: 0, credit: 1000, narration: 'CR 1011' },
      ],
    });
    const r = await call('bounceCheque', 70, { reason: 'returned' });
    expect(r.statusCode).toBe(200);
    expect(r.body.data.mirrored).toBe(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Cheque Bounce', refNo: 'PAY-070' });
    expect(lines(accounting.journals[0])).toEqual([[14, 0, 1000], [30, 1000, 0]]);
    // The original stays Posted (signed delta, never reverse-and-repost).
    expect(row('journal_entries', 900).status).toBe('Posted');
  });

  test('a receipt cheque, once bounced, no longer holds the receivable or its local sale', async () => {
    seed({
      local_sales: [{ id: 5, sale_no: 'LS-5', total_amount: 800, paid_amount: 0, due_amount: 800, payment_status: 'Credit' }],
      receivables: [{ id: 31, local_sale_id: 5, expected_amount: 800, received_amount: 0, outstanding: 800, status: 'Pending', entity: 'mill' }],
      payments: [{ id: 71, payment_no: 'PL-71', type: 'receipt', payment_method: 'cheque', cleared: false, status: 'Confirmed', amount: 800, currency: 'PKR', local_sale_id: 5, linked_receivable_id: 31 }],
      bank_accounts: tables().bank_accounts,
    });
    const { pendingChequeTotal } = require('../modules/finance/paymentSettlement');
    expect(await pendingChequeTotal(db, { receivableId: 31 })).toBe(800);
    const r = await call('bounceCheque', 71, { reason: 'stopped' });
    expect(r.statusCode).toBe(200);
    expect(await pendingChequeTotal(db, { receivableId: 31 })).toBe(0);
    expect(row('local_sales', 5)).toMatchObject({ paid_amount: 0, due_amount: 800 });
    expect(row('receivables', 31)).toMatchObject({ received_amount: 0, outstanding: 800 });
  });
});

describe('bounceBlockedReason', () => {
  test('only a confirmed, uncleared cheque can bounce', () => {
    const base = { payment_method: 'cheque', cleared: false, status: 'Confirmed' };
    expect(bounceBlockedReason(base)).toBeNull();
    expect(bounceBlockedReason({ ...base, cleared: true })).toMatch(/cleared/);
    expect(bounceBlockedReason({ ...base, status: 'Reversed' })).toMatch(/reversed/);
    expect(bounceBlockedReason({ ...base, status: 'Bounced' })).toMatch(/already bounced/);
    expect(bounceBlockedReason({ ...base, status: 'Pending Finance Confirmation' })).toMatch(/never confirmed/);
    expect(bounceBlockedReason({ ...base, payment_method: 'cash' })).toMatch(/Only a cheque/);
  });
});

describe('Joi + route', () => {
  const run = (schema, body) => schema.validate(body, { stripUnknown: true, abortEarly: false });
  test('reason is required; every field the handler reads survives validate()', () => {
    expect(run(schemas.bounceCheque, {}).error).toBeTruthy();
    expect(run(schemas.bounceCheque, { reason: '' }).error).toBeTruthy();
    const { error, value } = run(schemas.bounceCheque, { reason: 'x', bank_charge: 10, charge_date: '2026-10-08', charge_account_id: 3 });
    expect(error).toBeUndefined();
    expect(value).toEqual({ reason: 'x', bank_charge: 10, charge_date: '2026-10-08', charge_account_id: 3 });
  });
  test('POST /payments/:id/bounce is finance.confirm_payment, validated and audited', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../modules/finance/finance.routes.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/payments\/:id\/bounce', authorize\('finance', 'confirm_payment'\),\s*validate\(schemas\.bounceCheque\),\s*auditAction\('bounce_cheque'/);
  });
});
